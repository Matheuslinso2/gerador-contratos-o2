import "server-only";

import {
  listarItensSpa,
  listarHistoricoEtapas,
  buscarDefinicaoCampos,
  type BitrixItemRaw,
  type BitrixStageHistoryEvent,
  type BitrixDefinicaoCampo,
} from "@/lib/bitrix/client";
import { diasUteisEquivalentesEntre } from "@/lib/bitrix/horarioComercial";
import { contarPorDia, type ContagemDia } from "@/lib/contagemPorDia";

// Modelagem do painel Seguro Auto — fonte: SPA "Seguro Automóvel" no
// Bitrix24, entityTypeId 1050, um único funil (categoria 30). A SPA foi
// criada em 18/08/2026 junto com o formulário público /seguro-auto. Prêmio
// e comissão são preenchidos à mão pelo time depois do fechamento.

export const ENTITY_TYPE_ID = 1050;
export const CATEGORIA_PADRAO = 30;

type Semantica = "P" | "S" | "F";
type Etapa = { statusId: string; nome: string; semantica: Semantica };

// Etapas conferidas ao vivo via crm.status.list em 15/10/2026 -- o time
// renomeou as 3 primeiras e criou as 3 de "Ag." depois da versão de
// 18/08/2026. Se aparecer etapa nova no Bitrix, ela entra no funil com o
// próprio ID (ver montarPainelSeguroAuto) até ser cadastrada aqui.
export const ETAPAS: Etapa[] = [
  { statusId: "DT1050_30:NEW", nome: "Iniciando", semantica: "P" },
  { statusId: "DT1050_30:PREPARATION", nome: "Cotação", semantica: "P" },
  { statusId: "DT1050_30:CLIENT", nome: "Transmitida", semantica: "P" },
  { statusId: "DT1050_30:AG_VISTORIA", nome: "Ag. vistoria", semantica: "P" },
  { statusId: "DT1050_30:AG_EMISSAO", nome: "Ag. emissão", semantica: "P" },
  { statusId: "DT1050_30:AG_CADASTRO", nome: "Ag. cadastro", semantica: "P" },
  { statusId: "DT1050_30:SUCCESS", nome: "Finalizado", semantica: "S" },
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

// Competência no fuso de Brasília -- um card fechado em 31/08 às 22h é de
// agosto, não de setembro (o que aconteceria contando em UTC).
const FORMATO_COMPETENCIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
});

function competenciaData(data: Date): string {
  const partes = FORMATO_COMPETENCIA.formatToParts(data);
  const ano = partes.find((p) => p.type === "year")?.value;
  const mes = partes.find((p) => p.type === "month")?.value;
  return `${ano}-${mes}`;
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
  // Quando o card entrou na etapa final (Finalizado/Perda) -- é o mês que
  // conta pra Convertidas/Perdidas/prêmio/comissão. Null enquanto em aberto.
  concluidoEm: Date | null;
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
    convertidos: number; // chegaram em Finalizado nesta competência (qualquer mês de criação)
    perdidos: number; // chegaram em Perda nesta competência (qualquer mês de criação)
    emAndamento: ContagemPorOrigem; // novos + herdados, ainda "P" agora -- ÚNICA coisa que herda de mês anterior (pedido do Matheus: uma vez concluído, não herda mais)
    taxaConversao: number | null;
    cardsComAlerta: number;
    percentualComCnh: number; // "novidades"
    percentualComCrlv: number; // "novidades"
    comApoliceAnterior: number; // "novidades"
    premioEfetivado: number; // das convertidas da competência (mês de fechamento)
    comissaoGerada: number; // das convertidas da competência (mês de fechamento)
    percentualComissaoMedio: number | null; // das convertidas da competência (mês de fechamento)
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
  // Pro relatório diário do WhatsApp: novos = cards criados no dia;
  // concluidos = cards que chegaram em Convertido no dia (movedTime).
  // Opcional porque retratos salvos antes de 01/10/2026 não têm.
  porDia?: ContagemDia[];
  atualizadoEm: string;
};

export function mapearCard(
  item: BitrixItemRaw,
  defs: Record<string, BitrixDefinicaoCampo>,
  agora: Date
): CardSeguroAuto | null {
  const criadoEm = dataValida(item.createdTime);
  if (!criadoEm) return null;
  const etapa = etapaPorStatusId.get(texto(item.stageId));
  const movidoEm = dataValida(item.movedTime);
  const diasParadoEtapaAtual = movidoEm ? diasUteisEquivalentesEntre(movidoEm, agora) : null;
  const semantica = etapa?.semantica ?? "P";
  return {
    id: Number(item.id),
    titulo: texto(item.title),
    etapaId: texto(item.stageId),
    etapaNome: etapa?.nome ?? texto(item.stageId),
    semantica,
    criadoEm,
    movidoEm,
    // movedTime só muda quando o card troca de etapa, então num card
    // concluído ele é exatamente a hora em que chegou em Finalizado/Perda.
    concluidoEm: semantica === "P" ? null : (movidoEm ?? criadoEm),
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
      const duracao = diasUteisEquivalentesEntre(linha[i].inicio, linha[i + 1].inicio);
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
  return competenciaData(new Date());
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

  const emAndamentoTodos = cards.filter((c) => c.semantica === "P");
  const emAndamento = contagemPorOrigem(emAndamentoTodos, competencia);

  // Redefinido com o Matheus em 15/10/2026: Convertidas/Perdidas (e o
  // prêmio/comissão delas) contam no mês em que o card CHEGOU em
  // Finalizado/Perda, não no mês em que foi criado. Antes contava pela
  // criação, e como o mês é congelado no dia 1º, um card criado em agosto
  // e fechado em setembro não entrava em mês nenhum -- ~R$ 2,1 mil de
  // comissão de ago-out/2026 nunca apareceram no painel por causa disso.
  const concluidosNaCompetencia = cards.filter((c) => c.concluidoEm && competenciaData(c.concluidoEm) === competencia);
  const convertidosMes = concluidosNaCompetencia.filter((c) => c.etapaId === "DT1050_30:SUCCESS");
  const perdidosMes = concluidosNaCompetencia.filter((c) => c.semantica === "F");
  const convertidos = convertidosMes.length;
  const perdidos = perdidosMes.length;
  const taxaConversao = convertidos + perdidos > 0 ? convertidos / (convertidos + perdidos) : null;
  const comCnh = novidades.filter((c) => c.temCnh).length;
  const comCrlv = novidades.filter((c) => c.temCrlv).length;
  const comApolice = novidades.filter((c) => c.temApolice).length;

  const premioEfetivado = convertidosMes.reduce((soma, c) => soma + c.premioEfetivado, 0);
  const comissaoGerada = convertidosMes.reduce((soma, c) => soma + c.comissaoGerada, 0);
  const comPercentualComissao = convertidosMes.filter((c) => c.percentualComissao > 0);
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
    // Etapa "P" (em andamento) reflete o estado ATUAL, de qualquer origem --
    // mesmo critério do bloco "Em andamento". Etapas terminais (S/F) nunca
    // saem de lá uma vez concluídas, então contar todo o histórico inflaria
    // o funil pra sempre com meses antigos -- contam só as concluídas nesta
    // competência, mesmo critério de Convertidas/Perdidas.
    if (card.semantica !== "P" && !(card.concluidoEm && competenciaData(card.concluidoEm) === competencia)) continue;
    contagemAtualPorEtapa.set(card.etapaId, (contagemAtualPorEtapa.get(card.etapaId) || 0) + 1);
  }
  // Etapa que existe no Bitrix mas ainda não está em ETAPAS: entra antes das
  // etapas finais com o próprio ID, pra nenhum card sumir do funil.
  const etapasConhecidas = new Set(ETAPAS.map((e) => e.statusId));
  const etapasDesconhecidas: Etapa[] = [...contagemAtualPorEtapa.keys()]
    .filter((id) => !etapasConhecidas.has(id))
    .map((id) => ({ statusId: id, nome: id, semantica: "P" }));
  const primeiraConcluida = ETAPAS.findIndex((e) => e.semantica !== "P");
  const etapasFunil = [...ETAPAS.slice(0, primeiraConcluida), ...etapasDesconhecidas, ...ETAPAS.slice(primeiraConcluida)];
  const funil: FunilEtapa[] = etapasFunil.map((etapa) => ({
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

  const convertidasFinanceiro = [...convertidosMes]
    .sort((a, b) => b.premioEfetivado - a.premioEfetivado)
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      premioEfetivado: c.premioEfetivado,
      comissaoGerada: c.comissaoGerada,
      percentualComissao: c.percentualComissao,
      numeroParcelas: c.numeroParcelas,
    }));

  // Mesma lógica da herança dos KPIs (e da lista "Títulos solicitados" em
  // capitalizacao/painel.ts): entram na lista as fichas da competência
  // (novidades, qualquer status) mais as que ainda estão em andamento de
  // meses anteriores (herdadas) -- uma ficha concluída em outro mês não
  // aparece aqui, ela já foi contada no mês em que nasceu.
  const idsNovidades = new Set(novidades.map((c) => c.id));
  const herdadosEmAndamento = emAndamentoTodos.filter((c) => !idsNovidades.has(c.id));
  const fichasRelevantes = [...novidades, ...herdadosEmAndamento];

  const fichas = fichasRelevantes
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
    porDia: contarPorDia(
      competencia,
      cards.map((c) => c.criadoEm),
      cards.filter((c) => c.etapaId === "DT1050_30:SUCCESS" && c.movidoEm).map((c) => ({ quando: c.movidoEm!, comissao: c.comissaoGerada })),
      cards.filter((c) => c.semantica === "F" && c.movidoEm).map((c) => c.movidoEm!)
    ),
    atualizadoEm: agora.toISOString(),
  };
}
