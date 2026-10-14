import type { SupabaseClient } from "@supabase/supabase-js";

// O recado de um aviso interno (HTML, às vezes com texto colado do Word/Gmail
// e imagens) viaja entre as telas "novo" -> "revisar" -> envio. Ia inteiro num
// cookie, o que quebrava de dois jeitos (visto no Sentry em 14/10/2026):
//  1) emoji "partido" no texto colado (surrogate solto) faz o cookie falhar
//     ao gravar -- "URIError: URI malformed" -- e a tela mostrava só "An
//     unexpected response was received from the server";
//  2) HTML grande passa do limite de ~4 KB de um cookie e o navegador o
//     descarta em silêncio (o recado sumia na revisão).
// Agora o HTML fica numa tabela (avisos_internos_rascunhos) e o cookie guarda
// só o id.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Troca por "�" qualquer metade de emoji sem par (String.toWellFormed só
// existe em Node novo/navegadores recentes -- aqui é feito à mão).
export function limparSurrogates(texto: string): string {
  return texto.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

export async function gravarRascunhoAviso(supabase: SupabaseClient, userId: string, mensagemHtml: string): Promise<string | null> {
  const html = limparSurrogates(mensagemHtml);
  if (!html) return null;
  const { data, error } = await supabase.from("avisos_internos_rascunhos").insert({ mensagem_html: html, criado_por: userId }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Falha ao guardar o recado.");
  return data.id as string;
}

// Aceita o valor do cookie: um id de rascunho ou, nos 15 minutos seguintes ao
// deploy, o HTML direto que o formato antigo gravava.
export async function lerRascunhoAviso(supabase: SupabaseClient, valorCookie: string | undefined): Promise<string> {
  if (!valorCookie) return "";
  if (!UUID.test(valorCookie)) return valorCookie;
  const { data } = await supabase.from("avisos_internos_rascunhos").select("mensagem_html").eq("id", valorCookie).maybeSingle();
  return (data?.mensagem_html as string | undefined) ?? "";
}

export async function apagarRascunhoAviso(supabase: SupabaseClient, valorCookie: string | undefined): Promise<void> {
  if (!valorCookie || !UUID.test(valorCookie)) return;
  await supabase.from("avisos_internos_rascunhos").delete().eq("id", valorCookie);
}
