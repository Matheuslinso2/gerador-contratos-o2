// Contexto (não é prova de vínculo): para cada imobiliária do grupo "sem cotação", quais cards de renovação 09.2026/10.2026 existem na empresa do Bitrix dela. Só leitura.
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { listarItensSpaCategoria } from "@/lib/bitrix/client";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
async function main() {
  const { data } = await sb.from("erp_renovacoes_sem_cotacao_v").select("documento_id, imobiliaria, seguradora, vigencia_inicio, vigencia_fim").range(0, 999);
  const docs = (data ?? []) as any[];
  const nomes = [...new Set(docs.map((d) => d.imobiliaria).filter(Boolean))] as string[];
  const { data: ims } = await sb.from("imobiliarias").select("id, nome").in("nome", nomes);
  const idPorNome = new Map((ims ?? []).map((i: any) => [i.nome, i.id]));
  const { data: regs } = await sb.from("imobiliaria_registros_fonte").select("imobiliaria_id, chave_externa").eq("fonte", "bitrix_empresa").eq("situacao", "confirmado").in("imobiliaria_id", [...idPorNome.values()]);
  const empPorImob = new Map<string, Set<number>>();
  for (const r of regs ?? []) { const s = empPorImob.get(r.imobiliaria_id as string) ?? new Set<number>(); s.add(Number(r.chave_externa)); empPorImob.set(r.imobiliaria_id as string, s); }
  const cards = ((await listarItensSpaCategoria(1046, 34)) as any[]).filter((c) => /\.2026/.test(String(c.title)));
  const linhas = ["Imobiliária;Seguradora;Mês do fim da vigência da renovação;Qtd renovações sem cotação;Cards da empresa 09.2026/10.2026 (SPA 1046:id etapa)"];
  const grupos = new Map<string, { imob: string; seg: string; mes: string; n: number }>();
  for (const d of docs) { const k = `${d.imobiliaria}|${d.seguradora}|${String(d.vigencia_fim).slice(0, 7)}`; const g = grupos.get(k) ?? { imob: d.imobiliaria, seg: d.seguradora, mes: String(d.vigencia_fim).slice(0, 7), n: 0 }; g.n++; grupos.set(k, g); }
  for (const g of [...grupos.values()].sort((a, b) => b.n - a.n)) {
    const emp = empPorImob.get(idPorNome.get(g.imob) as string) ?? new Set<number>();
    const achados = cards.filter((c) => emp.has(Number(c.companyId)) && /(09|10)\.2026/.test(String(c.title)));
    const txt = achados.map((c) => `1046:${c.id} ${String(c.stageId).split(":")[1]} [${String(c.title).slice(0, 60)}]`).join(" ; ") || "nenhum card nas empresas dela";
    linhas.push([g.imob, g.seg, g.mes, g.n, txt].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
    console.log(`${String(g.n).padStart(3)} ${g.imob} | ${g.seg} | ${g.mes} → ${achados.length ? achados.length + " card(s) 09/10.2026: " + achados.map((c) => c.id + ":" + String(c.stageId).split(":")[1]).join(",") : "nenhum card"}`);
  }
  fs.writeFileSync(path.resolve(process.cwd(), "..", "renovacoes-re", "sem-cotacao-cards-por-empresa-0611.csv"), "\ufeff" + linhas.join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
