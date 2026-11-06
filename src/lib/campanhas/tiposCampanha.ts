// Painel de campanhas dividido em Campanhas comerciais e Marketing (06/11/2026, pedido do Matheus). O tipo fica gravado na
// campanha (campanhas.tipo) e é escolhido ao criar, pelos botões "Nova campanha comercial" / "Nova campanha de marketing" --
// qualquer colaborador pode criar os dois tipos. Para as campanhas antigas, o tipo foi definido uma vez pelo criador (as de
// marketing eram todas do login da Jessika); isso não é regra para o futuro. Ver supabase/schema_campanhas_tipo_0611.sql.
export type TipoCampanha = "comercial" | "marketing";

export const ROTULO_TIPO_CAMPANHA: Record<TipoCampanha, string> = {
  comercial: "Campanhas comerciais",
  marketing: "Marketing",
};

export const ROTULO_NOVA_CAMPANHA: Record<TipoCampanha, string> = {
  comercial: "Nova campanha comercial",
  marketing: "Nova campanha de marketing",
};

export function tipoDaQuery(valor: string | undefined | null): TipoCampanha {
  return valor === "marketing" ? "marketing" : "comercial";
}
