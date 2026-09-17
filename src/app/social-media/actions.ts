"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { coletarNoticias } from "@/lib/social/news";
import {
  gerarConteudoDeNoticia,
  gerarConteudoInstitucional,
  gerarConteudoCarrosselDeNoticia,
  gerarConteudoCarrosselInstitucional,
} from "@/lib/social/gerarConteudo";
import { publicarPostPorId } from "@/lib/social/publicar";

// Fuso fixo -03:00 (Brasil não tem mais horário de verão desde 2019) --
// <input type="datetime-local"> devolve "AAAA-MM-DDTHH:mm" sem fuso nenhum,
// então trata direto como horário de Brasília (mesmo padrão de
// src/app/campanhas/[id]/actions.ts).
const OFFSET_BRASILIA = "-03:00";

async function exigirAcessoInterno() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(isAdmin(user.email) || isColaboradorO2(user.email))) redirect("/login");
  return supabase;
}

// Mesmo pipeline do cron (src/app/api/cron/coletar-noticias/route.ts), só
// que disparado manualmente pela página — útil pra testar sem esperar o
// horário do cron. Resume o resultado por fonte na URL (ver page.tsx) pra
// dar pra ver na hora se algum feed quebrou, sem precisar olhar log.
export async function coletarAgora() {
  await exigirAcessoInterno();
  const resultados = await coletarNoticias();
  const resumo = resultados
    .map((r) => `${r.fonte}: ${r.erro ? `erro (${r.erro})` : `${r.novas} novas`}`)
    .join(";;");
  revalidatePath("/social-media");
  redirect(`/social-media?coleta=${encodeURIComponent(resumo)}`);
}

// Gera um rascunho de post a partir de uma notícia coletada e marca a
// notícia como "usada" (não impede gerar de novo depois se quiser descartar
// o rascunho, só evita que ela continue aparecendo como pendente).
export async function gerarRascunho(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const noticiaId = Number(formData.get("noticia_id"));
  if (!noticiaId) return;
  const carrossel = formData.get("carrossel") === "on";

  const { data: noticia, error } = await supabase
    .from("social_media_noticias")
    .select("titulo, resumo, link, social_media_fontes(nome, categoria)")
    .eq("id", noticiaId)
    .single();
  if (error || !noticia) return;

  const fonte = noticia.social_media_fontes as unknown as { nome: string; categoria: string } | null;
  const dadosNoticia = {
    titulo: noticia.titulo,
    resumo: noticia.resumo,
    link: noticia.link,
    fonteNome: fonte?.nome ?? "fonte desconhecida",
  };

  if (carrossel) {
    const conteudo = await gerarConteudoCarrosselDeNoticia(dadosNoticia);
    await supabase.from("social_media_posts").insert({
      noticia_id: noticiaId,
      categoria: fonte?.categoria ?? "mercado_imobiliario",
      titulo_card: conteudo.slides[0],
      legenda: conteudo.legenda,
      slides: conteudo.slides,
    });
  } else {
    const conteudo = await gerarConteudoDeNoticia(dadosNoticia);
    await supabase.from("social_media_posts").insert({
      noticia_id: noticiaId,
      categoria: fonte?.categoria ?? "mercado_imobiliario",
      titulo_card: conteudo.titulo_card,
      legenda: conteudo.legenda,
      tipo_post: conteudo.tipo_post,
      numero_destaque: conteudo.numero_destaque,
    });
  }
  await supabase.from("social_media_noticias").update({ usado: true }).eq("id", noticiaId);

  revalidatePath("/social-media");
}

// Post institucional livre — sem notícia de origem, só um tema digitado.
export async function gerarRascunhoInstitucional(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const tema = String(formData.get("tema") ?? "").trim();
  if (!tema) return;
  const carrossel = formData.get("carrossel") === "on";

  if (carrossel) {
    const conteudo = await gerarConteudoCarrosselInstitucional(tema);
    await supabase.from("social_media_posts").insert({
      tema_institucional: tema,
      categoria: "institucional",
      titulo_card: conteudo.slides[0],
      legenda: conteudo.legenda,
      slides: conteudo.slides,
    });
  } else {
    const conteudo = await gerarConteudoInstitucional(tema);
    await supabase.from("social_media_posts").insert({
      tema_institucional: tema,
      categoria: "institucional",
      titulo_card: conteudo.titulo_card,
      legenda: conteudo.legenda,
      tipo_post: conteudo.tipo_post,
      numero_destaque: conteudo.numero_destaque,
    });
  }

  revalidatePath("/social-media");
}

// Publica de verdade no Instagram — só roda quando você clica, nunca
// sozinho (ver plano da Fase 3/4: automação total fica pausada até você
// pedir). Guarda o resultado (sucesso ou erro) no próprio post.
export async function aprovarEPublicar(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const postId = Number(formData.get("post_id"));
  if (!postId) return;

  await publicarPostPorId(supabase, postId);

  revalidatePath("/social-media");
}

// Agenda a publicação pra mais tarde em vez de publicar agora -- não muda
// nada na hora, só marca status "agendado" + agendado_para. Quem publica de
// fato quando a hora chegar é o cron
// (src/app/api/cron/publicar-social-media/route.ts), que roda a cada 5 min.
export async function agendarPublicacao(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const postId = Number(formData.get("post_id"));
  const dataHoraLocal = String(formData.get("agendado_para") ?? "").trim();
  if (!postId) return;

  if (!dataHoraLocal) {
    redirect(`/social-media?erro=${encodeURIComponent("Escolha uma data e horário pro agendamento.")}`);
  }
  const agendadoPara = new Date(`${dataHoraLocal}:00${OFFSET_BRASILIA}`);
  if (Number.isNaN(agendadoPara.getTime()) || agendadoPara.getTime() <= Date.now()) {
    redirect(`/social-media?erro=${encodeURIComponent("A data do agendamento precisa ser no futuro.")}`);
  }

  await supabase
    .from("social_media_posts")
    .update({ status: "agendado", agendado_para: agendadoPara.toISOString() })
    .eq("id", postId);

  revalidatePath("/social-media");
}

// Cancelar volta pro rascunho (editável/publicável de novo), não é estado
// terminal -- o post continua existindo, só perde a data marcada.
export async function cancelarAgendamento(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const postId = Number(formData.get("post_id"));
  if (!postId) return;
  await supabase.from("social_media_posts").update({ status: "rascunho", agendado_para: null }).eq("id", postId);
  revalidatePath("/social-media");
}

// Arquivamento (pedido do Matheus, 16/09/2026): tira o post do radar do dia
// a dia sem apagar nada -- diferente de descartarRascunho, que apaga de
// verdade. Pode desarquivar a qualquer momento.
export async function arquivarPost(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const postId = Number(formData.get("post_id"));
  if (!postId) return;
  await supabase.from("social_media_posts").update({ arquivado_em: new Date().toISOString() }).eq("id", postId);
  revalidatePath("/social-media");
}

export async function desarquivarPost(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const postId = Number(formData.get("post_id"));
  if (!postId) return;
  await supabase.from("social_media_posts").update({ arquivado_em: null }).eq("id", postId);
  revalidatePath("/social-media");
}

const TAMANHO_MAXIMO_FOTO_BYTES = 5 * 1024 * 1024; // 5 MB, mesmo padrão de uploadImagemCampanha

// Sobe uma foto pessoal (ex: do Matheus, em evento) pra usar no lugar do
// card gerado por next/og -- pedido de 15/09/2026. Bucket público
// "social-media-fotos" (URL de verdade, necessária pro Instagram buscar a
// imagem direto). A troca de fato acontece em
// src/app/api/social/imagem/[postId]/route.tsx, que redireciona pra essa
// URL quando ela existir -- tanto o preview na tela quanto a publicação de
// verdade usam essa mesma rota, então ficam sempre sincronizados.
export async function enviarFotoManual(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const postId = Number(formData.get("post_id"));
  if (!postId) return;

  const foto = formData.get("foto");
  if (!(foto instanceof File) || foto.size === 0) {
    redirect(`/social-media?foto_erro=${encodeURIComponent("Nenhuma foto selecionada.")}`);
  }
  if (!foto.type.startsWith("image/")) {
    redirect(`/social-media?foto_erro=${encodeURIComponent("Só é permitido enviar imagens.")}`);
  }
  if (foto.size > TAMANHO_MAXIMO_FOTO_BYTES) {
    redirect(`/social-media?foto_erro=${encodeURIComponent("Foto maior que 5 MB.")}`);
  }

  const ext = foto.name.split(".").pop() || "jpg";
  const path = `${postId}-${crypto.randomUUID()}.${ext}`;
  const { error: erroUpload } = await supabase.storage.from("social-media-fotos").upload(path, foto, { contentType: foto.type });
  if (erroUpload) {
    redirect(`/social-media?foto_erro=${encodeURIComponent(erroUpload.message)}`);
  }

  const { data: publicUrlData } = supabase.storage.from("social-media-fotos").getPublicUrl(path);
  await supabase.from("social_media_posts").update({ imagem_manual_url: publicUrlData.publicUrl }).eq("id", postId);

  revalidatePath("/social-media");
}

// Volta a usar o card gerado automaticamente em vez da foto manual.
export async function removerFotoManual(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const postId = Number(formData.get("post_id"));
  if (!postId) return;
  await supabase.from("social_media_posts").update({ imagem_manual_url: null }).eq("id", postId);
  revalidatePath("/social-media");
}

// Descarta um rascunho que não ficou bom.
export async function descartarRascunho(formData: FormData) {
  const supabase = await exigirAcessoInterno();
  const postId = Number(formData.get("post_id"));
  if (!postId) return;

  // Achado real (relatado pelo Matheus, 15/09/2026): descartar um post
  // apagava a linha, mas nunca desmarcava `usado` na notícia de origem --
  // a notícia ficava travada pra sempre (marcada como usada, sem post
  // nenhum pra mostrar, e sem aparecer de novo na lista de pendentes pra
  // gerar outro rascunho). Busca o noticia_id ANTES de apagar o post pra
  // poder reabrir a notícia.
  const { data: post } = await supabase.from("social_media_posts").select("noticia_id").eq("id", postId).single();

  await supabase.from("social_media_posts").delete().eq("id", postId);

  if (post?.noticia_id) {
    await supabase.from("social_media_noticias").update({ usado: false }).eq("id", post.noticia_id);
  }

  revalidatePath("/social-media");
}
