import JSZip from "jszip";
import WordExtractor from "word-extractor";

// Contrato antigo reaproveitado de um modelo salvo há anos costuma vir em
// .doc (formato binário OLE do Word 97-2003), não .docx (ZIP/XML) -- o
// e.g. "CONTRATO fulano.doc" que travou o Auditor pro Matheus é assim. O
// parser de .docx acima não lê esse formato de jeito nenhum (não é nem
// ZIP), por isso usa uma lib à parte só pra esse caso.
export async function extrairTextoDoc(buffer: Buffer): Promise<string> {
  const extractor = new WordExtractor();
  const documento = await extractor.extract(buffer);
  return documento.getBody().trim();
}

export async function extrairTextoDocx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("text");
  if (!documentXml) throw new Error("Não foi possível ler o conteúdo do arquivo Word.");

  const paragrafos = documentXml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [];

  const textoParagrafos = paragrafos.map((paragrafo) => {
    const textos = paragrafo.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [];
    return textos
      .map((t) => t.replace(/<w:t[^>]*>/, "").replace(/<\/w:t>/, ""))
      .join("")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  });

  return textoParagrafos.filter((p) => p.trim()).join("\n\n");
}
