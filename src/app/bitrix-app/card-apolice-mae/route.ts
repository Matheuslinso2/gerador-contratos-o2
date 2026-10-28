import { NextRequest } from "next/server";
import { emailDoUsuarioBitrix, emitirPasseCard } from "@/lib/bitrix/sessaoPanorama";
import { entityTypeIdPorPlacement } from "@/lib/bitrix/entidadesCard";
import { chavePasseApoliceMae, funilDaEntidade } from "@/lib/bitrix/apoliceMae";

export const dynamic = "force-dynamic";

// Handler da aba "Apólice-mãe" nos cards do Bitrix (28/10/2026). Mesmo
// formato da aba Panorama (ver card-panorama/route.ts): confere o token do
// Bitrix, confirma que é alguém da equipe O2, emite o passe amarrado a esta
// entidade + card e abre a tela bitrix-app/apolice-mae/[entidade]/[card].

function pagina(corpo: string) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>Apólice-mãe — O2 Seguros</title></head>
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

  const entityTypeId = campos.PLACEMENT ? entityTypeIdPorPlacement(campos.PLACEMENT) : null;
  if (!entityTypeId || !funilDaEntidade(entityTypeId)) {
    return pagina("<p>A aba Apólice-mãe existe só nos cards de endosso de Seguro Fiança, Ramos Elementares e Capitalização.</p>");
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

  const passe = emitirPasseCard(chavePasseApoliceMae(entityTypeId, cardId), email);
  const destino = `/bitrix-app/apolice-mae/${entityTypeId}/${cardId}?p=${encodeURIComponent(passe)}`;
  return pagina(`<p>Abrindo…</p><script>location.replace(${JSON.stringify(destino)});</script>`);
}
