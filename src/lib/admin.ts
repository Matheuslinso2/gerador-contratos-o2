export const ADMIN_EMAILS = ["matheus@o2seguros.com.br"];
const DOMINIO_O2 = "@o2seguros.com.br";

export type Perfil = "admin" | "colaborador" | "imobiliaria";

export function isAdmin(email: string | null | undefined) {
  return !!email && ADMIN_EMAILS.includes(email);
}

// Colaborador da O2: login @o2seguros.com.br que não é o admin. Usa as
// ferramentas (Gerar Contrato/Auditor) sem precisar de cadastro de
// imobiliária parceira, e tem acesso de leitura aos dados de todas as
// imobiliárias.
export function isColaboradorO2(email: string | null | undefined) {
  return !!email && email.toLowerCase().endsWith(DOMINIO_O2) && !isAdmin(email);
}

export function obterPerfil(email: string | null | undefined): Perfil {
  if (isAdmin(email)) return "admin";
  if (isColaboradorO2(email)) return "colaborador";
  return "imobiliaria";
}
