// ERP O2 — etapas do processo, da esquerda para a direita (Matheus 26/10/2026: "separar por lógica de processo",
// sem telas redundantes; o ERP começa na efetivação da proposta — cotações ficam no Workspace; todas as telas valem
// para todos os produtos). Fonte única do menu (ErpNav) e da barra do processo na tela inicial.
export type Etapa = {
  chave: string;
  label: string;
  curto: string; // nome no menu
  href: string | null; // null = ainda não construída ("em breve")
  externo?: boolean; // abre no Workspace (módulo que já existe lá)
  descricao: string;
  /** outras rotas que pertencem a esta etapa (para marcar o menu) */
  rotas?: string[];
};

export const ETAPAS: Etapa[] = [
  { chave: "emissao", curto: "Emissão", label: "Efetivadas / Emissão", href: "/erp/emissao", descricao: "Propostas efetivadas aguardando a emissão da apólice." },
  { chave: "faturas", curto: "Faturas", label: "Faturas", href: "/erp/faturas", descricao: "Apólices fora da fatura da imobiliária; a tela de cada fatura vem na fase B." },
  { chave: "envio", curto: "Envio", label: "Envio de apólices", href: null, descricao: "Apólices emitidas a enviar ao cliente/imobiliária (em breve)." },
  { chave: "apolices", curto: "Apólices", label: "Apólices", href: "/erp/documentos", descricao: "Apólices, endossos e faturas, com ficha e linha do tempo." },
  { chave: "parcelas", curto: "Parcelas", label: "Parcelas", href: "/erp/parcelas", descricao: "Vencimentos do Corp × cobrado pela seguradora; inadimplência em seguida." },
  { chave: "baixa", curto: "Baixa", label: "Baixa de comissão", href: "/erp/baixas", rotas: ["/erp/conferencia"], descricao: "Extratos conferidos, baixa assistida, atraso e estornos de endosso." },
  { chave: "repasses", curto: "Repasses", label: "Repasses", href: null, descricao: "Relatório do que será pago a cada imobiliária no dia 15 (em breve)." },
  { chave: "sinistro", curto: "Sinistro", label: "Sinistro", href: "/sinistros", externo: true, descricao: "Módulo de sinistros do Workspace." },
  { chave: "renovacao", curto: "Renovação", label: "Renovação", href: "/erp/renovacao", descricao: "Vigentes por fim de vigência, agrupados como os cards (lote imobiliária + seguradora ou 1 por seguro); conferência antes de criar o card da próxima vigência." },
];

export const CADASTROS = [
  { href: "/erp/clientes", label: "Clientes" },
  { href: "/erp/imobiliarias", label: "Imobiliárias" },
  { href: "/erp/seguradoras", label: "Seguradoras" },
];
