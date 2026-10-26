import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

// Remetentes da aba E-mail do card: cada pessoa da equipe tem uma imagem de
// assinatura (banner com nome, cargo e contatos -- as mesmas do Drive
// "Assinaturas Outubro 2025") guardada no bucket público assinaturas-email.
// A pessoa escolhe quem está enviando; o nome vira o remetente
// ("Nome | O2 Seguros") e a imagem sai no fim do e-mail. Cadastro em
// bitrix_email_assinaturas (slug = nome sem acento, ex: "kamila-pimenta").

export type Assinatura = { slug: string; nome: string; cargo: string | null; arquivo: string };

const BUCKET = "assinaturas-email";

export function urlImagemAssinatura(arquivo: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(arquivo)}`;
}

export async function listarAssinaturas(): Promise<Assinatura[]> {
  const { data } = await createServiceClient()
    .from("bitrix_email_assinaturas")
    .select("slug, nome, cargo, arquivo")
    .eq("ativo", true)
    .order("nome");
  return data ?? [];
}

export async function buscarAssinatura(slug: string): Promise<Assinatura | null> {
  const { data } = await createServiceClient()
    .from("bitrix_email_assinaturas")
    .select("slug, nome, cargo, arquivo")
    .eq("slug", slug)
    .eq("ativo", true)
    .maybeSingle();
  return data ?? null;
}

// Imagem da assinatura pro fim do corpo do e-mail. Alt com nome e cargo pra
// quem lê com as imagens bloqueadas.
export function htmlAssinatura(a: Assinatura): string {
  const alt = [a.nome, a.cargo].filter(Boolean).join(" — ").replace(/"/g, "");
  return `<div style="margin-top:12px;"><img src="${urlImagemAssinatura(a.arquivo)}" alt="${alt}" width="500" style="display:block;border:0;max-width:100%;height:auto;" /></div>`;
}
