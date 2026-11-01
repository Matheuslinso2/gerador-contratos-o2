// Escolhe a LINHA certa do resultado da busca do Corp (01/11). A busca marca "Buscar também por documentos associados": para um endosso/renovação o resultado traz VÁRIAS linhas
// (o documento e os ligados a ele) e o robô abria sempre a 1ª (y=175), que pode ser OUTRO documento (≈16% da amostra): telas e anexos iam para o Nosso Nº errado.
// Aqui: se a 2ª linha tem texto, o OCR local do Windows (gratuito) lê a coluna "Nosso Nº" e devolve o y da linha cujo número é o buscado. Qualquer falha = 175 (comportamento antigo).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import type { Page } from "playwright";

const PASTA = process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp");
const Y_PRIMEIRA = 175, PASSO = 22;
const CLIP = { x: 12, y: 166, width: 62, height: 190 }; // coluna Nosso Nº das ~8 primeiras linhas
const ESCALA = 4;

async function linhaTemTexto(page: Page, y: number): Promise<boolean> {
  const { data } = await sharp(await page.screenshot({ clip: { x: 845, y: y - 7, width: 68, height: 14 } })).greyscale().raw().toBuffer({ resolveWithObject: true });
  let escuros = 0; for (const v of data) if (v < 170) escuros++;
  return escuros > 15;
}

/** y (na tela) para o duplo clique no documento `nn`; 175 (1ª linha) quando só há uma linha ou quando não foi possível ler. */
export async function yDaLinhaDoDocumento(page: Page, nn: string, log: (m: string) => void = () => {}): Promise<number> {
  try {
    if (!(await linhaTemTexto(page, Y_PRIMEIRA + PASSO))) return Y_PRIMEIRA; // uma linha só: é ela
    const dir = path.join(PASTA, "ocr-linha"); fs.mkdirSync(dir, { recursive: true });
    const png = path.join(dir, `${nn}.png`), lista = path.join(dir, `${nn}.txt`), saida = path.join(dir, `${nn}.jsonl`);
    for (const f of [saida]) if (fs.existsSync(f)) fs.unlinkSync(f);
    await sharp(await page.screenshot({ clip: CLIP })).greyscale().resize({ width: CLIP.width * ESCALA, kernel: "lanczos3" }).png().toFile(png);
    fs.writeFileSync(lista, png);
    const ps1 = path.join(process.cwd(), "scripts", "robo-corp", "ocr-win.ps1");
    spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Lista", lista, "-Saida", saida, "-Escala", "1"], { stdio: "ignore", timeout: 20_000 });
    const j = fs.existsSync(saida) ? JSON.parse(fs.readFileSync(saida, "utf8").split("\n").filter(Boolean)[0] ?? "{}") : null;
    const palavras: { t: string; y: number; h: number }[] = [];
    for (const l of j?.linhas ?? []) for (const p of Array.isArray(l.palavras) ? l.palavras : [l.palavras]) if (p) palavras.push(p);
    const alvo = palavras.filter((p) => p.t.replace(/\D/g, "") === nn);
    for (const f of [png, lista, saida]) if (fs.existsSync(f)) fs.unlinkSync(f);
    if (alvo.length !== 1) { log(`${nn}: busca com várias linhas, mas o Nosso Nº buscado não foi lido na coluna (${alvo.length}); abre a 1ª`); return Y_PRIMEIRA; }
    const y = Math.round(CLIP.y + (alvo[0].y + alvo[0].h / 2) / ESCALA);
    if (y < 168 || y > 350) return Y_PRIMEIRA;
    if (Math.abs(y - Y_PRIMEIRA) > 6) log(`${nn}: busca com várias linhas; documento buscado está na linha de y=${y} (não na 1ª)`);
    return y;
  } catch (e) {
    log(`${nn}: escolha da linha falhou (${(e as Error).message}); abre a 1ª`);
    return Y_PRIMEIRA;
  }
}
