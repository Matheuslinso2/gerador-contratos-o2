// Modelagem de dados do painel Seguro Fiança, portada 1:1 da lógica já
// validada com o Matheus (ver dados-brutos/montar_planilha.js no projeto
// "seguro-fianca-analise"). Regras principais:
// - Um card conta uma vez; movimentações de etapa contam separado.
// - Resultado de Análise e Cotação: Recusado (perdeu ali) / Aprovado
//   (avançou pra Negociação e Contrato, mesmo que o card já não esteja mais
//   fisicamente nesse funil) / Em andamento.
// - Resultado de Negociação e Contrato: Perdido / Convertido / Em andamento.
// - Recusa em Análise e Cotação é decisão de compliance da seguradora — não
//   exige motivo interno. Só cobramos motivo pra perdas em Negociação e
//   Contrato.
// - Taxa real de uma seguradora = valor da cotação ÷ pacote de locação
//   (não confundir com o campo "Taxa Média (13%)" do CRM, que é uma meta
//   fixa, não um resultado real).

import type { BitrixDefinicaoCampo, BitrixItemRaw, BitrixStageHistoryEvent } from "./client";

export const ENTITY_TYPE_ID = 1042;
export const CATEGORIA_ANALISE = 18;
export const CATEGORIA_NEGOCIACAO = 20;

type Etapa = { statusId: string; nome: string; semantica: "P" | "S" | "F" };

// Lista completa e verificada via crm.status.list — estável, não muda sem
// alguém reconfigurar o funil no Bitrix. Fixado aqui em vez de reconsultado
// a cada carga de página.
export const ETAPAS: Etapa[] = [
  { statusId: "DT1042_18:NEW", nome: "Nova Solicitação", semantica: "P" },
  { statusId: "DT1042_18:PREPARATION", nome: "Pendente Informação", semantica: "P" },
  { statusId: "DT1042_18:CLIENT", nome: "Aguardando Cotação", semantica: "P" },
  { statusId: "DT1042_18:UC_YW2LWF", nome: "Aguardando Seguradora", semantica: "P" },
  { statusId: "DT1042_18:UC_VE1LYP", nome: "Cotado com Pendência", semantica: "P" },
  { statusId: "DT1042_18:SUCCESS", nome: "SUCESSO", semantica: "S" },
  { statusId: "DT1042_18:FAIL", nome: "PERDIDO", semantica: "F" },
  { statusId: "DT1042_20:NEW", nome: "Liberado para Negociar", semantica: "P" },
  { statusId: "DT1042_20:UC_XWVPIX", nome: "Contato Pendente", semantica: "P" },
  { statusId: "DT1042_20:PREPARATION", nome: "Em Negociação", semantica: "P" },
  { statusId: "DT1042_20:CLIENT", nome: "Tratativa de Desconto", semantica: "P" },
  { statusId: "DT1042_20:UC_ALTIBE", nome: "Aguardando Contrato", semantica: "P" },
  { statusId: "DT1042_20:UC_RD3MTL", nome: "Contrato Recebido", semantica: "P" },
  { statusId: "DT1042_20:UC_AHCJI2", nome: "Contrato com Pendências", semantica: "P" },
  { statusId: "DT1042_20:SUCCESS", nome: "SUCESSO", semantica: "S" },
  { statusId: "DT1042_20:FAIL", nome: "PERDIDO", semantica: "F" },
];
const etapaPorStatusId = new Map(ETAPAS.map((e) => [e.statusId, e]));

type ConfigSeguradora = {
  nome: string;
  status: [string, string][]; // [rótulo do plano, código do campo] — mais de um item quando a seguradora tem planos com status separado (ex: Porto)
  valor: string;
  comissao: string | null;
  pAluguel: string;
  pLocacao: string;
};

// Códigos de campo (ufCrm10_...) confirmados via crm.item.fields na SPA
// Seguro Fiança (entityTypeId 1042). Porto e Pottencial têm status separado
// por plano, mas valor/comissão/taxa compartilhados entre os planos — é
// assim que o Bitrix guarda, não é limitação da modelagem daqui.
export const SEGURADORAS: ConfigSeguradora[] = [
  {
    nome: "Too",
    status: [["Status", "ufCrm10_1776867659537"]],
    valor: "ufCrm10_1776867692274",
    comissao: "ufCrm10_1776867669061",
    pAluguel: "ufCrm10_1776867701485",
    pLocacao: "ufCrm10_1776867711264",
  },
  {
    nome: "Porto",
    status: [
      ["Tradicional", "ufCrm10_1776867859015"],
      ["Essencial 20", "ufCrm10_1776867889708"],
      ["Essencial 30", "ufCrm10_1776867909680"],
    ],
    valor: "ufCrm10_1776867925596",
    comissao: "ufCrm10_1776867916361",
    pAluguel: "ufCrm10_1776867930894",
    pLocacao: "ufCrm10_1776867936621",
  },
  {
    nome: "Pottencial (Taxa Fixa)",
    status: [["Status", "ufCrm10_1776867969326"]],
    valor: "ufCrm10_1776867980768",
    comissao: "ufCrm10_1776867975334",
    pAluguel: "ufCrm10_1778265458",
    pLocacao: "ufCrm10_1778265502",
  },
  {
    nome: "Pottencial (Tradicional)",
    status: [["Status", "ufCrm10_1776867994910"]],
    valor: "ufCrm10_1776868008634",
    comissao: "ufCrm10_1776867999897",
    pAluguel: "ufCrm10_1778265458",
    pLocacao: "ufCrm10_1778265502",
  },
  {
    nome: "Tokio",
    status: [["Status", "ufCrm10_1776868050602"]],
    valor: "ufCrm10_1776868065822",
    comissao: "ufCrm10_1776868055318",
    pAluguel: "ufCrm10_1776868072231",
    pLocacao: "ufCrm10_1776868076763",
  },
  {
    nome: "Junto",
    status: [["Status", "ufCrm10_1776868102153"]],
    valor: "ufCrm10_1778263318",
    comissao: null,
    pAluguel: "ufCrm10_1778265853",
    pLocacao: "ufCrm10_1778265830",
  },
];

const CAMPO_TIPO_LOCACAO = "ufCrm10_1776351302";
const CAMPO_FINALIDADE_IMOVEL = "ufCrm10_1781116634";
const CAMPO_ALUGUEL = "ufCrm10_1776352052";
const CAMPO_PACOTE_LOCACAO = "ufCrm10_1776352154";
const CAMPO_SEGURADORA_ESCOLHIDA = "ufCrm10_1776352200";
const CAMPO_MOTIVO_RECUSA = "ufCrm10_1776352403";
const CAMPO_VIGENCIA_INICIAL = "ufCrm10_1779821934";
const CAMPO_VIGENCIA_FINAL = "ufCrm10_1779821962";
const CAMPO_DATA_EFETIVACAO = "ufCrm10_1776352369";
const CAMPO_PREMIO_LIQUIDO = "ufCrm10_1779820763";
const CAMPO_PREMIO_LIQUIDO_LEGADO = "ufCrm10_1778258846";
const CAMPO_COMISSAO_FINAL = "ufCrm10_1779820737";
const CAMPO_COMISSAO_FINAL_LEGADO = "ufCrm10_1778258780";
const CAMPO_DESCONTO = "ufCrm10_1781029891735";
const CAMPO_DESCONTO_LEGADO = "ufCrm10_1779820897";

function enumLabel(defs: Record<string, BitrixDefinicaoCampo>, campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const item = defs[campo]?.items?.find((i) => i.ID === String(valor));
  return item ? item.VALUE : String(valor);
}

function nomeUsuario(usuarios: Record<number, string>, id: number | undefined): string {
  if (!id) return "";
  return usuarios[id] || `ID ${id}`;
}

function nomeEmpresa(empresas: Record<number, string>, id: number | undefined): string {
  if (!id) return "";
  return empresas[id] || `ID ${id}`;
}

// Bitrix guarda valores monetários como "1234.56|BRL" — extrai só o número.
function valorMonetario(v: unknown): number | "" {
  if (v === null || v === undefined || v === "") return "";
  const [num] = String(v).split("|");
  return num === "" ? "" : Number(num);
}

function apenasData(v: unknown): string {
  if (!v) return "";
  return String(v).slice(0, 10);
}

export type LinhaContagem = {
  id: number;
  nome: string;
  imobiliaria: string;
  tipoLocacao: string;
  finalidadeImovel: string;
  competencia: string;
  funil: "Análise e Cotação" | "Negociação e Contrato";
  etapaAtual: string;
  resultado: "Recusado" | "Aprovado" | "Perdido" | "Convertido" | "Em andamento";
  dataCriacao: string;
  ultimaMovimentacao: string;
  diasEmAberto: number;
  qtdMovimentacoes: number;
  responsavelAtual: string;
  criadoPor: string;
  ultimaMovimentacaoPor: string;
  aluguel: number | "";
  pacoteLocacao: number | "";
  seguradoras: Record<
    string,
    { status: Record<string, string>; valor: number | ""; comissaoPct: number | ""; pctAluguel: number | ""; pctLocacao: number | "" }
  >;
  seguradoraEscolhida: string;
  motivoRecusaPerda: string;
  vigenciaInicial: string;
  vigenciaFinal: string;
  dataEfetivacao: string;
  premioLiquido: number | "";
  comissaoFinal: number | "";
  desconto: number | "";
  alertas: string[];
};

// Resultado por FUNIL (não é o resultado final do card): um card aprovado
// em Análise e Cotação continua existindo — só passa a ser acompanhado
// dentro de Negociação e Contrato a partir daí.
function resultadoNoFunil(categoryId: number, semantica: Etapa["semantica"]): LinhaContagem["resultado"] {
  if (categoryId === CATEGORIA_ANALISE) {
    if (semantica === "F") return "Recusado";
    if (semantica === "S") return "Aprovado"; // transitório — o automatismo do Bitrix já move pro funil 2
    return "Em andamento";
  }
  if (semantica === "F") return "Perdido";
  if (semantica === "S") return "Convertido";
  return "Em andamento";
}

export function montarContagemMensal(
  items: BitrixItemRaw[],
  historico: BitrixStageHistoryEvent[],
  usuarios: Record<number, string>,
  empresas: Record<number, string>,
  defs: Record<string, BitrixDefinicaoCampo>
): LinhaContagem[] {
  const historicoPorCard = new Map<number, BitrixStageHistoryEvent[]>();
  for (const evento of historico) {
    const lista = historicoPorCard.get(evento.OWNER_ID) ?? [];
    lista.push(evento);
    historicoPorCard.set(evento.OWNER_ID, lista);
  }

  const agora = new Date();

  return items.map((item): LinhaContagem => {
    const eventos = historicoPorCard.get(item.id) ?? [];
    const etapa = etapaPorStatusId.get(item.stageId);
    const semantica = etapa?.semantica ?? "P";
    const resultado = resultadoNoFunil(item.categoryId, semantica);

    const criadoEm = new Date(item.createdTime);
    const fimContagem = resultado === "Em andamento" ? agora : new Date(item.movedTime || item.updatedTime);
    const diasEmAberto = Math.max(0, Math.round((fimContagem.getTime() - criadoEm.getTime()) / 86_400_000));

    const motivoRecusaPerda = enumLabel(defs, CAMPO_MOTIVO_RECUSA, item[CAMPO_MOTIVO_RECUSA]);
    const alertas: string[] = [];
    // Recusa em Análise e Cotação (categoryId 18) não exige motivo — só perdas em Negociação e Contrato (categoryId 20).
    if (resultado === "Perdido" && !motivoRecusaPerda) alertas.push("Perdido sem motivo registrado");
    if (!item.companyId) alertas.push("Sem imobiliária/empresa vinculada");
    if (resultado === "Convertido" && !enumLabel(defs, CAMPO_SEGURADORA_ESCOLHIDA, item[CAMPO_SEGURADORA_ESCOLHIDA])) {
      alertas.push("Convertido sem seguradora escolhida");
    }

    const seguradoras: LinhaContagem["seguradoras"] = {};
    for (const seg of SEGURADORAS) {
      const status: Record<string, string> = {};
      for (const [rotulo, campo] of seg.status) status[rotulo] = enumLabel(defs, campo, item[campo]);
      const pAluguel = item[seg.pAluguel];
      const pLocacao = item[seg.pLocacao];
      seguradoras[seg.nome] = {
        status,
        valor: valorMonetario(item[seg.valor]),
        comissaoPct: seg.comissao ? valorMonetario(item[seg.comissao]) : "",
        pctAluguel: typeof pAluguel === "number" ? pAluguel : "",
        pctLocacao: typeof pLocacao === "number" ? pLocacao : "",
      };
    }

    return {
      id: item.id,
      nome: item.title,
      imobiliaria: nomeEmpresa(empresas, item.companyId),
      tipoLocacao: enumLabel(defs, CAMPO_TIPO_LOCACAO, item[CAMPO_TIPO_LOCACAO]),
      finalidadeImovel: enumLabel(defs, CAMPO_FINALIDADE_IMOVEL, item[CAMPO_FINALIDADE_IMOVEL]),
      competencia: item.createdTime.slice(0, 7),
      funil: item.categoryId === CATEGORIA_ANALISE ? "Análise e Cotação" : "Negociação e Contrato",
      etapaAtual: etapa?.nome ?? item.stageId,
      resultado,
      dataCriacao: apenasData(item.createdTime),
      ultimaMovimentacao: apenasData(item.movedTime),
      diasEmAberto,
      qtdMovimentacoes: eventos.length,
      responsavelAtual: nomeUsuario(usuarios, item.assignedById),
      criadoPor: nomeUsuario(usuarios, item.createdBy),
      ultimaMovimentacaoPor: nomeUsuario(usuarios, item.movedBy),
      aluguel: valorMonetario(item[CAMPO_ALUGUEL]),
      pacoteLocacao: valorMonetario(item[CAMPO_PACOTE_LOCACAO]),
      seguradoras,
      seguradoraEscolhida: enumLabel(defs, CAMPO_SEGURADORA_ESCOLHIDA, item[CAMPO_SEGURADORA_ESCOLHIDA]),
      motivoRecusaPerda,
      vigenciaInicial: apenasData(item[CAMPO_VIGENCIA_INICIAL]),
      vigenciaFinal: apenasData(item[CAMPO_VIGENCIA_FINAL]),
      dataEfetivacao: apenasData(item[CAMPO_DATA_EFETIVACAO]),
      premioLiquido: valorMonetario(item[CAMPO_PREMIO_LIQUIDO]) || valorMonetario(item[CAMPO_PREMIO_LIQUIDO_LEGADO]),
      comissaoFinal: valorMonetario(item[CAMPO_COMISSAO_FINAL]) || valorMonetario(item[CAMPO_COMISSAO_FINAL_LEGADO]),
      desconto: valorMonetario(item[CAMPO_DESCONTO]) || valorMonetario(item[CAMPO_DESCONTO_LEGADO]),
      alertas,
    };
  });
}

function media(valores: number[]): number {
  if (!valores.length) return 0;
  return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10;
}
function mediana(valores: number[]): number {
  if (!valores.length) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

export type AnaliseGerencial = {
  kpis: { total: number; emAndamento: number; recusados: number; aprovados: number; perdidos: number; convertidos: number; comAlerta: number; imobiliarias: number };
  porFunilEtapa: Record<string, number>;
  porResponsavelFunil1: Record<string, { cards: number; andamento: number; negativos: number; positivos: number }>;
  porResponsavelFunil2: Record<string, { cards: number; andamento: number; negativos: number; positivos: number }>;
  statusPorSeguradora: Record<string, Record<string, number>>;
  cotadoPorSeguradora: Record<string, { n: number; premio: number; comissao: number }>;
  taxaPorSeguradora: Record<string, { n: number; pctLocacao: number; pctAluguel: number }>;
  motivosRecusaFunil1: { total: number; semMotivo: number }; // decisão de compliance, sem motivo interno — só o total importa
  motivosPerdaFunil2: { porMotivo: Record<string, number>; semMotivo: number; total: number };
  topImobiliarias: { nome: string; total: number; recusados: number; emAndamento: number; perdidos: number; convertidos: number }[];
  valoresTrabalhados: { aluguel: number; pacoteLocacao: number };
  faixasPacoteLocacao: { faixa: string; cards: number; pacoteMedio: number; seguroMedio: number }[];
  tempoPorEtapa: Record<string, { media: number; mediana: number; min: number; max: number; n: number }>;
  cardsQuePedemAtencao: { id: number; nome: string; etapa: string; dias: number; mediaEtapa: number; responsavel: string }[];
  qualidade: { semImobiliaria: number; perdidosFunil2SemMotivo: number; totalPerdidosFunil2: number };
};

export function montarAnaliseGerencial(linhas: LinhaContagem[]): AnaliseGerencial {
  const total = linhas.length;
  const recusados = linhas.filter((l) => l.resultado === "Recusado").length;
  const aprovados = linhas.filter((l) => l.funil === "Negociação e Contrato").length; // todo card no funil 2 já foi aprovado no funil 1
  const perdidos = linhas.filter((l) => l.resultado === "Perdido").length;
  const convertidos = linhas.filter((l) => l.resultado === "Convertido").length;
  const emAndamento = linhas.filter((l) => l.resultado === "Em andamento").length;
  const comAlerta = linhas.filter((l) => l.alertas.length > 0).length;

  const porFunilEtapa: Record<string, number> = {};
  for (const l of linhas) {
    const chave = `${l.funil} | ${l.etapaAtual}`;
    porFunilEtapa[chave] = (porFunilEtapa[chave] ?? 0) + 1;
  }

  function porResponsavel(linhasFunil: LinhaContagem[], creditoPositivo: (l: LinhaContagem) => boolean) {
    const mapa: Record<string, { cards: number; andamento: number; negativos: number; positivos: number }> = {};
    for (const l of linhasFunil) {
      const nome = l.responsavelAtual || "(sem responsável)";
      mapa[nome] ??= { cards: 0, andamento: 0, negativos: 0, positivos: 0 };
      mapa[nome].cards++;
      if (creditoPositivo(l)) mapa[nome].positivos++;
      else if (l.resultado === "Recusado" || l.resultado === "Perdido") mapa[nome].negativos++;
      else mapa[nome].andamento++;
    }
    return mapa;
  }
  // Funil 1: cards ainda ativos ali contam por Andamento/Negativos; os que já
  // avançaram pro funil 2 entram como "Positivos" pelo responsável ATUAL
  // (não dá pra saber quem especificamente fechou a análise — a API não
  // guarda histórico de troca de responsável, só de etapa).
  const porResponsavelFunil1 = porResponsavel(linhas, (l) => l.funil === "Negociação e Contrato");
  const porResponsavelFunil2 = porResponsavel(
    linhas.filter((l) => l.funil === "Negociação e Contrato"),
    (l) => l.resultado === "Convertido"
  );

  const statusPorSeguradora: Record<string, Record<string, number>> = {};
  const cotadoPorSeguradora: Record<string, { n: number; premio: number; comissao: number }> = {};
  const taxaPorSeguradora: Record<string, { n: number; pctLocacao: number; pctAluguel: number }> = {};
  for (const seg of SEGURADORAS) {
    const rotulos = seg.status.map(([rotulo]) => rotulo);
    for (const rotulo of rotulos) {
      const chave = rotulos.length > 1 ? `${seg.nome} (${rotulo})` : seg.nome;
      const contagem: Record<string, number> = {};
      for (const l of linhas) {
        const valor = l.seguradoras[seg.nome]?.status[rotulo];
        if (!valor) continue;
        contagem[valor] = (contagem[valor] ?? 0) + 1;
      }
      statusPorSeguradora[chave] = contagem;
    }

    const cotadas = linhas.filter((l) => typeof l.seguradoras[seg.nome]?.valor === "number");
    cotadoPorSeguradora[seg.nome] = {
      n: cotadas.length,
      premio: cotadas.reduce((a, l) => a + (l.seguradoras[seg.nome].valor as number), 0),
      comissao: cotadas.reduce((a, l) => {
        const s = l.seguradoras[seg.nome];
        const pct = typeof s.comissaoPct === "number" ? s.comissaoPct : 0;
        return a + (s.valor as number) * (pct / 100);
      }, 0),
    };

    const comTaxa = linhas.filter((l) => typeof l.seguradoras[seg.nome]?.pctLocacao === "number");
    taxaPorSeguradora[seg.nome] = {
      n: comTaxa.length,
      pctLocacao: media(comTaxa.map((l) => l.seguradoras[seg.nome].pctLocacao as number)),
      pctAluguel: media(comTaxa.map((l) => l.seguradoras[seg.nome].pctAluguel as number)),
    };
  }

  const recusasFunil1 = linhas.filter((l) => l.resultado === "Recusado");
  const perdasFunil2 = linhas.filter((l) => l.resultado === "Perdido");
  const motivosPerdaFunil2: Record<string, number> = {};
  let perdasSemMotivo = 0;
  for (const l of perdasFunil2) {
    if (!l.motivoRecusaPerda) {
      perdasSemMotivo++;
      continue;
    }
    motivosPerdaFunil2[l.motivoRecusaPerda] = (motivosPerdaFunil2[l.motivoRecusaPerda] ?? 0) + 1;
  }

  const porImobiliaria: Record<
    string,
    { total: number; recusados: number; emAndamento: number; perdidos: number; convertidos: number }
  > = {};
  let semImobiliaria = 0;
  for (const l of linhas) {
    if (!l.imobiliaria) {
      semImobiliaria++;
      continue;
    }
    porImobiliaria[l.imobiliaria] ??= { total: 0, recusados: 0, emAndamento: 0, perdidos: 0, convertidos: 0 };
    const d = porImobiliaria[l.imobiliaria];
    d.total++;
    if (l.resultado === "Recusado") d.recusados++;
    else if (l.resultado === "Perdido") d.perdidos++;
    else if (l.resultado === "Convertido") d.convertidos++;
    else d.emAndamento++; // "Aprovado" é transitório (card já está no funil 2, contado lá pelo resultado real dele)
  }
  // Todas as imobiliárias com pelo menos 1 card, ordenadas por volume — a
  // UI decide quantas mostrar por padrão (ver ImobiliariasTabela.tsx).
  const topImobiliarias = Object.entries(porImobiliaria)
    .map(([nome, d]) => ({ nome, ...d }))
    .sort((a, b) => b.total - a.total);

  const valoresTrabalhados = {
    aluguel: linhas.reduce((a, l) => a + (typeof l.aluguel === "number" ? l.aluguel : 0), 0),
    pacoteLocacao: linhas.reduce((a, l) => a + (typeof l.pacoteLocacao === "number" ? l.pacoteLocacao : 0), 0),
  };

  // Ticket médio por faixa de pacote de locação: quanto maior o pacote,
  // maior a parcela média do seguro cotado (média das cotações não-vazias
  // de cada card, depois média entre os cards da faixa).
  function cotacaoMediaDoCard(l: LinhaContagem): number | null {
    const valores = SEGURADORAS.map((seg) => l.seguradoras[seg.nome]?.valor).filter((v): v is number => typeof v === "number" && v > 0);
    return valores.length ? media(valores) : null;
  }
  const FAIXAS_PACOTE = [
    { faixa: "Até R$ 1.800", min: 0, max: 1800 },
    { faixa: "R$ 1.800 – R$ 2.600", min: 1800, max: 2600 },
    { faixa: "R$ 2.600 – R$ 5.200", min: 2600, max: 5200 },
    { faixa: "Acima de R$ 5.200", min: 5200, max: Infinity },
  ];
  const faixasPacoteLocacao = FAIXAS_PACOTE.map(({ faixa, min: minFaixa, max: maxFaixa }) => {
    const doFaixa = linhas.filter((l) => typeof l.pacoteLocacao === "number" && l.pacoteLocacao >= minFaixa && l.pacoteLocacao < maxFaixa);
    const cotacoes = doFaixa.map(cotacaoMediaDoCard).filter((v): v is number => v !== null);
    return {
      faixa,
      cards: doFaixa.length,
      pacoteMedio: media(doFaixa.map((l) => l.pacoteLocacao as number)),
      seguroMedio: media(cotacoes),
    };
  });

  const diasPorEtapa: Record<string, number[]> = {};
  for (const l of linhas) {
    const chave = `${l.funil} | ${l.etapaAtual}`;
    (diasPorEtapa[chave] ??= []).push(l.diasEmAberto);
  }
  const tempoPorEtapa: AnaliseGerencial["tempoPorEtapa"] = {};
  for (const [chave, dias] of Object.entries(diasPorEtapa)) {
    const ordenado = [...dias].sort((a, b) => a - b);
    tempoPorEtapa[chave] = { media: media(dias), mediana: mediana(dias), min: ordenado[0], max: ordenado[ordenado.length - 1], n: dias.length };
  }

  // Cards em andamento parados bem acima da média da própria etapa (não é
  // "dias corridos" isolado — é relativo ao ritmo normal daquela etapa).
  const candidatosAtencao = linhas
    .filter((l) => l.resultado === "Em andamento")
    .map((l) => {
      const stats = tempoPorEtapa[`${l.funil} | ${l.etapaAtual}`];
      const razao = stats && stats.media > 0 ? l.diasEmAberto / stats.media : 0;
      return { id: l.id, nome: l.nome, etapa: l.etapaAtual, dias: l.diasEmAberto, mediaEtapa: stats?.media ?? 0, responsavel: l.responsavelAtual, razao };
    })
    .filter((c) => c.razao > 1.3 && c.dias >= 2)
    .sort((a, b) => b.dias - a.dias || b.razao - a.razao)
    .slice(0, 8);
  const cardsQuePedemAtencao = candidatosAtencao.map((c) => ({
    id: c.id,
    nome: c.nome,
    etapa: c.etapa,
    dias: c.dias,
    mediaEtapa: c.mediaEtapa,
    responsavel: c.responsavel,
  }));

  return {
    kpis: { total, emAndamento, recusados, aprovados, perdidos, convertidos, comAlerta, imobiliarias: Object.keys(porImobiliaria).length },
    porFunilEtapa,
    porResponsavelFunil1,
    porResponsavelFunil2,
    statusPorSeguradora,
    cotadoPorSeguradora,
    taxaPorSeguradora,
    motivosRecusaFunil1: { total: recusasFunil1.length, semMotivo: recusasFunil1.length },
    motivosPerdaFunil2: { porMotivo: motivosPerdaFunil2, semMotivo: perdasSemMotivo, total: perdasFunil2.length },
    topImobiliarias,
    valoresTrabalhados,
    faixasPacoteLocacao,
    tempoPorEtapa,
    cardsQuePedemAtencao,
    qualidade: { semImobiliaria, perdidosFunil2SemMotivo: perdasSemMotivo, totalPerdidosFunil2: perdasFunil2.length },
  };
}
