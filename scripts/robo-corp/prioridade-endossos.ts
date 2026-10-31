// Monta a prioridade do Robo Corp Anexos (%TEMP%/o2-apolices-corp/prioridade.json) com os endossos do cruzamento
// erp-o2/CRUZAMENTO-ENDOSSOS-CORP-31OUT2026.csv (Matheus 31/10): prêmio diferente por razão 4, 3, 2; depois fora_do_erp e sem_apolice_mae.
// Mantém no fim o que já estava na prioridade (fora-faturas). Só os que ainda faltam visitar entram na rodada (selecionarPendentes).
//   npx tsx scripts/robo-corp/prioridade-endossos.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const PASTA = process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp");
const PRIO = path.join(PASTA, "prioridade.json");
const csv = fs.readFileSync(path.join(__dirname, "../../erp-o2/CRUZAMENTO-ENDOSSOS-CORP-31OUT2026.csv"), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
const h = csv[0].split(";"); const col = (n: string) => h.indexOf(n);
type Item = { nn: string; produto: string; fim_vig: string };
const linhas = csv.slice(1).map((l) => l.split(";"));
const get = (c: string[], n: string) => c[col(n)] ?? "";
const iso = (d: string) => { const m = d.match(/^(\d\d)\/(\d\d)\/(\d\d)$/); return m ? `20${m[3]}-${m[2]}-${m[1]}` : ""; };
const grupos: { rotulo: string; itens: Item[] }[] = [];
for (const r of ["4", "3", "2"]) grupos.push({ rotulo: `premio_diferente razão ${r}`, itens: linhas.filter((c) => get(c, "tipo_achado") === "premio_diferente" && get(c, "razao_corp_erp") === r).map((c) => ({ nn: get(c, "nosso_numero_corp"), produto: "endosso", fim_vig: iso(get(c, "fim_vig")) })) });
for (const t of ["fora_do_erp", "sem_apolice_mae"]) grupos.push({ rotulo: t, itens: linhas.filter((c) => get(c, "tipo_achado") === t).map((c) => ({ nn: get(c, "nosso_numero_corp"), produto: "endosso", fim_vig: iso(get(c, "fim_vig")) })) });
const vistos = new Set<string>(); const novos: Item[] = [];
for (const g of grupos) { let n = 0; for (const i of g.itens) if (i.nn && !vistos.has(i.nn)) { vistos.add(i.nn); novos.push(i); n++; } console.log(`${g.rotulo}: ${n}`); }
const antigos: Item[] = fs.existsSync(PRIO) ? JSON.parse(fs.readFileSync(PRIO, "utf8")) : [];
if (!fs.existsSync(PRIO + ".antes-endossos")) fs.copyFileSync(PRIO, PRIO + ".antes-endossos");
const resto = antigos.filter((i) => !vistos.has(i.nn));
fs.writeFileSync(PRIO, JSON.stringify([...novos, ...resto]));
console.log(`prioridade.json: ${novos.length} endossos no topo + ${resto.length} que já estavam`);
