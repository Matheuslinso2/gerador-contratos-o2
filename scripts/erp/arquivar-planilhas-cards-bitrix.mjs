// ERP O2 — 05/11/2026 (Matheus: "as planilhas de lote têm que ser lidas e salvas"): lê TODAS as abas e colunas das planilhas (xlsx/xls/csv) anexadas aos
// comentários e campos dos cards do Bitrix (bucket bitrix-cards-arquivos) e grava em erp_planilha_abas + erp_planilha_linhas, igual às planilhas do Drive
// (arquivo_id = 'bitrix:<file_id>', pasta = 'Cards Bitrix <entidade>'; 1 linha por linha; chaves = cabeçalho original; datas em ISO). Retomável: pula arquivo já lido.
// Depois rode scripts/erp/padronizar-planilhas.ts para chegar em erp_planilha_registro. Desfazer: delete por lote.
// uso: node scripts/erp/arquivar-planilhas-cards-bitrix.mjs <lote> [--gravar]   (sem --gravar só conta, a seco)
import XLSX from "xlsx";
import { supabase, buscarTudo } from "../base-unica/_comum.mjs";

const [lote, ...resto] = process.argv.slice(2);
if (!lote) throw new Error("uso: <lote> [--gravar]");
const gravar = resto.includes("--gravar");
const vazio = (v) => v == null || (typeof v === "string" && v.trim() === "");
const valor = (v) => (v instanceof Date ? (Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)) : typeof v === "string" ? v.trim() : v);
function acharCabecalho(linhas) {
  let melhor = -1, nMelhor = 2;
  for (let i = 0; i < Math.min(10, linhas.length); i++) {
    const n = (linhas[i] || []).filter((c) => typeof c === "string" && c.trim() && Number.isNaN(Number(c.replace(",", ".")))).length;
    if (n > nMelhor) { nMelhor = n; melhor = i; }
  }
  return melhor;
}

const arqs = (await buscarTudo("bitrix_card_arquivos", "file_id, entity_type_id, item_id, nome, storage_path, anexado_no_bitrix_em", (q) => q.not("storage_path", "is", null).or("nome.ilike.%.xlsx,nome.ilike.%.xls,nome.ilike.%.csv,nome.ilike.%.xlsm")));
const jaLidos = new Set((await buscarTudo("erp_planilha_abas", "arquivo_id", (q) => q.like("arquivo_id", "bitrix:%"))).map((r) => r.arquivo_id));
console.log("planilhas dos cards:", arqs.length, "| já lidas:", jaLidos.size, gravar ? "(GRAVANDO)" : "(a seco)");
const tot = { arquivos: 0, abas: 0, linhas: 0, erros: 0, puladas: 0 };
for (const c of arqs) {
  const arquivo_id = `bitrix:${c.file_id}`;
  if (jaLidos.has(arquivo_id)) { tot.puladas++; continue; }
  try {
    const { data, error } = await supabase.storage.from("bitrix-cards-arquivos").download(c.storage_path);
    if (error) throw new Error(error.message);
    const wb = XLSX.read(Buffer.from(await data.arrayBuffer()), { type: "buffer", cellDates: true, cellFormula: false, cellHTML: false, cellStyles: false, dense: true });
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
        if (algum) regs.push({ arquivo_id, aba, linha_n: i + 1, dados, lote });
      }
      tot.abas++; tot.linhas += regs.length;
      if (gravar) {
        await supabase.from("erp_planilha_linhas").delete().eq("arquivo_id", arquivo_id).eq("aba", aba);
        for (let k = 0; k < regs.length; k += 500) {
          const { error: e } = await supabase.from("erp_planilha_linhas").insert(regs.slice(k, k + 500));
          if (e) throw new Error(`${aba}: ${e.message}`);
        }
        await supabase.from("erp_planilha_abas").upsert({ arquivo_id, aba, cabecalho_linha: h + 1, colunas: cols, n_linhas: regs.length, nome_arquivo: c.nome, pasta: `Cards Bitrix ${c.entity_type_id} (card ${c.item_id})`, lote, lido_em: new Date().toISOString() }, { onConflict: "arquivo_id,aba" });
      }
    }
  } catch (e) { tot.erros++; console.log("ERRO", c.nome, e.message); }
  if ((tot.arquivos + tot.erros) % 10 === 0) console.log(JSON.stringify(tot));
  await new Promise((r) => setTimeout(r, 300));
}
console.log("FIM", JSON.stringify(tot));
