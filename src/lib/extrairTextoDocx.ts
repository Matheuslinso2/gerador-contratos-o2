import JSZip from "jszip";

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
