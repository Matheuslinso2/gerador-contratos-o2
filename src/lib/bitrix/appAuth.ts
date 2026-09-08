import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

// Autenticação do aplicativo local do Bitrix (Fase 0 do e-mail dentro do
// card) -- diferente do resto de src/lib/bitrix/*, que usa um webhook
// estático (BITRIX_WEBHOOK_URL). Um app local usa OAuth: token de acesso de
// curta duração + token de refresh, os dois reemitidos pelo Bitrix a cada
// vez que o placement é aberto (POST em /bitrix-app/card-email) e também
// renováveis via oauth.bitrix.info quando expiram. Só existe 1 portal aqui,
// por isso a linha 'default' na tabela em vez de multi-tenant de verdade.

const ID_LINHA = "default";

type LinhaAuth = {
  dominio: string;
  member_id: string;
  access_token: string;
  refresh_token: string;
  expira_em: string;
};

export async function salvarInstalacao(params: {
  dominio: string;
  memberId: string;
  accessToken: string;
  refreshToken: string;
  expiresInSegundos: number;
}) {
  const supabase = createServiceClient();
  const expiraEm = new Date(Date.now() + params.expiresInSegundos * 1000).toISOString();
  const { error } = await supabase.from("bitrix_app_auth").upsert({
    id: ID_LINHA,
    dominio: params.dominio,
    member_id: params.memberId,
    access_token: params.accessToken,
    refresh_token: params.refreshToken,
    expira_em: expiraEm,
    atualizado_em: new Date().toISOString(),
  });
  if (error) throw new Error(`Falha ao salvar instalação do app Bitrix: ${error.message}`);
}

// Bitrix reemite token novo a cada abertura do placement -- se o refresh
// manual (via oauth.bitrix.info) nunca chegar a ser necessário na prática
// porque o usuário sempre reabre o card antes de expirar, tudo bem: o
// refresh aqui é só um reforço para chamadas de servidor feitas fora de uma
// abertura de placement (ex: processar resposta de e-mail chegando via
// webhook do Cloudflare, na Fase 2).
async function renovarToken(linha: LinhaAuth): Promise<LinhaAuth> {
  const clientId = process.env.BITRIX_APP_CLIENT_ID;
  const clientSecret = process.env.BITRIX_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("BITRIX_APP_CLIENT_ID/BITRIX_APP_CLIENT_SECRET não configuradas -- necessárias para renovar o token do app local.");
  }

  const url = new URL("https://oauth.bitrix.info/oauth/token/");
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("client_secret", clientSecret);
  url.searchParams.set("refresh_token", linha.refresh_token);

  const resposta = await fetch(url.toString(), { cache: "no-store", signal: AbortSignal.timeout(15000) });
  const dados = await resposta.json();
  if (!resposta.ok || dados.error) {
    throw new Error(`Falha ao renovar token do app Bitrix: ${dados.error_description || dados.error || `HTTP ${resposta.status}`}`);
  }

  await salvarInstalacao({
    dominio: linha.dominio,
    memberId: linha.member_id,
    accessToken: dados.access_token,
    refreshToken: dados.refresh_token,
    expiresInSegundos: Number(dados.expires_in ?? 3600),
  });

  return {
    ...linha,
    access_token: dados.access_token,
    refresh_token: dados.refresh_token,
    expira_em: new Date(Date.now() + Number(dados.expires_in ?? 3600) * 1000).toISOString(),
  };
}

// Margem de segurança: renova um pouco antes de expirar de verdade, para não
// arriscar uma chamada em voo no exato instante da expiração.
const MARGEM_SEGURANCA_MS = 5 * 60 * 1000;

async function obterAuthValida(): Promise<LinhaAuth> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("bitrix_app_auth").select("*").eq("id", ID_LINHA).maybeSingle();
  if (error) throw new Error(`Falha ao ler token do app Bitrix: ${error.message}`);
  if (!data) throw new Error("Aplicativo local do Bitrix ainda não foi instalado (tabela bitrix_app_auth vazia).");

  const expiraEm = new Date(data.expira_em).getTime();
  if (Date.now() > expiraEm - MARGEM_SEGURANCA_MS) return renovarToken(data as LinhaAuth);
  return data as LinhaAuth;
}

// Equivalente ao bitrix<T>() usado em src/lib/integracoes/*.ts, mas
// autenticando com o token OAuth do app local (auth no body) em vez de
// embutir a chave na própria URL do webhook.
export async function chamarBitrixComoApp<T>(metodo: string, params: Record<string, unknown> = {}): Promise<T> {
  const auth = await obterAuthValida();
  const resposta = await fetch(`https://${auth.dominio}/rest/${metodo}.json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...params, auth: auth.access_token }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const dados = await resposta.json();
  if (!resposta.ok || dados.error) {
    throw new Error(`Bitrix (app) ${metodo}: ${dados.error_description || dados.error || `HTTP ${resposta.status}`}`);
  }
  return dados as T;
}
