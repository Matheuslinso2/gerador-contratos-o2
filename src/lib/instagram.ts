// Publicação no Instagram via Ayrshare (https://www.ayrshare.com) — um
// intermediário que já resolveu a parte chata de virar "desenvolvedor" no
// Meta for Developers. O usuário conecta o Instagram uma vez no painel do
// Ayrshare (login simples, sem app nem verificação de desenvolvedor), e a
// gente só chama a API deles com uma chave. Fetch puro, mesmo espírito de
// bitrix/client.ts.
//
// Precisa de uma variável de ambiente: AYRSHARE_API_KEY (painel do Ayrshare
// → API Key).

const AYRSHARE_BASE = "https://api.ayrshare.com/api";

type RespostaPost = {
  status: "success" | "error";
  postIds?: { status: string; id?: string; platform: string; postUrl?: string; errors?: unknown }[];
  errors?: unknown;
  message?: string;
};

// Publica uma imagem com legenda no Instagram e devolve a URL do post
// publicado. imageUrl precisa ser uma URL pública (o Ayrshare busca ela
// direto, não aceita localhost).
export async function publicarPost(imageUrl: string, legenda: string): Promise<string> {
  const apiKey = process.env.AYRSHARE_API_KEY;
  if (!apiKey) throw new Error("AYRSHARE_API_KEY não configurada");

  const resposta = await fetch(`${AYRSHARE_BASE}/post`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      post: legenda,
      platforms: ["instagram"],
      mediaUrls: [imageUrl],
    }),
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });

  const dados = (await resposta.json()) as RespostaPost;

  if (!resposta.ok || dados.status === "error") {
    throw new Error(`Ayrshare falhou: ${dados.message || JSON.stringify(dados.errors) || `HTTP ${resposta.status}`}`);
  }

  const resultadoInstagram = dados.postIds?.find((p) => p.platform === "instagram");
  if (!resultadoInstagram || resultadoInstagram.status !== "success") {
    throw new Error(`Ayrshare não confirmou a publicação no Instagram: ${JSON.stringify(resultadoInstagram?.errors ?? dados)}`);
  }

  return resultadoInstagram.postUrl ?? resultadoInstagram.id ?? "publicado";
}
