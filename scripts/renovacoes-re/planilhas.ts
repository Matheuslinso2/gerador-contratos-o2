// Robô de renovações RE — planilhas de lote do Imobiliário (1 por card:
// imobiliária + seguradora), no modelo "RENOVAÇÃO SPECIAL 11.2026".
// Não mexe no Bitrix nem no Drive: grava os .xlsx numa pasta local.
// uso: npx tsx scripts/renovacoes-re/planilhas.ts --mes 2026-12 --corp <simplificado_com_produtor.xlsx>
//        [--itens <Exporta_itens_pacote.xlsx>] [--pdf <itens_e_garantias.pdf>] [--historico <pasta com lotes do ano anterior>]
//        [--saida <pasta>]
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { lerExportItens } from "@/lib/renovacoesRe/exportItens";
import { lerPdfItensGarantias } from "@/lib/renovacoesRe/pdfItensGarantias";
import {
  lerHistorico, lerSimplificadoComProdutor, montarLinha, nomeSeguradora, planilhaDoLote, type HistoricoItem,
} from "@/lib/renovacoesRe/planilhaLote";

const args = process.argv.slice(2);
const op = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const mes = op("--mes");
const arqCorp = op("--corp");
if (!mes || !arqCorp) {
  console.error("uso: npx tsx scripts/renovacoes-re/planilhas.ts --mes AAAA-MM --corp <xlsx> [--itens <xlsx>] [--pdf <pdf>] [--historico <pasta>] [--saida <pasta>]");
  process.exit(1);
}
const mesBr = `${mes.slice(5, 7)}.${mes.slice(0, 4)}`;
const saida = op("--saida") ?? path.resolve(process.cwd(), "..", "renovacoes-re", "planilhas", mes);

async function main() {
  const corp = lerSimplificadoComProdutor(fs.readFileSync(arqCorp!)).filter(
    (a) => /^(2?IMO|IMOB)$/.test(a.ramoCodigo) && (a.fimVigencia ?? "").startsWith(mes!),
  );
  const itens = op("--itens") ? lerExportItens(fs.readFileSync(op("--itens")!)) : [];
  const porNossoNumero = new Map(itens.map((i) => [i.nossoNumero, i]));
  const pdf = op("--pdf") ? await lerPdfItensGarantias(new Uint8Array(fs.readFileSync(op("--pdf")!))) : [];
  const pdfPorNN = new Map(pdf.map((d) => [d.nossoNumero, d]));
  const historico: HistoricoItem[] = [];
  if (op("--historico")) {
    for (const f of fs.readdirSync(op("--historico")!).filter((f) => /\.xlsx?$/i.test(f)))
      historico.push(...lerHistorico(fs.readFileSync(path.join(op("--historico")!, f)), f));
  }

  // Agrupa em cards: imobiliária + seguradora (decisão da reunião de 22/10).
  const grupos = new Map<string, typeof corp>();
  for (const a of corp) {
    const chave = `${a.imobiliaria ?? "SEM IMOBILIÁRIA"}|${nomeSeguradora(a.seguradoraCodigo)}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), a]);
  }

  fs.mkdirSync(saida, { recursive: true });
  const resumo: Record<string, unknown>[] = [];
  const nomeArquivo = (s: string) => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();
  for (const [chave, aps] of [...grupos.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const [imob, seg] = chave.split("|");
    aps.sort((x, y) => (x.fimVigencia ?? "").localeCompare(y.fimVigencia ?? "") || x.cliente.localeCompare(y.cliente));
    const montadas = aps.map((a) => montarLinha(a, porNossoNumero.get(a.nossoNumero), pdfPorNN.get(a.nossoNumero), historico));
    const arquivo = `${nomeArquivo(imob)} - ${seg} - RENOVAÇÃO ${mesBr}.xlsx`;
    XLSX.writeFile(planilhaDoLote(montadas.map((m) => m.linha)), path.join(saida, arquivo));
    resumo.push({
      "Card / planilha": arquivo.replace(/\.xlsx$/, ""),
      Imobiliária: imob,
      Seguradora: seg,
      Itens: aps.length,
      "Ramos no Corp": [...new Set(aps.map((a) => a.ramoCodigo))].join(", "),
      "Endereço do Corp (itens)": montadas.filter((m) => m.fonteEndereco === "Corp (itens)").length,
      "Endereço do PDF": montadas.filter((m) => m.fonteEndereco.startsWith("Corp (PDF")).length,
      "Sem endereço": montadas.filter((m) => m.fonteEndereco === "sem endereço").length,
      "LMI do histórico": montadas.filter((m) => m.fonteLmi.startsWith("histórico")).length,
      "LMI da Yelum (Corp)": montadas.filter((m) => m.fonteLmi.startsWith("Corp")).length,
      "LMI a conferir": montadas.filter((m) => m.fonteLmi === "LMI a conferir").length,
      "Prêmio 2025 (R$)": Math.round(aps.reduce((s, a) => s + a.premioTotal, 0) * 100) / 100,
      "Indicado por": [...new Set(aps.flatMap((a) => a.canais))].join(", "),
    });
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(resumo);
  ws["!cols"] = Object.keys(resumo[0] ?? {}).map((k) => ({ wch: Math.max(k.length + 2, k === "Card / planilha" ? 60 : 12) }));
  XLSX.utils.book_append_sheet(wb, ws, "Cards do mês");
  XLSX.writeFile(wb, path.join(saida, `_RESUMO - RENOVAÇÕES IMOBILIÁRIO ${mesBr}.xlsx`));

  const soma = (k: string) => resumo.reduce((s, r) => s + Number(r[k]), 0);
  console.log(`${mes}: ${corp.length} apólices de Imobiliário (IMOB+2IMO) → ${resumo.length} planilhas/cards`);
  console.log(`endereço: itens ${soma("Endereço do Corp (itens)")}, PDF ${soma("Endereço do PDF")}, sem ${soma("Sem endereço")}`);
  console.log(`LMI: histórico ${soma("LMI do histórico")}, Yelum ${soma("LMI da Yelum (Corp)")}, a conferir ${soma("LMI a conferir")}`);
  console.log(`histórico lido: ${historico.length} itens; pasta de saída: ${saida}`);
}
main().catch((e) => {
  console.error("ERRO:", e.message ?? e);
  process.exit(1);
});
