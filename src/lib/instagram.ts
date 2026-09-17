import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

// Publicação no Instagram via API oficial da Meta (Instagram API with
// Instagram Login, graph.instagram.com) -- substituiu o Ayrshare em
// 15/09/2026 (decisão do Matheus, pra eliminar o custo mensal do
// intermediário). Sem app review necessário porque só publica na própria
// conta que fez login no app (Development Mode do app Meta basta).
//
// Fluxo: o Matheus conecta a conta uma vez em /social-media
// (src/app/api/instagram/conectar + .../callback), o token de longa duração
// (60 dias) fica em instagram_auth (schema_instagram_auth.sql), e um cron
// diário (src/app/api/cron/renovar-token-instagram) renova antes de
// expirar. Esta função só CONSOME o token já válido -- não tenta renovar
// aqui (é papel exclusivo do cron), pra não misturar responsabilidade e pra
// uma publicação nunca ficar lenta esperando uma renovação.

const ID_LINHA = "default";
const GRAPH_BASE = "https://graph.instagram.com/v25.0";

export type InstagramAuth = {
  access_token: string;
  instagram_business_account_id: string;
  instagram_username: string | null;
  expira_em: string;
};

// Margem de segurança: mesmo espírito de appAuth.ts (Bitrix) -- se o token
// já expirou (ou expira nos próximos 5 min), melhor falhar com mensagem
// clara agora do que arriscar uma chamada em voo exatamente na virada.
const MARGEM_SEGURANCA_MS = 5 * 60 * 1000;

export async function obterAuthValida(): Promise<InstagramAuth> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("instagram_auth").select("*").eq("id", ID_LINHA).maybeSingle();
  if (error) throw new Error(`Falha ao ler token do Instagram: ${error.message}`);
  if (!data) {
    throw new Error("Instagram não conectado — acesse /social-media e clique em \"Conectar Instagram\".");
  }
  const expiraEm = new Date(data.expira_em).getTime();
  if (Date.now() > expiraEm - MARGEM_SEGURANCA_MS) {
    throw new Error(
      "Token do Instagram expirado — o cron de renovação automática deveria ter renovado antes disso. Reconecte em /social-media."
    );
  }
  return data as InstagramAuth;
}

// Status de conexão pra exibir em /social-media (sem expor o token em si).
export async function obterStatusConexao(): Promise<
  { conectado: false } | { conectado: true; username: string | null; expiraEm: string }
> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("instagram_auth").select("instagram_username, expira_em").eq("id", ID_LINHA).maybeSingle();
  if (!data) return { conectado: false };
  return { conectado: true, username: data.instagram_username, expiraEm: data.expira_em };
}

type ErroGraphApi = { error?: { message?: string; type?: string; code?: number } };

async function chamarGraphApi<T>(url: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const dados = (await resposta.json()) as T & ErroGraphApi;
  if (!resposta.ok || dados.error) {
    const { message, type, code } = dados.error ?? {};
    throw new Error(`Instagram${code ? ` (${code}${type ? ` ${type}` : ""})` : ""}: ${message || `HTTP ${resposta.status}`}`);
  }
  return dados;
}

async function aguardar(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Conta oficial da O2 no Instagram -- sempre marcada nas publicações (pedido
// do Matheus, 15/09/2026). A API não tem como enviar convite de COLABORAÇÃO
// de verdade na hora de publicar (confirmado no changelog oficial da Meta:
// só existe endpoint pra ACEITAR convite já recebido, não pra criar um) --
// isso só dá pra fazer manualmente dentro do app, depois de publicado. Por
// isso aqui é uma combinação das duas formas que a API realmente suporta:
// menção no texto da legenda (sempre funciona) + marcação na foto via
// user_tags (pode ficar pendente de aprovação do lado da conta @o2seguros,
// dependendo da configuração de marcação dela).
const CONTA_COLAB_USERNAME = "o2seguros";

// Publica uma imagem com legenda no Instagram e devolve o link do post
// publicado (permalink). imageUrl precisa ser uma URL pública (a Graph API
// busca ela direto, não aceita localhost) -- ver src/app/api/social/imagem.
export async function publicarPost(imageUrl: string, legenda: string): Promise<string> {
  const auth = await obterAuthValida();
  const contaId = auth.instagram_business_account_id;
  const legendaComMarcacao = `${legenda}\n\n@${CONTA_COLAB_USERNAME}`;

  // Passo 1: cria o container de mídia (a Graph API baixa a imagem da URL e
  // processa em segundo plano, por isso o status_code pode vir "IN_PROGRESS").
  // Tenta com user_tags (marcação na foto) primeiro; a documentação da Meta
  // pra essa variante da API não deixa 100% claro o formato de coordenadas
  // exigido, então se a marcação na foto for rejeitada, tenta de novo sem
  // ela -- a publicação em si nunca deve falhar por causa disso, só perde a
  // marcação na foto (a menção na legenda continua garantida de qualquer jeito).
  let container: { id: string };
  try {
    container = await chamarGraphApi<{ id: string }>(`${GRAPH_BASE}/${contaId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: legendaComMarcacao,
        user_tags: [{ username: CONTA_COLAB_USERNAME, x: 0.5, y: 0.9 }],
        access_token: auth.access_token,
      }),
    });
  } catch (erroComMarcacao) {
    console.warn("Instagram: falha ao marcar @o2seguros na foto, publicando sem a marcação:", erroComMarcacao);
    container = await chamarGraphApi<{ id: string }>(`${GRAPH_BASE}/${contaId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, caption: legendaComMarcacao, access_token: auth.access_token }),
    });
  }

  // Passo 2: espera o container terminar de processar antes de publicar --
  // publicar um container ainda "IN_PROGRESS" dá erro na Graph API. 3
  // tentativas com 2s de intervalo é folga generosa pra uma imagem 1080x1080
  // (normalmente processa em menos de 1s).
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const status = await chamarGraphApi<{ status_code: string }>(
      `${GRAPH_BASE}/${container.id}?fields=status_code&access_token=${encodeURIComponent(auth.access_token)}`
    );
    if (status.status_code === "FINISHED") break;
    if (status.status_code === "ERROR") throw new Error("Instagram: falha ao processar a imagem do post (status_code ERROR).");
    await aguardar(2000);
  }

  // Passo 3: publica o container.
  const publicado = await chamarGraphApi<{ id: string }>(`${GRAPH_BASE}/${contaId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: container.id, access_token: auth.access_token }),
  });

  // Passo 4: busca o link clicável do post (pra conferir depois sem precisar
  // procurar manualmente no Instagram) -- se essa chamada falhar por
  // qualquer motivo, o post já foi publicado de verdade, então não vale
  // jogar erro aqui; só cai pro ID puro como fallback.
  try {
    const detalhe = await chamarGraphApi<{ permalink: string }>(
      `${GRAPH_BASE}/${publicado.id}?fields=permalink&access_token=${encodeURIComponent(auth.access_token)}`
    );
    return detalhe.permalink;
  } catch {
    return publicado.id;
  }
}

// Publica um carrossel (2 a 10 imagens conforme a Graph API, mas aqui sempre
// 4-5, geradas por gerarConteudoCarrossel*) e devolve o link do post
// publicado. Cada imagem primeiro vira um container "item" isolado
// (is_carousel_item: true), só depois entram todos juntos num container pai
// (media_type: CAROUSEL) que é o que de fato se publica.
export async function publicarCarrossel(imageUrls: string[], legenda: string): Promise<string> {
  const auth = await obterAuthValida();
  const contaId = auth.instagram_business_account_id;
  const legendaComMarcacao = `${legenda}\n\n@${CONTA_COLAB_USERNAME}`;

  // Passo 1: cria um container por imagem, cada um marcado como item de
  // carrossel (sem caption individual -- a legenda só vai no container pai).
  const itens: { id: string }[] = [];
  for (const imageUrl of imageUrls) {
    const item = await chamarGraphApi<{ id: string }>(`${GRAPH_BASE}/${contaId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, is_carousel_item: true, access_token: auth.access_token }),
    });
    itens.push(item);
  }

  // Passo 2: espera cada item terminar de processar antes de montar o
  // container pai -- mesmo cuidado do publicarPost, aplicado item a item.
  for (const item of itens) {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const status = await chamarGraphApi<{ status_code: string }>(
        `${GRAPH_BASE}/${item.id}?fields=status_code&access_token=${encodeURIComponent(auth.access_token)}`
      );
      if (status.status_code === "FINISHED") break;
      if (status.status_code === "ERROR") throw new Error("Instagram: falha ao processar uma das imagens do carrossel (status_code ERROR).");
      await aguardar(2000);
    }
  }

  // Passo 3: cria o container pai do carrossel, com a legenda. A Graph API
  // não aceita user_tags no container pai do carrossel (só em item avulso),
  // então a marcação de @o2seguros aqui fica só na menção da legenda mesmo.
  const containerPai = await chamarGraphApi<{ id: string }>(`${GRAPH_BASE}/${contaId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "CAROUSEL",
      children: itens.map((item) => item.id),
      caption: legendaComMarcacao,
      access_token: auth.access_token,
    }),
  });

  // Passo 4: publica o container pai.
  const publicado = await chamarGraphApi<{ id: string }>(`${GRAPH_BASE}/${contaId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerPai.id, access_token: auth.access_token }),
  });

  try {
    const detalhe = await chamarGraphApi<{ permalink: string }>(
      `${GRAPH_BASE}/${publicado.id}?fields=permalink&access_token=${encodeURIComponent(auth.access_token)}`
    );
    return detalhe.permalink;
  } catch {
    return publicado.id;
  }
}

// ---------------------------------------------------------------------------
// Troca/renovação de token -- usadas só pela rota de callback do OAuth
// (troca inicial) e pelo cron de renovação (src/app/api/cron/
// renovar-token-instagram). Endpoints e nomes de parâmetro confirmados
// contra a documentação oficial da Meta em 15/09/2026
// (developers.facebook.com/docs/instagram-platform/reference/access_token
// e .../refresh_access_token).
// ---------------------------------------------------------------------------

export async function salvarAuth(params: {
  accessToken: string;
  instagramBusinessAccountId: string;
  instagramUsername: string | null;
  expiresInSegundos: number;
}) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("instagram_auth").upsert({
    id: ID_LINHA,
    access_token: params.accessToken,
    instagram_business_account_id: params.instagramBusinessAccountId,
    instagram_username: params.instagramUsername,
    expira_em: new Date(Date.now() + params.expiresInSegundos * 1000).toISOString(),
    atualizado_em: new Date().toISOString(),
  });
  if (error) throw new Error(`Falha ao salvar token do Instagram: ${error.message}`);
}

// Troca o "code" do OAuth por um token de curta duração (1h) -- primeiro
// passo depois do redirect de volta em /api/instagram/callback.
export async function trocarCodePorTokenCurto(code: string, redirectUri: string): Promise<{ accessToken: string }> {
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appId || !appSecret) throw new Error("INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET não configuradas.");

  const body = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });
  const dados = await chamarGraphApi<{ access_token: string }>("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return { accessToken: dados.access_token };
}

// Troca o token de curta duração (1h) pelo de longa duração (60 dias).
export async function trocarPorTokenLongo(tokenCurto: string): Promise<{ accessToken: string; expiresInSegundos: number }> {
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  if (!appSecret) throw new Error("INSTAGRAM_APP_SECRET não configurada.");

  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", tokenCurto);

  const dados = await chamarGraphApi<{ access_token: string; expires_in: number }>(url.toString());
  return { accessToken: dados.access_token, expiresInSegundos: dados.expires_in };
}

// Descobre a conta vinculada ao token (user_id = instagram_business_account_id
// pra essa API; username só pra exibir na tela de status).
export async function obterContaDoToken(accessToken: string): Promise<{ userId: string; username: string }> {
  const url = new URL(`${GRAPH_BASE}/me`);
  url.searchParams.set("fields", "user_id,username");
  url.searchParams.set("access_token", accessToken);
  const dados = await chamarGraphApi<{ user_id: string; username: string }>(url.toString());
  return { userId: dados.user_id, username: dados.username };
}

// Renova um token de longa duração ainda válido -- só funciona se o token
// ainda não tiver expirado de verdade (se já expirou, não tem como recuperar
// sem passar pelo login OAuth de novo).
export async function renovarTokenLongo(tokenAtual: string): Promise<{ accessToken: string; expiresInSegundos: number }> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", tokenAtual);

  const dados = await chamarGraphApi<{ access_token: string; expires_in: number }>(url.toString());
  return { accessToken: dados.access_token, expiresInSegundos: dados.expires_in };
}

// Renova o token guardado se estiver perto de expirar -- chamado pelo cron
// diário. Não faz nada (sem erro) se ainda não conectou, ou se faltar mais
// de DIAS_MARGEM_RENOVACAO dias pra expirar.
const DIAS_MARGEM_RENOVACAO = 10;

export async function renovarTokenInstagramSeNecessario(): Promise<
  { acao: "nada_a_fazer"; motivo: string } | { acao: "renovado"; expiraEm: string } | { acao: "falhou"; erro: string }
> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("instagram_auth").select("*").eq("id", ID_LINHA).maybeSingle();
  if (!data) return { acao: "nada_a_fazer", motivo: "Instagram ainda não conectado." };

  const diasParaExpirar = (new Date(data.expira_em).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (diasParaExpirar > DIAS_MARGEM_RENOVACAO) {
    return { acao: "nada_a_fazer", motivo: `Faltam ${diasParaExpirar.toFixed(1)} dias pra expirar, ainda dentro da margem.` };
  }

  try {
    const renovado = await renovarTokenLongo(data.access_token);
    await salvarAuth({
      accessToken: renovado.accessToken,
      instagramBusinessAccountId: data.instagram_business_account_id,
      instagramUsername: data.instagram_username,
      expiresInSegundos: renovado.expiresInSegundos,
    });
    return { acao: "renovado", expiraEm: new Date(Date.now() + renovado.expiresInSegundos * 1000).toISOString() };
  } catch (erro) {
    return { acao: "falhou", erro: erro instanceof Error ? erro.message : String(erro) };
  }
}
