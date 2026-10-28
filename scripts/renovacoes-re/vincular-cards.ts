// Liga os cards de renovação que JÁ EXISTEM no Bitrix (Fiança 1042/32 · Capitalização 1048/38 · Ramos Elementares 1046/34) aos documentos do ERP
// (erp_renovacoes.bitrix_card_id = "<SPA>:<id>"). Bitrix: só leitura. Sem --gravar só mostra o que ligaria.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/renovacoes-re/vincular-cards.ts [--mes 2027-01] [--gravar]
process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { casarCardsComDocumentos, lerCardsRenovacao, lerDocumentosParaLigar, statusPelaEtapa } from "@/lib/erp/renovacaoCards";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const mes = arg("mes");
const GRAVAR = process.argv.includes("--gravar");

(async () => {
  const cards = await lerCardsRenovacao();
  // casa com TODOS os vigentes (um card de renovação pode estar adiantado ou atrasado em relação ao mês filtrado)
  const docs = await lerDocumentosParaLigar(sb);
  const { ligacoes, cardsSemDocumento } = casarCardsComDocumentos(cards, docs);
  const doc = new Map(docs.map((d) => [d.id, d]));
  console.log(`cards lidos: ${cards.length} · documentos vigentes: ${docs.length} · ligações: ${ligacoes.length} · cards sem documento: ${cardsSemDocumento.length}`);
  const porFunil: Record<string, number> = {}, porVia: Record<string, number> = {}, porStatus: Record<string, number> = {};
  for (const l of ligacoes) { porFunil[l.card.funil] = (porFunil[l.card.funil] ?? 0) + 1; porVia[l.via] = (porVia[l.via] ?? 0) + 1; const s = statusPelaEtapa(l.card.etapa); porStatus[s] = (porStatus[s] ?? 0) + 1; }
  console.log("por funil:", porFunil, "| por via:", porVia, "| status pela etapa:", porStatus);
  if (mes) {
    const noMes = ligacoes.filter((l) => doc.get(l.documentoId)?.vigencia_fim?.startsWith(mes));
    const total = docs.filter((d) => d.vigencia_fim?.startsWith(mes));
    const pf: Record<string, number> = {}; noMes.forEach((l) => { pf[l.card.funil] = (pf[l.card.funil] ?? 0) + 1; });
    console.log(`${mes}: ${total.length} documentos vigentes, ${noMes.length} já com card →`, pf);
  }
  if (!GRAVAR) return;
  let novos = 0, atualizados = 0;
  for (const l of ligacoes) {
    const d = doc.get(l.documentoId)!;
    const valor = { bitrix_card_id: `${l.card.entity}:${l.card.id}`, status: statusPelaEtapa(l.card.etapa), vence_em: d.vigencia_fim, updated_at: new Date().toISOString() };
    const { data: ex } = await sb.from("erp_renovacoes").select("id,bitrix_card_id").eq("documento_id", l.documentoId).limit(1);
    if (ex?.length) { if (ex[0].bitrix_card_id !== valor.bitrix_card_id) { await sb.from("erp_renovacoes").update(valor).eq("id", ex[0].id); atualizados++; } }
    else { const { error } = await sb.from("erp_renovacoes").insert({ documento_id: l.documentoId, ...valor, observacoes: `Ligado ao card #${l.card.id} (${l.card.funil}) pelo ${l.via === "apolice" ? "Nº da apólice" : l.via === "nosso_numero_corp" ? "Nosso nº do Corp" : "nome do cliente e fim da vigência"}` }); if (error) console.log("erro", error.message); else novos++; }
  }
  console.log(`gravado: ${novos} novos, ${atualizados} atualizados`);
})();
