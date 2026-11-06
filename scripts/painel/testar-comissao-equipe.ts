// Testa a regra de comissão da equipe (06/11/2026) com os 4 cenários do documento do Matheus. Sem I/O.
//   npx tsx scripts/painel/testar-comissao-equipe.ts
import { calcularComissaoEquipe, incentivoEliteCrescimento, resumirComissaoEquipe, type EntradaComissao, type EvidenciaWS } from "../../src/lib/painelComercial/comissaoEquipe";

let falhas = 0;
const confere = (nome: string, ok: boolean, detalhe?: unknown) => {
  console.log(`${ok ? "OK " : "ERRO"} ${nome}${ok ? "" : ` -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
};

const IMOB = "imob-1";
const ws = (p: Partial<EvidenciaWS> & { id: string }): EvidenciaWS => ({ chave: p.id, imobiliariaId: IMOB, produto: "fianca", tipo: "novo", status: "Em análise", dataCotacao: null, dataEfetivacao: null, comissao: null, origemBitrixId: null, fonte: "planilha", ...p });
const base = (over: Partial<EntradaComissao["base"]> = {}): EntradaComissao["base"] => ({
  cards: [{ card: "100", empresaId: "E1", cliente: "Imob Teste", vendedora: "Dayane", funil: "Sucesso", etapa: "Oportunidade", produtos: ["Fiança"], dataCotacao: "2026-11-10", situacaoCotacao: null, campanha: null }],
  calls: [{ card: "100", empresaId: "E1", data: "2026-10-20", vendedora: "Dayane", funil: "Sucesso", evento: "Call", resultadoId: "3274", resultado: "Oportunidade de cotação gerada", realizada: true, treino: false }],
  fin: [],
  ...over,
});
const entrada = (b: EntradaComissao["base"], evidencias: EvidenciaWS[], extra: Partial<EntradaComissao> = {}): EntradaComissao => ({
  base: b,
  imobPorEmpresa: new Map([["E1", IMOB]]),
  nomeImob: new Map([[IMOB, "Imob Teste"]]),
  evidencias,
  eliteImobs: new Set(),
  pagas: ["Dayane", "Livia"],
  competenciaInicial: "2026-10",
  ...extra,
});

// 1) Call em outubro, primeira cotação em novembro, efetivação em janeiro após uma recusa: R$ 50 em nov e R$ 50 em jan, sem duplicar a recotação.
{
  const evid = [
    ws({ id: "c1", dataCotacao: "2026-11-10", status: "Recusado" }),
    ws({ id: "c2", dataCotacao: "2026-12-05", status: "Em análise" }),
    ws({ id: "c3", dataCotacao: "2026-12-20", status: "Convertido", dataEfetivacao: "2027-01-15", comissao: 300 }),
  ];
  const b = base({ fin: [{ empresaId: "E1", cliente: "Imob Teste", vendedora: "Dayane", apolices: 1, comissao: 300, data: "2027-01-20", mes: "2027-01" }] });
  const l = calcularComissaoEquipe(entrada(b, evid));
  const c1 = l.filter((x) => x.gatilho === "cotacao");
  const c2 = l.filter((x) => x.gatilho === "efetivacao");
  confere("1: um crédito de cotação em nov/26, validado", c1.length === 1 && c1[0].competencia === "2026-11" && c1[0].valor === 50 && c1[0].situacao === "Comissão validada", c1);
  confere("1: um crédito de efetivação em jan/27, validado", c2.length === 1 && c2[0].competencia === "2027-01" && c2[0].valor === 50 && c2[0].situacao === "Comissão validada", c2);
  confere("1: recotação fica só no histórico", c1[0].historico.length === 2 && l.length === 2, c1[0].historico);
  const r = resumirComissaoEquipe(l);
  confere("1: total validado R$ 50 em nov e R$ 50 em jan", r.find((x) => x.competencia === "2026-11")?.validado === 50 && r.find((x) => x.competencia === "2027-01")?.validado === 50, r);
}

// 2) Efetivação elegível sem call: R$ 50 no mês da efetivação.
{
  const b = base({ calls: [], fin: [{ empresaId: "E1", cliente: "Imob Teste", vendedora: "Dayane", apolices: 2, comissao: 500, data: "2026-11-28", mes: "2026-11" }] });
  const evid = [ws({ id: "e1", status: "Convertido", dataCotacao: "2026-11-02", dataEfetivacao: "2026-11-25", comissao: 500 })];
  const l = calcularComissaoEquipe(entrada(b, evid));
  confere("2: só efetivação, R$ 50 em nov/26, validada", l.length === 1 && l[0].gatilho === "efetivacao" && l[0].competencia === "2026-11" && l[0].valor === 50 && l[0].validado, l);
}

// 3) Cotação no Workspace com Data de cotação em branco no Bitrix: aparece pendente e fica fora do total validado.
{
  const b = base();
  b.cards[0].dataCotacao = null;
  const evid = [ws({ id: "c1", dataCotacao: "2026-11-10", status: "Em análise" })];
  const l = calcularComissaoEquipe(entrada(b, evid));
  confere("3: preenchimento pendente no Bitrix, fora do validado", l.length === 1 && l[0].situacao === "Preenchimento pendente no Bitrix" && !l[0].validado && /Data de cotação/.test(l[0].detalhe), l);
  const r = resumirComissaoEquipe(l);
  confere("3: validado 0 e pendente R$ 50", r[0].validado === 0 && r[0].pendente === 50, r);
}

// 4) Elite com referência de R$ 10.000 e fechamento de R$ 12.000: crescimento 20%, excedente R$ 2.000, incentivo R$ 10.
{
  const e = incentivoEliteCrescimento(10000, 12000);
  confere("4: Elite 10.000 -> 12.000 = R$ 10", e.excedente === 2000 && Math.abs((e.crescimento ?? 0) - 0.2) < 1e-9 && e.incentivo === 10, e);
  confere("4: sem crescimento, sem incentivo", incentivoEliteCrescimento(10000, 9000).incentivo === 0);
}

// Extras: Elite (Fiança) não paga R$ 50; divergência de data; reunião sem cotação comprovada não paga.
{
  const l = calcularComissaoEquipe(entrada(base(), [ws({ id: "c1", dataCotacao: "2026-11-10" })], { eliteImobs: new Set([IMOB]) }));
  confere("extra: Fiança de imobiliária Elite = R$ 0 (regra de crescimento)", l.length === 1 && l[0].valor === 0 && l[0].situacao === "Sem crédito", l);
  const b = base();
  b.cards[0].dataCotacao = "2026-11-12";
  const d = calcularComissaoEquipe(entrada(b, [ws({ id: "c1", dataCotacao: "2026-11-10" })]));
  confere("extra: datas diferentes = divergência", d[0].situacao === "Divergência Bitrix × Workspace" && !d[0].validado, d);
  const sem = calcularComissaoEquipe(entrada(base(), []));
  confere("extra: sem cotação no Workspace = aguardando comprovação", sem[0].situacao === "Aguardando comprovação no Workspace" && !sem[0].validado, sem);
  const outros = base();
  outros.calls[0].resultadoId = "3278";
  confere("extra: resultado 'Sem demanda atual' não gera crédito de cotação", calcularComissaoEquipe(entrada(outros, [ws({ id: "c1", dataCotacao: "2026-11-10" })])).filter((x) => x.gatilho === "cotacao").length === 0);
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTodos os cenários passaram");
process.exit(falhas ? 1 : 0);
