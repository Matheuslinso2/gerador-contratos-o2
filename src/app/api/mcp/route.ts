import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registrarFerramentas } from "@/lib/mcp/ferramentas";
import { emailAutorizado, supabaseDoToken } from "@/lib/mcp/conectorLeitura";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

// Conector de leitura (MCP) do Workspace/ERP para o Claude da diretoria.
// Login por OAuth do Supabase (botão de login normal da O2) — sem token fixo.
// Só aceita token emitido pelo fluxo OAuth (tem client_id), de alguém da
// equipe O2 que esteja em mcp_autorizados. Ver src/lib/mcp/.

export const maxDuration = 60;


const mcp = createMcpHandler((server) => registrarFerramentas(server), {
  serverInfo: { name: "workspace-o2-leitura", version: "1.0.0" },
});

async function verificar(_req: Request, token?: string) {
  if (!token) return undefined;
  const { data, error } = await supabaseDoToken(token).auth.getClaims(token);
  const c = data?.claims as Record<string, unknown> | undefined;
  if (error || !c || c.aud !== "authenticated" || !c.client_id) return undefined;
  const email = String(c.email ?? "").toLowerCase();
  if (!email || !(isAdmin(email) || isColaboradorO2(email))) return undefined;
  if (!(await emailAutorizado(email))) return undefined;
  return { token, clientId: String(c.client_id), scopes: [], expiresAt: Number(c.exp), extra: { email, sub: c.sub } };
}

const handler = withMcpAuth(mcp, verificar, { required: true });

export { handler as GET, handler as POST, handler as DELETE };
