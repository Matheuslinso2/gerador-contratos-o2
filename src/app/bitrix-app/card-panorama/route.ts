import { NextRequest } from "next/server";
import { emailDoUsuarioBitrix, emitirPassePanorama } from "@/lib/bitrix/sessaoPanorama";
import { entityTypeIdPorPlacement, ENTITY_TYPE_ID_SEGURO_FIANCA } from "@/lib/bitrix/entidadesCard";

export const dynamic = "force-dynamic";

// Handler da aba "Panorama" dentro do card do Seguro Fiança no Bitrix
// (16/10/2026). O Bitrix abre a aba com um POST (AUTH_ID do usuário +
// PLACEMENT_OPTIONS com o ID do card) -- mesmo formato do "E-mail no card"
// (ver card-email/route.ts). Aqui só: confere o token no Bitrix, confirma
// que é alguém da equipe O2, emite o passe do card e redireciona o iframe
// pra tela do panorama (bitrix-app/panorama/[cardId]), que é a mesma do
// Workspace.

function pagina(corpo: string) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>Panorama — O2 Seguros</title></head>
<body style="font-family:system-ui,sans-serif;color:#01192e;padding:24px;">${corpo}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export async function POST(request: NextRequest) {
  const campos: Record<string, string> = {};
  try {
    const form = await request.formData();
    for (const [chave, valor] of form.entries()) campos[chave] = String(valor);
  } catch {
    // corpo vazio/inesperado -- cai na mensagem de erro abaixo
  }

  const placement = campos.PLACEMENT;
  if (placement && entityTypeIdPorPlacement(placement) !== ENTITY_TYPE_ID_SEGURO_FIANCA) {
    return pagina("<p>O Panorama de preços só existe nos cards de Seguro Fiança.</p>");
  }

  let cardId = 0;
  try {
    cardId = Number(JSON.parse(campos.PLACEMENT_OPTIONS ?? "{}").ID);
  } catch {
    cardId = 0;
  }
  if (!Number.isInteger(cardId) || cardId <= 0) {
    return pagina("<p>Não consegui identificar o card. Feche e abra de novo a aba.</p>");
  }

  const email = campos.AUTH_ID ? await emailDoUsuarioBitrix(campos.AUTH_ID) : null;
  if (!email) {
    return pagina("<p>Acesso ao Panorama só para a equipe O2 (usuário do Bitrix com e-mail @o2seguros.com.br).</p>");
  }

  const destino = `/bitrix-app/panorama/${cardId}?p=${encodeURIComponent(emitirPassePanorama(cardId, email))}`;
  return pagina(
    `<p>Abrindo o panorama…</p><script>location.replace(${JSON.stringify(destino)});</script>`
  );
}
