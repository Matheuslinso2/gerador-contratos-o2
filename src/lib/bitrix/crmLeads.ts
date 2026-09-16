// Modelagem de dados do bloco "CRM Leads" do painel Comercial -- Bitrix
// LEADS (crm.lead.*), não Deals. Substitui o antigo bloco "Ativação Novos
// Clientes" (que era Deal categoria 1, removido de comercial.ts em
// 2026-09-16) por decisão do usuário: essa etapa do funil comercial passou
// a ser rastreada em Leads no Bitrix, não mais em Deals.
//
// Fonte da especificação: dois documentos trazidos pelo usuário
// (Dashboard_Prospeccao_e_Sucesso_Autoexplicativo.docx e
// Dashboard_Prospeccao_e_Sucesso_Prompt_IA.docx) -- na prática o prompt +
// código-fonte de um protótipo estático já gerado por outra IA, com uma
// fotografia congelada de Leads reais de 10/09/2026 e a lógica de
// classificação embutida em JavaScript. Este arquivo reproduz essa MESMA
// lógica de classificação, mas buscando dado ao vivo em vez de usar o
// array congelado do protótipo.
//
// Diferente do bloco Sucesso (comercial.ts), CRM Leads NÃO tem conceito de
// competência/mês -- é sempre uma fotografia do estado atual (documento:
// "painel de acompanhamento", não histórico mensal). Por isso
// buscarLeadsAoVivo() não recebe parâmetro de competência e não é salvo em
// snapshot no Supabase.
//
// Escopo assumido (não confirmado explicitamente pelo usuário, só inferido
// do protótipo): o filtro de responsável do documento lista só 3 pessoas
// (Vanessa Fochi, Henrique Pereira Guterres, Dayane Lima) -- a query abaixo
// já filtra os Leads por esses 3 IDs de responsável em vez de trazer todo o
// funil de Leads do portal (que tem milhares de registros de outros
// contextos). Se o time de prospecção mudar, esses IDs precisam ser
// atualizados aqui.

import "server-only";
import { buscarTodasPaginasFlat, buscarUsuarios, chamarBitrix, type BitrixDefinicaoCampo, type BitrixCampoEnum } from "./client";
import { ENTITY_TYPE_ID_LEAD, gerarLinkCard } from "./entidadesCard";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

// Confirmado ao vivo via crm.status.list?filter[ENTITY_ID]=STATUS (2026-09-16).
export const ETAPAS_LEAD: Record<string, string> = {
  NEW: "1. NOVO LEAD / ENRIQUECIMENTO | DAYANE",
  UC_N8ETQN: "2. EMAIL INICIAL.+TOMAD. DE DECISÃO",
  UC_KGCI58: "3. LIGAÇÃO (ATÉ 7 DIAS)",
  UC_3UHNFO: "4. RETOMADA PROGRAMADA",
  UC_QZ9OF8: "6. CALL OU VISITA AGENDADA",
  UC_2XNYOR: "7. REUNIÃO REALIZADA / DIAGNÓSTICO",
  UC_WJ48PO: "9. E-MAILS PADRÃO | PRODUTOS + COMISSÕES",
  UC_9RFDW0: "10. ATIVIÇÃO EM ANDAM.",
  UC_0DHSFN: "11. CADASTRO COMPLETO",
  UC_Q5TX86: "12.PRIMEIRA EMISSÃO/APÓLICE",
  CONVERTED: "PRODUÇÃO / PARCEIRO ATIVADO",
  JUNK: "ENCERRADO SEM ATIVAÇÃO",
};
const ORDEM_ETAPAS_LEAD_ABERTAS = ["NEW", "UC_N8ETQN", "UC_KGCI58", "UC_3UHNFO", "UC_QZ9OF8", "UC_2XNYOR", "UC_WJ48PO", "UC_9RFDW0", "UC_0DHSFN", "UC_Q5TX86"];

// IDs Bitrix confirmados ao vivo (user.get) -- ver nota de escopo no topo do arquivo.
export const RESPONSAVEIS_LEAD: { id: number; nome: string }[] = [
  { id: 11, nome: "Vanessa Fochi" },
  { id: 35, nome: "Henrique Pereira Guterres" },
  { id: 210, nome: "Dayane Lima" },
];

// Campos custom confirmados ao vivo via crm.lead.fields (2026-09-16, prefixo
// UF_CRM_O2_* = criados especificamente pra esse painel).
const CAMPO_DECISOR = "UF_CRM_O2_NOME_DECISOR";
const CAMPO_EMAIL_INICIAL_STATUS = "UF_CRM_O2_EMAIL_INICIAL_STATUS";
const CAMPO_CAD_STATUS = "UF_CRM_O2_CAD_STATUS";
const CAMPO_CAMINHO = "UF_CRM_O2_CAMINHO";

export const CAMINHOS_LEAD = ["A — Cotação + cadastro", "B — Plataforma + cadastro", "C — Cotação sem cadastro", "Em definição", "Não informado"] as const;

// ---------------------------------------------------------------------------
// Chamadas cruas ao Bitrix
// ---------------------------------------------------------------------------

export type BitrixLeadRaw = {
  ID: string;
  TITLE: string;
  STATUS_ID: string;
  STATUS_SEMANTIC_ID: string;
  ASSIGNED_BY_ID: string;
  [campo: string]: unknown;
};

export async function listarLeads(): Promise<BitrixLeadRaw[]> {
  return buscarTodasPaginasFlat<BitrixLeadRaw>("crm.lead.list", {
    "filter[ASSIGNED_BY_ID]": RESPONSAVEIS_LEAD.map((r) => r.id),
    "filter[STATUS_SEMANTIC_ID]": "P", // só leads abertos -- os "31 ativos" do documento
    select: ["ID", "TITLE", "STATUS_ID", "STATUS_SEMANTIC_ID", "ASSIGNED_BY_ID", CAMPO_DECISOR, CAMPO_EMAIL_INICIAL_STATUS, CAMPO_CAD_STATUS, CAMPO_CAMINHO],
  });
}

export type BitrixAtividadeLeadRaw = {
  ID: string;
  OWNER_ID: string;
  COMPLETED: "Y" | "N";
  DEADLINE: string | null;
  SUBJECT: string;
};

// O portal tem ~16 mil atividades de Lead no total (todas as épocas, todos
// os responsáveis) -- paginar tudo seria lento e a maioria é irrelevante
// pra esse painel. Filtramos direto pelos IDs dos leads abertos (a lista já
// é pequena, ~30-50) e por COMPLETED=N: só atividades em aberto entram na
// classificação de prioridade (ver classificarPrioridade), então nem vale
// buscar as concluídas.
export async function listarAtividadesLead(leadIds: number[]): Promise<BitrixAtividadeLeadRaw[]> {
  if (!leadIds.length) return [];
  return buscarTodasPaginasFlat<BitrixAtividadeLeadRaw>("crm.activity.list", {
    "filter[OWNER_TYPE_ID]": ENTITY_TYPE_ID_LEAD,
    "filter[OWNER_ID]": leadIds,
    "filter[COMPLETED]": "N",
    select: ["ID", "OWNER_ID", "COMPLETED", "DEADLINE", "SUBJECT"],
  });
}

export async function buscarDefinicaoCamposLead(): Promise<Record<string, BitrixDefinicaoCampo>> {
  const resposta = await chamarBitrix<{ result: Record<string, BitrixDefinicaoCampo> }>("crm.lead.fields", {});
  return resposta.result;
}

// ---------------------------------------------------------------------------
// Normalização por lead
// ---------------------------------------------------------------------------

function enumLabel(defs: Record<string, BitrixDefinicaoCampo>, campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "";
  const item = defs[campo]?.items?.find((i: BitrixCampoEnum) => i.ID === String(valor));
  return item ? item.VALUE : String(valor);
}

export type LinhaLead = {
  id: number;
  nome: string;
  link: string;
  responsavelId: number;
  responsavelNome: string;
  stageId: string;
  etapaNome: string;
  // Prioridade 1 = tem atividade aberta com prazo vencido; 2 = sem vencida e
  // sem atividade futura com prazo; 3 = sem vencida e com atividade futura
  // agendada. Categorias exclusivas -- regra do documento.
  prioridade: 1 | 2 | 3;
  prazo: string | null; // ISO da atividade relevante (vencida ou futura), null se não há nenhuma com prazo
  assunto: string; // SUBJECT da atividade relevante, ou nome da etapa como fallback
  decisorRegistrado: boolean;
  emailInicialEnviado: boolean;
  cadastroConcluido: boolean;
  caminho: (typeof CAMINHOS_LEAD)[number];
};

function classificarPrioridade(
  atividadesDoLead: BitrixAtividadeLeadRaw[],
  agora: Date
): { prioridade: 1 | 2 | 3; prazo: string | null; assunto: string | null } {
  const abertasComPrazo = atividadesDoLead.filter((a) => a.COMPLETED !== "Y" && a.DEADLINE);
  const vencidas = abertasComPrazo.filter((a) => new Date(a.DEADLINE as string).getTime() < agora.getTime());
  const futuras = abertasComPrazo.filter((a) => new Date(a.DEADLINE as string).getTime() >= agora.getTime());

  if (vencidas.length) {
    // A mais antiga vencida primeiro -- é a que está esperando há mais tempo.
    const escolhida = vencidas.sort((a, b) => new Date(a.DEADLINE as string).getTime() - new Date(b.DEADLINE as string).getTime())[0];
    return { prioridade: 1, prazo: escolhida.DEADLINE, assunto: escolhida.SUBJECT || null };
  }
  if (futuras.length) {
    const escolhida = futuras.sort((a, b) => new Date(a.DEADLINE as string).getTime() - new Date(b.DEADLINE as string).getTime())[0];
    return { prioridade: 3, prazo: escolhida.DEADLINE, assunto: escolhida.SUBJECT || null };
  }
  return { prioridade: 2, prazo: null, assunto: null };
}

export function montarLinhasLeads(
  leads: BitrixLeadRaw[],
  atividades: BitrixAtividadeLeadRaw[],
  definicaoCampos: Record<string, BitrixDefinicaoCampo>,
  nomesUsuarios: Record<number, string>,
  agora: Date
): LinhaLead[] {
  const atividadesPorLead = new Map<number, BitrixAtividadeLeadRaw[]>();
  for (const a of atividades) {
    const id = Number(a.OWNER_ID);
    const lista = atividadesPorLead.get(id) ?? [];
    lista.push(a);
    atividadesPorLead.set(id, lista);
  }

  return leads.map((lead): LinhaLead => {
    const id = Number(lead.ID);
    const responsavelId = Number(lead.ASSIGNED_BY_ID) || 0;
    const { prioridade, prazo, assunto } = classificarPrioridade(atividadesPorLead.get(id) ?? [], agora);
    const etapaNome = ETAPAS_LEAD[lead.STATUS_ID] ?? lead.STATUS_ID;
    const caminhoBruto = enumLabel(definicaoCampos, CAMPO_CAMINHO, lead[CAMPO_CAMINHO]);
    return {
      id,
      nome: lead.TITLE,
      link: gerarLinkCard(ENTITY_TYPE_ID_LEAD, id),
      responsavelId,
      responsavelNome: nomesUsuarios[responsavelId] || `ID ${responsavelId}`,
      stageId: lead.STATUS_ID,
      etapaNome,
      prioridade,
      prazo,
      assunto: assunto || etapaNome,
      decisorRegistrado: Boolean(lead[CAMPO_DECISOR]),
      emailInicialEnviado: enumLabel(definicaoCampos, CAMPO_EMAIL_INICIAL_STATUS, lead[CAMPO_EMAIL_INICIAL_STATUS]) === "Enviado",
      cadastroConcluido: enumLabel(definicaoCampos, CAMPO_CAD_STATUS, lead[CAMPO_CAD_STATUS]) === "Concluído",
      caminho: (CAMINHOS_LEAD as readonly string[]).includes(caminhoBruto) ? (caminhoBruto as (typeof CAMINHOS_LEAD)[number]) : "Não informado",
    };
  });
}

// ---------------------------------------------------------------------------
// Busca ao vivo
// ---------------------------------------------------------------------------

export type DadosLeadsAoVivo = {
  linhas: LinhaLead[];
  responsaveis: { id: number; nome: string }[];
  ultimaAtualizacao: string;
};

export async function buscarLeadsAoVivo(): Promise<DadosLeadsAoVivo> {
  const [leads, definicaoCampos] = await Promise.all([listarLeads(), buscarDefinicaoCamposLead()]);
  const idsLead = leads.map((l) => Number(l.ID));
  const idsUsuario = leads.map((l) => Number(l.ASSIGNED_BY_ID)).filter((id) => id > 0);
  const [atividades, nomesUsuarios] = await Promise.all([listarAtividadesLead(idsLead), buscarUsuarios(idsUsuario)]);
  const agora = new Date();
  const linhas = montarLinhasLeads(leads, atividades, definicaoCampos, nomesUsuarios, agora);
  return { linhas, responsaveis: RESPONSAVEIS_LEAD, ultimaAtualizacao: agora.toISOString() };
}

export { ORDEM_ETAPAS_LEAD_ABERTAS };
