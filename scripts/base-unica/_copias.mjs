// Leitura das CÓPIAS CONGELADAS das planilhas (bucket privado
// planilhas-congeladas, referência de 18/10/2026) — a Fase 3 nunca lê o
// Drive ao vivo, só a versão congelada.
import XLSX from "xlsx";
import { supabase, buscarTudo } from "./_comum.mjs";

export const norm = (v) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

export async function listarCopias() {
  return buscarTudo("base_unica_planilhas_congeladas", "arquivo_id, nome, pasta, mime_type, modificado_em, copia_storage_path");
}

// Pasta → produto da planilha.
export function produtoDaPasta(c) {
  const p = norm(`${c.pasta} ${c.nome}`);
  if (/CAPITALIZA|TITULOS NOVOS/.test(p)) return "capitalizacao";
  if (/COTACAO DIARIA/.test(p)) return "re";
  return "fianca";
}

export async function abrirCopia(c, { linhas = 20000, bruto = false } = {}) {
  const { data, error } = await supabase.storage.from("planilhas-congeladas").download(c.copia_storage_path);
  if (error) throw new Error(`${c.nome}: ${error.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true, bookVBA: false, cellFormula: false, cellHTML: false, cellStyles: false, sheetRows: linhas, dense: true });
  return wb.SheetNames.map((nome) => [nome, XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: bruto, blankrows: true, defval: null })]);
}

// Acha a linha de cabeçalho (até a 8ª) que tenha uma das colunas-âncora.
export function acharCabecalho(linhas, ancora = /^IMOBILI/) {
  for (let i = 0; i < Math.min(8, linhas.length); i++) {
    const l = (linhas[i] || []).map(norm);
    if (l.some((c) => ancora.test(c))) return { indice: i, colunas: l };
  }
  return null;
}
