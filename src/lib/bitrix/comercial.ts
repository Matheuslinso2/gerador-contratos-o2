// Modelagem de dados do painel Comercial, bloco "Sucesso do Cliente" --
// Deals padrão do Bitrix (crm.deal.*), categoria 0, não SPA. Mesmo espírito
// arquitetural de seguroFianca.ts (que lê um Smart Process via crm.item.*),
// mas a API e o formato de resposta do Bitrix são diferentes aqui:
// crm.deal.list e crm.activity.list devolvem `{result: [...array
// direto...]}`, não `{result: {items: [...]}}` como crm.item.list -- por
// isso usamos buscarTodasPaginasFlat (client.ts) em vez de
// buscarTodasPaginas (que espera o formato aninhado). O histórico de etapas
// (crm.stagehistory.list) usa o MESMO formato paginado de `{items:[...]}`
// que a SPA, então ali sim reusamos listarHistoricoEtapas de client.ts
// diretamente, só passando entityTypeId=2 (DEAL) em vez de 1042.
//
// O "cliente" da O2 aqui é a imobiliária parceira (COMPANY_ID), não o
// inquilino/segurado -- o funil rastreia o relacionamento comercial com
// essas imobiliárias, não o processo de uma apólice individual.
//
// 2026-09-16: o bloco "Ativação Novos Clientes" (categoria 1, KPIs A1-A12)
// foi REMOVIDO deste arquivo -- substituído pelo módulo "CRM Leads"
// (src/lib/bitrix/crmLeads.ts), baseado em Bitrix Leads (crm.lead.*) em vez
// de Deals, seguindo uma especificação nova trazida pelo usuário. Decisão
// dele, não uma depreciação técnica: o funil de Ativação em Deals categoria
// 1 continua existindo no Bitrix, só não é mais representado neste painel.
//
// Regras gerais pro bloco Sucesso (ver
// ESPECIFICACOES_KPIS_BITRIX_ATIVACAO_SUCESSO_AGOSTO_2026.md, seção 1, fonte
// de verdade pra toda fórmula usada abaixo):
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
// 1.2 Contagem única: cada card conta 1x por KPI de quantidade.
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

import "server-only";
import {
  buscarEmpresas,
  buscarTodasPaginasFlat,
  buscarUsuarios,
  chamarBitrix,
  listarHistoricoEtapas,
  type BitrixCampoEnum,
  type BitrixDefinicaoCampo,
  type BitrixStageHistoryEvent,
} from "./client";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const CATEGORY_ID_SUCESSO = 0;
export const ENTITY_TYPE_ID_DEAL = 2;

export const CAMPO_VALOR = "OPPORTUNITY";
export const CAMPO_DATA_TERMINO = "CLOSEDATE";
// Confirmado direto no Bitrix pelo usuário (2026-08-26): nome completo
// "Motivo da entrada em Ativ. e Sucesso" (nome abreviado do campo, tipo
// Lista, entidade Negócio) -- era só inferência por semântica das opções do
// enum até então, agora confirmado.
export const CAMPO_MOTIVO_ENTRADA = "UF_CRM_1784138667";

// Etapas confirmadas via crm.dealcategory.stage.list?id=0 ao vivo (última
// checagem: 2026-09-16, sem mudança desde 2026-09-08) -- inclui as 9 etapas
// do fluxo novo (Radar de Negócios...Reciclagem, confirmadas pelo usuário
// como válidas e não-legado) + as 13 etapas anteriores (também confirmadas
// como válidas, não legado) + os 3 estados de fechamento.
export const ETAPAS_SUCESSO: Record<string, string> = {
  NEW: "RADAR DE NEGÓCIOS",
  UC_L6RJ2U: "CONTATO EM ANDAMENTO",
  UC_G2AEBP: "ANÁLISE DESEMP. (PRÉ VISITA)",
  UC_QEBNPE: "VISITA/CALL",
  UC_A37BU6: "PÓS VISITA/CALL",
  UC_ZX9NXX: "OPORTUNIDADE COMERCIAL",
  UC_GT4DU8: "EM CAMPANHA",
  UC_ARK8G9: "RESULTADO GERADO",
  UC_I8X3YE: "AÇÃO FUTURA",
  UC_SWMRPW: "RECICLAGEM",
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
  "UC_L6RJ2U",
  "UC_G2AEBP",
  "UC_QEBNPE",
  "UC_A37BU6",
  "UC_ZX9NXX",
  "UC_GT4DU8",
  "UC_ARK8G9",
  "UC_I8X3YE",
  "UC_SWMRPW",
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
// Campos de Empresa usados nos indicadores novos do Sucesso do Cliente (Fase
// B, 2026-09-16) -- fonte: documentos "Dashboard_Prospeccao_e_Sucesso_*"
// trazidos pelo usuário. Confirmados ao vivo via crm.company.fields. Ficam
// na Empresa (COMPANY_ID), não no Deal, porque descrevem a imobiliária em
// si, não um card específico dela.
// ---------------------------------------------------------------------------

const CAMPO_EMPRESA_CLASSIFICACAO = "UF_CRM_1788465932551";
const CAMPO_EMPRESA_IMOVEIS_ADM = "UF_CRM_1788466044080"; // tipo string no Bitrix -- precisa parse
const CAMPO_EMPRESA_TICKET_MEDIO = "UF_CRM_1788466221752";
const CAMPO_EMPRESA_STATUS_CONTATO = "UF_CRM_1788467418002";
// O documento pede "Tipo(s) de oportunidade" como múltiplo (uma empresa em
// mais de um produto) -- o campo real no Bitrix é enumeration de valor
// único (isMultiple:false, confirmado ao vivo), sem opção "OUTROS" (só tem
// FIANÇA/INCÊNDIO/CAPITALIZAÇÃO/RENOVAÇÕES). Tratado aqui como single-value.
const CAMPO_EMPRESA_TIPO_OPORTUNIDADE = "UF_CRM_1788467738723";
const CAMPO_EMPRESA_NUM_COTACOES = "UF_CRM_O2_NUM_COTACOES";
const CAMPO_EMPRESA_NUM_APOLICES = "UF_CRM_1788467865683"; // tipo string no Bitrix -- precisa parse
const CAMPO_EMPRESA_COMISSAO_O2 = "UF_CRM_1788467885830"; // money
const CAMPO_EMPRESA_PREMIO_LIQUIDO = "UF_CRM_1788467919009"; // money

const CLASSIFICACOES_EMPRESA = [
  "COBRE (Menos de 10 imóveis - PF)",
  "BRONZE (1 a 29 imóveis)",
  "PRATA (30 A 60 imóveis)",
  "OURO (61 a 199 imóveis)",
  "DIAMANTE (200 a 499 imóveis)",
  "PLATINA (500 imóveis ou mais)",
];
const TICKETS_MEDIO_EMPRESA = ["ATÉ R$1.000,00", "R$:1.000,01 ATÉ 5.000,00", "R$: 5.000,01 ATÉ 10.000,00", "ACIMA DE R$: 10.000,00"];
const STATUS_CONTATO_EMPRESA = ["INICIAR CONTATO", "CONTATO EM ANDAMENTO", "SEM RETORNO", "TENTANDO CONTATO"];
const TIPOS_OPORTUNIDADE_EMPRESA = ["FIANÇA", "INCÊNDIO", "CAPITALIZAÇÃO", "RENOVAÇÕES"];

// "Radar de Negócios" até "Visita/Call", inclusive -- base do indicador
// "Total de card em andamento" (documento novo, item 2).
const ETAPAS_EM_ANDAMENTO = new Set(["NEW", "UC_L6RJ2U", "UC_G2AEBP", "UC_QEBNPE"]);

// ---------------------------------------------------------------------------
// Campos de Deal usados nos indicadores de tempo, Reciclagem e no card de
// detalhe do Sucesso do Cliente (Fase C, 2026-09-16) -- confirmados ao vivo
// via crm.deal.fields. Os 5 "Data de entrada" foram criados no Bitrix depois
// da Fase B (só Radar e Oportunidade existiam antes).
// ---------------------------------------------------------------------------

const CAMPO_DT_RADAR = "UF_CRM_O2_DT_RADAR";
const CAMPO_DT_CONTATO = "UF_CRM_O2_DT_CONTATO";
const CAMPO_DT_PREVISITA = "UF_CRM_O2_DT_PREVISITA";
const CAMPO_DT_OPORTUNIDADE = "UF_CRM_O2_DT_OPORTUNIDADE";
const CAMPO_DT_RESULTADO = "UF_CRM_O2_DT_RESULTADO";
const CAMPO_DT_PRIMEIRO_AGENDAMENTO = "UF_CRM_O2_DT_PRIM_AGEND";
const CAMPO_DT_REUNIAO_REALIZADA = "UF_CRM_6AA45191E7B9F";
const CAMPO_DT_REUNIAO_ATUAL = "UF_CRM_6AA45191D48C1";
const CAMPO_FORMATO_REUNIAO = "UF_CRM_6AA451914C752";
const CAMPO_STATUS_REUNIAO = "UF_CRM_6AA4519187ECF";
const CAMPO_MOTIVO_CANCELAMENTO = "UF_CRM_O2_MOT_CANCEL";
const CAMPO_ENDERECO_IMOBILIARIA = "UF_CRM_6AA4518ED969D";
const CAMPO_NOME_DECISOR_DEAL = "UF_CRM_6AA4518EEC984";
const CAMPO_CARGO_DECISOR = "UF_CRM_6AA4518E6DC30";
const CAMPO_PROXIMA_ACAO = "UF_CRM_6AA4518FA0FC9";
const CAMPO_RESPONSAVEL_PROXIMA_ACAO = "UF_CRM_6AA4518FDBD85";
const CAMPO_PRAZO_PROXIMA_ACAO = "UF_CRM_6AA4518FC8F34";
const CAMPO_PENDENCIA_PRINCIPAL = "UF_CRM_6AA4518FEEC79";
// "Motivo do Desinteresse/Desqualificação" -- campo real usado pra
// Reciclagem, mas as 8 opções não batem 100% com as do documento (ex: tem
// "Reciclagem (data da ação comercial programada)" em vez de "Impactar com
// marketing/contato futuro"). Usado como está, sem forçar pro texto do doc.
const CAMPO_MOTIVO_RECICLAGEM = "UF_CRM_1784731862";

const STAGE_ID_VISITA_CALL = "UC_QEBNPE";
const STAGE_ID_RECICLAGEM = "UC_SWMRPW";

const MOTIVOS_RECICLAGEM = [
  "Já possui parceiro/corretora de longa data/familiar ou amigo",
  "Questão de repasse",
  "Trabalha com (Loft, CredAluga, etc.)",
  "Baixo volume de locações",
  "Fora do perfil (vendas)",
  "É corretor de seguros",
  "Sem retorno/sem potencial",
  "Reciclagem (data da ação comercial programada)",
];

// ---------------------------------------------------------------------------
// Chamadas cruas ao Bitrix
// ---------------------------------------------------------------------------

// Deal bruto -- campos padrão usados pelo painel comercial + o UF de motivo
// de entrada. Index signature pra tolerar campos extras que o Bitrix sempre
// devolve mesmo sem pedir.
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
      CAMPO_MOTIVO_RECICLAGEM,
      CAMPO_DT_RADAR,
      CAMPO_DT_PRIMEIRO_AGENDAMENTO,
      CAMPO_DT_REUNIAO_REALIZADA,
    ],
  });
}

// crm.deal.fields devolve `{result: {...dict de campos direto...}}` --
// diferente de crm.item.fields, que aninha em `.result.fields`. Reusamos o
// tipo BitrixDefinicaoCampo de client.ts porque o formato de cada entrada
// (`{items: [{ID, VALUE}]}`) é o mesmo.
export async function buscarDefinicaoCamposDeal(): Promise<Record<string, BitrixDefinicaoCampo>> {
  const resposta = await chamarBitrix<{ result: Record<string, BitrixDefinicaoCampo> }>("crm.deal.fields", {});
  return resposta.result;
}

// crm.stagehistory.list tem o MESMO formato paginado `{items:[...]}` que a
// SPA usa -- listarHistoricoEtapas (client.ts) já é genérica por
// entityTypeId, então reusamos direto em vez de duplicar a lógica.
export async function listarHistoricoEtapasDeal(): Promise<BitrixStageHistoryEvent[]> {
  return listarHistoricoEtapas(ENTITY_TYPE_ID_DEAL);
}

export async function buscarDefinicaoCamposEmpresa(): Promise<Record<string, BitrixDefinicaoCampo>> {
  const resposta = await chamarBitrix<{ result: Record<string, BitrixDefinicaoCampo> }>("crm.company.fields", {});
  return resposta.result;
}

export type BitrixEmpresaCompletaRaw = { ID: string; [campo: string]: unknown };

// buscarEmpresas (client.ts) só devolve id→nome -- aqui precisamos dos
// campos UF_CRM_* da imobiliária pros indicadores novos do Sucesso (Fase B).
// Mesmo padrão de lote de 50 (limite do crm.company.list por página).
export async function buscarEmpresasCompletas(ids: number[]): Promise<Map<number, BitrixEmpresaCompletaRaw>> {
  const mapa = new Map<number, BitrixEmpresaCompletaRaw>();
  const idsUnicos = [...new Set(ids)].filter((id) => id > 0);
  if (!idsUnicos.length) return mapa;

  const campos = [
    "ID",
    CAMPO_EMPRESA_CLASSIFICACAO,
    CAMPO_EMPRESA_IMOVEIS_ADM,
    CAMPO_EMPRESA_TICKET_MEDIO,
    CAMPO_EMPRESA_STATUS_CONTATO,
    CAMPO_EMPRESA_TIPO_OPORTUNIDADE,
    CAMPO_EMPRESA_NUM_COTACOES,
    CAMPO_EMPRESA_NUM_APOLICES,
    CAMPO_EMPRESA_COMISSAO_O2,
    CAMPO_EMPRESA_PREMIO_LIQUIDO,
  ];
  const tamanhoLote = 50;
  for (let i = 0; i < idsUnicos.length; i += tamanhoLote) {
    const lote = idsUnicos.slice(i, i + tamanhoLote);
    const registros = await buscarTodasPaginasFlat<BitrixEmpresaCompletaRaw>("crm.company.list", {
      select: campos,
      "filter[ID]": lote,
    });
    for (const r of registros) mapa.set(Number(r.ID), r);
  }
  return mapa;
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
// crm.deal.list) -- confirmado ao vivo.
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
    const resposta = await chamarBitrix<{ result: { tasks?: BitrixTarefaRaw[] } | BitrixTarefaRaw[] }>("tasks.task.list", {
      select: ["ID", "UF_CRM_TASK", "CREATED_DATE", "CHANGED_DATE", "CLOSED_DATE"],
    });
    const resultado = resposta.result;
    if (Array.isArray(resultado)) return resultado;
    return resultado?.tasks ?? [];
  } catch (erro) {
    console.warn(
      "[bitrix/comercial] tasks.task.list indisponível (provável falta de escopo no webhook BITRIX_WEBHOOK_URL) -- seguindo sem dados de tarefas. KPI R9 (por responsável) fica zerado até essa pendência de infraestrutura ser resolvida.",
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
// batendo com a forma como o KPI S14 é descrito no documento (2 buckets: >0
// e =0, sem um terceiro bucket "não preenchido").
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
  categoriaId: number;
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
  motivoEntradaId: string; // valor bruto do enum, "" se vazio
  motivoEntradaNome: string;
  motivoReciclagemNome: string; // "" se vazio -- ver CAMPO_MOTIVO_RECICLAGEM
  dtRadar: string; // datetime ISO cru do campo, "" se vazio -- início do ciclo atual (não a criação do card)
  dtPrimeiroAgendamento: string;
  dtReuniaoRealizada: string;
  dataCriacao: string;
  dataModificacao: string;
  eventosOrdenados: BitrixStageHistoryEvent[];
  eventosNoMes: BitrixStageHistoryEvent[];
  atividadesNoMes: BitrixAtividadeRaw[];
  tarefasNoMes: BitrixTarefaRaw[];
  fontesAlteracaoEfetiva: string[]; // motivos que explicam alteracaoEfetivaNoMes -- ver regra 1.1
  alteracaoEfetivaNoMes: boolean;
  reabriuNesteMes: boolean; // fechamento (S/F) seguido de reabertura (P), com a reabertura neste mês
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
    const stageSemantica = deal.STAGE_SEMANTIC_ID || "P";
    const aberto = stageSemantica === "P";
    const responsavelId = Number(deal.ASSIGNED_BY_ID) || 0;
    const empresaId = Number(deal.COMPANY_ID) || 0;
    const etapaNome = ETAPAS_SUCESSO[deal.STAGE_ID] ?? deal.STAGE_ID;

    const eventosOrdenados = ordenarPorData(historicoPorCard.get(id) ?? []);
    const eventosNoMes = eventosOrdenados.filter((e) => noMes(e.CREATED_TIME, competencia));

    const todasAtividades = atividadesPorCard.get(id) ?? [];
    const atividadesNoMes = todasAtividades.filter((a) => noMes(a.CREATED, competencia) || noMes(a.LAST_UPDATED, competencia));

    const todasTarefas = tarefasPorCard.get(id) ?? [];
    const tarefasNoMes = todasTarefas.filter((t) => tarefaEmMes(t, competencia));

    // Reabertura: fechamento (S ou F) seguido de reabertura (P) na mesma
    // categoria, com a reabertura neste mês. Validado contra a amostra de
    // agosto/2026 (card 499 — Armênio).
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
      motivoReciclagemNome: enumLabel(definicaoCampos, CAMPO_MOTIVO_RECICLAGEM, deal[CAMPO_MOTIVO_RECICLAGEM]),
      dtRadar: deal[CAMPO_DT_RADAR] ? String(deal[CAMPO_DT_RADAR]) : "",
      dtPrimeiroAgendamento: deal[CAMPO_DT_PRIMEIRO_AGENDAMENTO] ? String(deal[CAMPO_DT_PRIMEIRO_AGENDAMENTO]) : "",
      dtReuniaoRealizada: deal[CAMPO_DT_REUNIAO_REALIZADA] ? String(deal[CAMPO_DT_REUNIAO_REALIZADA]) : "",
      dataCriacao: apenasData(deal.DATE_CREATE),
      dataModificacao: apenasData(deal.DATE_MODIFY),
      eventosOrdenados,
      eventosNoMes,
      atividadesNoMes,
      tarefasNoMes,
      fontesAlteracaoEfetiva,
      alteracaoEfetivaNoMes: fontesAlteracaoEfetiva.length > 0,
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
    empresas: ResumoEmpresasSucesso;
    tempos: TemposEntreEtapas;
    reciclagem: ReciclagemResumo;
    negocioEncerrado: NegocioEncerradoResumo;
    empresasAtivas: EmpresaAtiva[];
  };
  porResponsavel: RegistroResponsavel[];
  qualidade: {
    q1_eventosDescartadosPorVisualizacao: number; // sempre 0 -- ver limitação documentada no topo do arquivo
    q3_coberturaResponsavelPct: number;
    q4_coberturaEmpresaPct: number;
    q5_coberturaDataTerminoPct: number;
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

function calcularRegistrosResponsavel(linhasFunil: LinhaComercial[], competencia: string, dataCorte: Date): RegistroResponsavel[] {
  const estoque = linhasFunil.filter((l) => l.categoriaId === CATEGORY_ID_SUCESSO && l.aberto);
  const ganhosMes = linhasFunil.filter((l) => l.eventosNoMes.some((e) => Number(e.CATEGORY_ID) === CATEGORY_ID_SUCESSO && e.STAGE_SEMANTIC_ID === "S"));
  const perdasFinais = linhasFunil.filter((l) => l.categoriaId === CATEGORY_ID_SUCESSO && l.stageSemantica === "F");

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
    const mudancasEtapa = carteira.reduce(
      (acc, l) => acc + l.eventosNoMes.filter((e) => Number(e.CATEGORY_ID) === CATEGORY_ID_SUCESSO).length,
      0
    );
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

// ---------------------------------------------------------------------------
// Empresas do Sucesso do Cliente (Fase B) -- indicadores que vêm do card da
// EMPRESA, não do Deal (o documento é explícito sobre isso: "Classificação,
// Imóveis ADM, Ticket médio e Status de contatos vêm do card da empresa").
// ---------------------------------------------------------------------------

export type Contagem = { rotulo: string; quantidade: number };

export type ResumoEmpresasSucesso = {
  totalCardsEmAndamento: number; // Radar de Negócios..Visita/Call, inclusive
  classificacao: Contagem[];
  mediaImoveisAdm: number | null; // null se nenhuma empresa do estoque tem o campo preenchido
  imoveisAdmAmostra: number;
  ticketMedio: Contagem[];
  statusContato: Contagem[];
  tipoOportunidade: Contagem[]; // campo real é valor único, não múltiplo como o documento pede -- ver nota em CAMPO_EMPRESA_TIPO_OPORTUNIDADE
  resultadoFinanceiro: { numCotacoes: number; numApolices: number; comissaoO2: number; premioLiquido: number };
};

// OPPORTUNITY e os campos "money" de Empresa usam o mesmo formato
// "123.45|BRL" do Bitrix -- mesma lógica de valorNumero, duplicada aqui
// porque semanticamente é sobre Empresa, não sobre o Deal.
function valorMonetarioEmpresa(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const [num] = String(v).split("|");
  const n = Number(num);
  return Number.isFinite(n) ? n : 0;
}

function inteiroOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Sempre lista todas as opções conhecidas do campo (mesmo com contagem 0),
// mais "Não informado" pro que está vazio -- mesmo espírito do documento
// ("campos vazios não comprovam ausência de trabalho", nunca omitir a
// opção, só mostrar 0 quando for o caso real).
function contarPorEnum(valores: string[], opcoesConhecidas: string[]): Contagem[] {
  const contagem = new Map<string, number>();
  for (const v of valores) {
    const rotulo = v || "Não informado";
    contagem.set(rotulo, (contagem.get(rotulo) ?? 0) + 1);
  }
  return [...opcoesConhecidas, "Não informado"].map((rotulo) => ({ rotulo, quantidade: contagem.get(rotulo) ?? 0 }));
}

export function montarResumoEmpresasSucesso(
  estoqueSucesso: LinhaComercial[],
  empresasCompletas: Map<number, BitrixEmpresaCompletaRaw>,
  definicaoCamposEmpresa: Record<string, BitrixDefinicaoCampo>
): ResumoEmpresasSucesso {
  const totalCardsEmAndamento = estoqueSucesso.filter((l) => ETAPAS_EM_ANDAMENTO.has(l.stageId)).length;

  // Uma linha por EMPRESA, não por card -- "resultado gerado no sucesso
  // considera somente empresas com card ativo... somar cada empresa uma
  // vez" (regra do documento). Amostra ao vivo (2026-09-16): nenhuma
  // empresa tem 2+ deals ativos em Sucesso hoje, mas se algum dia tiver, o
  // documento não define critério de desempate -- usamos o primeiro card
  // encontrado, sem tentar adivinhar qual é "o certo".
  const empresaIdsUnicos = [...new Set(estoqueSucesso.map((l) => l.empresaId).filter((id) => id > 0))];

  const classificacoes: string[] = [];
  const ticketMedios: string[] = [];
  const statusContatos: string[] = [];
  const tiposOportunidade: string[] = [];
  const imoveisAdm: number[] = [];
  let numCotacoes = 0;
  let numApolices = 0;
  let comissaoO2 = 0;
  let premioLiquido = 0;

  for (const empresaId of empresaIdsUnicos) {
    const e = empresasCompletas.get(empresaId);
    if (!e) continue;
    classificacoes.push(enumLabel(definicaoCamposEmpresa, CAMPO_EMPRESA_CLASSIFICACAO, e[CAMPO_EMPRESA_CLASSIFICACAO]));
    ticketMedios.push(enumLabel(definicaoCamposEmpresa, CAMPO_EMPRESA_TICKET_MEDIO, e[CAMPO_EMPRESA_TICKET_MEDIO]));
    statusContatos.push(enumLabel(definicaoCamposEmpresa, CAMPO_EMPRESA_STATUS_CONTATO, e[CAMPO_EMPRESA_STATUS_CONTATO]));
    tiposOportunidade.push(enumLabel(definicaoCamposEmpresa, CAMPO_EMPRESA_TIPO_OPORTUNIDADE, e[CAMPO_EMPRESA_TIPO_OPORTUNIDADE]));
    const imoveis = inteiroOuNull(e[CAMPO_EMPRESA_IMOVEIS_ADM]);
    if (imoveis !== null) imoveisAdm.push(imoveis);
    numCotacoes += inteiroOuNull(e[CAMPO_EMPRESA_NUM_COTACOES]) ?? 0;
    numApolices += inteiroOuNull(e[CAMPO_EMPRESA_NUM_APOLICES]) ?? 0;
    comissaoO2 += valorMonetarioEmpresa(e[CAMPO_EMPRESA_COMISSAO_O2]);
    premioLiquido += valorMonetarioEmpresa(e[CAMPO_EMPRESA_PREMIO_LIQUIDO]);
  }

  return {
    totalCardsEmAndamento,
    classificacao: contarPorEnum(classificacoes, CLASSIFICACOES_EMPRESA),
    mediaImoveisAdm: imoveisAdm.length ? Math.round((imoveisAdm.reduce((a, b) => a + b, 0) / imoveisAdm.length) * 10) / 10 : null,
    imoveisAdmAmostra: imoveisAdm.length,
    ticketMedio: contarPorEnum(ticketMedios, TICKETS_MEDIO_EMPRESA),
    statusContato: contarPorEnum(statusContatos, STATUS_CONTATO_EMPRESA),
    tipoOportunidade: contarPorEnum(tiposOportunidade, TIPOS_OPORTUNIDADE_EMPRESA),
    resultadoFinanceiro: { numCotacoes, numApolices, comissaoO2, premioLiquido },
  };
}

// ---------------------------------------------------------------------------
// Tempos entre etapas, Reciclagem e Negócio encerrado (Fase C) --
// indicadores 8 (tempos), 9/9.1 (Reciclagem) e 10 (Negócio encerrado) do
// documento novo.
// ---------------------------------------------------------------------------

export type MediaDias = { mediaDias: number | null; amostra: number };
export type TemposEntreEtapas = {
  radarAteVisitaCall: MediaDias;
  agendamentoAteRealizacao: MediaDias;
  radarAteRealizacao: MediaDias;
};

function diasEntre(inicioIso: string, fimIso: string): number | null {
  const inicio = new Date(inicioIso).getTime();
  const fim = new Date(fimIso).getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim < inicio) return null;
  return Math.round((fim - inicio) / 86400000);
}

function media(valores: number[]): number | null {
  return valores.length ? Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10 : null;
}

// Escopo: TODOS os cards de Sucesso (abertos e fechados), não só o estoque
// atual -- é um indicador de velocidade operacional, um card que já fechou
// não deixou de ter passado por essas etapas. "Somente com datas completas"
// (regra do documento): cards sem as duas datas do par simplesmente não
// entram na média, sem contar como 0.
function calcularTemposEntreEtapas(linhasSucesso: LinhaComercial[]): TemposEntreEtapas {
  const radarVisita: number[] = [];
  const agendRealiz: number[] = [];
  const radarRealiz: number[] = [];
  for (const l of linhasSucesso) {
    const entradaVisitaCall = l.eventosOrdenados.find((e) => e.STAGE_ID === STAGE_ID_VISITA_CALL)?.CREATED_TIME;
    if (l.dtRadar && entradaVisitaCall) {
      const d = diasEntre(l.dtRadar, entradaVisitaCall);
      if (d !== null) radarVisita.push(d);
    }
    if (l.dtPrimeiroAgendamento && l.dtReuniaoRealizada) {
      const d = diasEntre(l.dtPrimeiroAgendamento, l.dtReuniaoRealizada);
      if (d !== null) agendRealiz.push(d);
    }
    if (l.dtRadar && l.dtReuniaoRealizada) {
      const d = diasEntre(l.dtRadar, l.dtReuniaoRealizada);
      if (d !== null) radarRealiz.push(d);
    }
  }
  return {
    radarAteVisitaCall: { mediaDias: media(radarVisita), amostra: radarVisita.length },
    agendamentoAteRealizacao: { mediaDias: media(agendRealiz), amostra: agendRealiz.length },
    radarAteRealizacao: { mediaDias: media(radarRealiz), amostra: radarRealiz.length },
  };
}

export type ReciclagemResumo = {
  empresas: { dealId: number; empresaNome: string; responsavelNome: string; motivo: string }[];
  porMotivo: Contagem[];
};

function montarResumoReciclagem(estoqueSucesso: LinhaComercial[]): ReciclagemResumo {
  const emReciclagem = estoqueSucesso.filter((l) => l.stageId === STAGE_ID_RECICLAGEM);
  return {
    empresas: emReciclagem.map((l) => ({
      dealId: l.id,
      empresaNome: l.empresaNome,
      responsavelNome: l.responsavelNome,
      motivo: l.motivoReciclagemNome || "Não informado",
    })),
    porMotivo: contarPorEnum(
      emReciclagem.map((l) => l.motivoReciclagemNome),
      MOTIVOS_RECICLAGEM
    ),
  };
}

export type NegocioEncerradoResumo = { totalNoMes: number; porEstado: Contagem[] };

// O documento pede 4 categorias (EM PRODUÇÃO/DECLINADO/CONTRATOU/CANCELADO)
// -- não existe campo nenhum no Bitrix com essa classificação (procurado em
// todos os campos de Deal, nenhuma opção bate). Usa os 3 estados REAIS de
// fechamento do funil (Ganho Fechado/Perda Fechada/Analisar falha) em vez
// de inventar um mapeamento pras 4 categorias do documento.
function montarResumoNegocioEncerrado(linhasSucesso: LinhaComercial[]): NegocioEncerradoResumo {
  const encerradosNoMes = linhasSucesso.filter(
    (l) => (l.stageSemantica === "S" || l.stageSemantica === "F") && l.eventosNoMes.some((e) => e.STAGE_SEMANTIC_ID === "S" || e.STAGE_SEMANTIC_ID === "F")
  );
  const rotulos = ["Ganho Fechado", "Perda Fechada", "Analisar falha"];
  return {
    totalNoMes: encerradosNoMes.length,
    porEstado: rotulos.map((rotulo) => ({ rotulo, quantidade: encerradosNoMes.filter((l) => ETAPAS_SUCESSO[l.stageId] === rotulo).length })),
  };
}

export type EmpresaAtiva = { dealId: number; empresaNome: string; responsavelNome: string; etapaNome: string };

function montarEmpresasAtivas(estoqueSucesso: LinhaComercial[]): EmpresaAtiva[] {
  return [...estoqueSucesso]
    .sort((a, b) => ORDEM_ETAPAS_SUCESSO.indexOf(a.stageId) - ORDEM_ETAPAS_SUCESSO.indexOf(b.stageId) || a.empresaNome.localeCompare(b.empresaNome))
    .map((l) => ({ dealId: l.id, empresaNome: l.empresaNome, responsavelNome: l.responsavelNome, etapaNome: l.etapaNome }));
}

export function montarKpisComercial(
  linhas: LinhaComercial[],
  _historico: BitrixStageHistoryEvent[],
  competencia: string,
  empresasCompletas: Map<number, BitrixEmpresaCompletaRaw> = new Map(),
  definicaoCamposEmpresa: Record<string, BitrixDefinicaoCampo> = {}
): KpisComercial {
  void _historico; // mantido na assinatura por simetria com o padrão de seguroFianca.ts; os eventos já vêm embutidos em cada LinhaComercial
  const dataCorte = new Date();

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
    empresas: montarResumoEmpresasSucesso(estoqueSucesso, empresasCompletas, definicaoCamposEmpresa),
    tempos: calcularTemposEntreEtapas(linhas.filter((l) => l.categoriaId === CATEGORY_ID_SUCESSO)),
    reciclagem: montarResumoReciclagem(estoqueSucesso),
    negocioEncerrado: montarResumoNegocioEncerrado(linhas.filter((l) => l.categoriaId === CATEGORY_ID_SUCESSO)),
    empresasAtivas: montarEmpresasAtivas(estoqueSucesso),
  };

  const porResponsavel = calcularRegistrosResponsavel(linhas, competencia, dataCorte);

  // ---- Qualidade / auditoria (Q1, Q3-Q6 -- Q2 fora de escopo, ver topo do arquivo) ----
  const qualidade: KpisComercial["qualidade"] = {
    q1_eventosDescartadosPorVisualizacao: 0, // ver limitação documentada no topo do arquivo
    q3_coberturaResponsavelPct: pct(estoqueSucesso.filter((l) => l.responsavelId > 0).length, s2),
    q4_coberturaEmpresaPct: pct(estoqueSucesso.filter((l) => l.empresaId > 0).length, s2),
    q5_coberturaDataTerminoPct: pct(estoqueSucesso.filter((l) => l.dataTermino).length, s2),
    q6_ultimaAtualizacao: dataCorte.toISOString(),
  };

  return { competencia, sucesso, porResponsavel, qualidade };
}

// Busca ao vivo no Bitrix + monta os KPIs comerciais (Sucesso do Cliente)
// pra uma competência -- paraleliza deals, histórico, atividades, tarefas e
// definição de campos, depois resolve responsáveis/empresas referenciados
// antes de montar as linhas normalizadas. Mesmo padrão de
// buscarAnaliseGerencialAoVivo em seguroFianca.ts.
export async function buscarKpisComercialAoVivo(competencia: string): Promise<KpisComercial & { totalEventos: number }> {
  const [deals, historico, atividades, tarefas, definicaoCampos, definicaoCamposEmpresa] = await Promise.all([
    listarDeals(CATEGORY_ID_SUCESSO),
    listarHistoricoEtapasDeal(),
    listarAtividades(),
    listarTarefas(),
    buscarDefinicaoCamposDeal(),
    buscarDefinicaoCamposEmpresa(),
  ]);

  const idsUsuario = deals.map((d) => Number(d.ASSIGNED_BY_ID)).filter((id) => id > 0);
  const idsEmpresa = deals.map((d) => Number(d.COMPANY_ID)).filter((id) => id > 0);
  const [nomesUsuarios, nomesEmpresas, empresasCompletas] = await Promise.all([
    buscarUsuarios(idsUsuario),
    buscarEmpresas(idsEmpresa),
    buscarEmpresasCompletas(idsEmpresa),
  ]);

  const linhas = montarLinhasComerciais(deals, historico, atividades, tarefas, definicaoCampos, nomesUsuarios, nomesEmpresas, competencia);
  const kpis = montarKpisComercial(linhas, historico, competencia, empresasCompletas, definicaoCamposEmpresa);
  return { ...kpis, totalEventos: historico.length };
}

// ---------------------------------------------------------------------------
// Card de detalhe da empresa (Fase C) -- tela "Card da empresa" do
// documento, só leitura (decisão do usuário: não escreve de volta no
// Bitrix nesta fase). Busca um único Deal + sua Empresa, com todos os
// campos relevantes pra tela, não só os agregados do dashboard.
// ---------------------------------------------------------------------------

export type DetalheCardSucesso = {
  deal: {
    id: number;
    titulo: string;
    etapaNome: string;
    responsavelNome: string;
    enderecoImobiliaria: string;
    nomeDecisor: string;
    cargoDecisor: string;
    formatoReuniao: string;
    statusReuniao: string;
    dataReuniaoAtual: string;
    motivoCancelamento: string;
    dataReuniaoRealizada: string;
    dataPrimeiroAgendamento: string;
    dtRadar: string;
    dtContato: string;
    dtPrevisita: string;
    dtOportunidade: string;
    dtResultado: string;
    proximaAcao: string;
    responsavelProximaAcao: string;
    prazoProximaAcao: string;
    pendenciaPrincipal: string;
    valor: number;
    dataTermino: string;
    motivoEntradaNome: string;
    motivoReciclagemNome: string;
  };
  empresa: {
    id: number;
    nome: string;
    classificacao: string;
    imoveisAdm: number | null;
    ticketMedio: string;
    statusContato: string;
    tipoOportunidade: string;
    numCotacoes: number | null;
    numApolices: number | null;
    comissaoO2: number;
    premioLiquido: number;
  } | null;
};

export async function buscarDetalheCardSucesso(dealId: number): Promise<DetalheCardSucesso | null> {
  const [dealResp, definicaoCampos] = await Promise.all([
    chamarBitrix<{ result: BitrixDealRaw }>("crm.deal.get", { id: dealId }),
    buscarDefinicaoCamposDeal(),
  ]);
  const deal = dealResp.result;
  if (!deal || Number(deal.CATEGORY_ID) !== CATEGORY_ID_SUCESSO) return null;

  const empresaId = Number(deal.COMPANY_ID) || 0;
  const responsavelId = Number(deal.ASSIGNED_BY_ID) || 0;
  const responsavelProximaAcaoId = Number(deal[CAMPO_RESPONSAVEL_PROXIMA_ACAO]) || 0;
  const idsUsuario = [responsavelId, responsavelProximaAcaoId].filter((id) => id > 0);

  const [nomesUsuarios, empresasCompletas, nomesEmpresas, definicaoCamposEmpresa] = await Promise.all([
    buscarUsuarios(idsUsuario),
    buscarEmpresasCompletas([empresaId]),
    buscarEmpresas([empresaId]),
    buscarDefinicaoCamposEmpresa(),
  ]);
  const empresaRaw = empresasCompletas.get(empresaId);

  return {
    deal: {
      id: Number(deal.ID),
      titulo: deal.TITLE,
      etapaNome: ETAPAS_SUCESSO[deal.STAGE_ID] ?? deal.STAGE_ID,
      responsavelNome: nomeUsuario(nomesUsuarios, responsavelId),
      enderecoImobiliaria: String(deal[CAMPO_ENDERECO_IMOBILIARIA] ?? ""),
      nomeDecisor: String(deal[CAMPO_NOME_DECISOR_DEAL] ?? ""),
      cargoDecisor: enumLabel(definicaoCampos, CAMPO_CARGO_DECISOR, deal[CAMPO_CARGO_DECISOR]),
      formatoReuniao: enumLabel(definicaoCampos, CAMPO_FORMATO_REUNIAO, deal[CAMPO_FORMATO_REUNIAO]),
      statusReuniao: enumLabel(definicaoCampos, CAMPO_STATUS_REUNIAO, deal[CAMPO_STATUS_REUNIAO]),
      dataReuniaoAtual: String(deal[CAMPO_DT_REUNIAO_ATUAL] ?? ""),
      motivoCancelamento: enumLabel(definicaoCampos, CAMPO_MOTIVO_CANCELAMENTO, deal[CAMPO_MOTIVO_CANCELAMENTO]),
      dataReuniaoRealizada: String(deal[CAMPO_DT_REUNIAO_REALIZADA] ?? ""),
      dataPrimeiroAgendamento: apenasData(deal[CAMPO_DT_PRIMEIRO_AGENDAMENTO]),
      dtRadar: apenasData(deal[CAMPO_DT_RADAR]),
      dtContato: apenasData(deal[CAMPO_DT_CONTATO]),
      dtPrevisita: apenasData(deal[CAMPO_DT_PREVISITA]),
      dtOportunidade: apenasData(deal[CAMPO_DT_OPORTUNIDADE]),
      dtResultado: apenasData(deal[CAMPO_DT_RESULTADO]),
      proximaAcao: enumLabel(definicaoCampos, CAMPO_PROXIMA_ACAO, deal[CAMPO_PROXIMA_ACAO]),
      responsavelProximaAcao: nomeUsuario(nomesUsuarios, responsavelProximaAcaoId),
      prazoProximaAcao: String(deal[CAMPO_PRAZO_PROXIMA_ACAO] ?? ""),
      pendenciaPrincipal: String(deal[CAMPO_PENDENCIA_PRINCIPAL] ?? ""),
      valor: valorNumero(deal[CAMPO_VALOR]),
      dataTermino: apenasData(deal[CAMPO_DATA_TERMINO]),
      motivoEntradaNome: enumLabel(definicaoCampos, CAMPO_MOTIVO_ENTRADA, deal[CAMPO_MOTIVO_ENTRADA]),
      motivoReciclagemNome: enumLabel(definicaoCampos, CAMPO_MOTIVO_RECICLAGEM, deal[CAMPO_MOTIVO_RECICLAGEM]),
    },
    empresa: empresaRaw
      ? {
          id: empresaId,
          nome: nomesEmpresas[empresaId] || `ID ${empresaId}`,
          classificacao: enumLabel(definicaoCamposEmpresa, CAMPO_EMPRESA_CLASSIFICACAO, empresaRaw[CAMPO_EMPRESA_CLASSIFICACAO]),
          imoveisAdm: inteiroOuNull(empresaRaw[CAMPO_EMPRESA_IMOVEIS_ADM]),
          ticketMedio: enumLabel(definicaoCamposEmpresa, CAMPO_EMPRESA_TICKET_MEDIO, empresaRaw[CAMPO_EMPRESA_TICKET_MEDIO]),
          statusContato: enumLabel(definicaoCamposEmpresa, CAMPO_EMPRESA_STATUS_CONTATO, empresaRaw[CAMPO_EMPRESA_STATUS_CONTATO]),
          tipoOportunidade: enumLabel(definicaoCamposEmpresa, CAMPO_EMPRESA_TIPO_OPORTUNIDADE, empresaRaw[CAMPO_EMPRESA_TIPO_OPORTUNIDADE]),
          numCotacoes: inteiroOuNull(empresaRaw[CAMPO_EMPRESA_NUM_COTACOES]),
          numApolices: inteiroOuNull(empresaRaw[CAMPO_EMPRESA_NUM_APOLICES]),
          comissaoO2: valorMonetarioEmpresa(empresaRaw[CAMPO_EMPRESA_COMISSAO_O2]),
          premioLiquido: valorMonetarioEmpresa(empresaRaw[CAMPO_EMPRESA_PREMIO_LIQUIDO]),
        }
      : null,
  };
}
