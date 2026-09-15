"use server";

import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;

// Chamada direto do editor de corpo do e-mail (client component) -- não é
// form action com redirect, é invocada imperativamente e devolve a URL
// pública da imagem pra inserir no contentEditable. Bucket "campanhas-imagens"
// é público (igual "logos"): e-mail precisa de URL de verdade, não signed
// URL temporária nem data: URI, que a maioria dos clientes de e-mail corta.
export async function uploadImagemCampanha(formData: FormData): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada, recarregue a página.");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) throw new Error("Sem permissão.");

  const imagem = formData.get("imagem");
  if (!(imagem instanceof File) || imagem.size === 0) throw new Error("Nenhuma imagem enviada.");
  if (!imagem.type.startsWith("image/")) throw new Error("Só é permitido enviar imagens.");
  if (imagem.size > TAMANHO_MAXIMO_BYTES) throw new Error("Imagem maior que 5 MB.");

  const ext = imagem.name.split(".").pop() || "png";
  const path = `${user.id}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("campanhas-imagens").upload(path, imagem, { contentType: imagem.type });
  if (error) throw new Error(error.message);

  return supabase.storage.from("campanhas-imagens").getPublicUrl(path).data.publicUrl;
}
