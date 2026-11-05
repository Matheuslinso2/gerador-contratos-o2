// Atualiza a ETAPA ATUAL dos cards já ligados em erp_renovacoes (card_etapa, status, card_atualizado_em), lendo o Bitrix (só leitura).
// Só mexe em linhas que já têm bitrix_card_id; não cria vínculo novo nem toca em erp_documentos. Sem --gravar só mostra o que mudaria.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/renovacoes-re/atualizar-etapas-cards.ts [--gravar]
process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";
import { lerCardsRenovacao, statusPelaEtapa } from "@/lib/erp/renovacaoCards";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const GRAVAR = process.argv.includes("--gravar");

async function main() {
  const cards = await lerCardsRenovacao();
  const porId = new Map(cards.map((c) => [`${c.entity}:${c.id}`, c]));
  const linhas: { id: string; bitrix_card_id: string; card_etapa: string | null; status: string | null }[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from("erp_renovacoes").select("id,bitrix_card_id,card_etapa,status").not("bitrix_card_id", "is", null).range(de, de + 999);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const mudar: { id: string; etapa: string; status: string }[] = [];
  let semCard = 0;
  const trocas: Record<string, number> = {};
  for (const l of linhas) {
    const c = porId.get(l.bitrix_card_id);
    if (!c) { semCard++; continue; }
    const status = statusPelaEtapa(c.etapa);
    if (c.etapa !== l.card_etapa || status !== l.status) {
      mudar.push({ id: l.id, etapa: c.etapa, status });
      const k = `${l.card_etapa ?? "(vazio)"} -> ${c.etapa}`;
      trocas[k] = (trocas[k] ?? 0) + 1;
    }
  }
  console.log(`cards lidos: ${cards.length} | linhas ligadas: ${linhas.length} | card não encontrado no Bitrix (apagado?): ${semCard} | a mudar: ${mudar.length}`);
  console.log(trocas);
  if (!GRAVAR) return console.log("(simulação; use --gravar)");
  const agora = new Date().toISOString();
  for (const m of mudar) {
    const { error } = await sb.from("erp_renovacoes").update({ card_etapa: m.etapa, status: m.status, card_atualizado_em: agora, updated_at: agora }).eq("id", m.id);
    if (error) throw error;
  }
  console.log("gravado:", mudar.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
