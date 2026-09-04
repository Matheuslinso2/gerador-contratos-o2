import * as XLSX from "xlsx";

// Algumas seguradoras (ex: Pottencial) mandam o demonstrativo em planilha
// (.xls/.xlsx) em vez de PDF -- diferente do boleto (sempre PDF), a
// planilha não costuma ter senha. Convertida pra texto/CSV, entra no mesmo
// pipeline de extração por IA usado pros PDFs (que já é baseado em texto).
export function extrairTextoPlanilha(buffer: Buffer): string {
  const pasta = XLSX.read(buffer, { type: "buffer" });
  const partes: string[] = [];
  for (const nomeAba of pasta.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(pasta.Sheets[nomeAba]);
    partes.push(`Planilha: ${nomeAba}\n${csv}`);
  }
  return partes.join("\n\n").trim();
}

// CSV já é texto puro -- não passa pela lib xlsx (que lê formato binário
// de planilha), só decodifica o buffer direto. Exportado como UTF-8 com
// BOM (﻿ no início) é comum em relatório gerado por sistema legado
// brasileiro (ex: Corp) -- precisa remover, senão sobra um caractere
// invisível colado no primeiro cabeçalho da coluna.
export function extrairTextoCsv(buffer: Buffer): string {
  return buffer.toString("utf8").replace(/^﻿/, "");
}

export function ehArquivoCsv(nomeArquivo: string): boolean {
  return /\.csv$/i.test(nomeArquivo);
}

export function ehArquivoPlanilha(nomeArquivo: string): boolean {
  return /\.(xls|xlsx|csv)$/i.test(nomeArquivo);
}
