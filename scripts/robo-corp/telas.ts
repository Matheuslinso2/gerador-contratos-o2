// Captura das telas do documento no Corp junto com a visita do robô de anexos (decisão do Matheus, 01/11/2026: "registrar todo tipo de informação").
// Fotografa cada aba do documento (Documento, Parcelas, Comissões, Repasses, Itens, Anexos, Observações, Acompanhamento) em webp comprimido,
// em %TEMP%/o2-apolices-corp/telas/<nosso nº>/<tela>.webp, e uma foto da busca quando o documento "não é achado". Os campos são lidos depois,
// fora do Corp (OCR em processo local). A captura NUNCA derruba a visita: qualquer erro aqui é só registrado.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { Page } from "playwright";
import { acharNaTela, espera, log } from "./_corp";

export const PASTA_TELAS = path.join(process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp"), "telas");
/** Abas do documento, da esquerda para a direita; a aba Anexos é o ponto de referência (modelo doc-aba-anexos), as demais ficam a ~117 px uma da outra (tela 1366×768). */
const ABAS = [
  { tela: "documento", delta: -5 }, { tela: "parcelas", delta: -4 }, { tela: "comissoes", delta: -3 }, { tela: "repasses", delta: -2 },
  { tela: "itens", delta: -1 }, { tela: "anexos", delta: 0 }, { tela: "observacoes", delta: 1 }, { tela: "acompanhamento", delta: 2 },
];
const PASSO = 117.5;
export const VERSAO_TELAS = 1;

async function salvar(page: Page, nn: string, tela: string): Promise<number> {
  const png = await page.screenshot();
  const webp = await sharp(png).webp({ quality: 55 }).toBuffer();
  const pasta = path.join(PASTA_TELAS, nn);
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, `${tela}.webp`), webp);
  return webp.length;
}

/** Com o documento acabado de abrir (aba Documento ativa, aba Anexos ainda "não selecionada": é assim que o modelo doc-aba-anexos casa): fotografa todas as abas e
 *  volta para a aba Documento, deixando a tela como estava para o download dos anexos. Devolve quantas telas e quantos bytes. Não lança erro. */
export async function capturarTelasDoDocumento(page: Page, nn: string): Promise<{ telas: number; bytes: number; erro?: string }> {
  let telas = 0, bytes = 0;
  try {
    const ref = await acharNaTela(page, "doc-aba-anexos");
    if (!ref) return { telas, bytes, erro: "aba Anexos não encontrada na tela (referência das abas)" };
    bytes += await salvar(page, nn, "documento"); telas++; // a aba já aberta, sem clicar
    for (const a of ABAS.filter((x) => x.tela !== "documento")) {
      try {
        await page.mouse.click(Math.round(ref.x + a.delta * PASSO), ref.y);
        await espera(1200);
        bytes += await salvar(page, nn, a.tela);
        telas++;
      } catch (e) { log(`${nn}: tela ${a.tela} não capturada: ${(e as Error).message.slice(0, 80)}`); }
    }
    // volta para a aba Documento (a 1ª): a aba Anexos volta a ficar "não selecionada" para o passo seguinte da visita
    await page.mouse.click(Math.round(ref.x - 5 * PASSO), ref.y); await espera(900);
    return { telas, bytes };
  } catch (e) {
    return { telas, bytes, erro: (e as Error).message.slice(0, 120) };
  }
}

/** Documento não achado na busca: guarda a foto da busca para diagnóstico. */
export async function capturarBuscaSemResultado(page: Page, nn: string): Promise<void> {
  try { await salvar(page, nn, "busca"); } catch { /* só diagnóstico */ }
}
