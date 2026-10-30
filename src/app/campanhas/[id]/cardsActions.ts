"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { criarCardsDaCampanha, vincularCardsExistentes } from "@/lib/campanhas/cardsBitrix";

// Cards no funil Campanhas do Bitrix (30/10/2026). Interruptor desligado por
// padrão: nem toda campanha cria card. Só quem tem acesso à área de campanhas
// liga/desliga; ao ligar, a confirmação é a caixa marcada + o aviso da tela.

async function exigirAcesso(campanhaId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  const { data: campanha } = await supabase.from("campanhas").select("id, nome, status, valido_de, valido_ate, imobiliarias_selecionadas, criado_por_email, campanha_pai_id").eq("id", campanhaId).single();
  if (!campanha) redirect("/campanhas");
  if (campanha.campanha_pai_id) redirect(`/campanhas/${campanhaId}?erro=${encodeURIComponent("Os cards ficam na campanha principal, não nos e-mails dela.")}`);
  return { user, campanha, db: createServiceClient() };
}

const voltar = (id: string, tipo: "ok" | "erro", texto: string) => redirect(`/campanhas/${id}?${tipo}=${encodeURIComponent(texto)}#cards-bitrix`);

export async function alternarCriarCardsBitrix(formData: FormData) {
  const id = String(formData.get("campanha_id") ?? "");
  const ligar = String(formData.get("ligar") ?? "") === "1";
  const { user, db } = await exigirAcesso(id);
  const { error } = await db
    .from("campanhas")
    .update({ criar_cards_bitrix: ligar, cards_bitrix_ativado_por: ligar ? (user.email ?? null) : null, cards_bitrix_ativado_em: ligar ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return voltar(id, "erro", "Não consegui salvar a opção: " + error.message);
  return voltar(id, "ok", ligar ? "Pronto: ao enviar os e-mails desta campanha, um card por imobiliária será criado no funil Campanhas do Bitrix." : "Desligado: esta campanha não cria cards no Bitrix.");
}

export async function criarCardsAgora(formData: FormData) {
  const id = String(formData.get("campanha_id") ?? "");
  const { user, campanha, db } = await exigirAcesso(id);
  const r = await criarCardsDaCampanha(db, campanha, user.email ?? "workspace", 25);
  const partes = [`${r.criados} card(s) criado(s) no Bitrix`];
  if (r.empresasCriadas) partes.push(`${r.empresasCriadas} empresa(s) cadastrada(s) no Bitrix`);
  if (r.restantes > 0) partes.push(`faltam ${r.restantes} — clique em "Criar agora" de novo para continuar`);
  if (r.falhas.length) return voltar(id, "erro", `${partes.join("; ")}. Não deu certo para: ${r.falhas.slice(0, 5).map((f) => `${f.nome} (${f.erro})`).join("; ")}${r.falhas.length > 5 ? "…" : ""}`);
  return voltar(id, "ok", partes.join("; ") + ".");
}

export async function ligarCardsExistentes(formData: FormData) {
  const id = String(formData.get("campanha_id") ?? "");
  const { user, campanha, db } = await exigirAcesso(id);
  const r = await vincularCardsExistentes(db, campanha, user.email ?? "workspace", true);
  const partes = [`${r.vinculados} card(s) ligado(s) à campanha`];
  if (r.jaVinculados) partes.push(`${r.jaVinculados} já estavam ligados`);
  if (r.semEmpresaVinculada.length) partes.push(`${r.semEmpresaVinculada.length} card(s) do funil com empresa sem vínculo na base de imobiliárias (ficam de fora)`);
  return voltar(id, "ok", partes.join("; ") + ". Nada foi criado nem alterado no Bitrix.");
}
