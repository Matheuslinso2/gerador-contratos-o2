import "server-only";
import { createClient } from "@/lib/supabase/server";

// Usa o client autenticado do próprio usuário (não o service client) --
// a RLS de gestao_emails_pendentes já restringe tudo a matheus@o2seguros.com.br,
// então a sessão dele é o que deve autorizar a leitura/escrita, igual ao
// resto do app.

export async function listarIdsPendentes(): Promise<Set<string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("gestao_emails_pendentes").select("message_id");
  return new Set((data ?? []).map((linha) => linha.message_id as string));
}

export async function marcarComoPendente(messageId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("gestao_emails_pendentes").upsert({ message_id: messageId });
  if (error) throw new Error(`Falha ao marcar como pendente: ${error.message}`);
}

export async function desmarcarPendente(messageId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("gestao_emails_pendentes").delete().eq("message_id", messageId);
  if (error) throw new Error(`Falha ao remover de pendentes: ${error.message}`);
}
