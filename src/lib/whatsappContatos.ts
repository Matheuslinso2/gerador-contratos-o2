import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import { destinatariosRelatorio } from "@/lib/whatsapp";

// Cadastro de quem conversa com o Workspace pelo WhatsApp (tabela
// whatsapp_contatos, editada em /admin/whatsapp -- 08/10/2026). Enquanto o
// cadastro não tiver nenhum contato da equipe, vale a lista antiga da
// variável WHATSAPP_RELATORIO_DESTINATARIOS (todos tratados como equipe e
// recebendo o relatório), pra a troca não derrubar nada.

export type ContatoWhatsApp = {
  numero: string;
  nome: string;
  tipo: "equipe" | "imobiliaria";
  imobiliariaId: string | null;
  recebeRelatorio: boolean;
};

export function somenteDigitos(numero: string): string {
  return numero.replace(/\D/g, "");
}

// Celular brasileiro pode chegar da Meta SEM o 9 depois do DDD (wa_id de
// contas antigas, ex: 552188887777 em vez de 5521988887777) -- compara
// sempre na forma sem o 9 pra não barrar um contato cadastrado.
function formaCanonica(numero: string): string {
  const n = somenteDigitos(numero);
  return n.length === 13 && n.startsWith("55") && n[4] === "9" ? n.slice(0, 4) + n.slice(5) : n;
}

async function contatosAtivos(): Promise<ContatoWhatsApp[]> {
  const { data, error } = await createServiceClient()
    .from("whatsapp_contatos")
    .select("numero, nome, tipo, imobiliaria_id, recebe_relatorio")
    .eq("ativo", true)
    .order("criado_em", { ascending: true });
  if (error) throw new Error(`whatsapp_contatos: ${error.message}`);
  const cadastro = (data ?? []).map((c) => ({
    numero: c.numero as string,
    nome: c.nome as string,
    tipo: c.tipo as ContatoWhatsApp["tipo"],
    imobiliariaId: (c.imobiliaria_id as string | null) ?? null,
    recebeRelatorio: !!c.recebe_relatorio,
  }));
  if (cadastro.some((c) => c.tipo === "equipe")) return cadastro;
  // Transição: cadastro ainda sem equipe -> lista antiga do Vercel.
  return [
    ...cadastro,
    ...destinatariosRelatorio().map((numero) => ({ numero, nome: "Equipe O2", tipo: "equipe" as const, imobiliariaId: null, recebeRelatorio: true })),
  ];
}

export async function buscarContato(waId: string): Promise<ContatoWhatsApp | null> {
  const alvo = formaCanonica(waId);
  return (await contatosAtivos()).find((c) => formaCanonica(c.numero) === alvo) ?? null;
}

// Quem recebe o relatório das 8h, na ordem de cadastro -- o botão "enviar
// teste" da prévia manda só pro PRIMEIRO (o Matheus se cadastra primeiro).
export async function destinatariosDoRelatorio(): Promise<string[]> {
  const numeros = (await contatosAtivos())
    .filter((c) => c.tipo === "equipe" && c.recebeRelatorio)
    .map((c) => somenteDigitos(c.numero));
  return [...new Set(numeros)];
}
