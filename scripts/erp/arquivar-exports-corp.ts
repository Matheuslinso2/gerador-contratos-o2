// ERP O2 — ARQUIVO dos relatórios exportados do Corp (01/11/2026, regra do Matheus "registrar todo tipo de informação").
// Cada linha da planilha vira 1 registro em erp_corp_export_linhas com TODAS as colunas em `dados` (fonte 'Corp export', nível 8).
// Textos livres (Observações etc.) passam por mascararSegredos (senha/login/usuário/token/pin → ***). PDF: uma linha de texto por
// registro (dados.pagina, dados.texto), também mascarado. Lote para desfazer: delete from erp_corp_export_linhas where lote = '<lote>'.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/arquivar-exports-corp.ts <lote> <relatorio=arquivo> [...]
process.loadEnvFile(".env.local");
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const pega = (d: Record<string, unknown>, ...nomes: RegExp[]) => {
  for (const [k, v] of Object.entries(d)) if (nomes.some((n) => n.test(k)) && v !== null && v !== "") return String(v).trim();
  return null;
};

(async () => {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const { mascararSegredos } = await import("@/lib/erp/mascararSegredos");
  const sb = createServiceClient();
  const [lote, ...pares] = process.argv.slice(2);
  if (!lote || !pares.length) throw new Error("uso: <lote> <relatorio=caminho> ...");
  const resumo: Record<string, number> = {};
  for (const par of pares) {
    const i = par.indexOf("=");
    const relatorio = par.slice(0, i), caminho = par.slice(i + 1), arquivo = basename(caminho);
    const regs: Record<string, unknown>[] = [];
    if (/\.pdf$/i.test(caminho)) {
      const { abrirTextoPdfComSenha, candidatosSenhaO2 } = await import("@/lib/pdfComSenha");
      const texto = (await abrirTextoPdfComSenha(readFileSync(caminho), candidatosSenhaO2()))?.texto ?? "";
      let pagina = 1, n = 0;
      for (const bruta of texto.split(/\r?\n/)) {
        if (/^\f/.test(bruta) || /^-- \d+ of \d+ --$/.test(bruta.trim())) pagina++;
        const t = bruta.replace(/\f/g, "").trim();
        if (!t) continue;
        regs.push({ lote, relatorio, arquivo, linha_n: ++n, dados: { pagina, texto: mascararSegredos(t) } });
      }
    } else {
      const wb = XLSX.read(readFileSync(caminho), { type: "buffer", cellDates: true });
      let n = 0;
      for (const aba of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[aba], { defval: null, raw: true });
        for (const r of rows) {
          const dados: Record<string, unknown> = wb.SheetNames.length > 1 ? { _aba: aba } : {};
          for (const [k, v] of Object.entries(r)) {
            const chave = norm(k) || "coluna";
            dados[chave] = typeof v === "string" ? mascararSegredos(v) : v instanceof Date ? v.toISOString().slice(0, 10) : v;
          }
          regs.push({
            lote, relatorio, arquivo, linha_n: ++n, dados,
            seguradora: pega(dados, /^seg(_|uradora|$)/), apolice: pega(dados, /apolice/, /^documento$/, /titulo/),
            endosso: pega(dados, /^endosso/), parcela: pega(dados, /^parc/), cic: pega(dados, /^cic$/, /cpf|cnpj/),
          });
        }
      }
    }
    for (let k = 0; k < regs.length; k += 500) {
      const { error } = await sb.from("erp_corp_export_linhas").upsert(regs.slice(k, k + 500), { onConflict: "relatorio,arquivo,linha_n" });
      if (error) throw new Error(`${relatorio}: ${error.message}`);
    }
    resumo[relatorio] = regs.length;
    console.log(relatorio, regs.length);
  }
  console.log(JSON.stringify(resumo));
})().catch((e) => { console.error("ERRO", e.message); process.exit(1); });
