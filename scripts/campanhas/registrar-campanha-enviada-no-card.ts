// Registra no campo de e-mails do card (Bitrix) campanhas JÁ enviadas por fora da conversa do card (pedido do Matheus, 05/11/2026): só vínculo e
// controle, NUNCA reenvia. Para cada imobiliária que recebeu e tem card ligado à campanha-base, cria no card a atividade de e-mail "enviado", com a
// data em que saiu e os endereços que receberam. Pula o que já estiver registrado (mesmo assunto, mesmo horário). Sem --executar, só mostra.
//   NODE_PATH="$TEMP/stub" npx tsx scripts/campanhas/registrar-campanha-enviada-no-card.ts <campanha_base_com_os_cards> <campanha_id>[,<campanha_id>...] [--executar]
process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { registrarAtividadeEmail } from "../../src/lib/bitrix/atividades";
import { chamarBitrixComoApp } from "../../src/lib/bitrix/appAuth";
import { COLUNAS_CAMPANHA_ENVIO, montarHtmlCampanha, personalizarCampanha, type CampanhaRow } from "../../src/lib/campanhas/processarLote";
import { linkDescadastro } from "../../src/lib/campanhas/unsubscribeToken";
import { nomeParaComunicacao } from "../../src/lib/nomeParaComunicacao";

const ENTITY_DEAL = 2;
const TOLERANCIA_MS = 30 * 60_000;

async function main() {
  const baseId = process.argv[2];
  const ids = (process.argv[3] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const executar = process.argv.includes("--executar");
  if (!baseId || !ids.length) throw new Error("Uso: registrar-campanha-enviada-no-card.ts <campanha_base> <campanha_id>[,<campanha_id>] [--executar]");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!;

  const { data: cards } = await db.from("campanhas_cards_bitrix").select("imobiliaria_id, bitrix_deal_id").eq("campanha_id", baseId);
  const cardDaImob = new Map(((cards ?? []) as { imobiliaria_id: string; bitrix_deal_id: number }[]).map((c) => [c.imobiliaria_id, Number(c.bitrix_deal_id)]));
  console.log(`cards ligados à campanha-base: ${cardDaImob.size}`);

  for (const campanhaId of ids) {
    const { data: campanha } = await db.from("campanhas").select(COLUNAS_CAMPANHA_ENVIO + ", nome").eq("id", campanhaId).single<CampanhaRow & { nome: string }>();
    if (!campanha) throw new Error(`campanha ${campanhaId} não encontrada`);
    const { data: envios } = await db.from("campanhas_envios").select("imobiliaria_id, email, enviado_em").eq("campanha_id", campanhaId).eq("status", "enviado").not("imobiliaria_id", "is", null);
    const porImob = new Map<string, { email: string; enviado_em: string }[]>();
    for (const e of (envios ?? []) as { imobiliaria_id: string; email: string; enviado_em: string }[]) porImob.set(e.imobiliaria_id, [...(porImob.get(e.imobiliaria_id) ?? []), e]);
    const { data: fichas } = await db.from("imobiliarias").select("id, nome, apelido").in("id", [...porImob.keys()]);
    const ficha = new Map(((fichas ?? []) as { id: string; nome: string; apelido: string | null }[]).map((f) => [f.id, f]));
    const resumo = { registrados: 0, jaRegistrados: 0, semCard: 0, falhas: [] as string[] };
    console.log(`\n== ${campanha.nome} (${campanhaId.slice(0, 8)}): ${porImob.size} imobiliária(s) com e-mail enviado ==`);

    for (const [imobId, lista] of porImob) {
      const dealId = cardDaImob.get(imobId);
      const f = ficha.get(imobId);
      if (!dealId || !f) { resumo.semCard++; continue; }
      const enderecos = lista.map((l) => l.email);
      const quando = lista.map((l) => l.enviado_em).sort()[0];
      const personalizada = personalizarCampanha(campanha, nomeParaComunicacao(f));
      const html = montarHtmlCampanha(personalizada, linkDescadastro(enderecos[0], siteUrl, campanhaId));
      const existentes = await chamarBitrixComoApp<{ result: { START_TIME: string }[] }>("crm.activity.list", {
        filter: { OWNER_TYPE_ID: ENTITY_DEAL, OWNER_ID: dealId, TYPE_ID: 4, SUBJECT: personalizada.assunto },
        select: ["ID", "START_TIME"],
      });
      if ((existentes.result ?? []).some((a) => Math.abs(new Date(a.START_TIME).getTime() - new Date(quando).getTime()) < TOLERANCIA_MS)) { resumo.jaRegistrados++; continue; }
      console.log(`${executar ? "REGISTRANDO" : "registraria"}: ${(f.apelido || f.nome).slice(0, 34).padEnd(34)} card ${String(dealId).padEnd(5)} ${enderecos.length} endereço(s) · saiu ${quando.slice(0, 16).replace("T", " ")} UTC`);
      if (!executar) continue;
      try {
        await registrarAtividadeEmail({ entityTypeId: ENTITY_DEAL, itemId: dealId, assunto: personalizada.assunto, corpo: html, direcao: "enviado", enderecoEnvolvido: enderecos[0], enderecosEnvolvidos: enderecos, quando });
        resumo.registrados++;
      } catch (e) {
        resumo.falhas.push(`${f.apelido || f.nome}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log("RESUMO", JSON.stringify(resumo));
  }
}
main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
