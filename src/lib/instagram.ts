// Publicação no Instagram via "Instagram API with Instagram Login" (produto
// lançado pelo Meta em 2024 — não exige Página do Facebook vinculada, só
// conta Business/Creator). Fetch puro, mesmo espírito de bitrix/client.ts.
//
// Fluxo de publicação de imagem: cria um "container" de mídia (a foto +
// legenda), espera o Instagram processar, depois publica o container. Precisa
// de duas variáveis de ambiente: INSTAGRAM_ACCESS_TOKEN (token de longa
// duração gerado no painel do Meta) e INSTAGRAM_USER_ID (ID numérico da
// conta, também mostrado no painel).

const GRAPH_BASE = "https://graph.instagram.com/v21.0";

function exigirEnv(nome: "INSTAGRAM_ACCESS_TOKEN" | "INSTAGRAM_USER_ID"): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} não configurada`);
  return valor;
}

type ContainerStatus = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

async function chamarInstagram<T>(
  caminho: string,
  metodo: "GET" | "POST",
  params: Record<string, string>
): Promise<T> {
  const token = exigirEnv("INSTAGRAM_ACCESS_TOKEN");
  const busca = new URLSearchParams({ ...params, access_token: token });
  const url = metodo === "GET" ? `${GRAPH_BASE}${caminho}?${busca.toString()}` : `${GRAPH_BASE}${caminho}`;

  const resposta = await fetch(url, {
    method: metodo,
    body: metodo === "POST" ? busca : undefined,
    headers: metodo === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });

  const dados = await resposta.json();
  if (!resposta.ok || dados.error) {
    const msg = dados.error?.error_user_msg || dados.error?.message || `HTTP ${resposta.status}`;
    throw new Error(`Instagram ${caminho} falhou: ${msg}`);
  }
  return dados as T;
}

async function criarContainerMidia(imageUrl: string, caption: string): Promise<string> {
  const userId = exigirEnv("INSTAGRAM_USER_ID");
  const resposta = await chamarInstagram<{ id: string }>(`/${userId}/media`, "POST", {
    image_url: imageUrl,
    caption,
  });
  return resposta.id;
}

// O Instagram processa a imagem de forma assíncrona — precisa esperar
// status_code virar FINISHED antes de publicar, senão media_publish falha.
async function aguardarContainerPronto(containerId: string): Promise<void> {
  for (let tentativa = 0; tentativa < 15; tentativa++) {
    const status = await chamarInstagram<{ status_code: ContainerStatus }>(`/${containerId}`, "GET", {
      fields: "status_code",
    });
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(`Instagram não conseguiu processar a imagem (status: ${status.status_code})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Instagram demorou demais pra processar a imagem (timeout)");
}

async function publicarContainer(containerId: string): Promise<string> {
  const userId = exigirEnv("INSTAGRAM_USER_ID");
  const resposta = await chamarInstagram<{ id: string }>(`/${userId}/media_publish`, "POST", {
    creation_id: containerId,
  });
  return resposta.id;
}

// Publica uma imagem com legenda no Instagram e devolve o ID do post
// publicado. imageUrl precisa ser uma URL pública (o Instagram busca ela
// direto nos servidores do Meta, não aceita localhost).
export async function publicarPost(imageUrl: string, legenda: string): Promise<string> {
  const containerId = await criarContainerMidia(imageUrl, legenda);
  await aguardarContainerPronto(containerId);
  return publicarContainer(containerId);
}
