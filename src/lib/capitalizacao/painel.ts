import "server-only";

import {
  listarItensSpa,
  listarHistoricoEtapas,
  type BitrixItemRaw,
  type BitrixStageHistoryEvent,
} from "@/lib/bitrix/client";

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

function competenciaData(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type CardCapitalizacao = {
  id: number;
  titulo: string;
  etapaId: string;
  etapaNome: string;
  semantica: Semantica;
  criadoEm: Date;
  movidoEm: Date | null;
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

export type PainelCapitalizacao = {
  competencia: string;
  kpis: {
    total: number; // "novidades" -- só cards criados nesta competência
    emitidos: number; // "novidades" -- só cards criados nesta competência
    perdidos: number; // "novidades" -- só cards criados nesta competência
    emAndamento: ContagemPorOrigem; // novos + herdados, ainda "P" agora -- ÚNICA coisa que herda de mês anterior (pedido do Matheus: uma vez concluído, não herda mais)
    taxaConversao: number | null;
    valorTotalEmitido: number; // "novidades"
    comissaoEfetivada: number; // "novidades"
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
  atualizadoEm: string;
};

function mapearCard(item: BitrixItemRaw, agora: Date): CardCapitalizacao | null {
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

function contagemPorOrigem(itens: CardCapitalizacao[], competencia: string): ContagemPorOrigem {
  let mesAtual = 0;
  let herdado = 0;
  for (const c of itens) {
    if (competenciaData(c.criadoEm) === competencia) mesAtual++;
    else herdado++;
  }
  return { mesAtual, herdado, total: mesAtual + herdado };
}

export async function montarPainelCapitalizacao(competencia: string, agora = new Date()): Promise<PainelCapitalizacao> {
  const [itens, historico] = await Promise.all([
    listarItensSpa(ENTITY_TYPE_ID),
    listarHistoricoEtapas(ENTITY_TYPE_ID),
  ]);

  const cards = itens.map((item) => mapearCard(item, agora)).filter((c): c is CardCapitalizacao => c !== null);
  const novidades = cards.filter((c) => competenciaData(c.criadoEm) === competencia);

  // Redefinido com o Matheus em 01/09/2026: a ÚNICA coisa que herda de mês
  // anterior é "Em Andamento" (card ainda aberto, de qualquer origem) --
  // uma vez que o card CONCLUI (Emitido/Pagamento não realizado/
  // Desistência), ele deixa de ser herdado e Emitidos/Perdidos voltam a
  // ser só sobre quem foi CRIADO neste mês, não sobre quando o Bitrix
  // registrou a conclusão. Motivo: o card só muda de etapa quando o
  // Controle confirma o registro no Corp, o que pode acontecer dias depois
  // do título ter sido emitido de fato -- usar a data de mudança de etapa
  // pra decidir o mês fazia um card nascido em agosto (emitido de fato em
  // agosto) contar como setembro só por causa do atraso do Controle.
  const emAndamentoTodos = cards.filter((c) => c.semantica === "P");
  const emAndamento = contagemPorOrigem(emAndamentoTodos, competencia);

  const emitidosNovidades = novidades.filter((c) => c.etapaId === "DT1048_28:SUCCESS");
  const perdidosNovidades = novidades.filter((c) => c.semantica === "F");
  const emitidos = emitidosNovidades.length;
  const perdidos = perdidosNovidades.length;
  const taxaConversao = emitidos + perdidos > 0 ? emitidos / (emitidos + perdidos) : null;
  const valorTotalEmitido = emitidosNovidades.reduce((soma, c) => soma + c.valorTitulo, 0);
  const comissaoEfetivada = emitidosNovidades.reduce((soma, c) => soma + c.comissao, 0);
  const comissaoPotencial = novidades.reduce((soma, c) => soma + c.comissao, 0);
  const premioPotencial = novidades.reduce((soma, c) => soma + c.valorTitulo, 0);
  const numeroImobiliarias = new Set(novidades.filter((c) => c.imobiliaria !== "—").map((c) => c.imobiliaria)).size;
  const ticketMedioPremio = novidades.length > 0 ? premioPotencial / novidades.length : 0;

  // Alerta de card parado é operacional (agora), não fica preso à
  // competência selecionada — um card antigo esquecido continua alertando.
  const cardsAlertaLista = cards
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
    // novidades desta competência, mesmo critério de Emitidos/Perdidos.
    if (card.semantica !== "P" && competenciaData(card.criadoEm) !== competencia) continue;
    contagemAtualPorEtapa.set(card.etapaId, (contagemAtualPorEtapa.get(card.etapaId) || 0) + 1);
  }

  const funil: FunilEtapa[] = ETAPAS.map((etapa) => ({
    statusId: etapa.statusId,
    nome: etapa.nome,
    semantica: etapa.semantica,
    quantidadeAtual: contagemAtualPorEtapa.get(etapa.statusId) || 0,
    tempoMedioDiasFechado: mediasPorEtapa.get(etapa.statusId) ?? null,
  }));

  // Mesma lógica da herança dos KPIs: só entram na lista os títulos da
  // competência (novidades, qualquer status) e os que ainda estão em
  // andamento de meses anteriores (herdados) -- um título concluído em
  // outro mês não aparece aqui, ele já foi contado no mês em que nasceu.
  const idsNovidades = new Set(novidades.map((c) => c.id));
  const herdadosEmAndamento = emAndamentoTodos.filter((c) => !idsNovidades.has(c.id));
  const titulosRelevantes = [...novidades, ...herdadosEmAndamento];

  const titulos = titulosRelevantes
    .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
    .map((c) => ({
      id: c.id,
      titular: c.titular,
      imobiliaria: c.imobiliaria,
      etapaNome: c.etapaNome,
      valorTitulo: c.valorTitulo,
      comissao: c.comissao,
    }));

  return {
    competencia,
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
    atualizadoEm: agora.toISOString(),
  };
}
