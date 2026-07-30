"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { montarFichaImobiliaria } from "@/lib/prospeccaoIA";
import { obterNumerosO2 } from "@/lib/numerosO2";
import { buscarHistoricoEComparativo, buscarImobiliariaConhecida } from "@/lib/prospeccaoDados";

export async function criarRelatorioProspeccao(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const nome = String(formData.get("nome") ?? "").trim();
  let cnpj = String(formData.get("cnpj") ?? "").trim();
  const url_site = String(formData.get("url_site") ?? "").trim();
  const url_instagram = String(formData.get("url_instagram") ?? "").trim();
  const notas_manuais = String(formData.get("notas_manuais") ?? "").trim();

  if (!nome) {
    redirect(`/prospeccao?erro=${encodeURIComponent("Informe ao menos o nome da imobiliária.")}`);
  }

  // Fase 2 vai preencher isso de verdade buscando o site/Instagram
  // informados. Por enquanto a ficha é montada só com as notas manuais.
  const textoSite = "";
  const textoInstagram = "";

  const [{ historico: historico_cotacoes, regional: comparativo_regional }, numeros_o2, imobiliariaConhecida] =
    await Promise.all([
      buscarHistoricoEComparativo(nome),
      obterNumerosO2(),
      buscarImobiliariaConhecida(supabase, nome),
    ]);

  // Se o colaborador não informou o CNPJ, mas achamos uma correspondência
  // única no registro interno de imobiliárias já conhecidas, usa esse CNPJ.
  if (!cnpj && imobiliariaConhecida) {
    cnpj = imobiliariaConhecida.cnpj;
  }

  let ficha;
  try {
    ficha = await montarFichaImobiliaria(nome, cnpj, notas_manuais, textoSite, textoInstagram);
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha ao montar a ficha da imobiliária.";
    redirect(`/prospeccao?erro=${encodeURIComponent(mensagem)}`);
  }

  const { data: relatorio, error } = await supabase
    .from("relatorios_prospeccao")
    .insert({
      criado_por: user.id,
      criado_por_email: user.email,
      nome_imobiliaria: nome,
      cnpj_imobiliaria: cnpj || null,
      url_site: url_site || null,
      url_instagram: url_instagram || null,
      notas_manuais: notas_manuais || null,
      ficha,
      historico_cotacoes,
      comparativo_regional,
      numeros_o2,
    })
    .select("id")
    .single();

  if (error) redirect(`/prospeccao?erro=${encodeURIComponent(error.message)}`);

  redirect(`/prospeccao/${relatorio.id}`);
}
