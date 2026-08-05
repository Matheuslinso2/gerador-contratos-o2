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

export function ehArquivoPlanilha(nomeArquivo: string): boolean {
  return /\.(xls|xlsx)$/i.test(nomeArquivo);
}
