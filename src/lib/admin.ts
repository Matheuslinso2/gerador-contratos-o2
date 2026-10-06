export const ADMIN_EMAILS = ["matheus@o2seguros.com.br", "misatorafael@nichoos.com", "lucas@nichoos.com"];
const EMAIL_MATHEUS = "matheus@o2seguros.com.br";
export const DOMINIO_O2 = "@o2seguros.com.br";
export const DOMINIO_NICHOOS = "@nichoos.com";

export type Perfil = "admin" | "colaborador" | "imobiliaria";

export function isAdmin(email: string | null | undefined) {
  return !!email && ADMIN_EMAILS.includes(email);
}

// Mais restrito que isAdmin (que também inclui misatorafael@ e lucas@) --
// usado só pra telas que o Matheus quer visíveis exclusivamente pra ele,
// como o uso diário do Workspace.
export function isMatheus(email: string | null | undefined) {
  return !!email && email === EMAIL_MATHEUS;
}

// Colaborador da O2: login @o2seguros.com.br que não é o admin. Usa as
// ferramentas (Gerar Contrato/Auditor) sem precisar de cadastro de
// imobiliária parceira, e tem acesso de leitura aos dados de todas as
// imobiliárias.
export function isColaboradorO2(email: string | null | undefined) {
  return !!email && email.toLowerCase().endsWith(DOMINIO_O2) && !isAdmin(email);
}

// Equipe = admins + qualquer e-mail @o2seguros.com.br ou @nichoos.com. Usada
// só nas telas da aba Configurações abertas em 06/10/2026 (Cláusulas,
// Imobiliárias cadastradas, Histórico de análises, Relatório diário) --
// espelha is_equipe_o2() no banco. Não altera isColaboradorO2, que continua
// valendo pro resto do Workspace.
export function isEquipe(email: string | null | undefined) {
  if (!email) return false;
  const e = email.toLowerCase();
  return isAdmin(email) || e.endsWith(DOMINIO_O2) || e.endsWith(DOMINIO_NICHOOS);
}

export function obterPerfil(email: string | null | undefined): Perfil {
  if (isAdmin(email)) return "admin";
  if (isColaboradorO2(email)) return "colaborador";
  return "imobiliaria";
}
