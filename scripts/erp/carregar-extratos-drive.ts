// ERP O2 — Fase 2: extratos de comissão da pasta oficial do Drive "- RELATÓRIO COMISSÃO SEGURADORAS".
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-extratos-drive.ts [--gravar] [--max 30] [--refazer] [--so TOKI,PORT]
// Sem --gravar só lista e lê (não grava). --refazer apaga os "não lidos" e tenta de novo. Com --gravar roda erp_cruzar_extratos().
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { carregarExtratosDrive, listarArquivosExtratos } from "@/lib/erp/extratosDrive";

async function main() {
  const gravar = process.argv.includes("--gravar");
  const i = process.argv.indexOf("--max");
  const max = i >= 0 ? Number(process.argv[i + 1]) : 30;
  const j = process.argv.indexOf("--so");
  const seguradoras = j >= 0 ? process.argv[j + 1].split(",") : undefined;
  const arquivos = await listarArquivosExtratos();
  console.log(`arquivos na pasta: ${arquivos.length}`);
  for (const a of arquivos.slice(0, 20)) console.log(`  ${a.caminho} (${a.mime})`);
  const sb = createServiceClient();
  const r = await carregarExtratosDrive(sb, { gravar, max, refazerNaoLidos: process.argv.includes("--refazer"), seguradoras });
  console.log(`${gravar ? "GRAVADO" : "SIMULAÇÃO"} · novos ${r.novos} · lidos ${r.lidos} (${r.linhas} linhas) · não lidos ${r.nao_lidos}`);
  for (const e of r.erros) console.log(`  ${e}`);
  if (gravar) {
    const { data, error } = await sb.rpc("erp_cruzar_extratos");
    console.log("cruzamento:", error ? error.message : JSON.stringify(data));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
