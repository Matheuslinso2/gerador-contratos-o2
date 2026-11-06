// Para as renovações sem cotação (view erp_renovacoes_sem_cotacao_v): existe card no Bitrix que traga a apólice (campo Nº da apólice / qualquer campo do card)? Só leitura. Não usa título como prova.
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { listarItensSpaCategoria } from "@/lib/bitrix/client";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
async function main() {
  const { data } = await sb.from("erp_renovacoes_sem_cotacao_v").select("*").range(0, 999);
  const docs = (data ?? []) as any[];
  // a view lista a apólice NOVA (renovação); o card de renovação traz a apólice ANTERIOR
  const { data: novos } = await sb.from("erp_documentos").select("id, documento_renovado_id, renovacao_inferida_id").in("id", docs.map((d) => d.documento_id));
  const antIds = (novos ?? []).map((n: any) => n.documento_renovado_id ?? n.renovacao_inferida_id).filter(Boolean);
  const { data: ants } = antIds.length ? await sb.from("erp_documentos").select("id, numero_apolice, vigencia_fim").in("id", antIds) : { data: [] };
  const antPorId = new Map((ants ?? []).map((a: any) => [a.id, a]));
  const antDoNovo = new Map((novos ?? []).map((n: any) => [n.id, antPorId.get(n.documento_renovado_id ?? n.renovacao_inferida_id)]));
  const funis: [number, number][] = [[1046, 34], [1042, 32], [1048, 38]];
  const cards: { entity: number; id: number; titulo: string; etapa: string; txt: string; apol: Set<string> }[] = [];
  for (const [e, c] of funis) for (const i of (await listarItensSpaCategoria(e, c)) as any[]) {
    const apol = new Set<string>();
    for (const [k, v] of Object.entries(i)) if (/^ufCrm/.test(k) && typeof v === "string") for (const a of v.split(/[;,\s]+/)) if (a.length >= 5 && /\d/.test(a)) apol.add(a.replace(/^0+/, ""));
    cards.push({ entity: e, id: Number(i.id), titulo: String(i.title ?? ""), etapa: String(i.stageId), txt: JSON.stringify(i), apol });
  }
  console.log("com apólice anterior ligada no ERP:", docs.filter((d) => antDoNovo.get(d.documento_id)).length, "de", docs.length);
  const set = cards.filter((c) => /09.2026/.test(c.titulo));
  console.log("cards de setembro/26 no Bitrix (por título, só contexto):", set.length, "| etapas:", JSON.stringify(set.reduce((a: any, c) => { a[c.etapa] = (a[c.etapa] ?? 0) + 1; return a; }, {})));
  console.log("apólices anteriores/numeros em cards de setembro:", set.reduce((s2, c) => s2 + c.apol.size, 0));
  const linhas = ["Código O2 do documento;Nº da apólice (nova);Nº da apólice anterior;Nosso nº do Corp;Imobiliária;Seguradora;Fim da vigência;Card que traz a apólice (SPA:id);Etapa;Título do card"];
  let com = 0; const sem: Record<string, number> = {};
  for (const d of docs) {
    const ant: any = antDoNovo.get(d.documento_id);
    const n = String(ant?.numero_apolice ?? "").replace(/^0+/, "");
    const achados = n.length >= 5 ? cards.filter((c) => c.apol.has(n)) : [];
    if (achados.length) com++; else { const k = `${String(d.vigencia_fim).slice(0, 7)} | ${d.imobiliaria ?? "—"} | ${d.seguradora ?? "—"}`; sem[k] = (sem[k] ?? 0) + 1; }
    const a = achados[0];
    linhas.push([d.documento_id, d.numero_apolice, ant?.numero_apolice ?? "", d.nosso_numero_corp, d.imobiliaria, d.seguradora, d.vigencia_fim, a ? `${a.entity}:${a.id}` : "", a?.etapa ?? "", a?.titulo ?? ""].map(csv).join(";"));
  }
  fs.writeFileSync(path.resolve(process.cwd(), "..", "renovacoes-re", "sem-cotacao-x-cards-0611.csv"), "\ufeff" + linhas.join("\n"));
  console.log(`renovações sem cotação: ${docs.length} | com card que traz a apólice: ${com} | sem card algum: ${docs.length - com}`);
  console.log("sem card por mês | imobiliária | seguradora:");
  for (const [k, v] of Object.entries(sem).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(" ", v, k);
}
main().catch((e) => { console.error(e); process.exit(1); });
