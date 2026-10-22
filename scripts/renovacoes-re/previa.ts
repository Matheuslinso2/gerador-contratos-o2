// Robô de renovações RE — Fase 1: PRÉVIA (não mexe no Bitrix).
// Lê o Excel "Exporta itens pacote" do Corp e gera uma planilha com os cards
// que o robô criaria no funil Renovações (SPA 1046, categoria 34), os itens de
// cada card e os alertas para a Kamila conferir.
// uso: npx tsx scripts/renovacoes-re/previa.ts <exporta_itens.xlsx> [--mes 2026-12] [--saida <pasta>]
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { agruparEmCards, lerExportItens, type ProdutoRenovacao } from "@/lib/renovacoesRe/exportItens";

const args = process.argv.slice(2);
const opcao = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const arquivo = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!arquivo) {
  console.error("uso: npx tsx scripts/renovacoes-re/previa.ts <exporta_itens.xlsx> [--mes AAAA-MM] [--saida <pasta>]");
  process.exit(1);
}
const pastaSaida = opcao("--saida") ?? path.resolve(process.cwd(), "..", "renovacoes-re", "previas");

const todos = lerExportItens(fs.readFileSync(arquivo));
const meses = [...new Set(todos.map((i) => (i.fimVigencia ?? "").slice(0, 7)))].sort();
const mes = opcao("--mes") ?? (meses.length === 1 ? meses[0] : undefined);
if (!mes) {
  console.error(`O Excel tem vencimentos em vários meses (${meses.join(", ")}); escolha um com --mes AAAA-MM.`);
  process.exit(1);
}
const itens = todos.filter((i) => (i.fimVigencia ?? "").startsWith(mes));
const foraDoMes = todos.length - itens.length;
const cards = agruparEmCards(itens);

const NOME_PRODUTO: Record<ProdutoRenovacao, string> = {
  imobiliario: "Imobiliário",
  residencial: "Residencial",
  empresarial: "Empresarial",
  outro: "Outro ramo",
};
const reais = (v: number) => Math.round(v * 100) / 100;

const abaCards = cards.map((c, n) => ({
  "Card nº": n + 1,
  "Título previsto": c.titulo,
  Produto: NOME_PRODUTO[c.produto],
  Imobiliária: c.imobiliaria ?? "",
  Seguradora: c.seguradora,
  "Vencimento (mês)": c.mes,
  "Qtd. itens": c.itens.length,
  "Itens com LMI no Corp": c.itensComLmiCorp,
  "Itens sem LMI (buscar no histórico)": c.itens.length - c.itensComLmiCorp,
  "Prêmio total anterior (R$)": reais(c.premioTotalAnterior),
  "Comissão anterior (R$)": reais(c.comissaoAnterior),
  "Indicado por (sistema parceiro)": [...new Set(c.itens.flatMap((i) => i.canais))].join(", "),
  Alertas: c.alertas.join("; "),
}));

const chavesObs = [...new Set(itens.flatMap((i) => Object.keys(i.observacao)))];
const numeroCard = new Map(cards.map((c, n) => [c.chave, n + 1]));
const abaItens = cards.flatMap((c) =>
  c.itens.map((i) => ({
    "Card nº": numeroCard.get(c.chave),
    "Título do card": c.titulo,
    "Nosso Nº": i.nossoNumero,
    Apólice: i.apolice,
    Seguradora: i.seguradora,
    Ramo: i.ramo,
    "Início vig.": i.inicioVigencia ?? "",
    "Fim vig.": i.fimVigencia ?? "",
    Segurado: i.cliente,
    "CPF/CNPJ segurado": i.clienteDocumento,
    Proprietário: i.proprietario,
    "CPF/CNPJ proprietário": i.proprietarioDocumento,
    "Endereço do item": i.enderecoItem,
    "Cidade/UF": i.cidadeItem,
    CEP: i.cepItem,
    Atividade: i.atividade,
    "LMI (Corp)": i.lmiCorp ?? "",
    "Situação do LMI": i.lmiCorp != null ? "✔ veio do Corp" : "buscar no histórico (Fase 2)",
    ...Object.fromEntries(chavesObs.filter((k) => !/LIMITE M[AÁ]XIMO/i.test(k)).map((k) => [k, i.observacao[k] ?? ""])),
    "Prêmio líquido anterior": reais(i.premioLiquido),
    "Prêmio total anterior": reais(i.premioTotal),
    "% comissão": i.percentualComissao,
    "Comissão anterior": reais(i.valorComissao),
    Imobiliária: i.imobiliaria ?? "",
    "Produtores no Corp": i.produtores.join(" | "),
    Alertas: i.alertas.join("; "),
    "Linha no Excel do Corp": i.linha,
  })),
);

const abaAlertas = abaItens.filter((i) => i.Alertas);

const porProduto = (p: ProdutoRenovacao) => cards.filter((c) => c.produto === p);
const resumo = [
  ["Prévia do robô de renovações — nada foi criado no Bitrix"],
  [],
  ["Arquivo do Corp", path.basename(arquivo)],
  ["Gerada em", new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })],
  ["Mês de vencimento", mes],
  ["Linhas do Corp no mês", itens.length],
  ...(foraDoMes ? [["Linhas fora do mês (ignoradas)", foraDoMes]] : []),
  [],
  ["Cards que seriam criados", cards.length],
  ...(["imobiliario", "residencial", "empresarial", "outro"] as ProdutoRenovacao[])
    .filter((p) => porProduto(p).length)
    .map((p) => [`  ${NOME_PRODUTO[p]}`, `${porProduto(p).length} cards / ${porProduto(p).reduce((s, c) => s + c.itens.length, 0)} itens`]),
  [],
  ["Itens com LMI vindo do Corp", itens.filter((i) => i.lmiCorp != null).length],
  ["Itens sem LMI (a Fase 2 busca no histórico)", itens.filter((i) => i.lmiCorp == null).length],
  ["Itens com alerta (aba Alertas)", abaAlertas.length],
  ["Prêmio total anterior (R$)", reais(itens.reduce((s, i) => s + i.premioTotal, 0))],
  [],
  ["Regras aplicadas"],
  ["Imobiliário", "1 card por imobiliária + seguradora, com os itens dentro"],
  ["Residencial / Empresarial", "1 card por apólice"],
  ["Imobiliária", "Segimob, Superlógica, Sohtec e Base Software só indicam: o card vai para a imobiliária do outro produtor"],
  ["Filial", "card fica com a filial que aparece no Corp; a matriz enxerga pelo vínculo no Workspace"],
  ["Casos especiais", "viram card normalmente; o alerta vai junto para conferência"],
];

const wb = XLSX.utils.book_new();
const largura = (linhas: Record<string, unknown>[]) =>
  Object.keys(linhas[0] ?? {}).map((k) => ({ wch: Math.min(60, Math.max(k.length, ...linhas.map((l) => String(l[k] ?? "").length)) + 2) }));
const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
wsResumo["!cols"] = [{ wch: 44 }, { wch: 100 }];
XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo");
for (const [nome, linhas] of [
  ["Cards", abaCards],
  ["Itens", abaItens],
  ["Alertas", abaAlertas],
] as const) {
  const ws = XLSX.utils.json_to_sheet(linhas.length ? [...linhas] : [{ Aviso: "nenhum" }]);
  ws["!cols"] = largura([...linhas]);
  ws["!autofilter"] = { ref: ws["!ref"]! };
  XLSX.utils.book_append_sheet(wb, ws, nome);
}

fs.mkdirSync(pastaSaida, { recursive: true });
const produtos = [...new Set(cards.map((c) => c.produto))].join("-");
const destino = path.join(pastaSaida, `previa-${mes}-${produtos}.xlsx`);
XLSX.writeFile(wb, destino);

console.log(`Mês ${mes}: ${itens.length} itens → ${cards.length} cards${foraDoMes ? ` (${foraDoMes} linhas de outro mês ignoradas)` : ""}`);
for (const c of cards.slice(0, 10)) console.log(`  ${String(c.itens.length).padStart(4)}  ${c.titulo}`);
if (cards.length > 10) console.log(`  … mais ${cards.length - 10} cards`);
console.log(`Itens sem LMI no Corp: ${itens.filter((i) => i.lmiCorp == null).length}; com alerta: ${abaAlertas.length}`);
console.log(`Prévia salva em ${destino}`);
