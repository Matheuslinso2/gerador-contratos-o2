import { PDFParse } from "pdf-parse";

export async function extrairTextoPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const resultado = await parser.getText();
    return resultado.text.trim();
  } finally {
    await parser.destroy();
  }
}
