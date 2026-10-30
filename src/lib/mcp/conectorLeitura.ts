import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

// Conector de leitura (MCP) do Workspace/ERP para o Claude da diretoria —
// pedido do Fabricio aprovado em 30/10/2026 (entregaveis/conector-leitura/).
// Regras: só leitura; cada consulta roda com o login da própria pessoa (token
// OAuth do Supabase), então valem as mesmas regras de acesso (RLS) das telas;
// só quem está em mcp_autorizados usa; dados pessoais de terceiros e textos
// livres nunca saem; toda consulta fica registrada em mcp_acessos.

export const LIMITE_POR_MINUTO = 120;
export const LIMITE_POR_DIA = 5000;

// Cliente Supabase "como a pessoa": o token vai no cabeçalho, então RLS,
// auth.jwt() e is_colaborador_o2() funcionam igual a uma sessão do site.
export function supabaseDoToken(token: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function emailAutorizado(email: string): Promise<boolean> {
  const { data } = await createServiceClient()
    .from("mcp_autorizados")
    .select("email")
    .eq("email", email.toLowerCase())
    .eq("ativo", true)
    .maybeSingle();
  return Boolean(data);
}

// Chaves que nunca saem do conector, em qualquer nível da resposta: dados
// pessoais de terceiros, textos livres (podem trazer instruções escritas por
// gente de fora) e qualquer coisa parecida com credencial ou arquivo.
// Compara PALAVRA inteira (segurado_nome sai; seguradora fica).
const PALAVRAS_PROIBIDAS = new Set([
  "cpf", "telefone", "telefones", "celular", "email", "emails", "login", "logins", "senha", "password", "token",
  "secret", "apikey", "segurado", "segurados", "locatario", "locatarios", "inquilino", "inquilinos", "pretendente",
  "fiador", "fiadores", "proprietario", "proprietarios", "observacao", "observacoes", "obs", "texto", "corpo", "html",
  "nascimento", "arquivo", "bucket", "path", "banco", "agencia", "conta",
]);
// cardsQuePedemAtencao: título do card do Bitrix = nome do locatário.
const CHAVES_PROIBIDAS = new Set(["cardsquepedematencao", "cards_que_pedem_atencao"]);

function chaveProibida(chave: string): boolean {
  const snake = chave
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  if (CHAVES_PROIBIDAS.has(snake) || CHAVES_PROIBIDAS.has(snake.replace(/_/g, ""))) return true;
  return snake.split(/[_\-\s]+/).some((p) => PALAVRAS_PROIBIDAS.has(p));
}

export function limparDados(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(limparDados);
  if (valor && typeof valor === "object") {
    const saida: Record<string, unknown> = {};
    for (const [chave, v] of Object.entries(valor as Record<string, unknown>)) {
      if (chaveProibida(chave)) continue;
      saida[chave] = limparDados(v);
    }
    return saida;
  }
  return valor;
}

export type Contexto = { email: string; sb: SupabaseClient };

export class ErroConector extends Error {}

// Executa uma ferramenta: confere limite de uso, roda, limpa a resposta e
// registra o acesso (com sucesso ou erro). Sempre devolve JSON com a regra de
// data e a data de atualização que a ferramenta informar.
export async function executar(
  ctx: Contexto,
  ferramenta: string,
  parametros: unknown,
  fn: () => Promise<{ dados: unknown; atualizado_em?: string | null; regra_data: string; fonte: string; observacoes?: string[] }>
) {
  const service = createServiceClient();
  const inicio = Date.now();
  const agora = new Date();
  const [{ count: minuto }, { count: dia }] = await Promise.all([
    service.from("mcp_acessos").select("id", { count: "exact", head: true }).eq("email", ctx.email).gte("criado_em", new Date(agora.getTime() - 60_000).toISOString()),
    service.from("mcp_acessos").select("id", { count: "exact", head: true }).eq("email", ctx.email).gte("criado_em", new Date(agora.getTime() - 86_400_000).toISOString()),
  ]);
  if ((minuto ?? 0) >= LIMITE_POR_MINUTO || (dia ?? 0) >= LIMITE_POR_DIA) {
    await service.from("mcp_acessos").insert({ email: ctx.email, ferramenta, parametros, ok: false, erro: "limite de consultas", duracao_ms: 0 });
    return texto({ erro: `Limite de consultas atingido (${LIMITE_POR_MINUTO}/min ou ${LIMITE_POR_DIA}/dia). Aguarde e tente de novo.` }, true);
  }

  try {
    const r = await fn();
    await service.from("mcp_acessos").insert({ email: ctx.email, ferramenta, parametros, ok: true, duracao_ms: Date.now() - inicio });
    return texto({
      fonte: r.fonte,
      regra_data: r.regra_data,
      atualizado_em: r.atualizado_em ?? null,
      consultado_em: agora.toISOString(),
      observacoes: r.observacoes ?? [],
      dados: limparDados(r.dados),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await service.from("mcp_acessos").insert({ email: ctx.email, ferramenta, parametros, ok: false, erro: msg.slice(0, 500), duracao_ms: Date.now() - inicio });
    // Erro de negócio (ErroConector) vai como está; o resto vira mensagem genérica.
    return texto({ erro: e instanceof ErroConector ? msg : "Falha ao consultar a fonte. Tente de novo; se persistir, avise o Matheus." }, true);
  }
}

function texto(obj: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj) }], isError };
}

// Lê uma RPC ou consulta e transforma erro do Supabase em exceção.
export async function ler<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

export const mesRegex = /^\d{4}-(0[1-9]|1[0-2])$/;

export function mesesEntre(de: string, ate: string): string[] {
  const meses: string[] = [];
  let [a, m] = de.split("-").map(Number);
  const [aF, mF] = ate.split("-").map(Number);
  while (a < aF || (a === aF && m <= mF)) {
    meses.push(`${a}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      a++;
    }
    if (meses.length > 240) throw new ErroConector("Período longo demais (máximo 20 anos).");
  }
  return meses;
}
