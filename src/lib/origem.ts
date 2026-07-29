import { headers } from "next/headers";

// Deriva o endereço do site a partir da própria requisição, em vez de
// depender do "Site URL" configurado no painel do Supabase (que fica
// apontando pro endereço de teste localhost se não for atualizado à mão).
// Usado em links de e-mail (confirmação de cadastro, redefinição de senha).
export async function origem() {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}
