// ERP O2 — carrega no ERP um PDF de extrato baixado do portal da seguradora (pelo robô ou à mão).
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-extrato-portal.ts <arquivo.pdf|.xls> [...] --seguradora TOKI [--gravar]
// Sem --gravar só mostra o que entraria. Com --gravar grava e roda erp_cruzar_extratos().
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { createServiceClient } from "@/lib/supabase/service";
import { parseTokioPdfVarios, parsePortoPdf, parsePortoHtml, type ExtratoPdf } from "@/lib/erp/extratosPdf";
import { gravarExtratosPortal } from "@/lib/erp/extratosPortal";

async function main() {
  const args = process.argv.slice(2);
  const gravar = args.includes("--gravar");
  const i = args.indexOf("--seguradora");
  const seguradora = i >= 0 ? args[i + 1] : "";
  const arquivos = args.filter((a, k) => !a.startsWith("--") && args[k - 1] !== "--seguradora");
  if (!["TOKI", "PORT"].includes(seguradora) || !arquivos.length) throw new Error("uso: <arquivo.pdf> --seguradora TOKI|PORT [--gravar]");
  const sb = createServiceClient();
  for (const arq of arquivos) {
    const buf = fs.readFileSync(arq);
    let extratos: ExtratoPdf[];
    if (buf.subarray(0, 5).toString() !== "%PDF-") {
      // Porto "planilha XLS" = tabela HTML em latin1
      extratos = [parsePortoHtml(new TextDecoder("latin1").decode(buf))].filter((x): x is ExtratoPdf => !!x);
    } else {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      extratos = seguradora === "TOKI" ? parseTokioPdfVarios(text as string) : [parsePortoPdf(text as string)].filter((x): x is ExtratoPdf => !!x);
    }
    const fecham = extratos.filter((e) => Math.abs(e.linhas.reduce((s, l) => s + (l.valor_comissao ?? 0), 0) - (e.total_bruto ?? 0)) < 0.01).length;
    const r = await gravarExtratosPortal(sb, seguradora, extratos, { arquivo: path.basename(arq), gravar });
    console.log(`${path.basename(arq)} · ${extratos.length} extratos (${fecham} fecham) · ${gravar ? "GRAVADO" : "SIMULAÇÃO"}: novos ${r.novos} (${r.linhas} linhas, bruto ${r.bruto.toFixed(2)}) · já existiam ${r.ja_existiam}`);
    r.erros.forEach((e) => console.log("  ERRO", e));
  }
  if (gravar) {
    const { data, error } = await sb.rpc("erp_cruzar_extratos");
    console.log("cruzamento:", error ? error.message : JSON.stringify(data));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
