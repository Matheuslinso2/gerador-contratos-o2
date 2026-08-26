// Modelagem de dados do painel Comercial (funis "Ativação Novos Clientes" e
// "Sucesso do Cliente"), Deals padrão do Bitrix (crm.deal.*), não SPA. Mesmo
// espírito arquitetural de seguroFianca.ts (que lê um Smart Process via
// crm.item.*), mas a API e o formato de resposta do Bitrix são diferentes
// aqui: crm.deal.list e crm.activity.list devolvem `{result: [...array
// direto...]}`, não `{result: {items: [...]}}` como crm.item.list — por isso
// este arquivo tem sua própria função de paginação (buscarTodasPaginasFlat),
// em vez de reusar buscarTodasPaginas de client.ts (que é privada, e cujo
// formato de resposta esperado não bate com esses dois métodos). O histórico
// de etapas (crm.stagehistory.list) usa o MESMO formato paginado de
// `{items:[...]}` que a SPA, então ali sim reusamos listarHistoricoEtapas de
// client.ts diretamente, só passando entityTypeId=2 (DEAL) em vez de 1042.
//
// O "cliente" da O2 aqui é a imobiliária parceira (COMPANY_ID), não o
// inquilino/segurado -- os dois funis rastreiam o relacionamento comercial
// com essas imobiliárias, não o processo de uma apólice individual.
//
// Regras gerais (ver ESPECIFICACOES_KPIS_BITRIX_ATIVACAO_SUCESSO_AGOSTO_2026.md,
// seção 1, fonte de verdade pra toda fórmula usada abaixo):
//
// 1.1 População mensal / "alteração efetiva": um card entra na população do
//     mês se teve pelo menos um destes eventos dentro do período: mudança de
//     etapa/funil (crm.stagehistory.list), atividade criada ou alterada
//     (crm.activity.list), ligação/e-mail registrado (idem, sem
//     distinção confiável de tipo -- ver nota sobre TYPE_ID abaixo), tarefa
//     criada/alterada/concluída (tasks.task.list, indisponível neste webhook
//     -- ver listarTarefas), ou campo/produto/vínculo alterado. Essa última
//     categoria (campo alterado) não é exposta com granularidade pelo Bitrix
//     REST -- usamos como aproximação de melhor esforço (decisão já validada
//     com o usuário) o DATE_MODIFY do deal cair no mês E nenhuma das fontes
//     anteriores já explicar a alteração. Isso é uma limitação conhecida
//     (pode super ou sub-contar levemente), não um bug. `Visualizar` nunca
//     conta sozinho -- e como não temos acesso a um log de visualizações via
//     essas 4 APIs, nunca entra na conta de "alteração efetiva" aqui (ver
//     nota em Q1 mais abaixo sobre essa limitação específica).
// 1.2 Contagem única: cada card conta 1x por KPI de quantidade. Transferência
//     de funil é sempre Ativação (categoria 1) → Sucesso (categoria 0);
//     nunca o inverso -- confirmado com o usuário, não tratamos o caso
//     reverso. Mover de funil é o MESMO ID de deal, só muda CATEGORY_ID (não
//     cria um deal novo) -- confirmado ao vivo.
// 1.3 Data de corte = data/hora da última atualização bem-sucedida dos dados
//     (ver kpis.qualidade.q6_ultimaAtualizacao), não fim do mês -- painel de
//     acompanhamento diário dentro do mês corrente.
// 1.4 Responsável = SEMPRE o responsável ATUAL do card (ASSIGNED_BY_ID),
//     nunca quem executou uma ação específica.
// 1.5 Valores financeiros: OPPORTUNITY só gera KPIs de cobertura/preenchimento
//     (% > 0, % = 0) -- NUNCA somado pra virar "produção total"/"receita
//     total"/etc. (proibido explicitamente na seção 6 do documento).
//
// Estado aberto/fechado: usamos STAGE_SEMANTIC_ID ("P"=em andamento,
// "S"=sucesso, "F"=fracasso) como critério primário, não comparação de
// string de STAGE_ID -- é o campo que o próprio Bitrix já semantiza pra isso,
// e cobre corretamente os 3 estados de fechamento do funil Sucesso (WON,
// LOSE, APOLOGY) sem precisar enumerar cada um.
//
// Limitações conhecidas e documentadas neste arquivo (não são bugs):
// - CAMPO_MOTIVO_ENTRADA (UF_CRM_1784138667): identificado por inferência
//   semântica das opções do enum, não confirmado 100% pelo rótulo real do
//   campo no Bitrix (a API não expõe EDIT_FORM_LABEL pra nenhum dos ~157
//   campos UF_CRM_* deste portal). Ver TODO ao lado da constante.
// - Ligação vs e-mail (KPI R8 e afins): os valores de TYPE_ID de
//   crm.activity.list para "ligação"/"e-mail" não foram confirmados contra
//   dados reais nesta sessão. R7 (atividades, sem distinção de tipo) é
//   confiável; a subdivisão em R8 usa um palpite de TYPE_ID documentado como
//   não confirmado -- não deve ser tratado como definitivo até validação.
// - KPI Q1 (eventos descartados por serem apenas visualização): nenhuma das
//   4 APIs usadas aqui (crm.deal.list, crm.activity.list,
//   crm.stagehistory.list, tasks.task.list) expõe um log de visualizações de
//   card -- não é possível reproduzir esse número com as fontes disponíveis.
//   Retornamos 0 documentando a limitação, em vez de inventar um valor.
// - KPI Q2 (cards excluídos no mês) fica FORA desta implementação -- decisão
//   já validada com o usuário (só fica confiável com um snapshot anterior
//   pra comparar contagem de antes/depois; adiado pra fase futura).
// - listarTarefas (tasks.task.list): o webhook BITRIX_WEBHOOK_URL não tem
//   escopo pra esse método (retorna insufficient_scope) -- é uma pendência
//   de infraestrutura fora do controle deste código. A função tenta a
//   chamada mesmo assim e cai num array vazio em caso de erro, pra não
//   quebrar o resto do painel.
// - A9 (movimentos de etapa: avanços/retornos/transferências/fechamentos):
//   a classificação de avanço vs retorno usa a ORDEM_ETAPAS_ATIVACAO listada
//   abaixo como proxy da ordem real do Kanban -- essa ordem não foi
//   confirmada contra a configuração real de exibição do funil no Bitrix,
//   só reflete a ordem em que as etapas foram documentadas.

import "server-only";
import {
  buscarEmpresas,
  buscarUsuarios,
  listarHistoricoEtapas,
  type BitrixCampoEnum,
  type BitrixDefinicaoCampo,
  type BitrixStageHistoryEvent,
} from "./client";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const CATEGORY_ID_ATIVACAO = 1;
export const CATEGORY_ID_SUCESSO = 0;
export const ENTITY_TYPE_ID_DEAL = 2;

export const CAMPO_VALOR = "OPPORTUNITY";
export const CAMPO_DATA_TERMINO = "CLOSEDATE";
// TODO: confirmar com o usuário que UF_CRM_1784138667 é de fato "Motivo da
// entrada" -- inferido pelos valores das opções do enum (7 opções, todas
// relacionadas a aumento/recuperação de produção, batendo com a descrição do
// usuário de que o motivo de entrada em Sucesso é sempre isso), mas o
// rótulo real do campo não é exposto pela API do Bitrix neste portal.
export const CAMPO_MOTIVO_ENTRADA = "UF_CRM_1784138667";

// Etapas confirmadas via crm.dealcategory.list / crm.status.list ao vivo
// nesta sessão -- estável, não muda sem reconfigurar o funil no Bitrix.
export const ETAPAS_ATIVACAO: Record<string, string> = {
  "C1:UC_FWJUVD": "CLIEN FECHOU (MÊS ANTERIOR)",
  "C1:UC_KSEOX6": "CLIEN FECHOU (MÊS ATUAL)",
  "C1:UC_SQM1IK": "VISITA/CALL ATIVA/ENGAJAMENTO",
  "C1:UC_1WXD0P": "ACOMP/AUM PRODUÇÃO",
  "C1:UC_1MCFAJ": "REVISÃO DESEMPENHO",
  "C1:NEW": "RECICLAGEM (ACIMA DE 30 DIAS COM POTENCIAL)",
  "C1:WON": "Ganho (Ativação)",
  "C1:LOSE": "Perda (Ativação)",
};
// Ordem de progressão do Kanban -- ver nota sobre A9 no topo do arquivo
// (aproximação, não confirmada contra a ordem real de exibição).
const ORDEM_ETAPAS_ATIVACAO = [
  "C1:UC_FWJUVD",
  "C1:UC_KSEOX6",
  "C1:UC_SQM1IK",
  "C1:UC_1WXD0P",
  "C1:UC_1MCFAJ",
  "C1:NEW",
  "C1:WON",
  "C1:LOSE",
];
const ETAPAS_ATIVACAO_ABERTAS = ORDEM_ETAPAS_ATIVACAO.filter((id) => id !== "C1:WON" && id !== "C1:LOSE");

export const ETAPAS_SUCESSO: Record<string, string> = {
  NEW: "1. ANÁLISE DESENPENHO",
  UC_44TPCY: "2.AÇÃO SUCESSO IDENTIFICADA",
  UC_RA0YYI: "3. PRIORIZAR ABORDAGEM",
  UC_1F3QT3: "4. TENTANDO CONTATO",
  UC_CJT0AO: "CONTATO FUTURO",
  UC_Z1FQZK: "DESINTERESSE/DESQUALIFICADO",
  UC_PWJCIY: "5. CONTATO REALIZADO",
  UC_S29YH6: "6. CALL/VISITA AGENDADA",
  UC_MMQUH9: "7.CALL/VISITA REALIZADA",
  UC_9X1BPT: "8. APRES. + DIAGNÓTICO",
  UC_K2PMR3: "9. OPORTUNIDADE GERADA(DIFERENÇA)",
  UC_AMUXWG: "EMISSÃO/APÓLICE (MENSAL - SOMENTE A DIFERENÇA)",
  UC_KKDC01: "RESULTADO CAMPANHA (> 1 MÊS)",
  UC_I95JZY: "CLIENTE SEM POTENCIAL",
  WON: "Ganho Fechado",
  LOSE: "Perda Fechada",
  APOLOGY: "Analisar falha",
};
const ORDEM_ETAPAS_SUCESSO = [
  "NEW",
  "UC_44TPCY",
  "UC_RA0YYI",
  "UC_1F3QT3",
  "UC_CJT0AO",
  "UC_Z1FQZK",
  "UC_PWJCIY",
  "UC_S29YH6",
  "UC_MMQUH9",
  "UC_9X1BPT",
  "UC_K2PMR3",
  "UC_AMUXWG",
  "UC_KKDC01",
  "UC_I95JZY",
  "WON",
  "LOSE",
  "APOLOGY",
];
const ETAPAS_SUCESSO_ABERTAS = ORDEM_ETAPAS_SUCESSO.filter((id) => !["WON", "LOSE", "APOLOGY"].includes(id));

// Palpite não confirmado de TYPE_ID de "ligação" em crm.activity.list --
// instalação padrão do Bitrix normalmente usa 1=Ligação, mas isso NUNCA foi
// validado contra dados reais deste portal nesta sessão. Ver nota no topo
// do arquivo (R8).
const TYPE_ID_LIGACAO_NAO_CONFIRMADO = new Set(["1"]);

// ---------------------------------------------------------------------------
// Chamadas cruas ao Bitrix -- réplica local mínima do padrão de client.ts.
// Não importamos chamarBitrix/buscarTodasPaginas de lá porque não são
// exportados, e o formato de resposta de crm.deal.list / crm.activity.list
// (array direto em `result`) é diferente do formato `{result:{items:[...]}}`
// que buscarTodasPaginas espera.
// ---------------------------------------------------------------------------

function getWebhookUrlComercial(): string {
  const url = process.env.BITRIX_WEBHOOK_URL;
  if (!url) throw new Error("BITRIX_WEBHOOK_URL não configurada");
  return url.endsWith("/") ? url : `${url}/`;
}

type ParamValorComercial = string | number | Array<string | number>;

async function chamarBitrixComercial<T>(metodo: string, params: Record<string, ParamValorComercial> = {}): Promise<T> {
  const base = getWebhookUrlComercial();
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (Array.isArray(valor)) {
      for (const item of valor) busca.append(`${chave}[]`, String(item));
    } else {
      busca.append(chave, String(valor));
    }
  }
  const url = `${base}${metodo}${busca.toString() ? `?${busca.toString()}` : ""}`;
  const resposta = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!resposta.ok) throw new Error(`Bitrix ${metodo} falhou: HTTP ${resposta.status}`);
  const dados = await resposta.json();
  if (dados.error) throw new Error(`Bitrix ${metodo} erro: ${dados.error_description || dados.error}`);
  return dados as T;
}

const TAMANHO_PAGINA_BITRIX_COMERCIAL = 50;
const CONCORRENCIA_PAGINACAO_COMERCIAL = 6;

async function comConcorrenciaLimitadaComercial<X, Y>(itens: X[], limite: number, tarefa: (item: X) => Promise<Y>): Promise<Y[]> {
  const resultados: Y[] = new Array(itens.length);
  let proximo = 0;
  async function trabalhador() {
    for (;;) {
      const indice = proximo++;
      if (indice >= itens.length) return;
      resultados[indice] = await tarefa(itens[indice]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return resultados;
}

// Paginação pro formato "flat array" que crm.deal.list e crm.activity.list
// usam (`{result: [...], next, total}`) -- diferente do formato
// `{result:{items:[...]}}` que buscarTodasPaginas (client.ts) espera.
async function buscarTodasPaginasFlat<X>(metodo: string, paramsBase: Record<string, ParamValorComercial>): Promise<X[]> {
  const primeira = await chamarBitrixComercial<{ result: X[]; next?: number; total?: number }>(metodo, {
    ...paramsBase,
    start: 0,
  });
  const itens = [...primeira.result];
  const total = primeira.total ?? itens.length;
  if (primeira.next === undefined || total <= itens.length) return itens;

  const starts: number[] = [];
  for (let start = TAMANHO_PAGINA_BITRIX_COMERCIAL; start < total; start += TAMANHO_PAGINA_BITRIX_COMERCIAL) starts.push(start);

  const paginas = await comConcorrenciaLimitadaComercial(starts, CONCORRENCIA_PAGINACAO_COMERCIAL, (start) =>
    chamarBitrixComercial<{ result: X[] }>(metodo, { ...paramsBase, start })
  );
  for (const pagina of paginas) itens.push(...pagina.result);
  return itens;
}

// Deal bruto -- campos padrão usados pelo painel comercial + o UF de motivo
// de entrada (só populado nos deals do funil Sucesso). Index signature pra
// tolerar campos extras que o Bitrix sempre devolve mesmo sem pedir.
export type BitrixDealRaw = {
  ID: string;
  TITLE: string;
  CATEGORY_ID: string;
  STAGE_ID: string;
  STAGE_SEMANTIC_ID: string;
  ASSIGNED_BY_ID: string;
  COMPANY_ID: string;
  OPPORTUNITY: string;
  CLOSEDATE: string | null;
  DATE_CREATE: string;
  DATE_MODIFY: string;
  [campo: string]: unknown;
};

export async function listarDeals(categoryId: number): Promise<BitrixDealRaw[]> {
  return buscarTodasPaginasFlat<BitrixDealRaw>("crm.deal.list", {
    "filter[CATEGORY_ID]": categoryId,
    select: [
      "ID",
      "TITLE",
      "CATEGORY_ID",
      "STAGE_ID",
      "STAGE_SEMANTIC_ID",
      "ASSIGNED_BY_ID",
      "COMPANY_ID",
      "OPPORTUNITY",
      "CLOSEDATE",
      "DATE_CREATE",
      "DATE_MODIFY",
      CAMPO_MOTIVO_ENTRADA,
    ],
  });
}

// crm.deal.fields devolve `{result: {...dict de campos direto...}}` --
// diferente de crm.item.fields, que aninha em `.result.fields`. Reusamos o
// tipo BitrixDefinicaoCampo de client.ts porque o formato de cada entrada
// (`{items: [{ID, VALUE}]}`) é o mesmo.
export async function buscarDefinicaoCamposDeal(): Promise<Record<string, BitrixDefinicaoCampo>> {
  const resposta = await chamarBitrixComercial<{ result: Record<string, BitrixDefinicaoCampo> }>("crm.deal.fields", {});
  return resposta.result;
}

// crm.stagehistory.list tem o MESMO formato paginado `{items:[...]}` que a
// SPA usa -- listarHistoricoEtapas (client.ts) já é genérica por
// entityTypeId, então reusamos direto em vez de duplicar a lógica.
export async function listarHistoricoEtapasDeal(): Promise<BitrixStageHistoryEvent[]> {
  return listarHistoricoEtapas(ENTITY_TYPE_ID_DEAL);
}

export type BitrixAtividadeRaw = {
  ID: string;
  OWNER_ID: string;
  OWNER_TYPE_ID: string;
  TYPE_ID: string;
  CREATED: string;
  LAST_UPDATED?: string;
};

// crm.activity.list também devolve array flat (mesmo formato de
// crm.deal.list) -- confirmado ao vivo nesta sessão.
export async function listarAtividades(): Promise<BitrixAtividadeRaw[]> {
  return buscarTodasPaginasFlat<BitrixAtividadeRaw>("crm.activity.list", {
    "filter[OWNER_TYPE_ID]": ENTITY_TYPE_ID_DEAL,
    select: ["ID", "OWNER_ID", "OWNER_TYPE_ID", "TYPE_ID", "CREATED", "LAST_UPDATED"],
  });
}

export type BitrixTarefaRaw = {
  id?: string;
  ufCrmTask?: string[];
  createdDate?: string;
  changedDate?: string;
  closedDate?: string;
  [campo: string]: unknown;
};

// O webhook BITRIX_WEBHOOK_URL não tem escopo pra tasks.task.list
// (insufficient_scope, confirmado ao vivo) -- pendência de infraestrutura
// fora do controle deste código. Tentamos mesmo assim (a config pode mudar
// no futuro) e caímos num array vazio em caso de erro, sem quebrar o painel.
export async function listarTarefas(): Promise<BitrixTarefaRaw[]> {
  try {
    const resposta = await chamarBitrixComercial<{ result: { tasks?: BitrixTarefaRaw[] } | BitrixTarefaRaw[] }>(
      "tasks.task.list",
      { select: ["ID", "UF_CRM_TASK", "CREATED_DATE", "CHANGED_DATE", "CLOSED_DATE"] }
    );
    const resultado = resposta.result;
    if (Array.isArray(resultado)) return resultado;
    return resultado?.tasks ?? [];
  } catch (erro) {
    console.warn(
      "[bitrix/comercial] tasks.task.list indisponível (provável falta de escopo no webhook BITRIX_WEBHOOK_URL) -- seguindo sem dados de tarefas. KPIs R9 (por responsável) ficam zerados até essa pendência de infraestrutura ser resolvida.",
      erro
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Normalização por card
// ---------------------------------------------------------------------------

function enumLabel(defs: Record<string, BitrixDefinicaoCampo>, campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const item = defs[campo]?.items?.find((i: BitrixCampoEnum) => i.ID === String(valor));
  return item ? item.VALUE : String(valor);
}

function nomeUsuario(usuarios: Record<number, string>, id: number): string {
  if (!id) return "";
  return usuarios[id] || `ID ${id}`;
}

function nomeEmpresa(empresas: Record<number, string>, id: number): string {
  if (!id) return "";
  return empresas[id] || `ID ${id}`;
}

// OPPORTUNITY vem como string numérica (às vezes com sufixo "|MOEDA", igual
// aos campos monetários da SPA). Tratamos ausente/vazio como 0 -- em
// nenhuma amostra observada o campo veio null (Bitrix money field defaulta
// pra "0.00"), então "sem valor" e "valor zero" são o mesmo bucket aqui,
// batendo com a forma como o KPI A11/S14 é descrito no documento (2
// buckets: >0 e =0, sem um terceiro bucket "não preenchido").
function valorNumero(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const [num] = String(v).split("|");
  const n = Number(num);
  return Number.isFinite(n) ? n : 0;
}

function apenasData(v: unknown): string {
  if (!v) return "";
  return String(v).slice(0, 10);
}

function noMes(dataIso: string | null | undefined, competencia: string): boolean {
  return !!dataIso && dataIso.startsWith(competencia);
}

function ordenarPorData(eventos: BitrixStageHistoryEvent[]): BitrixStageHistoryEvent[] {
  return [...eventos].sort((a, b) => new Date(a.CREATED_TIME).getTime() - new Date(b.CREATED_TIME).getTime());
}

export type LinhaComercial = {
  id: number;
  titulo: string;
  categoriaId: number; // categoria ATUAL (0 = Sucesso, 1 = Ativação)
  funil: "Ativação Novos Clientes" | "Sucesso do Cliente";
  stageId: string;
  etapaNome: string;
  stageSemantica: string; // "P" | "S" | "F" (campo já semantizado pelo Bitrix)
  aberto: boolean; // stageSemantica === "P"
  responsavelId: number;
  responsavelNome: string;
  empresaId: number;
  empresaNome: string;
  valor: number; // OPPORTUNITY, nunca somado pra virar produção/receita -- ver regra 1.5
  dataTermino: string; // CLOSEDATE (YYYY-MM-DD), "" se vazio
  motivoEntradaId: string; // valor bruto do enum, "" se vazio -- só relevante no funil Sucesso
  motivoEntradaNome: string;
  dataCriacao: string;
  dataModificacao: string;
  eventosOrdenados: BitrixStageHistoryEvent[]; // histórico completo do card (todas as categorias por onde já passou)
  eventosNoMes: BitrixStageHistoryEvent[];
  atividadesNoMes: BitrixAtividadeRaw[];
  tarefasNoMes: BitrixTarefaRaw[];
  fontesAlteracaoEfetiva: string[]; // motivos que explicam alteracaoEfetivaNoMes -- ver regra 1.1
  alteracaoEfetivaNoMes: boolean;
  // Primeiro evento do histórico em que a categoria vira de Ativação (1) pra
  // Sucesso (0) -- null se o card nunca esteve em Ativação, ou nunca saiu de
  // lá. Transferência é sempre Ativação → Sucesso (regra 1.2), não tratamos
  // o inverso.
  transferenciaEvento: BitrixStageHistoryEvent | null;
  transferiuNesteMes: boolean;
  reabriuNesteMes: boolean; // fechamento (S/F) seguido de reabertura (P) dentro da MESMA categoria, com a reabertura neste mês
};

function indexarPorOwnerId<T extends { OWNER_ID: string | number }>(itens: T[]): Map<number, T[]> {
  const mapa = new Map<number, T[]>();
  for (const item of itens) {
    const id = Number(item.OWNER_ID);
    const lista = mapa.get(id) ?? [];
    lista.push(item);
    mapa.set(id, lista);
  }
  return mapa;
}

// Tarefas vinculadas a um deal via campo ufCrmTask (formato "D_123" pro
// deal ID 123, convenção padrão do Bitrix pra vínculo Task↔CRM). Como
// listarTarefas hoje sempre devolve [] (sem escopo), esta função na prática
// sempre produz um mapa vazio -- mantida pronta pra quando o escopo for
// liberado.
function indexarTarefasPorDeal(tarefas: BitrixTarefaRaw[]): Map<number, BitrixTarefaRaw[]> {
  const mapa = new Map<number, BitrixTarefaRaw[]>();
  for (const tarefa of tarefas) {
    const vinculos = Array.isArray(tarefa.ufCrmTask) ? tarefa.ufCrmTask : [];
    for (const vinculo of vinculos) {
      const match = /^D_(\d+)$/.exec(String(vinculo));
      if (!match) continue;
      const dealId = Number(match[1]);
      const lista = mapa.get(dealId) ?? [];
      lista.push(tarefa);
      mapa.set(dealId, lista);
    }
  }
  return mapa;
}

function tarefaEmMes(tarefa: BitrixTarefaRaw, competencia: string): boolean {
  return (
    noMes(tarefa.createdDate ? String(tarefa.createdDate).slice(0, 10) : "", competencia) ||
    noMes(tarefa.changedDate ? String(tarefa.changedDate).slice(0, 10) : "", competencia) ||
    noMes(tarefa.closedDate ? String(tarefa.closedDate).slice(0, 10) : "", competencia)
  );
}

export function montarLinhasComerciais(
  deals: BitrixDealRaw[],
  historico: BitrixStageHistoryEvent[],
  atividades: BitrixAtividadeRaw[],
  tarefas: BitrixTarefaRaw[],
  definicaoCampos: Record<string, BitrixDefinicaoCampo>,
  nomesUsuarios: Record<number, string>,
  nomesEmpresas: Record<number, string>,
  competencia: string
): LinhaComercial[] {
  const historicoPorCard = indexarPorOwnerId(historico);
  const atividadesPorCard = indexarPorOwnerId(atividades);
  const tarefasPorCard = indexarTarefasPorDeal(tarefas);

  return deals.map((deal): LinhaComercial => {
    const id = Number(deal.ID);
    const categoriaId = Number(deal.CATEGORY_ID);
    const funil = categoriaId === CATEGORY_ID_ATIVACAO ? "Ativação Novos Clientes" : "Sucesso do Cliente";
    const stageSemantica = deal.STAGE_SEMANTIC_ID || "P";
    const aberto = stageSemantica === "P";
    const responsavelId = Number(deal.ASSIGNED_BY_ID) || 0;
    const empresaId = Number(deal.COMPANY_ID) || 0;
    const etapaNome =
      (categoriaId === CATEGORY_ID_ATIVACAO ? ETAPAS_ATIVACAO[deal.STAGE_ID] : ETAPAS_SUCESSO[deal.STAGE_ID]) ?? deal.STAGE_ID;

    const eventosOrdenados = ordenarPorData(historicoPorCard.get(id) ?? []);
    const eventosNoMes = eventosOrdenados.filter((e) => noMes(e.CREATED_TIME, competencia));

    const todasAtividades = atividadesPorCard.get(id) ?? [];
    const atividadesNoMes = todasAtividades.filter((a) => noMes(a.CREATED, competencia) || noMes(a.LAST_UPDATED, competencia));

    const todasTarefas = tarefasPorCard.get(id) ?? [];
    const tarefasNoMes = todasTarefas.filter((t) => tarefaEmMes(t, competencia));

    // Transferência Ativação → Sucesso: primeiro par consecutivo de eventos
    // em que a categoria vira de 1 pra 0 (nunca o inverso -- regra 1.2).
    let transferenciaEvento: BitrixStageHistoryEvent | null = null;
    for (let i = 1; i < eventosOrdenados.length; i++) {
      if (
        Number(eventosOrdenados[i - 1].CATEGORY_ID) === CATEGORY_ID_ATIVACAO &&
        Number(eventosOrdenados[i].CATEGORY_ID) === CATEGORY_ID_SUCESSO
      ) {
        transferenciaEvento = eventosOrdenados[i];
        break;
      }
    }
    const transferiuNesteMes = !!transferenciaEvento && noMes(transferenciaEvento.CREATED_TIME, competencia);

    // Reabertura: fechamento (S ou F) seguido de reabertura (P) DENTRO da
    // mesma categoria (ignora o par na fronteira de uma transferência de
    // funil, que naturalmente muda de categoria e semântica ao mesmo tempo
    // sem ser uma "reabertura" no sentido do KPI S7). S7 é um KPI específico
    // do funil Sucesso do Cliente (categoria 0) -- uma reabertura ocorrida
    // dentro de Ativação (categoria 1) não é contada aqui, pois o documento
    // de spec não define um KPI equivalente pra esse funil. Validado contra
    // a amostra de agosto/2026: sem esse filtro de categoria, um card que
    // reabriu dentro de Ativação (card 1544, C1:WON → C1:UC_1WXD0P) era
    // contado incorretamente junto com a reabertura real do card 499 em
    // Sucesso, dando 2 em vez do 1 esperado pelo doc.
    let reabriuNesteMes = false;
    for (let i = 1; i < eventosOrdenados.length; i++) {
      const anterior = eventosOrdenados[i - 1];
      const atual = eventosOrdenados[i];
      if (anterior.CATEGORY_ID !== atual.CATEGORY_ID) continue;
      if (Number(atual.CATEGORY_ID) !== CATEGORY_ID_SUCESSO) continue;
      if ((anterior.STAGE_SEMANTIC_ID === "S" || anterior.STAGE_SEMANTIC_ID === "F") && atual.STAGE_SEMANTIC_ID === "P") {
        if (noMes(atual.CREATED_TIME, competencia)) reabriuNesteMes = true;
      }
    }

    const fontesAlteracaoEfetiva: string[] = [];
    if (eventosNoMes.length) fontesAlteracaoEfetiva.push("mudança de etapa/funil");
    if (atividadesNoMes.length) fontesAlteracaoEfetiva.push("atividade (ligação/e-mail/reunião) criada ou alterada");
    if (tarefasNoMes.length) fontesAlteracaoEfetiva.push("tarefa criada, alterada ou concluída");
    if (!fontesAlteracaoEfetiva.length && noMes(apenasData(deal.DATE_MODIFY), competencia)) {
      // Aproximação de melhor esforço pra "campo alterado"/"produto ou
      // vínculo alterado" -- ver regra 1.1 no topo do arquivo.
      fontesAlteracaoEfetiva.push("campo alterado (aproximação via DATE_MODIFY, sem outra fonte explicando a mudança)");
    }

    return {
      id,
      titulo: deal.TITLE,
      categoriaId,
      funil,
      stageId: deal.STAGE_ID,
      etapaNome,
      stageSemantica,
      aberto,
      responsavelId,
      responsavelNome: nomeUsuario(nomesUsuarios, responsavelId),
      empresaId,
      empresaNome: nomeEmpresa(nomesEmpresas, empresaId),
      valor: valorNumero(deal[CAMPO_VALOR]),
      dataTermino: apenasData(deal[CAMPO_DATA_TERMINO]),
      motivoEntradaId: deal[CAMPO_MOTIVO_ENTRADA] ? String(deal[CAMPO_MOTIVO_ENTRADA]) : "",
      motivoEntradaNome: enumLabel(definicaoCampos, CAMPO_MOTIVO_ENTRADA, deal[CAMPO_MOTIVO_ENTRADA]),
      dataCriacao: apenasData(deal.DATE_CREATE),
      dataModificacao: apenasData(deal.DATE_MODIFY),
      eventosOrdenados,
      eventosNoMes,
      atividadesNoMes,
      tarefasNoMes,
      fontesAlteracaoEfetiva,
      alteracaoEfetivaNoMes: fontesAlteracaoEfetiva.length > 0,
      transferenciaEvento,
      transferiuNesteMes,
      reabriuNesteMes,
    };
  });
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

function pct(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 10000) / 100 : 0;
}

export type DistribuicaoEtapa = { etapa: string; cards: number };
export type CoberturaValor = { comValor: number; comValorPct: number; semValor: number; semValorPct: number };
export type RegistroResponsavel = {
  responsavel: string;
  r1_carteiraAtual: number;
  r2_cardsTrabalhados: number;
  r3_coberturaTrabalhoPct: number;
  r4_ganhosAtribuidos: number;
  r5_perdasFinaisAtribuidas: number;
  r6_mudancasDeEtapa: number;
  r7_atividadesRegistradas: number;
  r8_ligacoesRegistradas: number;
  r9_tarefasRegistradas: number;
  r10_cardsVencidos: number;
  r11_cardsSemTrabalho: number;
};

export type KpisComercial = {
  competencia: string;
  ativacao: {
    a1_cardsTrabalhados: number;
    a2_estoqueAtual: number;
    a3_semAlteracaoEfetiva: number;
    a4_ativacoesConcluidas: number;
    a5_perdasFinais: number;
    a6_aproveitamentoMensalPct: number;
    a7_taxaSucessoDesfechosPct: number | null;
    a7_amostraDesfechos: number;
    a8_distribuicaoPorEtapa: DistribuicaoEtapa[];
    a9_movimentosDeEtapa: { total: number; avancos: number; retornos: number; transferenciasParaSucesso: number; fechamentos: number };
    a10_cardsComPrazoVencido: number;
    a10_cardsComPrazoVencidoPct: number;
    a11_coberturaValor: CoberturaValor;
    a12_carteiraPorResponsavel: { responsavel: string; carteiraAtual: number; cardsAlteradosNoMes: number }[];
  };
  sucesso: {
    s1_cardsTrabalhados: number;
    s2_estoqueAtual: number;
    s3_semAlteracaoEfetiva: number;
    s4_ganhosDoMes: number;
    s5_movimentosParaPerda: number;
    s6_perdasFinais: number;
    s7_cardsReabertos: number;
    s8_aproveitamentoMensalPct: number;
    s9_taxaSucessoDesfechosPct: number | null;
    s9_amostraDesfechos: number;
    s10_distribuicaoPorEtapa: DistribuicaoEtapa[];
    s11_gargaloPorEtapaPct: { etapa: string; pct: number }[];
    s12_cardsComPrazoVencido: number;
    s12_cardsComPrazoVencidoPct: number;
    s13_motivoEntradaPreenchidoPct: number;
    s14_coberturaValor: CoberturaValor;
    s15_ganhosComValorPreenchidoPct: number;
    s16_carteiraEResultadoPorResponsavel: { responsavel: string; cardsAtuaisMaisGanhos: number; cardsAlterados: number; ganhos: number }[];
  };
  porResponsavel: { ativacao: RegistroResponsavel[]; sucesso: RegistroResponsavel[] };
  qualidade: {
    q1_eventosDescartadosPorVisualizacao: number; // sempre 0 -- ver limitação documentada no topo do arquivo
    q3_coberturaResponsavel: { ativacao: number; sucesso: number };
    q4_coberturaEmpresa: { ativacao: number; sucesso: number };
    q5_coberturaDataTermino: { ativacao: number; sucesso: number };
    q6_ultimaAtualizacao: string;
  };
};

function coberturaValor(linhas: LinhaComercial[]): CoberturaValor {
  const comValor = linhas.filter((l) => l.valor > 0).length;
  const semValor = linhas.filter((l) => l.valor === 0).length;
  return { comValor, comValorPct: pct(comValor, linhas.length), semValor, semValorPct: pct(semValor, linhas.length) };
}

function distribuicaoPorEtapa(linhas: LinhaComercial[], ordemEtapas: string[], mapaNomes: Record<string, string>): DistribuicaoEtapa[] {
  const contagem = new Map<string, number>();
  for (const l of linhas) contagem.set(l.stageId, (contagem.get(l.stageId) ?? 0) + 1);
  return ordemEtapas.map((stageId) => ({ etapa: mapaNomes[stageId] ?? stageId, cards: contagem.get(stageId) ?? 0 }));
}

function cardsComPrazoVencido(linhas: LinhaComercial[], dataCorte: Date): number {
  return linhas.filter((l) => l.dataTermino && new Date(l.dataTermino).getTime() < dataCorte.getTime()).length;
}

// Movimentos de etapa dentro de uma categoria no mês -- avanços/retornos por
// comparação de posição na ORDEM_ETAPAS_* (aproximação, ver nota no topo do
// arquivo), fechamentos = evento com STAGE_SEMANTIC_ID S ou F na própria
// categoria, transferências = card com transferiuNesteMes (só faz sentido
// pra Ativação, já que a transferência sempre vai Ativação → Sucesso).
function calcularMovimentosEtapaAtivacao(linhas: LinhaComercial[], competencia: string): KpisComercial["ativacao"]["a9_movimentosDeEtapa"] {
  let avancos = 0;
  let retornos = 0;
  let fechamentos = 0;
  let transferencias = 0;
  for (const l of linhas) {
    for (let i = 0; i < l.eventosOrdenados.length; i++) {
      const e = l.eventosOrdenados[i];
      if (Number(e.CATEGORY_ID) !== CATEGORY_ID_ATIVACAO) continue;
      if (!noMes(e.CREATED_TIME, competencia)) continue;
      if (e.STAGE_SEMANTIC_ID === "S" || e.STAGE_SEMANTIC_ID === "F") {
        fechamentos++;
        continue;
      }
      const anterior = i > 0 ? l.eventosOrdenados[i - 1] : null;
      if (!anterior || Number(anterior.CATEGORY_ID) !== CATEGORY_ID_ATIVACAO) {
        avancos++; // entrada na etapa sem uma etapa anterior conhecida na mesma categoria -- tratado como avanço
        continue;
      }
      const posAtual = ORDEM_ETAPAS_ATIVACAO.indexOf(e.STAGE_ID);
      const posAnterior = ORDEM_ETAPAS_ATIVACAO.indexOf(anterior.STAGE_ID);
      if (posAtual === -1 || posAnterior === -1 || posAtual >= posAnterior) avancos++;
      else retornos++;
    }
    if (l.transferiuNesteMes) transferencias++;
  }
  return { total: avancos + retornos + fechamentos, avancos, retornos, transferenciasParaSucesso: transferencias, fechamentos };
}

function calcularRegistrosResponsavel(
  linhasFunil: LinhaComercial[],
  categoryId: number,
  competencia: string,
  dataCorte: Date
): RegistroResponsavel[] {
  const estoque = linhasFunil.filter((l) => l.categoriaId === categoryId && l.aberto);
  const ganhosMes = linhasFunil.filter((l) => l.eventosNoMes.some((e) => Number(e.CATEGORY_ID) === categoryId && e.STAGE_SEMANTIC_ID === "S"));
  const perdasFinais = linhasFunil.filter((l) => l.categoriaId === categoryId && l.stageSemantica === "F");

  const nomeOuVazio = (l: LinhaComercial) => l.responsavelNome || "(sem responsável)";
  const universo = new Set<string>();
  for (const l of estoque) universo.add(nomeOuVazio(l));
  for (const l of ganhosMes) universo.add(nomeOuVazio(l));
  for (const l of perdasFinais) universo.add(nomeOuVazio(l));

  return [...universo].sort().map((nome) => {
    const carteira = estoque.filter((l) => nomeOuVazio(l) === nome);
    const trabalhados = carteira.filter((l) => l.alteracaoEfetivaNoMes);
    const ganhos = ganhosMes.filter((l) => nomeOuVazio(l) === nome).length;
    const perdas = perdasFinais.filter((l) => nomeOuVazio(l) === nome).length;
    const mudancasEtapa = carteira.reduce((acc, l) => acc + l.eventosNoMes.filter((e) => Number(e.CATEGORY_ID) === categoryId).length, 0);
    const atividades = carteira.reduce((acc, l) => acc + l.atividadesNoMes.length, 0);
    const ligacoes = carteira.reduce(
      (acc, l) => acc + l.atividadesNoMes.filter((a) => TYPE_ID_LIGACAO_NAO_CONFIRMADO.has(a.TYPE_ID)).length,
      0
    );
    const tarefas = carteira.reduce((acc, l) => acc + l.tarefasNoMes.length, 0);
    const vencidos = cardsComPrazoVencido(carteira, dataCorte);
    return {
      responsavel: nome,
      r1_carteiraAtual: carteira.length,
      r2_cardsTrabalhados: trabalhados.length,
      r3_coberturaTrabalhoPct: pct(trabalhados.length, carteira.length),
      r4_ganhosAtribuidos: ganhos,
      r5_perdasFinaisAtribuidas: perdas,
      r6_mudancasDeEtapa: mudancasEtapa,
      r7_atividadesRegistradas: atividades,
      r8_ligacoesRegistradas: ligacoes,
      r9_tarefasRegistradas: tarefas,
      r10_cardsVencidos: vencidos,
      r11_cardsSemTrabalho: carteira.length - trabalhados.length,
    };
  });
}

export function montarKpisComercial(linhas: LinhaComercial[], _historico: BitrixStageHistoryEvent[], competencia: string): KpisComercial {
  void _historico; // mantido na assinatura por simetria com o padrão de seguroFianca.ts; os eventos já vêm embutidos em cada LinhaComercial
  const dataCorte = new Date();

  // ---- Ativação ----
  const estoqueAtivacao = linhas.filter((l) => l.categoriaId === CATEGORY_ID_ATIVACAO && l.aberto);
  const estoqueAtivacaoComAlteracao = estoqueAtivacao.filter((l) => l.alteracaoEfetivaNoMes);
  const transferidasEsteMes = linhas.filter((l) => l.transferiuNesteMes);
  const a1Ids = new Set<number>([...estoqueAtivacaoComAlteracao.map((l) => l.id), ...transferidasEsteMes.map((l) => l.id)]);
  const a2 = estoqueAtivacao.length;
  const a3 = a2 - estoqueAtivacaoComAlteracao.length;

  // A4 = transferência definitiva pra Sucesso (nunca desfeita, regra 1.2) OU
  // encerramento como ganho AINDA vigente hoje dentro de Ativação. Exigimos
  // que o card continue no estado de ganho atualmente (categoriaId=1 &&
  // stageSemantica="S"), não só que o evento tenha ocorrido no mês --
  // simetria com A5, que já exclui perdas temporárias reabertas ("Um
  // movimento temporário para perda que foi reaberto não conta como perda
  // final"). Validado contra a amostra de agosto/2026: sem essa checagem de
  // estado atual, o card 1544 (ganho em C1:WON e reaberto 26s depois pra
  // C1:UC_1WXD0P, no mesmo dia) era contado como ativação concluída junto
  // com a transferência real do card 499, dando 2 em vez do 1 esperado.
  const a4Ids = new Set<number>();
  for (const l of linhas) {
    if (l.transferiuNesteMes) a4Ids.add(l.id);
    const ganhoDentroAtivacaoAindaVigente =
      l.categoriaId === CATEGORY_ID_ATIVACAO &&
      l.stageSemantica === "S" &&
      l.eventosNoMes.some((e) => Number(e.CATEGORY_ID) === CATEGORY_ID_ATIVACAO && e.STAGE_SEMANTIC_ID === "S");
    if (ganhoDentroAtivacaoAindaVigente) a4Ids.add(l.id);
  }
  const a4 = a4Ids.size;
  const a5 = linhas.filter((l) => l.categoriaId === CATEGORY_ID_ATIVACAO && l.stageSemantica === "F").length;
  const a6 = pct(a4, a1Ids.size);
  const a7amostra = a4 + a5;
  const a7 = a7amostra > 0 ? pct(a4, a7amostra) : null;

  const a10 = cardsComPrazoVencido(estoqueAtivacao, dataCorte);

  const a12Map = new Map<string, { carteiraAtual: number; cardsAlteradosNoMes: number }>();
  for (const l of estoqueAtivacao) {
    const nome = l.responsavelNome || "(sem responsável)";
    const atual = a12Map.get(nome) ?? { carteiraAtual: 0, cardsAlteradosNoMes: 0 };
    atual.carteiraAtual++;
    if (l.alteracaoEfetivaNoMes) atual.cardsAlteradosNoMes++;
    a12Map.set(nome, atual);
  }

  const ativacao: KpisComercial["ativacao"] = {
    a1_cardsTrabalhados: a1Ids.size,
    a2_estoqueAtual: a2,
    a3_semAlteracaoEfetiva: a3,
    a4_ativacoesConcluidas: a4,
    a5_perdasFinais: a5,
    a6_aproveitamentoMensalPct: a6,
    a7_taxaSucessoDesfechosPct: a7,
    a7_amostraDesfechos: a7amostra,
    a8_distribuicaoPorEtapa: distribuicaoPorEtapa(estoqueAtivacao, ETAPAS_ATIVACAO_ABERTAS, ETAPAS_ATIVACAO),
    a9_movimentosDeEtapa: calcularMovimentosEtapaAtivacao(linhas, competencia),
    a10_cardsComPrazoVencido: a10,
    a10_cardsComPrazoVencidoPct: pct(a10, a2),
    a11_coberturaValor: coberturaValor(estoqueAtivacao),
    a12_carteiraPorResponsavel: [...a12Map.entries()]
      .sort((x, y) => y[1].carteiraAtual - x[1].carteiraAtual)
      .map(([responsavel, d]) => ({ responsavel, ...d })),
  };

  // ---- Sucesso ----
  const estoqueSucesso = linhas.filter((l) => l.categoriaId === CATEGORY_ID_SUCESSO && l.aberto);
  const estoqueSucessoComAlteracao = estoqueSucesso.filter((l) => l.alteracaoEfetivaNoMes);
  const ganhosSucessoEsteMes = linhas.filter((l) => l.eventosNoMes.some((e) => Number(e.CATEGORY_ID) === CATEGORY_ID_SUCESSO && e.STAGE_SEMANTIC_ID === "S"));
  const s1Ids = new Set<number>([...estoqueSucessoComAlteracao.map((l) => l.id), ...ganhosSucessoEsteMes.map((l) => l.id)]);
  const s2 = estoqueSucesso.length;
  const s3 = s2 - estoqueSucessoComAlteracao.length;
  const s4 = ganhosSucessoEsteMes.length;
  // S5 conta EVENTOS (transições), não cards únicos -- um card pode ser
  // enviado pra perda mais de uma vez no mês.
  const s5 = linhas.reduce(
    (acc, l) => acc + l.eventosNoMes.filter((e) => Number(e.CATEGORY_ID) === CATEGORY_ID_SUCESSO && e.STAGE_SEMANTIC_ID === "F").length,
    0
  );
  const s6 = linhas.filter((l) => l.categoriaId === CATEGORY_ID_SUCESSO && l.stageSemantica === "F").length;
  const s7 = linhas.filter((l) => l.reabriuNesteMes).length;
  const s8 = pct(s4, s1Ids.size);
  const s9amostra = s4 + s6;
  const s9 = s9amostra > 0 ? pct(s4, s9amostra) : null;

  const s12 = cardsComPrazoVencido(estoqueSucesso, dataCorte);
  const s13 = estoqueSucesso.filter((l) => l.motivoEntradaId).length;

  const ganhosComValor = ganhosSucessoEsteMes.filter((l) => l.valor > 0).length;

  const s16Map = new Map<string, { cardsAtuaisMaisGanhos: number; cardsAlterados: number; ganhos: number }>();
  for (const l of estoqueSucesso) {
    const nome = l.responsavelNome || "(sem responsável)";
    const atual = s16Map.get(nome) ?? { cardsAtuaisMaisGanhos: 0, cardsAlterados: 0, ganhos: 0 };
    atual.cardsAtuaisMaisGanhos++;
    if (l.alteracaoEfetivaNoMes) atual.cardsAlterados++;
    s16Map.set(nome, atual);
  }
  for (const l of ganhosSucessoEsteMes) {
    const nome = l.responsavelNome || "(sem responsável)";
    const atual = s16Map.get(nome) ?? { cardsAtuaisMaisGanhos: 0, cardsAlterados: 0, ganhos: 0 };
    atual.cardsAtuaisMaisGanhos++;
    atual.ganhos++;
    s16Map.set(nome, atual);
  }

  const sucesso: KpisComercial["sucesso"] = {
    s1_cardsTrabalhados: s1Ids.size,
    s2_estoqueAtual: s2,
    s3_semAlteracaoEfetiva: s3,
    s4_ganhosDoMes: s4,
    s5_movimentosParaPerda: s5,
    s6_perdasFinais: s6,
    s7_cardsReabertos: s7,
    s8_aproveitamentoMensalPct: s8,
    s9_taxaSucessoDesfechosPct: s9,
    s9_amostraDesfechos: s9amostra,
    s10_distribuicaoPorEtapa: distribuicaoPorEtapa(estoqueSucesso, ETAPAS_SUCESSO_ABERTAS, ETAPAS_SUCESSO),
    s11_gargaloPorEtapaPct: distribuicaoPorEtapa(estoqueSucesso, ETAPAS_SUCESSO_ABERTAS, ETAPAS_SUCESSO).map((d) => ({
      etapa: d.etapa,
      pct: pct(d.cards, s2),
    })),
    s12_cardsComPrazoVencido: s12,
    s12_cardsComPrazoVencidoPct: pct(s12, s2),
    s13_motivoEntradaPreenchidoPct: pct(s13, s2),
    s14_coberturaValor: coberturaValor(estoqueSucesso),
    s15_ganhosComValorPreenchidoPct: pct(ganhosComValor, s4),
    s16_carteiraEResultadoPorResponsavel: [...s16Map.entries()]
      .sort((x, y) => y[1].cardsAtuaisMaisGanhos - x[1].cardsAtuaisMaisGanhos)
      .map(([responsavel, d]) => ({ responsavel, ...d })),
  };

  // ---- Por responsável (R1-R11), separado por funil ----
  const porResponsavel = {
    ativacao: calcularRegistrosResponsavel(linhas, CATEGORY_ID_ATIVACAO, competencia, dataCorte),
    sucesso: calcularRegistrosResponsavel(linhas, CATEGORY_ID_SUCESSO, competencia, dataCorte),
  };

  // ---- Qualidade / auditoria (Q1, Q3-Q6 -- Q2 fora de escopo, ver topo do arquivo) ----
  const qualidade: KpisComercial["qualidade"] = {
    q1_eventosDescartadosPorVisualizacao: 0, // ver limitação documentada no topo do arquivo
    q3_coberturaResponsavel: {
      ativacao: pct(estoqueAtivacao.filter((l) => l.responsavelId > 0).length, a2),
      sucesso: pct(estoqueSucesso.filter((l) => l.responsavelId > 0).length, s2),
    },
    q4_coberturaEmpresa: {
      ativacao: pct(estoqueAtivacao.filter((l) => l.empresaId > 0).length, a2),
      sucesso: pct(estoqueSucesso.filter((l) => l.empresaId > 0).length, s2),
    },
    q5_coberturaDataTermino: {
      ativacao: pct(estoqueAtivacao.filter((l) => l.dataTermino).length, a2),
      sucesso: pct(estoqueSucesso.filter((l) => l.dataTermino).length, s2),
    },
    q6_ultimaAtualizacao: dataCorte.toISOString(),
  };

  return { competencia, ativacao, sucesso, porResponsavel, qualidade };
}

// Busca ao vivo no Bitrix + monta os KPIs comerciais pra uma competência --
// paraleliza deals (2 funis), histórico, atividades, tarefas e definição de
// campos, depois resolve responsáveis/empresas referenciados antes de montar
// as linhas normalizadas. Mesmo padrão de buscarAnaliseGerencialAoVivo em
// seguroFianca.ts.
export async function buscarKpisComercialAoVivo(competencia: string): Promise<KpisComercial & { totalEventos: number }> {
  const [dealsAtivacao, dealsSucesso, historico, atividades, tarefas, definicaoCampos] = await Promise.all([
    listarDeals(CATEGORY_ID_ATIVACAO),
    listarDeals(CATEGORY_ID_SUCESSO),
    listarHistoricoEtapasDeal(),
    listarAtividades(),
    listarTarefas(),
    buscarDefinicaoCamposDeal(),
  ]);

  const deals = [...dealsAtivacao, ...dealsSucesso];
  const idsUsuario = deals.map((d) => Number(d.ASSIGNED_BY_ID)).filter((id) => id > 0);
  const idsEmpresa = deals.map((d) => Number(d.COMPANY_ID)).filter((id) => id > 0);
  const [nomesUsuarios, nomesEmpresas] = await Promise.all([buscarUsuarios(idsUsuario), buscarEmpresas(idsEmpresa)]);

  const linhas = montarLinhasComerciais(deals, historico, atividades, tarefas, definicaoCampos, nomesUsuarios, nomesEmpresas, competencia);
  const kpis = montarKpisComercial(linhas, historico, competencia);
  return { ...kpis, totalEventos: historico.length };
}
