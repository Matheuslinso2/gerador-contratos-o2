// Faz o robô dos anexos REVISITAR os documentos em que a janela aberta era OUTRO documento (telas-doc-errado.json, gerado por ler-telas.ts): tira o Nosso Nº buscado do estado.json
// (com backup) e do telas-enviadas.json, e os arquivos baixados do documento errado ficam onde estão (o envio de anexos já os retém). A próxima rodada, com a escolha certa da linha
// (linha-certa.ts), visita de novo. Não roda com o robô ativo (processo anexos.ts ou estado.json mexido nos últimos 10 min). Ensaio por padrão; --gravar executa.
//   npx tsx scripts/robo-corp/reabrir-doc-errado.ts [--gravar]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const PASTA = process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp");
const ESTADO = path.join(PASTA, "estado.json");
const ERRADOS = path.join(PASTA, "telas-doc-errado.json");
const GRAVAR = process.argv.includes("--gravar");
const errados = JSON.parse(fs.readFileSync(ERRADOS, "utf8")) as Record<string, number>;
const rodando = (() => { try { return /robo-corp[\/]anexos\.ts/.test(execSync("wmic process get commandline", { encoding: "utf8", maxBuffer: 20e6 })); } catch { return false; } })();
const recente = Date.now() - fs.statSync(ESTADO).mtimeMs < 10 * 60_000;
const estado = JSON.parse(fs.readFileSync(ESTADO, "utf8")) as Record<string, unknown>;
const alvo = Object.keys(errados).filter((nn) => estado[nn]);
console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${Object.keys(errados).length} documentos errados; ${alvo.length} estão no estado.json do robô. Robô rodando: ${rodando}; estado mexido há menos de 10 min: ${recente}`);
if (!GRAVAR) process.exit(0);
if (rodando || recente) { console.log("robô ativo: não mexi em nada. Rode de novo quando ele terminar."); process.exit(1); }
fs.copyFileSync(ESTADO, path.join(PASTA, "estado.antes-docerrado-0111.json"));
for (const nn of alvo) delete estado[nn];
fs.writeFileSync(ESTADO, JSON.stringify(estado));
console.log(`removidos ${alvo.length} do estado.json (backup: estado.antes-docerrado-0111.json); a próxima rodada revisita`);
