import { NextRequest } from "next/server";
import { emailDoUsuarioBitrix, emitirPasseCard } from "@/lib/bitrix/sessaoPanorama";
import { ENTITY_TYPE_ID_DEAL, entityTypeIdPorPlacement } from "@/lib/bitrix/entidadesCard";
import { chavePasseCampanha } from "@/lib/campanhas/panoramaDoCard";

export const dynamic = "force-dynamic";

// Handler da aba "Panorama da campanha" nos Negócios do Bitrix (30/10/2026).
// Mesmo formato das outras abas (card-panorama, card-apolice-mae): confere o
// token do Bitrix, confirma que é alguém da equipe O2, emite o passe amarrado a
// este card e abre bitrix-app/campanha/[cardId].

function pagina(corpo: string) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>Panorama da campanha — O2 Seguros</title></head>
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

  if (campos.PLACEMENT && entityTypeIdPorPlacement(campos.PLACEMENT) !== ENTITY_TYPE_ID_DEAL) {
    return pagina("<p>O Panorama da campanha existe só nos Negócios do funil Campanhas.</p>");
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
    return pagina("<p>Acesso só para a equipe O2 (usuário do Bitrix com e-mail @o2seguros.com.br).</p>");
  }

  const destino = `/bitrix-app/campanha/${cardId}?p=${encodeURIComponent(emitirPasseCard(chavePasseCampanha(cardId), email))}`;
  return pagina(`<p>Abrindo o panorama…</p><script>location.replace(${JSON.stringify(destino)});</script>`);
}
