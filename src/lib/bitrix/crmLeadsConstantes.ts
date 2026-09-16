// Constantes e tipos do bloco "CRM Leads" que precisam ser importáveis por
// Client Components (PainelCrmLeads.tsx) -- por isso ficam num arquivo
// separado de crmLeads.ts, que tem `import "server-only"` no topo. Importar
// qualquer VALOR (não só tipo) de um módulo server-only a partir de um
// Client Component quebra o build (Turbopack aborta com
// "'server-only' cannot be imported from a Client Component module") --
// mesmo problema pré-existente que já afeta seguroFianca.ts/
// classificacaoImobiliarias.ts em outro fluxo deste repo, não é exclusivo
// deste módulo.

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
export const ORDEM_ETAPAS_LEAD_ABERTAS = ["NEW", "UC_N8ETQN", "UC_KGCI58", "UC_3UHNFO", "UC_QZ9OF8", "UC_2XNYOR", "UC_WJ48PO", "UC_9RFDW0", "UC_0DHSFN", "UC_Q5TX86"];

export const RESPONSAVEIS_LEAD: { id: number; nome: string }[] = [
  { id: 11, nome: "Vanessa Fochi" },
  { id: 35, nome: "Henrique Pereira Guterres" },
  { id: 210, nome: "Dayane Lima" },
];

export const CAMINHOS_LEAD = ["A — Cotação + cadastro", "B — Plataforma + cadastro", "C — Cotação sem cadastro", "Em definição", "Não informado"] as const;

export type LinhaLead = {
  id: number;
  nome: string;
  link: string;
  responsavelId: number;
  responsavelNome: string;
  stageId: string;
  etapaNome: string;
  prioridade: 1 | 2 | 3;
  prazo: string | null;
  assunto: string;
  decisorRegistrado: boolean;
  emailInicialEnviado: boolean;
  cadastroConcluido: boolean;
  caminho: (typeof CAMINHOS_LEAD)[number];
};

export type DadosLeadsAoVivo = {
  linhas: LinhaLead[];
  responsaveis: { id: number; nome: string }[];
  ultimaAtualizacao: string;
};
