"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { enviarEmail } from "@/lib/email";
import { chamarBitrix } from "@/lib/bitrix/client";
import { gerarPreviaParciais } from "@/lib/campanhas/previaParciais";
import { produtosDaCampanha } from "@/lib/campanhas/produtos";
import { limparNomeRemetente, nomeExibidoRemetente } from "@/lib/campanhas/remetente";
import { enderecoDaImagem, dataBr, formatarValor, type DadosPanorama } from "@/lib/campanhas/panoramaCampanha";
import { montarEmailParcial, TEXTO_PADRAO_PARCIAL } from "@/lib/campanhas/parcialCampanha";
import { dispararCampanha } from "@/lib/campanhas/dispararCampanha";
import { ENDERECO_REMETENTE_CAMPANHAS, montarHtmlCampanha, type CampanhaRow } from "@/lib/campanhas/processarLote";
import { linkDescadastro } from "@/lib/campanhas/unsubscribeToken";

// "Enviar parciais" (30/10/2026), em 2 passos: (1) gera a PRÉVIA, que já grava
// uma versão do panorama por imobiliária com os números de agora; (2) a equipe
// revisa o texto e as imagens e envia. O que foi visto na prévia é exatamente o
// que sai (os números ficam fixos na versão).

async function exigirEquipe() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  return { supabase, user };
}

const irParaCampanha = (id: string, chave: "erro" | "ok", texto: string) => redirect(`/campanhas/${id}?${chave}=${encodeURIComponent(texto)}#producao`);
const irParaParciais = (id: string, lote: string, chave: "erro" | "ok", texto: string) => redirect(`/campanhas/${id}/parciais?lote=${lote}&${chave}=${encodeURIComponent(texto)}`);

export async function prepararParciais(campanhaId: string) {
  const { supabase, user } = await exigirEquipe();
  const { data: campanha } = await supabase.from("campanhas").select("*").eq("id", campanhaId).maybeSingle();
  if (!campanha) redirect("/campanhas");
  const r = await gerarPreviaParciais(createServiceClient(), campanha, user.email ?? null);
  if (!r.ok) return irParaCampanha(campanhaId, "erro", r.erro);
  redirect(`/campanhas/${campanhaId}/parciais?lote=${r.lote}`);
}

export async function descartarParciais(campanhaId: string, loteId: string) {
  await exigirEquipe();
  await createServiceClient().from("campanhas_panoramas").update({ status: "descartada" }).eq("campanha_id", campanhaId).eq("lote_id", loteId).eq("status", "previa");
  irParaCampanha(campanhaId, "ok", "Prévia das parciais descartada. Nada foi enviado.");
}

type PanoramaRow = { id: string; participante_id: string; imobiliaria_ids: string[]; nome: string; versao: number; token: string; dados: DadosPanorama };

async function carregarLote(campanhaId: string, loteId: string, formData: FormData) {
  const db = createServiceClient();
  const { data } = await db.from("campanhas_panoramas").select("id, participante_id, imobiliaria_ids, nome, versao, token, dados").eq("campanha_id", campanhaId).eq("lote_id", loteId).eq("status", "previa");
  const excluidos = new Set(formData.getAll("excluir").map(String));
  const linhas = ((data ?? []) as PanoramaRow[]).filter((l) => !excluidos.has(l.id)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const texto = String(formData.get("texto") ?? "").trim() || TEXTO_PADRAO_PARCIAL;
  return { db, linhas, texto };
}

// Teste: o e-mail da primeira imobiliária da lista, para quem está logado.
export async function enviarTesteParciais(campanhaId: string, loteId: string, formData: FormData) {
  const { user } = await exigirEquipe();
  const { linhas, texto } = await carregarLote(campanhaId, loteId, formData);
  if (!linhas.length) irParaParciais(campanhaId, loteId, "erro", "Não há nenhuma imobiliária marcada para enviar.");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl || !user.email) irParaParciais(campanhaId, loteId, "erro", "Não consegui montar o teste (endereço do site ou e-mail do usuário ausente).");
  const remetente = limparNomeRemetente(formData.get("remetente_nome"));
  const l = linhas[0];
  const e = montarEmailParcial(l.dados, texto, enderecoDaImagem(l.token));
  const row: CampanhaRow = { id: campanhaId, assunto: e.assunto, template: "comunicado", titulo: e.titulo, introducao: e.introducao, valido_de: l.dados.inicio, valido_ate: l.dados.fim, corpo_html: e.corpoHtml, cta_texto: null, cta_href: null, personalizacao: "nenhuma", remetente_nome: remetente };
  try {
    await enviarEmail({
      para: [user.email!],
      assunto: `[TESTE] ${e.assunto}`,
      html: montarHtmlCampanha(row, linkDescadastro(user.email!, siteUrl!, campanhaId)),
      remetente: nomeExibidoRemetente(remetente),
      enderecoRemetente: ENDERECO_REMETENTE_CAMPANHAS,
      throwSeFalhar: true,
    });
  } catch (erro) {
    irParaParciais(campanhaId, loteId, "erro", erro instanceof Error ? erro.message : String(erro));
  }
  irParaParciais(campanhaId, loteId, "ok", `E-mail de teste (${l.nome}) enviado para ${user.email}.`);
}

async function comentarNosCards(db: ReturnType<typeof createServiceClient>, campanhaId: string, l: PanoramaRow): Promise<{ comentados: number; falhas: number }> {
  const { data } = await db.from("campanhas_cards_bitrix").select("bitrix_deal_id").eq("campanha_id", campanhaId).in("imobiliaria_id", l.imobiliaria_ids);
  const d = l.dados;
  const u = d.moeda || !d.unidade ? "" : ` ${d.unidade}`;
  const texto =
    `Parcial nº ${d.versao} da campanha ${d.campanha} enviada em ${dataBr(d.posicaoEm)}: ` +
    `realizado ${formatarValor(d.realizado, d.moeda)}${u}` +
    (d.meta ? ` de ${formatarValor(d.meta, d.moeda)}${u} (${Math.round(d.percentual ?? 0)}% da meta)` : "") +
    (d.faltam && d.faltam > 0 ? `, faltam ${formatarValor(d.faltam, d.moeda)}${u}` : "") +
    (d.diasRestantes > 0 ? `, ${d.diasRestantes} dias até o fim` : ", campanha encerrada") +
    `. Panorama enviado: ${enderecoDaImagem(l.token)}`;
  let comentados = 0;
  let falhas = 0;
  for (const r of (data ?? []) as { bitrix_deal_id: number }[]) {
    try {
      await chamarBitrix("crm.timeline.comment.add", { "fields[ENTITY_ID]": r.bitrix_deal_id, "fields[ENTITY_TYPE]": "deal", "fields[COMMENT]": texto });
      comentados++;
    } catch {
      falhas++;
    }
  }
  return { comentados, falhas };
}

export async function enviarParciais(campanhaId: string, loteId: string, formData: FormData) {
  const { supabase, user } = await exigirEquipe();
  const { db, linhas, texto } = await carregarLote(campanhaId, loteId, formData);
  if (!linhas.length) irParaParciais(campanhaId, loteId, "erro", "Não há nenhuma imobiliária marcada para enviar.");
  const { data: campanha } = await supabase.from("campanhas").select("*").eq("id", campanhaId).maybeSingle();
  if (!campanha) redirect("/campanhas");

  const remetenteNome = limparNomeRemetente(formData.get("remetente_nome")) ?? (campanha.remetente_nome as string | null) ?? null;
  const agendarTexto = String(formData.get("agendado_para") ?? "").trim();
  let agendadoPara: string | null = null;
  if (agendarTexto) {
    const data = new Date(`${agendarTexto}:00-03:00`);
    if (Number.isNaN(data.getTime()) || data.getTime() <= Date.now()) irParaParciais(campanhaId, loteId, "erro", "O agendamento da parcial precisa ser no futuro.");
    agendadoPara = data.toISOString();
  }

  const produtos = produtosDaCampanha(campanha);
  let enviadas = 0;
  let falhasCard = 0;
  let cardsComentados = 0;
  const problemas: string[] = [];
  for (const l of linhas) {
    const e = montarEmailParcial(l.dados, texto, enderecoDaImagem(l.token));
    const { data: filho, error } = await db
      .from("campanhas")
      .insert({
        nome: e.nome,
        assunto: e.assunto,
        template: "comunicado",
        personalizacao: "nenhuma",
        titulo: e.titulo,
        introducao: e.introducao,
        corpo_html: e.corpoHtml,
        valido_de: l.dados.inicio,
        valido_ate: l.dados.fim,
        produto: produtos[0] ?? "institucional",
        produtos: produtos.length ? produtos : ["institucional"],
        campanha_pai_id: campanhaId,
        imobiliarias_selecionadas: l.imobiliaria_ids,
        remetente_nome: remetenteNome,
        criado_por: user.id,
        criado_por_email: user.email,
        status: agendadoPara ? "agendada" : "rascunho",
        agendado_para: agendadoPara,
      })
      .select("id")
      .single();
    if (error || !filho) {
      problemas.push(`${l.nome}: ${error?.message ?? "falha ao criar o e-mail"}`);
      continue;
    }
    if (!agendadoPara) {
      const r = await dispararCampanha(db, filho.id);
      if (!r.ok) problemas.push(`${l.nome}: ${r.erro}`);
    }
    await db.from("campanhas_panoramas").update({ status: "enviada", enviado_em: new Date().toISOString(), email_campanha_id: filho.id, texto }).eq("id", l.id);
    enviadas++;
    const c = await comentarNosCards(db, campanhaId, l);
    falhasCard += c.falhas;
    cardsComentados += c.comentados;
  }
  // Quem foi desmarcado na revisão não recebe parcial e sua prévia sai da lista.
  await db.from("campanhas_panoramas").update({ status: "descartada" }).eq("campanha_id", campanhaId).eq("lote_id", loteId).eq("status", "previa");

  const resumo =
    `${enviadas} parcial(is) ${agendadoPara ? "agendada(s)" : "em envio"}. As versões do panorama foram gravadas` +
    (falhasCard ? ` (${falhasCard} comentário(s) nos cards do Bitrix não puderam ser registrados)` : cardsComentados ? ` e registradas em ${cardsComentados} card(s) do Bitrix` : "") +
    ".";
  if (problemas.length) irParaCampanha(campanhaId, "erro", `${resumo} Com problema: ${problemas.slice(0, 4).join("; ")}.`);
  irParaCampanha(campanhaId, "ok", resumo);
}
