import "server-only";

import {
  listarItensSpa,
  listarHistoricoEtapas,
  type BitrixItemRaw,
  type BitrixStageHistoryEvent,
} from "@/lib/bitrix/client";
import { diasUteisEquivalentesEntre } from "@/lib/bitrix/horarioComercial";
import { contarPorDia, type ContagemDia } from "@/lib/contagemPorDia";

// Modelagem do painel Capitalização — fonte: SPA "Título de Capitalização" no
// Bitrix24, entityTypeId 1048, um único funil (categoria 28). Etapas
// verificadas ao vivo via crm.status.list em 2026-08-13 (ver memória
// painel_capitalizacao_plano). "Pagamento concluído (cartão)" e "Boleto
// pago" são dois caminhos alternativos pro mesmo passo do processo — um
// card passa só por um dos dois, nunca pelos dois.

export const ENTITY_TYPE_ID = 1048;
export const CATEGORIA_TITULO = 28;

type Semantica = "P" | "S" | "F";
type Etapa = { statusId: string; nome: string; semantica: Semantica };

export const ETAPAS: Etapa[] = [
  { statusId: "DT1048_28:NEW", nome: "Nova solicitação", semantica: "P" },
  { statusId: "DT1048_28:PREPARATION", nome: "Proposta", semantica: "P" },
  { statusId: "DT1048_28:CLIENT", nome: "Pagamento concluído (cartão)", semantica: "P" },
  { statusId: "DT1048_28:BOLETO_PAGO", nome: "Boleto pago", semantica: "P" },
  { statusId: "DT1048_28:SUCCESS", nome: "Emitido", semantica: "S" },
  { statusId: "DT1048_28:FAIL", nome: "Pagamento não realizado", semantica: "F" },
  { statusId: "DT1048_28:DESISTENCIA", nome: "Desistência", semantica: "F" },
];
const etapaPorStatusId = new Map(ETAPAS.map((e) => [e.statusId, e]));

const CAMPOS = {
  valorTitulo: "ufCrm14CapValorTit",
  comissao: "ufCrm14CapComissao",
  locatPfNome: "ufCrm14CapLocatPfNome",
  locatPjRazao: "ufCrm14CapLocatPjRazao",
  imobiliaria: "ufCrm14CapImobAdmin",
  corretor: "ufCrm14CapCorretor",
} as const;

const LIMITE_ALERTA_DIAS = 3;

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

function dinheiro(valor: unknown): number {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  const bruto = texto(valor).split("|")[0].replace(/\s/g, "");
  if (!bruto) return 0;
  const normalizado = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
  const convertido = Number(normalizado);
  return Number.isFinite(convertido) ? convertido : 0;
}

function dataValida(valor: unknown): Date | null {
  const bruto = texto(valor);
  if (!bruto) return null;
  const data = new Date(bruto);
  return Number.isNaN(data.getTime()) ? null : data;
}

// Competência no fuso de Brasília -- um título pago em 31/08 às 22h é de
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

// Etapas de pagamento (cartão ou boleto) -- a data em que o card entrou numa
// delas é a que decide o mês de um título Emitido.
const ETAPAS_PAGAMENTO = new Set(["DT1048_28:CLIENT", "DT1048_28:BOLETO_PAGO"]);

// Decisão do Matheus (18/10/2026): o título conta como efetivado (valor e
// comissão) assim que o pagamento entra -- card em Pagamento concluído
// (cartão), Boleto pago ou já Emitido -- sem esperar o Controle confirmar no
// Corp e mover pra Emitido. Antes só contava em Emitido e outubro aparecia
// zerado com 11 boletos pagos.
function efetivado(c: { etapaId: string }): boolean {
  return c.etapaId === "DT1048_28:SUCCESS" || ETAPAS_PAGAMENTO.has(c.etapaId);
}

export type CardCapitalizacao = {
  id: number;
  titulo: string;
  etapaId: string;
  etapaNome: string;
  semantica: Semantica;
  criadoEm: Date;
  movidoEm: Date | null;
  // Data que decide o mês de Emitidos/Perdidos: Emitido = quando o
  // pagamento entrou (Pagamento concluído/Boleto pago); Perdido = quando
  // chegou em Pagamento não realizado/Desistência. Null enquanto em aberto.
  concluidoEm: Date | null;
  valorTitulo: number;
  comissao: number;
  diasParadoEtapaAtual: number | null;
  titular: string;
  imobiliaria: string;
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

// Os 10 indicadores do quadro "Novidades do mês", reaproveitados pro
// comparativo com o mês anterior. Emitidos/perdidos/taxa/valor emitido/
// comissão efetivada contam pelo mês do pagamento (ver concluidoEm); os
// demais pelo mês de criação do card.
export type KpisNovidades = {
  total: number;
  emitidos: number;
  perdidos: number;
  taxaConversao: number | null;
  valorTotalEmitido: number;
  comissaoEfetivada: number;
  comissaoPotencial: number;
  premioPotencial: number;
  numeroImobiliarias: number;
  ticketMedioPremio: number;
};

// Quadros "Geral do mês" e "Herança" (pedido do Matheus, 22/10/2026): os
// mesmos indicadores por origem do card. Novos = criados no mês; herança =
// criados antes e ainda em aberto no começo do mês (concluídos neste mês ou
// depois, ou abertos até hoje). Geral = novos + herança. Emitidos/perdidos
// pelo mês do pagamento/perda (então emitidos geral = emitidos do mês);
// potencial = soma de todos os cards do grupo; em andamento = do grupo, sem
// conclusão até o fim do mês.
export type KpisGrupo = {
  total: number;
  emitidos: number;
  perdidos: number;
  emAndamento: number;
  taxaConversao: number | null;
  valorTotalEmitido: number;
  comissaoEfetivada: number;
  comissaoPotencial: number;
  premioPotencial: number;
  numeroImobiliarias: number;
  ticketMedioPremio: number;
};
export type KpisPorOrigem = { novos: KpisGrupo; heranca: KpisGrupo; geral: KpisGrupo };

export type PainelCapitalizacao = {
  competencia: string;
  // Mês anterior completo, calculado dos mesmos cards (sem chamada extra ao
  // Bitrix). Opcional: retratos salvos antes de 05/10/2026 não têm.
  kpisAnterior?: KpisNovidades & { competencia: string };
  // Opcional: retratos salvos antes de 22/10/2026 não têm.
  porOrigem?: KpisPorOrigem;
  porOrigemAnterior?: KpisPorOrigem;
  kpis: {
    total: number; // "novidades" -- só cards criados nesta competência
    emitidos: number; // pagos nesta competência e já Emitidos (qualquer mês de criação)
    perdidos: number; // chegaram em Pag. não realizado/Desistência nesta competência
    emAndamento: ContagemPorOrigem; // novos + herdados, ainda "P" agora -- ÚNICA coisa que herda de mês anterior (pedido do Matheus: uma vez concluído, não herda mais)
    taxaConversao: number | null;
    valorTotalEmitido: number; // dos emitidos da competência (mês do pagamento)
    comissaoEfetivada: number; // dos emitidos da competência (mês do pagamento)
    comissaoPotencial: number; // "novidades"
    cardsComAlerta: number;
    premioPotencial: number; // "novidades"
    numeroImobiliarias: number; // "novidades"
    ticketMedioPremio: number; // "novidades"
  };
  funil: FunilEtapa[];
  cardsAlerta: { id: number; titulo: string; etapaNome: string; diasParado: number }[];
  titulos: {
    id: number;
    titular: string;
    imobiliaria: string;
    etapaNome: string;
    valorTitulo: number;
    comissao: number;
  }[];
  // Pro relatório diário do WhatsApp: novos = cards criados no dia;
  // concluidos = cards que chegaram em Emitido no dia (movedTime). Opcional
  // porque retratos salvos antes de 01/10/2026 não têm.
  porDia?: ContagemDia[];
  atualizadoEm: string;
};

// Última entrada de cada card numa etapa de pagamento (um card que volta de
// "Pagamento não realizado" e paga depois fica com o pagamento novo).
export function pagamentoPorCard(historico: BitrixStageHistoryEvent[]): Map<number, Date> {
  const pagoEm = new Map<number, Date>();
  for (const evento of historico) {
    if (!ETAPAS_PAGAMENTO.has(texto(evento.STAGE_ID))) continue;
    const quando = dataValida(evento.CREATED_TIME);
    const id = Number(evento.OWNER_ID);
    const anterior = pagoEm.get(id);
    if (quando && (!anterior || quando > anterior)) pagoEm.set(id, quando);
  }
  return pagoEm;
}

export function mapearCard(item: BitrixItemRaw, agora: Date, pagoEm: Map<number, Date>): CardCapitalizacao | null {
  const criadoEm = dataValida(item.createdTime);
  if (!criadoEm) return null;
  const etapa = etapaPorStatusId.get(texto(item.stageId));
  const semantica = etapa?.semantica ?? "P";
  const movidoEm = dataValida(item.movedTime);
  const diasParadoEtapaAtual = movidoEm ? diasUteisEquivalentesEntre(movidoEm, agora) : null;
  // movedTime só muda quando o card troca de etapa, então num card concluído
  // é a hora em que chegou na etapa final -- vale pra Perdidos e pra um
  // Emitido que pulou a etapa de pagamento.
  const finalizadoEm = movidoEm ?? criadoEm;
  const concluidoEm = ETAPAS_PAGAMENTO.has(texto(item.stageId))
    ? (pagoEm.get(Number(item.id)) ?? finalizadoEm)
    : semantica === "P"
      ? null
      : semantica === "S"
        ? (pagoEm.get(Number(item.id)) ?? finalizadoEm)
        : finalizadoEm;
  return {
    id: Number(item.id),
    titulo: texto(item.title),
    etapaId: texto(item.stageId),
    etapaNome: etapa?.nome ?? texto(item.stageId),
    semantica,
    criadoEm,
    movidoEm,
    concluidoEm,
    valorTitulo: dinheiro(item[CAMPOS.valorTitulo]),
    comissao: dinheiro(item[CAMPOS.comissao]),
    diasParadoEtapaAtual,
    titular: texto(item[CAMPOS.locatPfNome]) || texto(item[CAMPOS.locatPjRazao]) || texto(item.title) || "—",
    imobiliaria: texto(item[CAMPOS.imobiliaria]) || texto(item[CAMPOS.corretor]) || "—",
  };
}

// Tempo médio (dias) que os cards que JÁ passaram por cada etapa ficaram
// nela — só conta trechos fechados (entrou/saiu), não o tempo de quem está
// parado numa etapa agora mesmo (isso é o alerta, é outra conta).
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
    const linha: { stageId: string; inicio: Date }[] = [{ stageId: "DT1048_28:NEW", inicio: criadoEm }];
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

export function competenciaAnterior(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 2, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

function concluidosNaCompetencia(cards: CardCapitalizacao[], competencia: string): CardCapitalizacao[] {
  return cards.filter((c) => c.concluidoEm && competenciaData(c.concluidoEm) === competencia);
}

function kpisDoMes(cards: CardCapitalizacao[], competencia: string): KpisNovidades {
  const novidades = cards.filter((c) => competenciaData(c.criadoEm) === competencia);
  const concluidos = concluidosNaCompetencia(cards, competencia);
  const emitidosLista = concluidos.filter(efetivado);
  const emitidos = emitidosLista.length;
  const perdidos = concluidos.filter((c) => c.semantica === "F").length;
  const premioPotencial = novidades.reduce((soma, c) => soma + c.valorTitulo, 0);
  return {
    total: novidades.length,
    emitidos,
    perdidos,
    taxaConversao: emitidos + perdidos > 0 ? emitidos / (emitidos + perdidos) : null,
    valorTotalEmitido: emitidosLista.reduce((soma, c) => soma + c.valorTitulo, 0),
    comissaoEfetivada: emitidosLista.reduce((soma, c) => soma + c.comissao, 0),
    comissaoPotencial: novidades.reduce((soma, c) => soma + c.comissao, 0),
    premioPotencial,
    numeroImobiliarias: new Set(novidades.filter((c) => c.imobiliaria !== "—").map((c) => c.imobiliaria)).size,
    ticketMedioPremio: novidades.length > 0 ? premioPotencial / novidades.length : 0,
  };
}

function kpisDoGrupo(grupo: CardCapitalizacao[], competencia: string): KpisGrupo {
  const noMes = (c: CardCapitalizacao) => !!c.concluidoEm && competenciaData(c.concluidoEm) === competencia;
  const emitidosLista = grupo.filter((c) => noMes(c) && efetivado(c));
  const perdidos = grupo.filter((c) => noMes(c) && c.semantica === "F").length;
  const emitidos = emitidosLista.length;
  const premioPotencial = grupo.reduce((soma, c) => soma + c.valorTitulo, 0);
  return {
    total: grupo.length,
    emitidos,
    perdidos,
    emAndamento: grupo.filter((c) => !c.concluidoEm || competenciaData(c.concluidoEm) > competencia).length,
    taxaConversao: emitidos + perdidos > 0 ? emitidos / (emitidos + perdidos) : null,
    valorTotalEmitido: emitidosLista.reduce((soma, c) => soma + c.valorTitulo, 0),
    comissaoEfetivada: emitidosLista.reduce((soma, c) => soma + c.comissao, 0),
    comissaoPotencial: grupo.reduce((soma, c) => soma + c.comissao, 0),
    premioPotencial,
    numeroImobiliarias: new Set(grupo.filter((c) => c.imobiliaria !== "—").map((c) => c.imobiliaria)).size,
    ticketMedioPremio: grupo.length > 0 ? premioPotencial / grupo.length : 0,
  };
}

function kpisPorOrigem(cards: CardCapitalizacao[], competencia: string): KpisPorOrigem {
  const novos = cards.filter((c) => competenciaData(c.criadoEm) === competencia);
  const heranca = cards.filter(
    (c) => competenciaData(c.criadoEm) < competencia && (!c.concluidoEm || competenciaData(c.concluidoEm) >= competencia)
  );
  return { novos: kpisDoGrupo(novos, competencia), heranca: kpisDoGrupo(heranca, competencia), geral: kpisDoGrupo([...novos, ...heranca], competencia) };
}

function contagemPorOrigem(itens: CardCapitalizacao[], competencia: string): ContagemPorOrigem {
  let mesAtual = 0;
  let herdado = 0;
  for (const c of itens) {
    if (competenciaData(c.criadoEm) === competencia) mesAtual++;
    else herdado++;
  }
  return { mesAtual, herdado, total: mesAtual + herdado };
}

// retratoCongelado: retrato já salvo de uma competência que JÁ FECHOU. Com
// ele, só os números de fechamento (emitidos, perdidos, valores, etapas
// finais do funil, títulos concluídos) são recalculados; "em andamento",
// alertas e etapas abertas do funil ficam como foram congelados (o estado
// de hoje não diz nada sobre o fim daquele mês). Serve pra completar o mês
// anterior com títulos pagos nele que só chegaram em Emitido depois.
export async function montarPainelCapitalizacao(
  competencia: string,
  agora = new Date(),
  retratoCongelado?: PainelCapitalizacao
): Promise<PainelCapitalizacao> {
  const [itens, historico] = await Promise.all([
    listarItensSpa(ENTITY_TYPE_ID),
    listarHistoricoEtapas(ENTITY_TYPE_ID),
  ]);

  const pagoEm = pagamentoPorCard(historico);
  const cards = itens.map((item) => mapearCard(item, agora, pagoEm)).filter((c): c is CardCapitalizacao => c !== null);
  const novidades = cards.filter((c) => competenciaData(c.criadoEm) === competencia);

  // Redefinido com o Matheus em 15/10/2026: Emitidos (e o valor/comissão
  // deles) contam no mês em que o PAGAMENTO entrou (Pagamento concluído/
  // Boleto pago); Perdidos, no mês em que o card chegou em Pagamento não
  // realizado/Desistência -- não mais no mês de criação. Pela criação, como
  // o mês congela no dia 1º, um título criado em agosto e pago em setembro
  // não entrava em mês nenhum (R$ 4.968,65 de comissão de ago-set/2026
  // sumiram assim). Não usa a data de Emitido porque o Controle só move o
  // card depois de confirmar no Corp, às vezes dias depois do pagamento
  // (motivo da decisão de 01/09/2026, que continua valendo).
  //
  // "Em Andamento" continua sendo a única coisa que herda de mês anterior.
  // Só entram cards criados até o fim da competência -- sem isso, um mês
  // passado recalculado depois contava como herdados cards criados depois.
  // Card já pago (cartão/boleto) conta como efetivado, não como em andamento.
  const emAndamentoTodos = cards.filter((c) => c.semantica === "P" && !efetivado(c) && competenciaData(c.criadoEm) <= competencia);
  const emAndamento = retratoCongelado?.kpis.emAndamento ?? contagemPorOrigem(emAndamentoTodos, competencia);

  const {
    emitidos,
    perdidos,
    taxaConversao,
    valorTotalEmitido,
    comissaoEfetivada,
    comissaoPotencial,
    premioPotencial,
    numeroImobiliarias,
    ticketMedioPremio,
  } = kpisDoMes(cards, competencia);
  const concluidos = concluidosNaCompetencia(cards, competencia);
  const competenciaAnt = competenciaAnterior(competencia);
  const kpisAnterior = { competencia: competenciaAnt, ...kpisDoMes(cards, competenciaAnt) };

  // Alerta de card parado é operacional (agora), não fica preso à
  // competência selecionada — um card antigo esquecido continua alertando.
  const cardsAlertaLista =
    retratoCongelado?.cardsAlerta ??
    cards
      .filter((c) => c.semantica === "P" && c.diasParadoEtapaAtual !== null && c.diasParadoEtapaAtual >= LIMITE_ALERTA_DIAS)
      .map((c) => ({ id: c.id, titulo: c.titulo, etapaNome: c.etapaNome, diasParado: Math.floor(c.diasParadoEtapaAtual!) }))
      .sort((a, b) => b.diasParado - a.diasParado);

  const mediasPorEtapa = tempoMedioPorEtapa(itens, historico);
  const contagemAtualPorEtapa = new Map<string, number>();
  for (const card of cards) {
    // Etapa "P" (em andamento) reflete o estado ATUAL, de qualquer origem --
    // mesmo critério do bloco "Em andamento" acima. Etapas terminais (S/F)
    // nunca saem de lá uma vez concluídas, então contar todo o histórico
    // inflaria o funil pra sempre com meses antigos -- contam só as
    // concluídos nesta competência, mesmo critério de Emitidos/Perdidos.
    if (card.semantica !== "P" && !(card.concluidoEm && competenciaData(card.concluidoEm) === competencia)) continue;
    contagemAtualPorEtapa.set(card.etapaId, (contagemAtualPorEtapa.get(card.etapaId) || 0) + 1);
  }

  const congeladoPorEtapa = new Map((retratoCongelado?.funil ?? []).map((e) => [e.statusId, e.quantidadeAtual]));
  const funil: FunilEtapa[] = ETAPAS.map((etapa) => ({
    statusId: etapa.statusId,
    nome: etapa.nome,
    semantica: etapa.semantica,
    quantidadeAtual:
      retratoCongelado && etapa.semantica === "P"
        ? (congeladoPorEtapa.get(etapa.statusId) ?? 0)
        : contagemAtualPorEtapa.get(etapa.statusId) || 0,
    tempoMedioDiasFechado: mediasPorEtapa.get(etapa.statusId) ?? null,
  }));

  // Mesma lógica dos KPIs: títulos criados na competência (qualquer status),
  // os concluídos nela (mesmo criados antes) e os herdados ainda em
  // andamento. Num retrato congelado, os herdados são os que estavam lá.
  const doMes = new Map<number, CardCapitalizacao>();
  for (const c of [...novidades, ...concluidos]) doMes.set(c.id, c);
  const criadoAteCompetencia = new Set(cards.filter((c) => competenciaData(c.criadoEm) <= competencia).map((c) => c.id));
  const herdados = retratoCongelado
    ? retratoCongelado.titulos.filter((t) => !doMes.has(t.id) && criadoAteCompetencia.has(t.id))
    : emAndamentoTodos.filter((c) => !doMes.has(c.id));

  const titulos = [...doMes.values(), ...herdados]
    .map((c) => ({
      id: c.id,
      titular: c.titular,
      imobiliaria: c.imobiliaria,
      etapaNome: c.etapaNome,
      valorTitulo: c.valorTitulo,
      comissao: c.comissao,
    }))
    // id do Bitrix cresce com a criação -- mais novo primeiro.
    .sort((a, b) => b.id - a.id);

  return {
    competencia,
    kpisAnterior,
    porOrigem: kpisPorOrigem(cards, competencia),
    porOrigemAnterior: kpisPorOrigem(cards, competenciaAnt),
    kpis: {
      total: novidades.length,
      emitidos,
      perdidos,
      emAndamento,
      taxaConversao,
      valorTotalEmitido,
      comissaoEfetivada,
      comissaoPotencial,
      cardsComAlerta: cardsAlertaLista.length,
      premioPotencial,
      numeroImobiliarias,
      ticketMedioPremio,
    },
    funil,
    cardsAlerta: cardsAlertaLista,
    titulos,
    // "concluidos" por dia = dia do pagamento/emissão (é o "Ontem" do
    // relatório do WhatsApp); o "No mês" do relatório usa os kpis acima.
    porDia: contarPorDia(
      competencia,
      cards.map((c) => c.criadoEm),
      cards.filter((c) => efetivado(c) && c.concluidoEm).map((c) => ({ quando: c.concluidoEm!, comissao: c.comissao })),
      cards.filter((c) => c.semantica === "F" && c.movidoEm).map((c) => c.movidoEm!)
    ),
    atualizadoEm: agora.toISOString(),
  };
}
