export type ImagemExtraida = { base64: string; mediaType: "image/jpeg" | "image/png" };

// Imobiliária costuma anexar um documento à parte (páginas escaneadas com
// as condições da seguradora, laudo de vistoria etc.) inserindo as páginas
// como IMAGEM dentro do próprio Word, em vez de outro arquivo separado --
// achado real: contrato .doc com 3 páginas de ~1MB cada assim, que o
// Auditor ignorava por completo (só lia texto). Filtra por tamanho pra não
// mandar pra IA logo/selo pequeno que também costuma vir embutido (photo de
// carimbo, brasão etc.) como se fosse página de conteúdo.
const TAMANHO_MINIMO_BYTES = 40 * 1024;

// .doc legado (OLE/compound file) não separa imagem num container próprio
// como o .docx (word/media/*) -- escaneia os bytes crus procurando os
// marcadores JPEG/PNG completos. O Word grava a imagem original sem
// recomprimir, então o marcador de início/fim de cada formato aparece
// intacto no meio do arquivo; não é uma leitura "correta" de OLE, mas é a
// única opção viável sem LibreOffice/Word instalado (não dá no ambiente
// serverless da Vercel).
export function extrairImagensDoOle(buffer: Buffer): ImagemExtraida[] {
  const imagens: ImagemExtraida[] = [];

  const SOI = Buffer.from([0xff, 0xd8, 0xff]);
  const EOI = Buffer.from([0xff, 0xd9]);
  let cursor = 0;
  while (true) {
    const inicio = buffer.indexOf(SOI, cursor);
    if (inicio === -1) break;
    const fim = buffer.indexOf(EOI, inicio);
    if (fim === -1) {
      cursor = inicio + 1;
      continue;
    }
    if (fim + 2 - inicio >= TAMANHO_MINIMO_BYTES) {
      imagens.push({ base64: buffer.subarray(inicio, fim + 2).toString("base64"), mediaType: "image/jpeg" });
    }
    cursor = fim + 2;
  }

  const PNG_SIG = Buffer.from("89504e470d0a1a0a", "hex");
  const IEND = Buffer.from("IEND");
  cursor = 0;
  while (true) {
    const inicio = buffer.indexOf(PNG_SIG, cursor);
    if (inicio === -1) break;
    const posIend = buffer.indexOf(IEND, inicio);
    if (posIend === -1) {
      cursor = inicio + 1;
      continue;
    }
    const fim = posIend + 8; // "IEND" (4 bytes) + CRC do chunk (4 bytes)
    if (fim - inicio >= TAMANHO_MINIMO_BYTES) {
      imagens.push({ base64: buffer.subarray(inicio, fim).toString("base64"), mediaType: "image/png" });
    }
    cursor = fim;
  }

  return imagens;
}

// .docx é um ZIP -- cada imagem embutida já vem como arquivo próprio em
// word/media/, sem precisar adivinhar marcador de início/fim.
export async function extrairImagensDocx(buffer: Buffer): Promise<ImagemExtraida[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const imagens: ImagemExtraida[] = [];

  for (const nome of Object.keys(zip.files)) {
    if (!nome.startsWith("word/media/")) continue;
    const extensao = nome.split(".").pop()?.toLowerCase();
    const mediaType: ImagemExtraida["mediaType"] | null =
      extensao === "png" ? "image/png" : extensao === "jpg" || extensao === "jpeg" ? "image/jpeg" : null;
    if (!mediaType) continue; // ignora .emf/.wmf (vetor do Office, a IA não lê) e outros formatos raros

    const bytes = await zip.file(nome)?.async("nodebuffer");
    if (bytes && bytes.length >= TAMANHO_MINIMO_BYTES) {
      imagens.push({ base64: bytes.toString("base64"), mediaType });
    }
  }

  return imagens;
}
