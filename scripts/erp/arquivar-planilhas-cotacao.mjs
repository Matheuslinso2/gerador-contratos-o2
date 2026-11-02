// ERP O2 — 02/11/2026 (Matheus: "salvar todas as informações lidas das planilhas 1 vez e tabelar tudo"): lê TODAS as abas e colunas das
// cópias congeladas das planilhas de cotação diária (Garantias/RE/Cap) e grava em erp_planilha_abas + erp_planilha_linhas
// (1 linha por linha da planilha; chaves = cabeçalho original; datas em ISO). ARQUIVO: não dispara baixa nem painel. Desfazer: delete por lote.
// uso: node scripts/erp/arquivar-planilhas-cotacao.mjs <lote> [--gravar] [--so=2026]   (sem --gravar só conta, a seco)
import XLSX from "xlsx";
import { supabase, buscarTudo } from "../base-unica/_comum.mjs";

const [lote, ...resto] = process.argv.slice(2);
if (!lote) throw new Error("uso: <lote> [--gravar] [--so=pasta]");
const gravar = resto.includes("--gravar");
const so = resto.find((a) => a.startsWith("--so="))?.slice(5);

const vazio = (v) => v == null || (typeof v === "string" && v.trim() === "");
const valor = (v) => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.trim();
  return v;
};
// cabeçalho = a linha (entre as 10 primeiras) com mais células de texto não numéricas e pelo menos 3
function acharCabecalho(linhas) {
  let melhor = -1, nMelhor = 2;
  for (let i = 0; i < Math.min(10, linhas.length); i++) {
    const n = (linhas[i] || []).filter((c) => typeof c === "string" && c.trim() && Number.isNaN(Number(c.replace(",", ".")))).length;
    if (n > nMelhor) { nMelhor = n; melhor = i; }
  }
  return melhor;
}

const copias = (await buscarTudo("base_unica_planilhas_congeladas", "arquivo_id, nome, pasta, mime_type, copia_storage_path", (q) => q.not("copia_storage_path", "is", null)))
  .filter((c) => !/\.pdf$/i.test(c.nome) && !/^Corp —|^Bitrix/.test(c.pasta ?? "") && (!so || c.pasta === so));
console.log("planilhas:", copias.length, gravar ? "(GRAVANDO)" : "(a seco)");
const tot = { arquivos: 0, abas: 0, linhas: 0, erros: 0 };
for (const c of copias) {
  try {
    const { data, error } = await supabase.storage.from("planilhas-congeladas").download(c.copia_storage_path);
    if (error) throw new Error(error.message);
    const wb = XLSX.read(Buffer.from(await data.arrayBuffer()), { type: "buffer", cellDates: true, bookVBA: false, cellFormula: false, cellHTML: false, cellStyles: false, dense: true });
    tot.arquivos++;
    for (const aba of wb.SheetNames) {
      const m = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, blankrows: true, defval: null });
      const h = acharCabecalho(m);
      if (h < 0) continue;
      const usados = new Map();
      const cols = (m[h] || []).map((x, j) => {
        const base = vazio(x) ? `col_${j + 1}` : String(x).replace(/\s+/g, " ").trim();
        const n = (usados.get(base) ?? 0) + 1; usados.set(base, n);
        return n > 1 ? `${base} (${n})` : base;
      });
      const regs = [];
      for (let i = h + 1; i < m.length; i++) {
        const dados = {};
        let algum = false;
        (m[i] || []).forEach((v, j) => { if (!vazio(v) && j < cols.length) { dados[cols[j]] = valor(v); algum = true; } });
        if (algum) regs.push({ arquivo_id: c.arquivo_id, aba, linha_n: i + 1, dados, lote });
      }
      tot.abas++; tot.linhas += regs.length;
      if (gravar) {
        await supabase.from("erp_planilha_linhas").delete().eq("arquivo_id", c.arquivo_id).eq("aba", aba);
        for (let k = 0; k < regs.length; k += 500) {
          const { error: e } = await supabase.from("erp_planilha_linhas").insert(regs.slice(k, k + 500));
          if (e) throw new Error(`${aba}: ${e.message}`);
        }
        await supabase.from("erp_planilha_abas").upsert({ arquivo_id: c.arquivo_id, aba, cabecalho_linha: h + 1, colunas: cols, n_linhas: regs.length, nome_arquivo: c.nome, pasta: c.pasta, lote, lido_em: new Date().toISOString() }, { onConflict: "arquivo_id,aba" });
      }
    }
  } catch (e) { tot.erros++; console.log("ERRO", c.nome, e.message); }
  if (tot.arquivos % 20 === 0) console.log(JSON.stringify(tot));
}
console.log("FIM", JSON.stringify(tot));
