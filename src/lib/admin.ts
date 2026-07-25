export const ADMIN_EMAILS = ["matheus@o2seguros.com.br"];

export function isAdmin(email: string | null | undefined) {
  return !!email && ADMIN_EMAILS.includes(email);
}
