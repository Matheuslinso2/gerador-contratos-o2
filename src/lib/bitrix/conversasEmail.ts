import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { gerarEnderecoRespostaCard } from "./entidadesCard";

// Conversas de e-mail por card. Cada e-mail que passa pelo endereço do card
// (resposta do cliente, cópia da equipe e a cópia oculta dos nossos próprios
// envios) entra em bitrix_email_mensagens com o Message-ID real. O próximo
// envio usa o último Message-ID da conversa escolhida como In-Reply-To, e o
// Gmail/Outlook colocam a mensagem na mesma conversa em vez de abrir outra.

// Tira "Re:", "Enc:", "Fwd:", "Resposta recebida:" etc. do começo, pra que
// "Re: Re: ANÁLISE X" e "ANÁLISE X" caiam na mesma conversa.
export function assuntoBase(assunto: string): string {
  let s = assunto.trim();
  for (;;) {
    const sem = s.replace(/^(re|res|enc|fw|fwd|resposta recebida)\s*:\s*/i, "");
    if (sem === s) break;
    s = sem;
  }
  return s.replace(/\s+/g, " ").trim() || "(sem assunto)";
}

export type Conversa = { assuntoBase: string; ultimaEm: string; mensagens: number };

export async function listarConversas(entityTypeId: number, itemId: number): Promise<Conversa[]> {
  const { data } = await createServiceClient()
    .from("bitrix_email_mensagens")
    .select("assunto_base, criado_em")
    .eq("entity_type_id", entityTypeId)
    .eq("item_id", itemId)
    .order("criado_em", { ascending: false })
    .limit(500);
  const porBase = new Map<string, Conversa>();
  for (const m of data ?? []) {
    const atual = porBase.get(m.assunto_base);
    if (atual) atual.mensagens++;
    else porBase.set(m.assunto_base, { assuntoBase: m.assunto_base, ultimaEm: m.criado_em, mensagens: 1 });
  }
  return [...porBase.values()];
}

// Assunto e cabeçalhos pra continuar a conversa. Null se a conversa não
// existe mais (aí quem chama envia como conversa nova).
export async function continuarConversa(
  entityTypeId: number,
  itemId: number,
  base: string
): Promise<{ assunto: string; headers: Record<string, string> } | null> {
  const { data } = await createServiceClient()
    .from("bitrix_email_mensagens")
    .select("message_id, referencias")
    .eq("entity_type_id", entityTypeId)
    .eq("item_id", itemId)
    .eq("assunto_base", base)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const cadeia = [data.referencias, data.message_id].filter(Boolean).join(" ").trim();
  return { assunto: `Re: ${base}`, headers: { "In-Reply-To": data.message_id, References: cadeia } };
}

// Cópia oculta pro endereço do card: é assim que o Worker recebe o nosso
// próprio e-mail e descobre o Message-ID que o provedor de envio atribuiu.
export const bccDoCard = (entityTypeId: number, itemId: number) => gerarEnderecoRespostaCard(entityTypeId, itemId);
