// Tipo (MIME) do arquivo pelo nome, pro envio direto do navegador pro Storage.
//
// Com um File, o Supabase manda o arquivo num formulário e usa o tipo do
// PRÓPRIO arquivo -- a opção contentType do upload() é ignorada. Em muitos
// computadores o navegador não informa o tipo (Windows sem Excel, HEIC, PDF
// de alguns apps...), o arquivo seguia como "application/octet-stream" e o
// bucket recusava ("mime type application/octet-stream is not supported").
// Reproduzido em 22/10/2026 na ficha de Seguro Incêndio; mesmo padrão nas
// fichas de Auto, Celular e Condomínio. Solução: criar um Blob novo com o tipo
// certo e enviar ele.

const TIPO_POR_EXTENSAO: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
};

export function tipoDoArquivo(arquivo: File): string {
  const extensao = arquivo.name.split(".").pop()?.toLowerCase() ?? "";
  return TIPO_POR_EXTENSAO[extensao] ?? (arquivo.type || "application/octet-stream");
}

// Pronto pra passar ao storage.upload(caminho, corpo, { contentType: tipo }).
export function arquivoParaUpload(arquivo: File): { corpo: Blob; tipo: string } {
  const tipo = tipoDoArquivo(arquivo);
  return { corpo: new Blob([arquivo], { type: tipo }), tipo };
}
