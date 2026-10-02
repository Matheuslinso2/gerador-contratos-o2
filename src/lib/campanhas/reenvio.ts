import type { SupabaseClient } from "@supabase/supabase-js";

export type PublicoReenvio = "todos" | "nao_abriram";

export type DestinatarioReenvio = { imobiliaria_id: string | null; email: string };

// Pedido do Matheus, 02/10/2026: reenviar uma campanha já concluída. O
// público sai de campanhas_envios (quem realmente recebeu/tentou receber no
// disparo original), não da seleção atual da campanha -- a seleção pode ter
// mudado depois, e o reenvio tem que bater com o histórico. Descadastrados
// (de antes ou de depois do disparo original) ficam de fora sempre.
export async function listarDestinatariosReenvio(
  supabase: SupabaseClient,
  campanhaId: string
): Promise<Record<PublicoReenvio, DestinatarioReenvio[]>> {
  const [{ data: envios }, { data: descadastros }] = await Promise.all([
    supabase.from("campanhas_envios").select("imobiliaria_id, email, status, aberto_em").eq("campanha_id", campanhaId).in("status", ["enviado", "falhou"]),
    supabase.from("campanhas_descadastros").select("email"),
  ]);
  const descadastrados = new Set((descadastros ?? []).map((d) => String(d.email).trim().toLowerCase()));

  const elegiveis = (envios ?? []).filter((e) => !descadastrados.has(String(e.email).trim().toLowerCase()));
  const paraDestinatario = (e: { imobiliaria_id: string | null; email: string }): DestinatarioReenvio => ({
    imobiliaria_id: e.imobiliaria_id,
    email: e.email,
  });

  return {
    todos: elegiveis.map(paraDestinatario),
    nao_abriram: elegiveis.filter((e) => !e.aberto_em).map(paraDestinatario),
  };
}

// AAAA-MM-DD de hoje no fuso de Brasília, pra comparar com colunas `date`
// (valido_ate) sem passar por Date/timezone do navegador.
export function hojeSaoPauloISO(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}
