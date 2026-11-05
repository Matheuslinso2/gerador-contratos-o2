// Registra no campo de e-mails do card (Bitrix) as parciais que JÁ foram enviadas por fora da conversa do card
// (pedido do Matheus, 05/11/2026): só vínculo e controle, NUNCA reenvia nada. Para cada parcial enviada, cria no
// card da imobiliária a atividade de e-mail "enviado", com a data/hora em que saiu e os endereços que receberam.
// Não repete: pula o que já estiver registrado (mesmo assunto no card). Sem --executar, só mostra o que faria.
//   NODE_PATH="$TEMP/stub" npx tsx scripts/campanhas/registrar-parciais-enviadas-no-card.ts <campanha_id> [--executar]
process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { registrarAtividadeEmail } from "../../src/lib/bitrix/atividades";
import { chamarBitrixComoApp } from "../../src/lib/bitrix/appAuth";
import { COLUNAS_CAMPANHA_ENVIO, LINK_DESCADASTRO_MENSAGEM_UNICA, montarHtmlCampanha, type CampanhaRow } from "../../src/lib/campanhas/processarLote";
import { linkDescadastro } from "../../src/lib/campanhas/unsubscribeToken";

const ENTITY_DEAL = 2;

async function main() {
  const campanhaId = process.argv[2];
  const executar = process.argv.includes("--executar");
  if (!campanhaId) throw new Error("Informe o id da campanha.");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL!;

  const { data: paineis } = await db
    .from("campanhas_panoramas")
    .select("id, nome, versao, imobiliaria_ids, enviado_em, email_campanha_id")
    .eq("campanha_id", campanhaId)
    .eq("status", "enviada")
    .not("email_campanha_id", "is", null)
    .order("nome");
  const resumo = { registrados: 0, jaRegistrados: 0, semCard: [] as string[], semEnvio: [] as string[], falhas: [] as string[] };

  for (const p of (paineis ?? []) as { id: string; nome: string; versao: number; imobiliaria_ids: string[]; enviado_em: string; email_campanha_id: string }[]) {
    const { data: cards } = await db.from("campanhas_cards_bitrix").select("bitrix_deal_id").eq("campanha_id", campanhaId).in("imobiliaria_id", p.imobiliaria_ids).order("bitrix_deal_id", { ascending: true }).limit(1);
    const dealId = Number((cards as { bitrix_deal_id: number }[] | null)?.[0]?.bitrix_deal_id);
    if (!Number.isFinite(dealId) || dealId <= 0) {
      resumo.semCard.push(p.nome);
      continue;
    }
    const { data: envios } = await db.from("campanhas_envios").select("email, status, enviado_em").eq("campanha_id", p.email_campanha_id).eq("status", "enviado").order("enviado_em", { ascending: true });
    const destinatarios = ((envios ?? []) as { email: string; enviado_em: string }[]);
    if (!destinatarios.length) {
      resumo.semEnvio.push(p.nome);
      continue;
    }
    const { data: filho } = await db.from("campanhas").select(COLUNAS_CAMPANHA_ENVIO).eq("id", p.email_campanha_id).single<CampanhaRow>();
    if (!filho) {
      resumo.falhas.push(`${p.nome}: e-mail da parcial não encontrado`);
      continue;
    }
    const enderecos = destinatarios.map((d) => d.email);
    // Cópia do primeiro destinatário (com o link de descadastro dele), como saiu de fato.
    const html = montarHtmlCampanha(filho, enderecos[0] ? linkDescadastro(enderecos[0], siteUrl, p.email_campanha_id) : LINK_DESCADASTRO_MENSAGEM_UNICA);
    const quando = destinatarios[0].enviado_em ?? p.enviado_em;

    // Já registrado? (mesmo assunto, e-mail, neste card)
    const existentes = await chamarBitrixComoApp<{ result: { ID: string }[] }>("crm.activity.list", {
      filter: { OWNER_TYPE_ID: ENTITY_DEAL, OWNER_ID: dealId, TYPE_ID: 4, SUBJECT: filho.assunto },
      select: ["ID"],
    });
    if ((existentes.result ?? []).length) {
      resumo.jaRegistrados++;
      console.log(`já registrado: ${p.nome} (card ${dealId})`);
      continue;
    }
    console.log(`${executar ? "REGISTRANDO" : "registraria"}: ${p.nome.padEnd(36)} card ${String(dealId).padEnd(5)} ${enderecos.length} endereço(s) · saiu ${quando.slice(0, 16).replace("T", " ")} UTC · "${filho.assunto.slice(0, 60)}"`);
    if (!executar) continue;
    try {
      await registrarAtividadeEmail({ entityTypeId: ENTITY_DEAL, itemId: dealId, assunto: filho.assunto, corpo: html, direcao: "enviado", enderecoEnvolvido: enderecos[0], enderecosEnvolvidos: enderecos, quando });
      resumo.registrados++;
    } catch (e) {
      resumo.falhas.push(`${p.nome}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log("\nRESUMO", JSON.stringify(resumo, null, 1));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
