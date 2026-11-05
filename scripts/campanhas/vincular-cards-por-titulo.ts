// Liga a uma ou mais campanhas os cards do funil Campanhas do Bitrix cujo TÍTULO contém um texto (ex.: "Cap Friday"), pela empresa de cada
// card (vínculo confirmado na base única). Só LÊ o Bitrix; grava apenas a ligação no Workspace (campanhas_cards_bitrix, origem "vinculado").
// Por padrão só mostra o que faria.
//   NODE_PATH="$TEMP/stub" npx tsx scripts/campanhas/vincular-cards-por-titulo.ts "Cap Friday" <campanha_id>[,<campanha_id>...] [--gravar]
process.loadEnvFile(".env.local");
import { createClient } from "@supabase/supabase-js";

const CATEGORIA_CAMPANHAS = 12;

async function main() {
  const texto = process.argv[2];
  const ids = (process.argv[3] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const gravar = process.argv.includes("--gravar");
  if (!texto || !ids.length) throw new Error('Uso: vincular-cards-por-titulo.ts "texto do título" <campanha_id>[,<campanha_id>] [--gravar]');
  const base = process.env.BITRIX_WEBHOOK_URL!;
  const chamar = async (m: string, p: Record<string, unknown>) => (await fetch(base.replace(/\/?$/, "/") + m + ".json", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) })).json();
  const deals: { ID: string; TITLE: string; COMPANY_ID: string }[] = [];
  for (let start = 0; ; ) {
    const j = await chamar("crm.deal.list", { filter: { CATEGORY_ID: CATEGORIA_CAMPANHAS, "%TITLE": texto }, select: ["ID", "TITLE", "COMPANY_ID"], order: { ID: "ASC" }, start });
    deals.push(...(j.result ?? []));
    if (j.next === undefined) break;
    start = j.next;
  }
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: regs } = await db.from("imobiliaria_registros_fonte").select("imobiliaria_id, chave_externa").eq("fonte", "bitrix_empresa").eq("situacao", "confirmado");
  const imobDaEmpresa = new Map((regs ?? []).map((r) => [String(r.chave_externa), r.imobiliaria_id as string]));
  const casados = deals.map((d) => ({ d, imob: imobDaEmpresa.get(String(d.COMPANY_ID)) })).filter((x) => x.imob);
  const semFicha = deals.filter((d) => !imobDaEmpresa.has(String(d.COMPANY_ID)));
  console.log(`cards com "${texto}": ${deals.length} | casam com uma ficha: ${casados.length} | sem ficha (não ligados): ${semFicha.length}`);
  for (const d of semFicha) console.log(`   sem ficha: #${d.ID} ${JSON.stringify(d.TITLE)} (empresa ${d.COMPANY_ID})`);
  const porImob = new Map<string, number>();
  for (const x of casados) porImob.set(x.imob!, (porImob.get(x.imob!) ?? 0) + 1);
  const repetidas = [...porImob.values()].filter((n) => n > 1).length;
  if (repetidas) throw new Error(`${repetidas} imobiliária(s) com mais de um card "${texto}": resolver antes de ligar.`);

  for (const campanhaId of ids) {
    const { data: ja } = await db.from("campanhas_cards_bitrix").select("imobiliaria_id").eq("campanha_id", campanhaId);
    const jaLigadas = new Set((ja ?? []).map((r) => r.imobiliaria_id as string));
    const novos = casados.filter((x) => !jaLigadas.has(x.imob!));
    console.log(`campanha ${campanhaId.slice(0, 8)}: a ligar ${novos.length} | já ligados ${casados.length - novos.length} (${gravar ? "GRAVANDO" : "simulação"})`);
    if (!gravar || !novos.length) continue;
    const linhas = novos.map((x) => ({ campanha_id: campanhaId, imobiliaria_id: x.imob!, bitrix_deal_id: Number(x.d.ID), bitrix_company_id: Number(x.d.COMPANY_ID) || null, origem: "vinculado", titulo: x.d.TITLE, criado_por: "matheus@o2seguros.com.br" }));
    const { error } = await db.from("campanhas_cards_bitrix").insert(linhas);
    if (error) throw new Error(error.message);
  }
}
main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
