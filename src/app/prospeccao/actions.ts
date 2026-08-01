"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { montarFichaImobiliaria } from "@/lib/prospeccaoIA";
import { obterNumerosO2 } from "@/lib/numerosO2";
import {
  buscarHistoricoEComparativo,
  buscarImobiliariaConhecida,
  buscarMetricasImobiliaria,
  type HistoricoCotacoes,
  type ComparativoRegional,
  type ImobiliariaConhecida,
} from "@/lib/prospeccaoDados";
import { buscarTicketPorLocal, type TicketPorLocal } from "@/lib/prospeccaoEstatisticas";

export async function criarRelatorioProspeccao(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const nome = String(formData.get("nome") ?? "").trim();
  let cnpj = String(formData.get("cnpj") ?? "").trim();
  let bairros = formData.getAll("bairros").map((b) => String(b).trim()).filter(Boolean);
  let cidadeInformada = String(formData.get("cidade") ?? "").trim();
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

  let historico_cotacoes: HistoricoCotacoes = {
    incendio_total_encontradas: 0,
    incendio_efetivadas: 0,
    incendio_exemplos: [],
    fianca_total_encontradas: 0,
    fianca_exemplos: [],
  };
  let comparativo_regional: ComparativoRegional = {
    cidade_da_imobiliaria: null,
    cotacoes_incendio_na_mesma_cidade: 0,
    cidade_com_mais_cotacoes: null,
    cotacoes_na_cidade_mais_frequente: 0,
    total_cotacoes_incendio_analisadas: 0,
    ticket_medio_incendio_geral: null,
    ticket_medio_incendio_na_cidade: null,
    ticket_medio_fianca_geral: null,
    ticket_medio_fianca_na_cidade: null,
    observacao: "Não foi possível consultar as planilhas do Google Sheets agora.",
  };
  let imobiliariaConhecida: ImobiliariaConhecida | null = null;

  // Uma falha na integração com o Google Sheets (rate limit, planilha
  // reorganizada, etc.) não pode derrubar a geração do relatório inteiro —
  // nesse caso, segue só sem o histórico/comparativo, e loga o motivo real
  // pra dar pra investigar depois via Vercel Runtime Logs.
  try {
    const resultado = await buscarHistoricoEComparativo(supabase, nome);
    historico_cotacoes = resultado.historico;
    comparativo_regional = resultado.regional;
  } catch (e) {
    console.error("[prospeccao] erro ao buscar histórico/comparativo nas planilhas:", e);
  }

  try {
    historico_cotacoes.metricas_por_produto = await buscarMetricasImobiliaria(supabase, nome);
  } catch (e) {
    console.error("[prospeccao] erro ao buscar métricas por imobiliária:", e);
  }

  try {
    imobiliariaConhecida = await buscarImobiliariaConhecida(supabase, nome);
  } catch (e) {
    console.error("[prospeccao] erro ao buscar imobiliária conhecida:", e);
  }

  const numeros_o2 = await obterNumerosO2();

  // Se o colaborador não informou o CNPJ, mas achamos uma correspondência
  // única no registro interno de imobiliárias já conhecidas, usa esse CNPJ.
  if (!cnpj && imobiliariaConhecida) {
    cnpj = imobiliariaConhecida.cnpj;
  }
  // Idem pro bairro/cidade — se o colaborador não selecionou nenhum bairro,
  // usa o que está cadastrado pra essa imobiliária.
  if (!bairros.length && imobiliariaConhecida?.bairro) {
    bairros = [imobiliariaConhecida.bairro];
  }
  if (!cidadeInformada && imobiliariaConhecida?.cidade) {
    cidadeInformada = imobiliariaConhecida.cidade;
  }

  let ticket_por_faixa: TicketPorLocal | null = null;
  try {
    ticket_por_faixa = await buscarTicketPorLocal(supabase, bairros, cidadeInformada);
  } catch (e) {
    console.error("[prospeccao] erro ao buscar ticket por bairro:", e);
  }

  // Potencial bruto (referência, não projeção): quantidade de imóveis da
  // imobiliária x ticket médio de fiança ponderado pelas faixas com dado —
  // assume 100% de adesão de propósito, só pra dar uma noção de tamanho.
  let potencial_bruto_mensal: number | null = null;
  if (imobiliariaConhecida?.quantidade_imoveis && ticket_por_faixa) {
    const faixasComDado = ticket_por_faixa.fianca_por_faixa.filter((f) => f.ticket_medio !== null);
    const totalQtd = faixasComDado.reduce((s, f) => s + f.quantidade, 0);
    if (totalQtd > 0) {
      const ticketBlend = faixasComDado.reduce((s, f) => s + (f.ticket_medio ?? 0) * f.quantidade, 0) / totalQtd;
      potencial_bruto_mensal = Math.round(imobiliariaConhecida.quantidade_imoveis * ticketBlend * 100) / 100;
    }
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
      ticket_por_faixa,
      numeros_o2,
      crm_classificacao: imobiliariaConhecida?.classificacao_crm ?? null,
      crm_responsavel: imobiliariaConhecida?.responsavel_crm ?? null,
      quantidade_imoveis: imobiliariaConhecida?.quantidade_imoveis ?? null,
      potencial_bruto_mensal,
    })
    .select("id")
    .single();

  if (error) redirect(`/prospeccao?erro=${encodeURIComponent(error.message)}`);

  redirect(`/prospeccao/${relatorio.id}`);
}
