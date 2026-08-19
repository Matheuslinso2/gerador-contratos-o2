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

// Ordem de progressão dos funis (funil 1 do primeiro ao último status, depois
// funil 2 do primeiro ao último) — usada pra ordenar o painel "Tempo em
// aberto por etapa" na mesma sequência em que o card realmente avança.
const ORDEM_CHAVES_ETAPA = ETAPAS.map((e) => {
  const funil = e.statusId.startsWith("DT1042_18") ? "Análise e Cotação" : "Negociação e Contrato";
  return `${funil} | ${e.nome}`;
});

type ConfigSeguradora = {
  nome: string;
  status: [string, string][]; // [rótulo do plano, código do campo] — mais de um item quando a seguradora tem planos com status separado (ex: Porto)
  valor: string; // valor da PARCELA cotada (mensal), não o prêmio total -- confirmado com o usuário
  parcelas: string | null; // nº de parcelas cotado -- valor × parcelas = prêmio total cotado, comparável com o prêmio líquido efetivado
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
    parcelas: "ufCrm10_1776867679954",
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
    parcelas: "ufCrm10_1776867921034",
    comissao: "ufCrm10_1776867916361",
    pAluguel: "ufCrm10_1776867930894",
    pLocacao: "ufCrm10_1776867936621",
  },
  {
    nome: "Pottencial (Taxa Fixa)",
    status: [["Status", "ufCrm10_1776867969326"]],
    valor: "ufCrm10_1776867980768",
    // "Parcelas - Pottencial" é compartilhado entre os 2 planos no Bitrix,
    // mesma limitação já documentada pra taxa/aluguel/locação da Pottencial.
    parcelas: "ufCrm10_1776867953606",
    comissao: "ufCrm10_1776867975334",
    pAluguel: "ufCrm10_1778265458",
    pLocacao: "ufCrm10_1778265502",
  },
  {
    nome: "Pottencial (Tradicional)",
    status: [["Status", "ufCrm10_1776867994910"]],
    valor: "ufCrm10_1776868008634",
    parcelas: "ufCrm10_1776867953606",
    comissao: "ufCrm10_1776867999897",
    pAluguel: "ufCrm10_1778265458",
    pLocacao: "ufCrm10_1778265502",
  },
  {
    nome: "Tokio",
    status: [["Status", "ufCrm10_1776868050602"]],
    valor: "ufCrm10_1776868065822",
    parcelas: "ufCrm10_1776868060146",
    comissao: "ufCrm10_1776868055318",
    pAluguel: "ufCrm10_1776868072231",
    pLocacao: "ufCrm10_1776868076763",
  },
  {
    nome: "Junto",
    status: [["Status", "ufCrm10_1776868102153"]],
    valor: "ufCrm10_1778263318",
    parcelas: "ufCrm10_1776868106892",
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
// "Valor do Premio Liquido" é o campo realmente usado hoje (money) -- os
// dois anteriores ("Prêmio Líquido" string e "Prémio Líquido" double) estão
// vazios em todo card convertido conferido, provavelmente campos antigos
// que pararam de ser preenchidos quando esse campo novo entrou.
const CAMPO_PREMIO_LIQUIDO_NOVO = "ufCrm10_1781029986152";
const CAMPO_PREMIO_LIQUIDO = "ufCrm10_1779820763";
const CAMPO_PREMIO_LIQUIDO_LEGADO = "ufCrm10_1778258846";
// "Comissão Trabalhada" é um PERCENTUAL (ex: 29 = 29%), não um valor em
// reais -- confirmado nos dados reais dos 8 cards convertidos (valores como
// 10, 16, 24, 40, incompatíveis com R$ mas plausíveis como %).
const CAMPO_COMISSAO_FINAL_PCT = "ufCrm10_1779820737";
const CAMPO_COMISSAO_FINAL_PCT_LEGADO = "ufCrm10_1778258780";
const CAMPO_DESCONTO = "ufCrm10_1781029891735";
const CAMPO_DESCONTO_LEGADO = "ufCrm10_1779820897";
// Adicionados pela supervisora em 05/08/2026 pra medir quanto tempo o
// cotador (Kelly/Cassia, normalmente) leva pra executar a fase de Análise e
// Cotação de um card — confirmados via crm.item.fields, únicos dos vários
// campos "HORA INICIO/FIM" testados naquele dia que de fato têm dado (os
// outros ficaram vazios, foram tentativas abandonadas).
const CAMPO_INICIO_COTACAO = "ufCrm10_1785946291045";
const CAMPO_FIM_COTACAO = "ufCrm10_1785946326148";
// Adicionados em 17/08/2026 pra resolver a perda de registro do responsável
// quando o card muda de dono ao longo do processo (assignedById só guarda o
// dono ATUAL) -- um campo por etapa, confirmados via crm.item.fields.
// Cotação e Negociação aceitam mais de uma pessoa por card (isMultiple),
// Cadastro (etapa "Iniciante") e Efetivação são de pessoa única.
const CAMPO_RESPONSAVEL_CADASTRO = "ufCrm10_1786644365";
const CAMPO_RESPONSAVEIS_COTACAO = "ufCrm10_1786644429";
const CAMPO_RESPONSAVEIS_NEGOCIACAO = "ufCrm10_1786644450";
const CAMPO_RESPONSAVEL_EFETIVACAO = "ufCrm10_1786644465";

function enumLabel(defs: Record<string, BitrixDefinicaoCampo>, campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const item = defs[campo]?.items?.find((i) => i.ID === String(valor));
  return item ? item.VALUE : String(valor);
}

function nomeUsuario(usuarios: Record<number, string>, id: number | undefined): string {
  if (!id) return "";
  return usuarios[id] || `ID ${id}`;
}

// Campos "employee" do Bitrix vêm como array (múltiplo) ou valor solto
// (único) -- normaliza os dois formatos pra uma lista de IDs.
function idsResponsavel(v: unknown): number[] {
  if (v === null || v === undefined || v === "") return [];
  const bruto = Array.isArray(v) ? v : [v];
  return bruto.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0);
}

function nomesResponsaveis(usuarios: Record<number, string>, v: unknown): string[] {
  return idsResponsavel(v)
    .map((id) => nomeUsuario(usuarios, id))
    .filter(Boolean);
}

// IDs de usuário referenciados nos campos de responsável por etapa de um
// card -- usado só pra saber quem resolver via user.get antes de montar as
// linhas (ver buscarDadosAoVivo em page.tsx).
export function idsResponsaveisEtapas(item: BitrixItemRaw): number[] {
  return [
    ...idsResponsavel(item[CAMPO_RESPONSAVEL_CADASTRO]),
    ...idsResponsavel(item[CAMPO_RESPONSAVEIS_COTACAO]),
    ...idsResponsavel(item[CAMPO_RESPONSAVEIS_NEGOCIACAO]),
    ...idsResponsavel(item[CAMPO_RESPONSAVEL_EFETIVACAO]),
  ];
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
  segmentosEtapa: { funil: "Análise e Cotação" | "Negociação e Contrato"; etapa: string; minutos: number }[];
  minutosEtapaAtual: number;
  minutosFunil1: number;
  minutosFunil2: number | null;
  minutosCotacao: number | null; // HORA FIM - HORA INICIO; null se um dos dois não estiver preenchido ainda
  dataCotacao: string; // data (YYYY-MM-DD) da HORA FIM — dia em que a cotação foi concluída; "" se não preenchida
  cotacaoCamposTrocados: boolean; // HORA INICIO/HORA FIM aparentam estar invertidos (duração já vem em valor absoluto)
  qtdMovimentacoes: number;
  responsavelAtual: string; // campo nativo (assignedById, dono ATUAL) -- guardado só como dado bruto, nenhuma métrica usa mais
  responsavelCadastro: string; // campo dedicado (17/08/2026), etapa "Iniciante", nome único, "" se vazio
  responsaveisCotacao: string[]; // campo dedicado (17/08/2026), pode ter mais de um nome
  responsaveisNegociacao: string[]; // idem
  responsavelEfetivacao: string; // nome único, "" se vazio
  criadoPor: string;
  ultimaMovimentacaoPor: string;
  aluguel: number | "";
  pacoteLocacao: number | "";
  seguradoras: Record<
    string,
    {
      status: Record<string, string>;
      valor: number | ""; // valor da PARCELA cotada
      parcelas: number | "";
      comissaoPct: number | "";
      pctAluguel: number | "";
      pctLocacao: number | "";
    }
  >;
  seguradoraEscolhida: string;
  motivoRecusaPerda: string;
  vigenciaInicial: string;
  vigenciaFinal: string;
  dataEfetivacao: string;
  premioLiquido: number | "";
  comissaoFinalPct: number | ""; // percentual (ex: 29 = 29%), não valor em reais
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

function nomeFunil(categoryId: number): LinhaContagem["funil"] {
  return categoryId === CATEGORIA_ANALISE ? "Análise e Cotação" : "Negociação e Contrato";
}

// Reconstrói, a partir do histórico real de mudança de etapa (crm.stagehistory.list),
// quanto tempo o card passou em cada etapa por onde já passou — não é "idade
// do card", é o tempo entre entrar numa etapa e sair dela (ou "agora"/fim de
// contagem, na etapa em que está atualmente). Se o card voltar pra uma etapa
// já visitada, cada passagem vira um segmento separado (soma nas agregações).
function construirSegmentosEtapa(
  item: BitrixItemRaw,
  eventos: BitrixStageHistoryEvent[],
  fimCard: Date
): { funil: LinhaContagem["funil"]; etapa: string; minutos: number }[] {
  const ordenados = [...eventos].sort((a, b) => new Date(a.CREATED_TIME).getTime() - new Date(b.CREATED_TIME).getTime());
  const pontos = ordenados.length
    ? ordenados.map((e) => ({
        funil: nomeFunil(e.CATEGORY_ID),
        etapa: etapaPorStatusId.get(e.STAGE_ID)?.nome ?? e.STAGE_ID,
        inicio: new Date(e.CREATED_TIME),
      }))
    : [{ funil: nomeFunil(item.categoryId), etapa: etapaPorStatusId.get(item.stageId)?.nome ?? item.stageId, inicio: new Date(item.createdTime) }];

  // O primeiro ponto conhecido é a etapa em que o card nasceu — conta a
  // partir da criação do card, não do timestamp do primeiro evento (que às
  // vezes fica alguns segundos depois, por processamento interno do Bitrix).
  pontos[0] = { ...pontos[0], inicio: new Date(item.createdTime) };

  return pontos.map((p, i) => {
    const fim = i + 1 < pontos.length ? pontos[i + 1].inicio : fimCard;
    const minutos = Math.max(0, Math.round((fim.getTime() - p.inicio.getTime()) / 60_000));
    return { funil: p.funil, etapa: p.etapa, minutos };
  });
}

// Dois marcos do processo, além do tempo por etapa: quanto tempo o card
// levou do início até sair de Análise e Cotação (aprovado ou recusado), e
// quanto tempo passou dentro de Negociação e Contrato até finalizar (ou até
// agora, se ainda estiver lá). minutosFunil2 é null pra quem nunca chegou
// no funil 2 (recusado ainda em Análise e Cotação).
function calcularTemposFunil(
  item: BitrixItemRaw,
  eventos: BitrixStageHistoryEvent[],
  fimCard: Date
): { minutosFunil1: number; minutosFunil2: number | null } {
  const ordenados = [...eventos].sort((a, b) => new Date(a.CREATED_TIME).getTime() - new Date(b.CREATED_TIME).getTime());
  const inicioCard = new Date(item.createdTime);
  const primeiroFunil2 = ordenados.find((e) => nomeFunil(e.CATEGORY_ID) === "Negociação e Contrato");

  if (!primeiroFunil2) {
    return { minutosFunil1: Math.max(0, Math.round((fimCard.getTime() - inicioCard.getTime()) / 60_000)), minutosFunil2: null };
  }
  const entradaFunil2 = new Date(primeiroFunil2.CREATED_TIME);
  return {
    minutosFunil1: Math.max(0, Math.round((entradaFunil2.getTime() - inicioCard.getTime()) / 60_000)),
    minutosFunil2: Math.max(0, Math.round((fimCard.getTime() - entradaFunil2.getTime()) / 60_000)),
  };
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

    const fimCard = resultado === "Em andamento" ? agora : new Date(item.movedTime || item.updatedTime);
    const segmentosEtapa = construirSegmentosEtapa(item, eventos, fimCard);
    const minutosEtapaAtual = segmentosEtapa[segmentosEtapa.length - 1]?.minutos ?? 0;
    const { minutosFunil1, minutosFunil2 } = calcularTemposFunil(item, eventos, fimCard);

    const inicioCotacaoRaw = item[CAMPO_INICIO_COTACAO];
    const fimCotacaoRaw = item[CAMPO_FIM_COTACAO];
    // O card pode ter HORA INICIO/HORA FIM preenchidos trocados (a pessoa
    // digitou os campos invertidos) — confirmado comparando com "Tempo
    // Gasto", campo calculado pelo próprio Bitrix, que sempre mostra a
    // duração real independente da ordem. Usamos valor absoluto pela mesma
    // razão, e marcamos o card pra aparecer na qualidade dos dados.
    const minutosCotacaoBruto =
      inicioCotacaoRaw && fimCotacaoRaw
        ? Math.round((new Date(String(fimCotacaoRaw)).getTime() - new Date(String(inicioCotacaoRaw)).getTime()) / 60_000)
        : null;
    const minutosCotacao = minutosCotacaoBruto !== null ? Math.abs(minutosCotacaoBruto) : null;
    const cotacaoCamposTrocados = minutosCotacaoBruto !== null && minutosCotacaoBruto < 0;
    const dataCotacao = fimCotacaoRaw ? apenasData(String(fimCotacaoRaw)) : "";

    const motivoRecusaPerda = enumLabel(defs, CAMPO_MOTIVO_RECUSA, item[CAMPO_MOTIVO_RECUSA]);
    const alertas: string[] = [];
    // Recusa em Análise e Cotação (categoryId 18) não exige motivo — só perdas em Negociação e Contrato (categoryId 20).
    if (resultado === "Perdido" && !motivoRecusaPerda) alertas.push("Perdido sem motivo registrado");
    if (!item.companyId) alertas.push("Sem imobiliária/empresa vinculada");
    if (resultado === "Convertido" && !enumLabel(defs, CAMPO_SEGURADORA_ESCOLHIDA, item[CAMPO_SEGURADORA_ESCOLHIDA])) {
      alertas.push("Convertido sem seguradora escolhida");
    }

    const alugCard = valorMonetario(item[CAMPO_ALUGUEL]);
    const pacoteCard = valorMonetario(item[CAMPO_PACOTE_LOCACAO]);

    const seguradoras: LinhaContagem["seguradoras"] = {};
    for (const seg of SEGURADORAS) {
      const status: Record<string, string> = {};
      for (const [rotulo, campo] of seg.status) status[rotulo] = enumLabel(defs, campo, item[campo]);
      const valorPlano = valorMonetario(item[seg.valor]);

      // Pottencial (Taxa Fixa) e Pottencial (Tradicional) compartilham o
      // MESMO campo de "% do Aluguel"/"% da Locação" no Bitrix -- não existe
      // um campo separado por plano lá (confirmado via crm.item.fields).
      // Ler esse campo direto sempre dá o mesmo número pros dois planos.
      // Como o campo "Valor" já é separado corretamente por plano, calculamos
      // a taxa real (valor da cotação ÷ pacote/aluguel) em vez de ler o
      // campo % compartilhado -- mesma regra já documentada no topo do
      // arquivo, só que agora aplicada de fato pra esse caso.
      let pctAluguel: number | "" = "";
      let pctLocacao: number | "" = "";
      if (seg.nome.startsWith("Pottencial")) {
        pctAluguel = typeof valorPlano === "number" && typeof alugCard === "number" && alugCard > 0 ? (valorPlano / alugCard) * 100 : "";
        pctLocacao = typeof valorPlano === "number" && typeof pacoteCard === "number" && pacoteCard > 0 ? (valorPlano / pacoteCard) * 100 : "";
      } else {
        const pAluguel = item[seg.pAluguel];
        const pLocacao = item[seg.pLocacao];
        pctAluguel = typeof pAluguel === "number" ? pAluguel : "";
        pctLocacao = typeof pLocacao === "number" ? pLocacao : "";
      }

      const parcelasRaw = seg.parcelas ? item[seg.parcelas] : undefined;

      seguradoras[seg.nome] = {
        status,
        valor: valorPlano,
        parcelas: typeof parcelasRaw === "number" ? parcelasRaw : "",
        comissaoPct: seg.comissao ? valorMonetario(item[seg.comissao]) : "",
        pctAluguel,
        pctLocacao,
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
      segmentosEtapa,
      minutosEtapaAtual,
      minutosFunil1,
      minutosFunil2,
      minutosCotacao,
      dataCotacao,
      cotacaoCamposTrocados,
      qtdMovimentacoes: eventos.length,
      responsavelAtual: nomeUsuario(usuarios, item.assignedById),
      responsavelCadastro: nomesResponsaveis(usuarios, item[CAMPO_RESPONSAVEL_CADASTRO])[0] ?? "",
      responsaveisCotacao: nomesResponsaveis(usuarios, item[CAMPO_RESPONSAVEIS_COTACAO]),
      responsaveisNegociacao: nomesResponsaveis(usuarios, item[CAMPO_RESPONSAVEIS_NEGOCIACAO]),
      responsavelEfetivacao: nomesResponsaveis(usuarios, item[CAMPO_RESPONSAVEL_EFETIVACAO])[0] ?? "",
      criadoPor: nomeUsuario(usuarios, item.createdBy),
      ultimaMovimentacaoPor: nomeUsuario(usuarios, item.movedBy),
      aluguel: alugCard,
      pacoteLocacao: pacoteCard,
      seguradoras,
      seguradoraEscolhida: enumLabel(defs, CAMPO_SEGURADORA_ESCOLHIDA, item[CAMPO_SEGURADORA_ESCOLHIDA]),
      motivoRecusaPerda,
      vigenciaInicial: apenasData(item[CAMPO_VIGENCIA_INICIAL]),
      vigenciaFinal: apenasData(item[CAMPO_VIGENCIA_FINAL]),
      dataEfetivacao: apenasData(item[CAMPO_DATA_EFETIVACAO]),
      premioLiquido:
        valorMonetario(item[CAMPO_PREMIO_LIQUIDO_NOVO]) ||
        valorMonetario(item[CAMPO_PREMIO_LIQUIDO]) ||
        valorMonetario(item[CAMPO_PREMIO_LIQUIDO_LEGADO]),
      comissaoFinalPct: valorMonetario(item[CAMPO_COMISSAO_FINAL_PCT]) || valorMonetario(item[CAMPO_COMISSAO_FINAL_PCT_LEGADO]),
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

type EstatisticaTempo = { media: number; mediana: number; min: number; max: number; n: number };
function estatisticasTempo(minutos: number[]): EstatisticaTempo {
  const ordenado = [...minutos].sort((a, b) => a - b);
  return { media: media(minutos), mediana: mediana(minutos), min: ordenado[0] ?? 0, max: ordenado[ordenado.length - 1] ?? 0, n: minutos.length };
}

export type AnaliseGerencial = {
  kpis: { total: number; emAndamento: number; recusados: number; aprovados: number; perdidos: number; convertidos: number; comAlerta: number; imobiliarias: number };
  porFunilEtapa: Record<string, number>;
  porResponsavelFunil1: Record<string, { cards: number; andamento: number; negativos: number; positivos: number }>;
  porResponsavelFunil2: Record<string, { cards: number; andamento: number; negativos: number; positivos: number }>;
  statusPorSeguradora: Record<string, Record<string, number>>;
  cotadoPorSeguradora: Record<string, { n: number; premio: number; comissao: number }>;
  convertidoPorSeguradora: Record<string, { n: number; premio: number; comissao: number }>;
  taxaPorSeguradora: Record<string, { n: number; pctLocacao: number; pctAluguel: number }>;
  motivosRecusaFunil1: { total: number; semMotivo: number }; // decisão de compliance, sem motivo interno — só o total importa
  motivosPerdaFunil2: { porMotivo: Record<string, number>; semMotivo: number; total: number };
  topImobiliarias: {
    nome: string;
    total: number;
    recusados: number;
    emAndamento: number;
    perdidos: number;
    convertidos: number;
    premioCotado: number;
    comissaoCotada: number;
    premioEfetivado: number;
    comissaoEfetivada: number;
    ticketMedio: number;
    mediaPercentualPacote: number;
  }[];
  valoresTrabalhados: { aluguel: number; pacoteLocacao: number };
  faixasPacoteLocacao: { faixa: string; cards: number; pacoteMedio: number; seguroMedio: number }[];
  tempoPorEtapa: Record<string, EstatisticaTempo>;
  tempoPorFunil: { analiseECotacao: EstatisticaTempo; negociacaoEContrato: EstatisticaTempo };
  cardsQuePedemAtencao: { id: number; nome: string; etapa: string; minutos: number; mediaEtapa: number; responsavel: string }[];
  tempoCotacaoPorResponsavel: Record<string, { recusado: EstatisticaTempo; aprovado: EstatisticaTempo }>;
  analisesDiariasPorResponsavel: QuadroDiario;
  contratosRecebidosPorDia: QuadroDiario;
  efetivacoesPorDia: QuadroDiario;
  qualidade: {
    semImobiliaria: number;
    perdidosFunil2SemMotivo: number;
    totalPerdidosFunil2: number;
    cotacaoTempoInconsistente: number;
    saiuFunil1SemHoraFim: number;
    semResponsavelCotacao: number;
    semResponsavelNegociacao: number;
    semResponsavelEfetivacao: number;
  };
};

// Forma comum dos 3 quadros "por dia × responsável" do painel (cotações,
// contratos recebidos, efetivações) -- ver montarQuadroDiario. semResponsavel
// é a contagem de cards que entraram na conta (têm o "dia" válido) mas não
// têm o campo de responsável daquela etapa preenchido -- não vira bucket na
// tabela, vira alerta em "Qualidade dos dados".
export type QuadroDiario = {
  responsaveis: string[];
  dias: { data: string; porResponsavel: Record<string, number>; total: number }[];
  semResponsavel: number;
};

function diasDoMes(competencia: string): string[] {
  const [ano, mes] = competencia.split("-").map(Number);
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return Array.from({ length: ultimoDia }, (_, i) => `${competencia}-${String(i + 1).padStart(2, "0")}`);
}

// Agrega uma lista de eventos (um card = um evento, com o dia em que ele
// aconteceu e os nomes dos responsáveis daquele card por aquela etapa) num
// quadro diário: total = nº de cards no dia (métrica real de volume), e o
// crédito por responsável é somado à parte -- quando um card tem mais de um
// responsável (Cotação/Negociação aceitam vários), cada um recebe crédito
// no seu nome, então a soma das colunas pode passar do Total. Cards sem
// nenhum responsável preenchido NÃO viram bucket na tabela (poluía a
// leitura) -- só contam pra `total` do dia e pra `semResponsavel`, que o
// painel de "Qualidade dos dados" usa pra alertar preenchimento incompleto.
function montarQuadroDiario(eventos: { dia: string; nomes: string[] }[], competencia: string): QuadroDiario {
  const porDia: Record<string, Record<string, number>> = {};
  const totalPorDia: Record<string, number> = {};
  const nomesSet = new Set<string>();
  let semResponsavel = 0;
  for (const { dia, nomes } of eventos) {
    if (!dia || !dia.startsWith(competencia)) continue;
    totalPorDia[dia] = (totalPorDia[dia] ?? 0) + 1;
    if (!nomes.length) {
      semResponsavel++;
      continue;
    }
    porDia[dia] ??= {};
    for (const nome of nomes) {
      porDia[dia][nome] = (porDia[dia][nome] ?? 0) + 1;
      nomesSet.add(nome);
    }
  }
  return {
    responsaveis: [...nomesSet].sort(),
    dias: diasDoMes(competencia).map((data) => ({ data, porResponsavel: porDia[data] ?? {}, total: totalPorDia[data] ?? 0 })),
    semResponsavel,
  };
}

// Snapshots salvos no Supabase antes de 17/08/2026 têm a forma antiga
// (contratosRecebidosPorDia era {data,quantidade}[], efetivacoesPorDia nem
// existia) -- ao reabrir uma competência passada, essa função evita quebrar
// a página, devolvendo um quadro vazio em vez do formato incompatível.
export function normalizarQuadroDiario(valor: unknown, competencia: string): QuadroDiario {
  const v = valor as Partial<QuadroDiario> | undefined | null;
  if (v && Array.isArray(v.responsaveis) && Array.isArray(v.dias)) {
    return { responsaveis: v.responsaveis, dias: v.dias, semResponsavel: typeof v.semResponsavel === "number" ? v.semResponsavel : 0 };
  }
  return { responsaveis: [], dias: diasDoMes(competencia).map((data) => ({ data, porResponsavel: {}, total: 0 })), semResponsavel: 0 };
}

const ETAPA_CONTRATO_RECEBIDO = "DT1042_20:UC_RD3MTL";

export function montarAnaliseGerencial(
  linhas: LinhaContagem[],
  historico: BitrixStageHistoryEvent[],
  competencia: string
): AnaliseGerencial {
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

  function porResponsavel(
    linhasFunil: LinhaContagem[],
    creditoPositivo: (l: LinhaContagem) => boolean,
    obterNomes: (l: LinhaContagem) => string[]
  ) {
    const mapa: Record<string, { cards: number; andamento: number; negativos: number; positivos: number }> = {};
    for (const l of linhasFunil) {
      const nomes = obterNomes(l);
      for (const nome of nomes.length ? nomes : ["(sem responsável)"]) {
        mapa[nome] ??= { cards: 0, andamento: 0, negativos: 0, positivos: 0 };
        mapa[nome].cards++;
        if (creditoPositivo(l)) mapa[nome].positivos++;
        else if (l.resultado === "Recusado" || l.resultado === "Perdido") mapa[nome].negativos++;
        else mapa[nome].andamento++;
      }
    }
    return mapa;
  }
  // Responsável(is) do funil 1 (Análise e Cotação) pra um card: prioriza
  // Responsáveis pela Cotação (etapa em que o card de fato está sendo
  // trabalhado); cai pro Responsável pelo Cadastro só se a cotação ainda nem
  // começou. Nunca usa o campo nativo (assignedById) -- esse perde o
  // histórico assim que o card muda de dono.
  const nomesFunil1 = (l: LinhaContagem): string[] =>
    l.responsaveisCotacao.length ? l.responsaveisCotacao : l.responsavelCadastro ? [l.responsavelCadastro] : [];
  // Funil 1: cards ainda ativos ali contam por Andamento/Negativos; os que já
  // avançaram pro funil 2 entram como "Positivos" (créditos de quem cotou,
  // ou de quem cadastrou se a cotação nunca chegou a ser atribuída).
  const porResponsavelFunil1 = porResponsavel(linhas, (l) => l.funil === "Negociação e Contrato", nomesFunil1);
  const porResponsavelFunil2 = porResponsavel(
    linhas.filter((l) => l.funil === "Negociação e Contrato"),
    (l) => l.resultado === "Convertido",
    (l) => l.responsaveisNegociacao
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
    // "Valor" é a PARCELA cotada (mensal), não o prêmio total -- confirmado
    // com o usuário. Prêmio cotado = parcela × nº de parcelas, senão fica
    // numa escala 8-29x menor que o prêmio líquido efetivado (que já é
    // total), inviabilizando a comparação "Cotado vs Convertido". Cards sem
    // o campo "Parcelas" preenchido ficam de fora da soma de premio/comissao
    // (não dá pra estimar o total sem saber quantas parcelas) -- "n" (qtd
    // cotada) continua contando todos, só o valor em R$ fica subestimado
    // proporcionalmente a esses casos.
    cotadoPorSeguradora[seg.nome] = {
      n: cotadas.length,
      premio: cotadas.reduce((a, l) => {
        const s = l.seguradoras[seg.nome];
        if (typeof s.valor !== "number" || typeof s.parcelas !== "number") return a;
        return a + s.valor * s.parcelas;
      }, 0),
      comissao: cotadas.reduce((a, l) => {
        const s = l.seguradoras[seg.nome];
        if (typeof s.valor !== "number" || typeof s.parcelas !== "number") return a;
        const pct = typeof s.comissaoPct === "number" ? s.comissaoPct : 0;
        return a + s.valor * s.parcelas * (pct / 100);
      }, 0),
    };

    const comTaxa = linhas.filter((l) => typeof l.seguradoras[seg.nome]?.pctLocacao === "number");
    taxaPorSeguradora[seg.nome] = {
      n: comTaxa.length,
      pctLocacao: media(comTaxa.map((l) => l.seguradoras[seg.nome].pctLocacao as number)),
      pctAluguel: media(comTaxa.map((l) => l.seguradoras[seg.nome].pctAluguel as number)),
    };
  }

  // Convertido de verdade (contrato fechado) -- usa a seguradora ESCOLHIDA
  // no card (campo preenchido só na conversão), não a lista de seguradoras
  // cotadas, e o prêmio líquido/comissão final registrados no fechamento
  // (não o valor cotado inicialmente, que pode ter mudado na negociação).
  const convertidoPorSeguradora: Record<string, { n: number; premio: number; comissao: number }> = {};
  for (const l of linhas) {
    if (l.resultado !== "Convertido") continue;
    const nome = l.seguradoraEscolhida || "Não identificado";
    const atual = convertidoPorSeguradora[nome] ?? { n: 0, premio: 0, comissao: 0 };
    const premio = typeof l.premioLiquido === "number" ? l.premioLiquido : 0;
    const pct = typeof l.comissaoFinalPct === "number" ? l.comissaoFinalPct : 0;
    atual.n += 1;
    atual.premio += premio;
    atual.comissao += premio * (pct / 100); // Comissão Trabalhada é % do prêmio líquido, não R$
    convertidoPorSeguradora[nome] = atual;
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
    {
      total: number;
      recusados: number;
      emAndamento: number;
      perdidos: number;
      convertidos: number;
      premioCotado: number;
      comissaoCotada: number;
      premioEfetivado: number;
      comissaoEfetivada: number;
      ticketMedioValores: number[];
      percentualPacoteValores: number[];
    }
  > = {};
  let semImobiliaria = 0;
  for (const l of linhas) {
    if (!l.imobiliaria) {
      semImobiliaria++;
      continue;
    }
    porImobiliaria[l.imobiliaria] ??= {
      total: 0,
      recusados: 0,
      emAndamento: 0,
      perdidos: 0,
      convertidos: 0,
      premioCotado: 0,
      comissaoCotada: 0,
      premioEfetivado: 0,
      comissaoEfetivada: 0,
      ticketMedioValores: [],
      percentualPacoteValores: [],
    };
    const d = porImobiliaria[l.imobiliaria];
    d.total++;
    if (l.resultado === "Recusado") d.recusados++;
    else if (l.resultado === "Perdido") d.perdidos++;
    else if (l.resultado === "Convertido") d.convertidos++;
    else d.emAndamento++; // "Aprovado" é transitório (card já está no funil 2, contado lá pelo resultado real dele)

    // Prêmio/comissão cotado -- soma de TODAS as seguradoras cotadas nesse
    // card (mesmo critério já usado no "Total cotado" de Cotado x
    // Convertido: um card cotado com 3 seguradoras conta as 3, não é
    // deduplicado por card). "Valor" é a PARCELA, então o prêmio total é
    // valor × parcelas (mesma correção aplicada em cotadoPorSeguradora) --
    // sem o nº de parcelas não dá pra estimar o total, esses casos ficam de
    // fora da soma em R$.
    for (const seg of SEGURADORAS) {
      const s = l.seguradoras[seg.nome];
      if (typeof s?.valor !== "number" || typeof s.parcelas !== "number") continue;
      const premioTotal = s.valor * s.parcelas;
      d.premioCotado += premioTotal;
      const pct = typeof s.comissaoPct === "number" ? s.comissaoPct : 0;
      d.comissaoCotada += premioTotal * (pct / 100);
    }

    // Ticket médio e % do pacote -- ao nível de CARD primeiro (média das
    // cotações do próprio card, ex: 5 seguradoras cotadas nesse card viram
    // 1 valor), e só depois média entre os cards da imobiliária. Evita o
    // mesmo problema do Prêmio Cotado (soma que cresce com o nº de
    // seguradoras cotadas, sem relação direta com o nº de cards).
    const ticketCard = cotacaoMediaDoCard(l);
    if (ticketCard !== null) d.ticketMedioValores.push(ticketCard);
    const pctCard = percentualPacoteMedioDoCard(l);
    if (pctCard !== null) d.percentualPacoteValores.push(pctCard);

    // Prêmio/comissão efetivado -- só cards convertidos, com o prêmio
    // líquido e o percentual de comissão registrados no fechamento (mesmo
    // cálculo de convertidoPorSeguradora).
    if (l.resultado === "Convertido") {
      const premio = typeof l.premioLiquido === "number" ? l.premioLiquido : 0;
      const pct = typeof l.comissaoFinalPct === "number" ? l.comissaoFinalPct : 0;
      d.premioEfetivado += premio;
      d.comissaoEfetivada += premio * (pct / 100);
    }
  }
  // Todas as imobiliárias com pelo menos 1 card, ordenadas por volume — a
  // UI decide quantas mostrar por padrão (ver ImobiliariasTabela.tsx).
  const topImobiliarias = Object.entries(porImobiliaria)
    .map(([nome, d]) => {
      const { ticketMedioValores, percentualPacoteValores, ...resto } = d;
      return {
        nome,
        ...resto,
        ticketMedio: media(ticketMedioValores),
        mediaPercentualPacote: media(percentualPacoteValores),
      };
    })
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
  // Mesma lógica do ticket médio, mas pra taxa (% do pacote de locação que
  // vira parcela do seguro) -- usada no ticket médio e no % médio por
  // imobiliária (ver porImobiliaria acima).
  function percentualPacoteMedioDoCard(l: LinhaContagem): number | null {
    const valores = SEGURADORAS.map((seg) => l.seguradoras[seg.nome]?.pctLocacao).filter(
      (v): v is number => typeof v === "number" && v > 0
    );
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

  // Tempo por etapa = só o card que está NA etapa AGORA, contando uma vez
  // (o tempo da passagem atual, minutosEtapaAtual) -- não soma passagens
  // antigas nem conta de novo um card que já voltou pra uma etapa visitada
  // antes. Cada card pertence a exatamente uma etapa aqui.
  const minutosPorEtapa: Record<string, number[]> = {};
  for (const l of linhas) {
    const chave = `${l.funil} | ${l.etapaAtual}`;
    (minutosPorEtapa[chave] ??= []).push(l.minutosEtapaAtual);
  }
  const tempoPorEtapa: AnaliseGerencial["tempoPorEtapa"] = {};
  const chavesOrdenadas = [
    ...ORDEM_CHAVES_ETAPA.filter((chave) => chave in minutosPorEtapa),
    ...Object.keys(minutosPorEtapa).filter((chave) => !ORDEM_CHAVES_ETAPA.includes(chave)),
  ];
  for (const chave of chavesOrdenadas) {
    tempoPorEtapa[chave] = estatisticasTempo(minutosPorEtapa[chave]);
  }

  const tempoPorFunil: AnaliseGerencial["tempoPorFunil"] = {
    analiseECotacao: estatisticasTempo(linhas.map((l) => l.minutosFunil1)),
    negociacaoEContrato: estatisticasTempo(linhas.map((l) => l.minutosFunil2).filter((v): v is number => v !== null)),
  };

  // Tempo de execução da fase de cotação (HORA INICIO -> HORA FIM, campos
  // adicionados pela supervisora em 05/08/2026), por Responsáveis pela
  // Cotação (campo dedicado, 17/08/2026 -- não mais o responsável ATUAL do
  // card) — separado em recusado/aprovado porque são naturalmente muito
  // diferentes (recusar é rápido, cotar de verdade com várias seguradoras
  // demora mais). Cards com HORA INICIO/FIM aparentemente trocados (o campo
  // "Tempo Gasto", calculado pelo próprio Bitrix, confirma que a duração
  // real bate com o valor absoluto) entram normalmente na média — só ficam
  // marcados como alerta de qualidade, não são mais excluídos. Cards sem
  // Responsável(is) pela Cotação preenchido não entram aqui (não tem quem
  // creditar) mas já caem no alerta semResponsavelCotacao, mais amplo.
  //
  // Alerta separado: card que já SAIU do funil 1 (foi recusado ou aprovado
  // pra Negociação) sem nunca ter registrado a HORA FIM da cotação -- sinal
  // de etapa pulada, independente de ter HORA INICIO ou responsável.
  const porCotador: Record<string, { recusado: number[]; aprovado: number[] }> = {};
  let cotacaoTempoInconsistente = 0;
  let saiuFunil1SemHoraFim = 0;
  for (const l of linhas) {
    const jaPassouPelaCotacao = l.funil === "Negociação e Contrato" || l.resultado === "Aprovado";
    const saiuFunil1 = jaPassouPelaCotacao || l.resultado === "Recusado";
    if (saiuFunil1 && !l.dataCotacao) saiuFunil1SemHoraFim++;

    if (l.minutosCotacao === null) continue;
    if (l.cotacaoCamposTrocados) cotacaoTempoInconsistente++;
    const resultadoCotacao = l.resultado === "Recusado" ? "recusado" : jaPassouPelaCotacao ? "aprovado" : null;
    if (!resultadoCotacao) continue; // ainda em andamento na cotação — não deveria ter os 2 campos preenchidos ainda
    if (!l.responsaveisCotacao.length) continue;
    for (const nome of l.responsaveisCotacao) {
      porCotador[nome] ??= { recusado: [], aprovado: [] };
      porCotador[nome][resultadoCotacao].push(l.minutosCotacao);
    }
  }
  const tempoCotacaoPorResponsavel: AnaliseGerencial["tempoCotacaoPorResponsavel"] = {};
  for (const [nome, d] of Object.entries(porCotador)) {
    tempoCotacaoPorResponsavel[nome] = { recusado: estatisticasTempo(d.recusado), aprovado: estatisticasTempo(d.aprovado) };
  }

  // Calendário diário de cotações REALIZADAS — dia de ENTRADA do card
  // (não a HORA FIM/finalização: nesse quadro importa que a cotação foi
  // feita, não quando ela terminou -- por isso o total bate com o total de
  // cards, com ou sem HORA FIM preenchida). Responsável vem do campo
  // dedicado Responsáveis pela Cotação (17/08/2026), não mais do
  // responsável ATUAL do card -- a supervisora reportou que o responsável
  // ia mudando de mão em mão e se perdia o registro de quem cotou de
  // verdade. Negociação e Efetivação (painéis ao lado) usam parâmetro
  // diferente de propósito: só existem quando a etapa de fato aconteceu.
  const analisesDiariasPorResponsavel = montarQuadroDiario(
    linhas.map((l) => ({ dia: l.dataCriacao, nomes: l.responsaveisCotacao })),
    competencia
  );

  // Calendário diário de "Contrato Recebido" (etapa do funil 2) — dia direto
  // do histórico nativo de mudança de etapa (não depende de campo novo, tem
  // histórico completo), quebrado por Responsáveis pela Negociação (campo
  // dedicado, 17/08/2026). Conta só a PRIMEIRA entrada de cada card nessa
  // etapa -- um card que volta pra "Contrato com Pendências" pra correção e
  // reentra em "Contrato Recebido" não pode contar 2x.
  const linhaPorId = new Map(linhas.map((l) => [l.id, l]));
  const primeiraEntradaContratoRecebido = new Map<number, string>(); // ownerId -> dia (YYYY-MM-DD)
  const historicoOrdenado = [...historico].sort(
    (a, b) => new Date(a.CREATED_TIME).getTime() - new Date(b.CREATED_TIME).getTime()
  );
  for (const h of historicoOrdenado) {
    if (h.STAGE_ID !== ETAPA_CONTRATO_RECEBIDO) continue;
    if (primeiraEntradaContratoRecebido.has(h.OWNER_ID)) continue;
    primeiraEntradaContratoRecebido.set(h.OWNER_ID, h.CREATED_TIME.slice(0, 10));
  }
  const contratosRecebidosPorDia = montarQuadroDiario(
    [...primeiraEntradaContratoRecebido.entries()].map(([ownerId, dia]) => ({
      dia,
      nomes: linhaPorId.get(ownerId)?.responsaveisNegociacao ?? [],
    })),
    competencia
  );

  // Calendário diário de Efetivação — dia da Data de Efetivação (campo já
  // existente), por Responsável pela Efetivação (novo, único por card).
  const efetivacoesPorDia = montarQuadroDiario(
    linhas.map((l) => ({ dia: l.dataEfetivacao, nomes: l.responsavelEfetivacao ? [l.responsavelEfetivacao] : [] })),
    competencia
  );

  // Cards em andamento parados bem acima da média da própria etapa (não é
  // "tempo corrido" isolado — é relativo ao ritmo normal daquela etapa, e
  // conta só o tempo na passagem ATUAL, não a idade total do card).
  const candidatosAtencao = linhas
    .filter((l) => l.resultado === "Em andamento")
    .map((l) => {
      const stats = tempoPorEtapa[`${l.funil} | ${l.etapaAtual}`];
      const razao = stats && stats.media > 0 ? l.minutosEtapaAtual / stats.media : 0;
      // Mesma prioridade de campo por etapa usada em porResponsavelFunil1/2 --
      // nunca o campo nativo (assignedById).
      const nomes = l.funil === "Negociação e Contrato" ? l.responsaveisNegociacao : nomesFunil1(l);
      const responsavel = nomes.join(", ") || "(sem responsável)";
      return { id: l.id, nome: l.nome, etapa: l.etapaAtual, minutos: l.minutosEtapaAtual, mediaEtapa: stats?.media ?? 0, responsavel, razao };
    })
    .filter((c) => c.razao > 1.3 && c.minutos >= 2880) // pelo menos 2 dias corridos, pra não gerar ruído com card recém-criado
    .sort((a, b) => b.minutos - a.minutos || b.razao - a.razao)
    .slice(0, 8);
  const cardsQuePedemAtencao = candidatosAtencao.map((c) => ({
    id: c.id,
    nome: c.nome,
    etapa: c.etapa,
    minutos: c.minutos,
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
    convertidoPorSeguradora,
    taxaPorSeguradora,
    motivosRecusaFunil1: { total: recusasFunil1.length, semMotivo: recusasFunil1.length },
    motivosPerdaFunil2: { porMotivo: motivosPerdaFunil2, semMotivo: perdasSemMotivo, total: perdasFunil2.length },
    topImobiliarias,
    valoresTrabalhados,
    faixasPacoteLocacao,
    tempoPorEtapa,
    tempoPorFunil,
    cardsQuePedemAtencao,
    tempoCotacaoPorResponsavel,
    analisesDiariasPorResponsavel,
    contratosRecebidosPorDia,
    efetivacoesPorDia,
    qualidade: {
      semImobiliaria,
      perdidosFunil2SemMotivo: perdasSemMotivo,
      totalPerdidosFunil2: perdasFunil2.length,
      cotacaoTempoInconsistente,
      saiuFunil1SemHoraFim,
      semResponsavelCotacao: analisesDiariasPorResponsavel.semResponsavel,
      semResponsavelNegociacao: contratosRecebidosPorDia.semResponsavel,
      semResponsavelEfetivacao: efetivacoesPorDia.semResponsavel,
    },
  };
}
