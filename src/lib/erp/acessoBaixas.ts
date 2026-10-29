// Quem pode ver a Baixa de comissão no ERP (decisão do Matheus, 29/10/2026, reunião com a Kamila): a baixa NÃO fica exposta a todos.
// Só estes e-mails (Nathalie, William Sales, Matheus Lins, André Lins, Fabricio Esteves, Vanessa Fochi, Kamila Pimenta,
// Patricia da Silva e Henrique Pereira). Vale para /erp/baixas (tela, ações, lista do Corp), /erp/conferencia e o menu.
const PODEM_VER_BAIXAS = [
  "nathalie@o2seguros.com.br",
  "william@o2seguros.com.br",
  "matheus@o2seguros.com.br",
  "andre@o2seguros.com.br",
  "fabricio@o2seguros.com.br",
  "vanessa@o2seguros.com.br",
  "kamila@o2seguros.com.br",
  "patricia@o2seguros.com.br",
  "henrique@o2seguros.com.br",
  // Nichoos (desenvolvimento do ERP; liberado pelo Matheus em 29/10)
  "misatorafael@nichoos.com",
  "lucas@nichoos.com",
];

export function podeVerBaixas(email: string | null | undefined): boolean {
  return !!email && PODEM_VER_BAIXAS.includes(email.toLowerCase());
}
