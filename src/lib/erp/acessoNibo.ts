// Quem pode ver a aba Nibo (espelho do Painel de Acompanhamento) no ERP — decisão do Matheus, 03/11/2026:
// somente Matheus, Nathalie e William. Vale para /erp/nibo e para o menu.
const PODEM_VER_NIBO = ["matheus@o2seguros.com.br", "nathalie@o2seguros.com.br", "william@o2seguros.com.br"];

export function podeVerNibo(email: string | null | undefined): boolean {
  return !!email && PODEM_VER_NIBO.includes(email.toLowerCase());
}
