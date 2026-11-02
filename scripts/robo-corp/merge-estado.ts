// Junta o estado de todos os robôs de anexos (estado-<login>.json) em estado.json, para o envio ao Workspace e o vinculador enxergarem tudo.
// Quem vence por documento é a visita mais recente. Só leitura dos arquivos dos robôs; escreve estado.json de forma atômica (arquivo temporário + rename).
// Roda dentro de anexos-pos.cmd (uma vez por dia) e pode ser rodado à mão: npx tsx scripts/robo-corp/merge-estado.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PASTA = process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp");
type Entrada = { quando?: string } & Record<string, unknown>;
const ler = (f: string): Record<string, Entrada> => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; } };
const geral = ler(path.join(PASTA, "estado.json"));
const arquivos = fs.existsSync(PASTA) ? fs.readdirSync(PASTA).filter((x) => /^estado-.+\.json$/.test(x)) : [];
let trazidos = 0;
for (const a of arquivos) for (const [nn, e] of Object.entries(ler(path.join(PASTA, a)))) if (!geral[nn] || String(e.quando ?? "") >= String(geral[nn].quando ?? "")) { if (!geral[nn] || geral[nn].quando !== e.quando) trazidos++; geral[nn] = e; }
const tmp = path.join(PASTA, `estado.json.${process.pid}.tmp`);
fs.writeFileSync(tmp, JSON.stringify(geral)); fs.renameSync(tmp, path.join(PASTA, "estado.json"));
console.log(`estado.json: ${Object.keys(geral).length} documentos (${trazidos} atualizados a partir de ${arquivos.length} arquivo(s) de robô)`);
