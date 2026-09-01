import "server-only";

import {
  listarItensSpa,
  listarHistoricoEtapas,
  buscarDefinicaoCampos,
  type BitrixItemRaw,
  type BitrixStageHistoryEvent,
  type BitrixDefinicaoCampo,
} from "@/lib/bitrix/client";

// Modelagem do painel Seguro Auto — fonte: SPA "Seguro Automóvel" no
// Bitrix24, entityTypeId 1050, um único funil (categoria 30). Etapas
// verificadas ao vivo via crm.status.list em 18/08/2026 (mesmo dia em que o
// Matheus criou a SPA e o formulário público /seguro-auto passou a
// alimentá-la). Diferente de Fiança/Capitalização, essa SPA não tem campo
// de valor/prêmio -- o painel foca em volume, funil e qualidade de
// preenchimento (documentos anexados), não em receita.

export const ENTITY_TYPE_ID = 1050;
export const CATEGORIA_PADRAO = 30;

type Semantica = "P" | "S" | "F";
type Etapa = { statusId: string; nome: string; semantica: Semantica };

export const ETAPAS: Etapa[] = [
  { statusId: "DT1050_30:NEW", nome: "Cotação", semantica: "P" },
  { statusId: "DT1050_30:PREPARATION", nome: "Negociação", semantica: "P" },
  { statusId: "DT1050_30:CLIENT", nome: "Fechamento", semantica: "P" },
  { statusId: "DT1050_30:SUCCESS", nome: "Sucesso", semantica: "S" },
  { statusId: "DT1050_30:FAIL", nome: "Perda", semantica: "F" },
];
const etapaPorStatusId = new Map(ETAPAS.map((e) => [e.statusId, e]));

const CAMPOS = {
  nome: "ufCrm16_1787056933080",
  email: "ufCrm16_1787056957386",
  telefone: "ufCrm16_1787056962877",
  garagem: "ufCrm16_1787056986772",
  portao: "ufCrm16_1787057051225",
  utilizacao: "ufCrm16_1787057098438",
  usoDiario: "ufCrm16_1787057118482",
  crlv: "ufCrm16_1787057133486",
  estadoCivil: "ufCrm16_1787057276856",
  endereco: "ufCrm16_1787057323033",
  cnh: "ufCrm16_1787057362552",
  apolice: "ufCrm16_1787058926395",
  // Adicionados em 18/08/2026, preenchidos manualmente pelo time SÓ depois
  // do fechamento (card em "Sucesso") -- não vêm do formulário público.
  percentualComissao: "ufCrm16_1787060483253",
  numeroParcelas: "ufCrm16_1787060548431",
  premioEfetivado: "ufCrm16_1787061422",
  comissaoGerada: "ufCrm16_1787061468",
} as const;

const LIMITE_ALERTA_DIAS = 3;

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

function numeroOuZero(valor: unknown): number {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : 0;
}

function dataValida(valor: unknown): Date | null {
  const bruto = texto(valor);
  if (!bruto) return null;
  const data = new Date(bruto);
  return Number.isNaN(data.getTime()) ? null : data;
}

function competenciaData(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

function enumLabel(defs: Record<string, BitrixDefinicaoCampo>, campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const item = defs[campo]?.items?.find((i) => i.ID === String(valor));
  return item ? item.VALUE : String(valor);
}

export type CardSeguroAuto = {
  id: number;
  titulo: string;
  etapaId: string;
  etapaNome: string;
  semantica: Semantica;
  criadoEm: Date;
  movidoEm: Date | null;
  diasParadoEtapaAtual: number | null;
  nome: string;
  email: string;
  telefone: string;
  temGaragem: boolean;
  portao: string;
  utilizacao: string;
  usoDiario: string;
  temCnh: boolean;
  temCrlv: boolean;
  temApolice: boolean;
  percentualComissao: number;
  numeroParcelas: number;
  premioEfetivado: number;
  comissaoGerada: number;
};

// mesAtual = origem (criadoEm) nesta competência; herdado = origem em
// competência anterior; total = soma dos dois.
export type ContagemPorOrigem = { mesAtual: number; herdado: number; total: number };

export type FunilEtapa = {
  statusId: string;
  nome: string;
  semantica: Semantica;
  quantidadeAtual: number;
  tempoMedioDiasFechado: number | null;
};

export type PainelSeguroAuto = {
  competencia: string;
  kpis: {
    total: number; // "novidades" -- só cards criados nesta competência
    convertidos: number; // "novidades" -- só cards criados nesta competência
    perdidos: number; // "novidades" -- só cards criados nesta competência
    emAndamento: ContagemPorOrigem; // novos + herdados, ainda "P" agora -- ÚNICA coisa que herda de mês anterior (pedido do Matheus: uma vez concluído, não herda mais)
    taxaConversao: number | null;
    cardsComAlerta: number;
    percentualComCnh: number; // "novidades"
    percentualComCrlv: number; // "novidades"
    comApoliceAnterior: number; // "novidades"
    premioEfetivado: number; // "novidades"
    comissaoGerada: number; // "novidades"
    percentualComissaoMedio: number | null; // "novidades"
  };
  funil: FunilEtapa[];
  distribuicaoUtilizacao: { rotulo: string; quantidade: number }[];
  distribuicaoGaragem: { comGaragem: number; semGaragem: number };
  cardsAlerta: { id: number; titulo: string; etapaNome: string; diasParado: number }[];
  convertidasFinanceiro: {
    id: number;
    nome: string;
    premioEfetivado: number;
    comissaoGerada: number;
    percentualComissao: number;
    numeroParcelas: number;
  }[];
  fichas: {
    id: number;
    nome: string;
    telefone: string;
    email: string;
    etapaNome: string;
    temCnh: boolean;
    temCrlv: boolean;
    criadoEm: Date;
  }[];
  atualizadoEm: string;
};

function mapearCard(
  item: BitrixItemRaw,
  defs: Record<string, BitrixDefinicaoCampo>,
  agora: Date
): CardSeguroAuto | null {
  const criadoEm = dataValida(item.createdTime);
  if (!criadoEm) return null;
  const etapa = etapaPorStatusId.get(texto(item.stageId));
  const movidoEm = dataValida(item.movedTime);
  const diasParadoEtapaAtual = movidoEm ? (agora.getTime() - movidoEm.getTime()) / 86_400_000 : null;
  return {
    id: Number(item.id),
    titulo: texto(item.title),
    etapaId: texto(item.stageId),
    etapaNome: etapa?.nome ?? texto(item.stageId),
    semantica: etapa?.semantica ?? "P",
    criadoEm,
    movidoEm,
    diasParadoEtapaAtual,
    nome: texto(item[CAMPOS.nome]) || texto(item.title),
    email: texto(item[CAMPOS.email]),
    telefone: texto(item[CAMPOS.telefone]),
    temGaragem: item[CAMPOS.garagem] === "Y",
    portao: enumLabel(defs, CAMPOS.portao, item[CAMPOS.portao]),
    utilizacao: enumLabel(defs, CAMPOS.utilizacao, item[CAMPOS.utilizacao]),
    usoDiario: enumLabel(defs, CAMPOS.usoDiario, item[CAMPOS.usoDiario]),
    temCnh: !!item[CAMPOS.cnh],
    temCrlv: !!item[CAMPOS.crlv],
    temApolice: !!item[CAMPOS.apolice],
    percentualComissao: numeroOuZero(item[CAMPOS.percentualComissao]),
    numeroParcelas: numeroOuZero(item[CAMPOS.numeroParcelas]),
    premioEfetivado: numeroOuZero(item[CAMPOS.premioEfetivado]),
    comissaoGerada: numeroOuZero(item[CAMPOS.comissaoGerada]),
  };
}

// Mesmo espírito de tempoMedioPorEtapa em capitalizacao/painel.ts -- tempo
// médio (dias) que cards que JÁ passaram por cada etapa ficaram nela, só
// trechos fechados (entrou/saiu).
function tempoMedioPorEtapa(itens: BitrixItemRaw[], historico: BitrixStageHistoryEvent[]): Map<string, number> {
  const historicoPorItem = new Map<number, BitrixStageHistoryEvent[]>();
  for (const evento of historico) {
    const lista = historicoPorItem.get(Number(evento.OWNER_ID)) || [];
    lista.push(evento);
    historicoPorItem.set(Number(evento.OWNER_ID), lista);
  }
  for (const lista of historicoPorItem.values()) {
    lista.sort((a, b) => new Date(a.CREATED_TIME).getTime() - new Date(b.CREATED_TIME).getTime());
  }

  const somaPorEtapa = new Map<string, number>();
  const contagemPorEtapa = new Map<string, number>();

  for (const item of itens) {
    const eventos = historicoPorItem.get(Number(item.id)) || [];
    const criadoEm = dataValida(item.createdTime);
    if (!criadoEm) continue;
    const linha: { stageId: string; inicio: Date }[] = [{ stageId: "DT1050_30:NEW", inicio: criadoEm }];
    for (const evento of eventos) {
      const quando = dataValida(evento.CREATED_TIME);
      if (quando) linha.push({ stageId: texto(evento.STAGE_ID), inicio: quando });
    }
    for (let i = 0; i < linha.length - 1; i++) {
      const duracao = (linha[i + 1].inicio.getTime() - linha[i].inicio.getTime()) / 86_400_000;
      if (duracao < 0) continue;
      somaPorEtapa.set(linha[i].stageId, (somaPorEtapa.get(linha[i].stageId) || 0) + duracao);
      contagemPorEtapa.set(linha[i].stageId, (contagemPorEtapa.get(linha[i].stageId) || 0) + 1);
    }
  }

  const medias = new Map<string, number>();
  for (const [stageId, soma] of somaPorEtapa) {
    const contagem = contagemPorEtapa.get(stageId) || 0;
    if (contagem > 0) medias.set(stageId, soma / contagem);
  }
  return medias;
}

export function competenciaAtual(): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const ano = partes.find((p) => p.type === "year")?.value;
  const mes = partes.find((p) => p.type === "month")?.value;
  return `${ano}-${mes}`;
}

export function competenciaValida(valor: string | undefined): valor is string {
  return !!valor && /^\d{4}-(0[1-9]|1[0-2])$/.test(valor);
}

function contagemPorOrigem(itens: CardSeguroAuto[], competencia: string): ContagemPorOrigem {
  let mesAtual = 0;
  let herdado = 0;
  for (const c of itens) {
    if (competenciaData(c.criadoEm) === competencia) mesAtual++;
    else herdado++;
  }
  return { mesAtual, herdado, total: mesAtual + herdado };
}

export async function montarPainelSeguroAuto(competencia: string, agora = new Date()): Promise<PainelSeguroAuto> {
  const [itens, historico, defs] = await Promise.all([
    listarItensSpa(ENTITY_TYPE_ID),
    listarHistoricoEtapas(ENTITY_TYPE_ID),
    buscarDefinicaoCampos(ENTITY_TYPE_ID),
  ]);

  const cards = itens.map((item) => mapearCard(item, defs, agora)).filter((c): c is CardSeguroAuto => c !== null);
  const novidades = cards.filter((c) => competenciaData(c.criadoEm) === competencia);

  // Redefinido com o Matheus em 01/09/2026 (mesma mudança em
  // capitalizacao/painel.ts): a ÚNICA coisa que herda de mês anterior é
  // "Em Andamento". Uma vez que o card CONCLUI (Sucesso/Perda), ele deixa
  // de ser herdado -- Convertidos/Perdidos voltam a ser só sobre quem foi
  // CRIADO neste mês, não sobre quando o Bitrix registrou a etapa final.
  const emAndamentoTodos = cards.filter((c) => c.semantica === "P");
  const emAndamento = contagemPorOrigem(emAndamentoTodos, competencia);

  const convertidosNovidades = novidades.filter((c) => c.etapaId === "DT1050_30:SUCCESS");
  const perdidosNovidades = novidades.filter((c) => c.semantica === "F");
  const convertidos = convertidosNovidades.length;
  const perdidos = perdidosNovidades.length;
  const taxaConversao = convertidos + perdidos > 0 ? convertidos / (convertidos + perdidos) : null;
  const comCnh = novidades.filter((c) => c.temCnh).length;
  const comCrlv = novidades.filter((c) => c.temCrlv).length;
  const comApolice = novidades.filter((c) => c.temApolice).length;

  // Prêmio/comissão só existem depois do fechamento -- soma sobre quem
  // converteu e foi criado ESTE mês.
  const premioEfetivado = convertidosNovidades.reduce((soma, c) => soma + c.premioEfetivado, 0);
  const comissaoGerada = convertidosNovidades.reduce((soma, c) => soma + c.comissaoGerada, 0);
  const comPercentualComissao = convertidosNovidades.filter((c) => c.percentualComissao > 0);
  const percentualComissaoMedio =
    comPercentualComissao.length > 0
      ? comPercentualComissao.reduce((soma, c) => soma + c.percentualComissao, 0) / comPercentualComissao.length
      : null;

  const cardsAlertaLista = cards
    .filter((c) => c.semantica === "P" && c.diasParadoEtapaAtual !== null && c.diasParadoEtapaAtual >= LIMITE_ALERTA_DIAS)
    .map((c) => ({ id: c.id, titulo: c.titulo, etapaNome: c.etapaNome, diasParado: Math.floor(c.diasParadoEtapaAtual!) }))
    .sort((a, b) => b.diasParado - a.diasParado);

  const mediasPorEtapa = tempoMedioPorEtapa(itens, historico);
  const contagemAtualPorEtapa = new Map<string, number>();
  for (const card of cards) {
    contagemAtualPorEtapa.set(card.etapaId, (contagemAtualPorEtapa.get(card.etapaId) || 0) + 1);
  }
  const funil: FunilEtapa[] = ETAPAS.map((etapa) => ({
    statusId: etapa.statusId,
    nome: etapa.nome,
    semantica: etapa.semantica,
    quantidadeAtual: contagemAtualPorEtapa.get(etapa.statusId) || 0,
    tempoMedioDiasFechado: mediasPorEtapa.get(etapa.statusId) ?? null,
  }));

  const contagemUtilizacao = new Map<string, number>();
  for (const c of novidades) {
    const rotulo = c.utilizacao || "Não informado";
    contagemUtilizacao.set(rotulo, (contagemUtilizacao.get(rotulo) ?? 0) + 1);
  }
  const distribuicaoUtilizacao = [...contagemUtilizacao.entries()]
    .map(([rotulo, quantidade]) => ({ rotulo, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade);

  const distribuicaoGaragem = {
    comGaragem: novidades.filter((c) => c.temGaragem).length,
    semGaragem: novidades.filter((c) => !c.temGaragem).length,
  };

  const convertidasFinanceiro = [...convertidosNovidades]
    .sort((a, b) => b.premioEfetivado - a.premioEfetivado)
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      premioEfetivado: c.premioEfetivado,
      comissaoGerada: c.comissaoGerada,
      percentualComissao: c.percentualComissao,
      numeroParcelas: c.numeroParcelas,
    }));

  const fichas = [...novidades]
    .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      telefone: c.telefone,
      email: c.email,
      etapaNome: c.etapaNome,
      temCnh: c.temCnh,
      temCrlv: c.temCrlv,
      criadoEm: c.criadoEm,
    }));

  return {
    competencia,
    kpis: {
      total: novidades.length,
      convertidos,
      perdidos,
      emAndamento,
      taxaConversao,
      cardsComAlerta: cardsAlertaLista.length,
      percentualComCnh: novidades.length > 0 ? comCnh / novidades.length : 0,
      percentualComCrlv: novidades.length > 0 ? comCrlv / novidades.length : 0,
      comApoliceAnterior: comApolice,
      premioEfetivado,
      comissaoGerada,
      percentualComissaoMedio,
    },
    funil,
    distribuicaoUtilizacao,
    distribuicaoGaragem,
    cardsAlerta: cardsAlertaLista,
    convertidasFinanceiro,
    fichas,
    atualizadoEm: agora.toISOString(),
  };
}
