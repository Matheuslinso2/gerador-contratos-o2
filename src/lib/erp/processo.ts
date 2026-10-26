// ERP O2 — etapas do processo, da esquerda para a direita (Matheus 26/10/2026: "separar por lógica de processo",
// sem telas redundantes; o ERP começa na efetivação da proposta — cotações ficam no Workspace; todas as telas valem
// para todos os produtos). Fonte única do menu (ErpNav) e da barra do processo na tela inicial.
export type Etapa = {
  chave: string;
  label: string;
  href: string | null; // null = ainda não construída ("em breve")
  externo?: boolean; // abre no Workspace (módulo que já existe lá)
  descricao: string;
  /** outras rotas que pertencem a esta etapa (para marcar o menu) */
  rotas?: string[];
};

export const ETAPAS: Etapa[] = [
  { chave: "emissao", label: "Efetivadas / Emissão", href: "/erp/emissao", descricao: "Propostas efetivadas aguardando a emissão da apólice." },
  { chave: "faturas", label: "Faturas", href: "/erp/faturas", descricao: "Apólices fora da fatura da imobiliária; a tela de cada fatura vem na fase B." },
  { chave: "envio", label: "Envio de apólices", href: null, descricao: "Apólices emitidas a enviar ao cliente/imobiliária (em breve)." },
  { chave: "apolices", label: "Apólices", href: "/erp/documentos", descricao: "Apólices, endossos e faturas, com ficha e linha do tempo." },
  { chave: "parcelas", label: "Parcelas", href: null, descricao: "Parcelas vencidas e inadimplência (em breve)." },
  { chave: "baixa", label: "Baixa de comissão", href: "/erp/baixas", rotas: ["/erp/conferencia"], descricao: "Extratos conferidos, baixa assistida, atraso e estornos de endosso." },
  { chave: "repasses", label: "Repasses", href: null, descricao: "Relatório do que será pago a cada imobiliária no dia 15 (em breve)." },
  { chave: "sinistro", label: "Sinistro", href: "/sinistros", externo: true, descricao: "Módulo de sinistros do Workspace." },
  { chave: "renovacao", label: "Renovação", href: null, descricao: "Apólices a renovar e criação dos cards da próxima vigência (em breve)." },
];

export const CADASTROS = [
  { href: "/erp/imobiliarias", label: "Imobiliárias" },
  { href: "/erp/seguradoras", label: "Seguradoras" },
];
