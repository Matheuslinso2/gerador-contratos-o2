import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente com service role — ignora RLS. Só para rotas sem usuário logado
// (cron jobs), nunca para código que roda a partir de uma sessão de
// browser. Precisa de SUPABASE_SERVICE_ROLE_KEY configurada no Vercel
// (Settings → Environment Variables), separada da chave anon já existente.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurada");
  if (!chave) throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurada");
  return createSupabaseClient(url, chave, { auth: { persistSession: false } });
}
