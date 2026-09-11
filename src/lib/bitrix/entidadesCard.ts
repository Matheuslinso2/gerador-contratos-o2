// Mapeamento de qual entidade do Bitrix um card pertence (Lead, Negócios,
// ou uma das 4 SPAs) pro CC certo no "E-mail no card" (Fase 1, ver
// C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md). Roteamento
// por entidade, não por "produto" -- Negócios (Sucesso do Cliente/Ativação)
// não tem campo de produto confiável, mas o entityTypeId da entidade já
// identifica sem ambiguidade quando é uma das 4 SPAs de produto único.
//
// Confirmado com o Matheus em 2026-09-10: mesmos endereços já usados pelas
// 5 landing pages (fianca@/incendio@/cap@/auto@) + comercial@ pra Lead e
// Negócios, que ainda não têm produto definido nessa etapa do funil.

export const ENTITY_TYPE_ID_LEAD = 1;
export const ENTITY_TYPE_ID_DEAL = 2;
export const ENTITY_TYPE_ID_SEGURO_FIANCA = 1042;
export const ENTITY_TYPE_ID_RAMOS_ELEMENTARES = 1046;
export const ENTITY_TYPE_ID_CAPITALIZACAO = 1048;
export const ENTITY_TYPE_ID_SEGURO_AUTO = 1050;

const EMAIL_COMERCIAL = "comercial@o2seguros.com.br";

const CC_POR_ENTIDADE: Record<number, string> = {
  [ENTITY_TYPE_ID_LEAD]: EMAIL_COMERCIAL,
  [ENTITY_TYPE_ID_DEAL]: EMAIL_COMERCIAL,
  [ENTITY_TYPE_ID_SEGURO_FIANCA]: "fianca@o2seguros.com.br",
  [ENTITY_TYPE_ID_RAMOS_ELEMENTARES]: "incendio@o2seguros.com.br",
  [ENTITY_TYPE_ID_CAPITALIZACAO]: "cap@o2seguros.com.br",
  [ENTITY_TYPE_ID_SEGURO_AUTO]: "auto@o2seguros.com.br",
};

// Nunca deixa passar sem nenhum CC -- se aparecer um entityTypeId novo que
// ainda não mapeamos, cai no comercial@ em vez de sumir sem aviso.
export function ccPorEntidade(entityTypeId: number): string {
  return CC_POR_ENTIDADE[entityTypeId] ?? EMAIL_COMERCIAL;
}

// Endereço que recebe a resposta do cliente (lido pelo Cloudflare Email
// Routing na Fase 2). Precisa do entityTypeId junto com o id porque o
// mesmo número de id existe em paralelo em Lead, Deal e cada SPA.
export function gerarEnderecoRespostaCard(entityTypeId: number, itemId: number): string {
  return `card-${entityTypeId}-${itemId}@notificacoes.o2seguros.com.br`;
}

// Caminho inverso: extrai entityTypeId/itemId do endereço "Para" de um
// e-mail recebido (Fase 2). Só aceita o formato exato gerado acima --
// qualquer coisa fora do padrão (ex: alguém respondeu um e-mail antigo de
// antes desse endereço existir) retorna null em vez de adivinhar.
export function parseEnderecoResposta(enderecoTo: string): { entityTypeId: number; itemId: number } | null {
  const casado = enderecoTo.trim().toLowerCase().match(/^card-(\d+)-(\d+)@notificacoes\.o2seguros\.com\.br$/);
  if (!casado) return null;
  return { entityTypeId: Number(casado[1]), itemId: Number(casado[2]) };
}

// Nome do placement do Bitrix (PLACEMENT no POST de abertura da aba) ->
// entityTypeId. Usado pelo handler do placement pra saber em qual entidade
// o card foi aberto -- ver Passo 2 do prompt-codex-registrar-placements-restantes.md
// pra confirmar se esses nomes batem com o que o Bitrix registrou de fato
// (nome de placement de SPA pode variar entre portais).
const ENTITY_TYPE_ID_POR_PLACEMENT: Record<string, number> = {
  CRM_LEAD_DETAIL_TAB: ENTITY_TYPE_ID_LEAD,
  CRM_DEAL_DETAIL_TAB: ENTITY_TYPE_ID_DEAL,
  CRM_DYNAMIC_1042_DETAIL_TAB: ENTITY_TYPE_ID_SEGURO_FIANCA,
  CRM_DYNAMIC_1046_DETAIL_TAB: ENTITY_TYPE_ID_RAMOS_ELEMENTARES,
  CRM_DYNAMIC_1048_DETAIL_TAB: ENTITY_TYPE_ID_CAPITALIZACAO,
  CRM_DYNAMIC_1050_DETAIL_TAB: ENTITY_TYPE_ID_SEGURO_AUTO,
};

export function entityTypeIdPorPlacement(placement: string | undefined): number | undefined {
  if (!placement) return undefined;
  return ENTITY_TYPE_ID_POR_PLACEMENT[placement];
}

// Nome amigável pro badge do e-mail (Fase 3 -- melhoria de conteúdo/layout,
// ver plano). Não precisa ser idêntico ao nome exato do funil no Bitrix,
// só reconhecível pra quem recebe o e-mail.
const NOME_POR_ENTIDADE: Record<number, string> = {
  [ENTITY_TYPE_ID_LEAD]: "Lead",
  [ENTITY_TYPE_ID_DEAL]: "Sucesso do Cliente",
  [ENTITY_TYPE_ID_SEGURO_FIANCA]: "Seguro Fiança",
  [ENTITY_TYPE_ID_RAMOS_ELEMENTARES]: "Seguro Incêndio",
  [ENTITY_TYPE_ID_CAPITALIZACAO]: "Capitalização",
  [ENTITY_TYPE_ID_SEGURO_AUTO]: "Seguro Automóvel",
};

export function nomeProdutoPorEntidade(entityTypeId: number): string {
  return NOME_POR_ENTIDADE[entityTypeId] ?? "O2 Seguros";
}

// URL de abertura direta do card no Bitrix -- 3 padrões diferentes
// conforme a entidade (Lead e Deal têm rota própria fixa; toda SPA usa
// /crm/type/<entityTypeId>/).
export function gerarLinkCard(entityTypeId: number, itemId: number): string {
  const dominio = "https://o2seguros.bitrix24.com.br";
  if (entityTypeId === ENTITY_TYPE_ID_LEAD) return `${dominio}/crm/lead/details/${itemId}/`;
  if (entityTypeId === ENTITY_TYPE_ID_DEAL) return `${dominio}/crm/deal/details/${itemId}/`;
  return `${dominio}/crm/type/${entityTypeId}/details/${itemId}/`;
}
