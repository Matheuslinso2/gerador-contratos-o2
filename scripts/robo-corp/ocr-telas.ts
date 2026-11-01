// Lê as telas do documento fotografadas pelo robô (telas.ts) com OCR LOCAL e GRATUITO do Windows (pt-BR; sem IA, sem custo, nada sai do computador).
// Recorta só a janela "Controle de Documentos" (a lista de trás não interessa) e faz DOIS passes, porque o OCR perde campos dentro de caixas com um só tratamento:
//   passe a = cor, ampliado 2,5×  (ocr/ocr-a.jsonl)   passe b = preto e branco (limiar 135), ampliado 3× (ocr/ocr-b.jsonl)
// Um JSONL por passe com cada palavra e sua posição. Retomável: o que já foi lido não é refeito. Depois, ler-telas.ts combina os passes e transforma em campos.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/ocr-telas.ts [--limite N] [--so NN,NN]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const PASTA = process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp");
const TELAS = path.join(PASTA, "telas");
const OCR = path.join(PASTA, "ocr");
export const RECORTE = { left: 213, top: 105, width: 941, height: 552 };
export const PASSES = { a: { escala: 2.5 }, b: { escala: 3 } } as const;
const limite = process.argv.includes("--limite") ? Number(process.argv[process.argv.indexOf("--limite") + 1]) : Infinity;
const so = process.argv.includes("--so") ? new Set(process.argv[process.argv.indexOf("--so") + 1].split(",")) : null;
const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  ${m}`);

(async () => {
  fs.mkdirSync(OCR, { recursive: true });
  const so_passe = process.argv.includes("--passe") ? process.argv[process.argv.indexOf("--passe") + 1] : null; // --passe b: só esse passe (permite rodar a e b em paralelo)
  for (const passe of ["a", "b"] as const) {
    if (so_passe && so_passe !== passe) continue;
    const pngDir = path.join(OCR, passe === "a" ? "png" : "png-b"); fs.mkdirSync(pngDir, { recursive: true });
    const saida = path.join(OCR, `ocr-${passe}.jsonl`);
    if (passe === "a" && !fs.existsSync(saida) && fs.existsSync(path.join(OCR, "ocr.jsonl"))) fs.renameSync(path.join(OCR, "ocr.jsonl"), saida);
    const feitos = new Set<string>();
    if (fs.existsSync(saida)) for (const l of fs.readFileSync(saida, "utf8").split("\n")) { const m = /"arq":"([^"]+)"/.exec(l); if (m) feitos.add(path.basename(m[1])); }
    const alvos: { nn: string; tela: string; png: string }[] = [];
    for (const nn of fs.readdirSync(TELAS).filter((x) => /^\d+$/.test(x) && (!so || so.has(x)))) {
      for (const f of fs.readdirSync(path.join(TELAS, nn)).filter((x) => x.endsWith(".webp") && x !== "busca.webp")) {
        const tela = f.replace(/\.webp$/, "");
        if (!feitos.has(`${nn}_${tela}.png`)) alvos.push({ nn, tela, png: path.join(pngDir, `${nn}_${tela}.png`) });
      }
    }
    const lote = alvos.slice(0, limite);
    log(`passe ${passe}: telas a ler ${lote.length} (já lidas ${feitos.size})`);
    const lista: string[] = [];
    for (const a of lote) {
      if (!fs.existsSync(a.png)) {
        let img = sharp(path.join(TELAS, a.nn, `${a.tela}.webp`)).extract(RECORTE);
        if (passe === "b") img = img.greyscale();
        img = img.resize({ width: Math.round(RECORTE.width * PASSES[passe].escala), kernel: "lanczos3" });
        if (passe === "b") img = img.threshold(135);
        await img.png().toFile(a.png);
      }
      lista.push(a.png);
    }
    if (!lista.length) continue;
    fs.writeFileSync(path.join(OCR, `lista-${passe}.txt`), lista.join("\n"));
    log(`passe ${passe}: imagens prontas ${lista.length}; rodando o OCR do Windows...`);
    const ps1 = path.join(process.cwd(), "scripts", "robo-corp", "ocr-win.ps1");
    // -ExecutionPolicy Bypass vale só para este processo (o script é nosso, local); não muda a política do Windows
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Lista", path.join(OCR, `lista-${passe}.txt`), "-Saida", saida, "-Escala", "1"], { stdio: "inherit" });
    log(`passe ${passe}: OCR terminou (código ${r.status})`);
  }
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
