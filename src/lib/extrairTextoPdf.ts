import { getDocumentProxy, extractText } from "unpdf";

export async function extrairTextoPdfComPaginas(
  buffer: Buffer
): Promise<{ texto: string; numPaginas: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return { texto: text.trim(), numPaginas: pdf.numPages };
}

export async function extrairTextoPdf(buffer: Buffer): Promise<string> {
  const { texto } = await extrairTextoPdfComPaginas(buffer);
  return texto;
}
