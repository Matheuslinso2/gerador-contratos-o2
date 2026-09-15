"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

const TAMANHO_MAXIMO_BYTES = 5 * 1024 * 1024;

// Usadas tanto na lista de campanhas (/campanhas) quanto na tela da
// campanha (/campanhas/[id]) -- por isso moraram aqui, no nível
// compartilhado, em vez de dentro de [id]/actions.ts.

// Pedido da reunião de 15/09/2026: relançar uma campanha parecida sem
// reescrever tudo do zero. Copia só o conteúdo e a seleção de
// destinatários -- nunca o histórico de envio/produção, que é específico
// do disparo original.
export async function duplicarCampanha(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const campanhaId = String(formData.get("campanha_id") ?? "");
  const voltarPara = String(formData.get("voltar_para") ?? `/campanhas/${campanhaId}`);

  const { data: original } = await supabase
    .from("campanhas")
    .select(
      "nome, assunto, template, titulo, introducao, valido_de, valido_ate, produto, corpo_html, cta_texto, cta_href, imobiliarias_selecionadas, contatos_externos_selecionados"
    )
    .eq("id", campanhaId)
    .single();
  if (!original) redirect(`${voltarPara}?erro=${encodeURIComponent("Campanha não encontrada.")}`);

  const { data: copia, error } = await supabase
    .from("campanhas")
    .insert({
      nome: `${original.nome} (cópia)`,
      assunto: original.assunto,
      template: original.template,
      titulo: original.titulo,
      introducao: original.introducao,
      valido_de: original.valido_de,
      valido_ate: original.valido_ate,
      produto: original.produto,
      corpo_html: original.corpo_html,
      cta_texto: original.cta_texto,
      cta_href: original.cta_href,
      imobiliarias_selecionadas: original.imobiliarias_selecionadas,
      contatos_externos_selecionados: original.contatos_externos_selecionados,
      status: "rascunho",
      criado_por: user.id,
      criado_por_email: user.email,
    })
    .select("id")
    .single();

  if (error || !copia) {
    redirect(`${voltarPara}?erro=${encodeURIComponent(error?.message ?? "Falha ao duplicar a campanha.")}`);
  }

  redirect(`/campanhas/${copia.id}`);
}

// Pedido do Matheus, 15/09/2026: excluir em qualquer status (inclusive já
// enviada -- perde o histórico de envios/produção junto, cascade nas FKs).
// campanhas_descadastros.origem_campanha_id vira null em vez de bloquear a
// exclusão (ver supabase/schema_campanhas_descadastros_origem_set_null.sql)
// -- o registro de opt-out em si tem que sobreviver, só perde a atribuição
// de qual campanha causou.
export async function excluirCampanha(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const campanhaId = String(formData.get("campanha_id") ?? "");
  const { error } = await supabase.from("campanhas").delete().eq("id", campanhaId);
  if (error) redirect(`/campanhas?erro=${encodeURIComponent(error.message)}`);

  redirect("/campanhas");
}

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
