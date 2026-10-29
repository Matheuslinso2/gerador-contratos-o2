"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { podeVerBaixas } from "@/lib/erp/acessoBaixas";

// ERP O2 — Gestão das baixas: anotações por seguradora/extrato e saldo a cobrar da seguradora. Nada é escrito no Corp nem no Nibo.
// A baixa automática NÃO tem ação aqui: ela só é avaliada (modo teste) até o Matheus ligar, seguradora por seguradora.

async function exigir() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!podeVerBaixas(user?.email)) redirect("/erp");
  return { supabase, email: user?.email ?? null };
}
const volta = (mes: string, ancora: string) => `/erp/baixas/gestao?mes=${encodeURIComponent(mes)}#${ancora}`;

export async function salvarNotaBaixa(formData: FormData) {
  const { supabase, email } = await exigir();
  const seguradora_id = String(formData.get("seguradora_id") ?? "");
  const corretora_id = String(formData.get("corretora_id") ?? "") || null;
  const extrato_id = String(formData.get("extrato_id") ?? "") || null;
  const texto = String(formData.get("texto") ?? "").trim();
  const mes = String(formData.get("mes") ?? "");
  const ancora = String(formData.get("ancora") ?? "");
  if (!seguradora_id || !texto) redirect(volta(mes, ancora));
  const { error } = await supabase.from("erp_gestao_baixas_notas").insert({ seguradora_id, corretora_id, extrato_id, texto, por_email: email });
  if (error) redirect(`${volta(mes, ancora)}&erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/erp/baixas/gestao");
  redirect(volta(mes, ancora));
}

export async function criarSaldoCobrar(formData: FormData) {
  const { supabase, email } = await exigir();
  const seguradora_id = String(formData.get("seguradora_id") ?? "");
  const corretora_id = String(formData.get("corretora_id") ?? "") || null;
  const extrato_id = String(formData.get("extrato_id") ?? "") || null;
  const valor = Number(String(formData.get("valor") ?? "").replace(/\./g, "").replace(",", "."));
  const motivo = String(formData.get("motivo") ?? "").trim();
  const mes = String(formData.get("mes") ?? "");
  const ancora = String(formData.get("ancora") ?? "");
  if (!seguradora_id || !motivo || !Number.isFinite(valor) || valor === 0) redirect(`${volta(mes, ancora)}&erro=${encodeURIComponent("Informe o valor e o motivo do saldo a cobrar.")}`);
  const { error } = await supabase.from("erp_saldo_cobrar_seguradora").insert({ seguradora_id, corretora_id, extrato_id, valor, motivo, por_email: email });
  if (error) redirect(`${volta(mes, ancora)}&erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/erp/baixas/gestao");
  redirect(volta(mes, ancora));
}

export async function fecharSaldoCobrar(formData: FormData) {
  const { supabase } = await exigir();
  const id = String(formData.get("id") ?? "");
  const situacao = String(formData.get("situacao") ?? "");
  const mes = String(formData.get("mes") ?? "");
  const ancora = String(formData.get("ancora") ?? "");
  if (!id || !["recebido", "perdoado"].includes(situacao)) redirect(volta(mes, ancora));
  const { error } = await supabase.from("erp_saldo_cobrar_seguradora").update({ situacao, fechado_em: new Date().toISOString().slice(0, 10) }).eq("id", id);
  if (error) redirect(`${volta(mes, ancora)}&erro=${encodeURIComponent(error.message)}`);
  revalidatePath("/erp/baixas/gestao");
  redirect(volta(mes, ancora));
}
