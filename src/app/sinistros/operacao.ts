"use server";

// Operação do sinistro pela equipe O2 (21/10/2026): ciclo completo
// (indenização, acordo/judicial, encerramento, reabertura), edição dos dados
// em qualquer etapa, equipe de responsáveis, atribuição em lote, busca de
// apólice, reaproveitamento de dados/documentos e abertura de outros produtos.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2, DOMINIO_O2 } from "@/lib/admin";
import { COBERTURAS_LMI, ETAPAS, calcularPrazoAviso, formatarReais, hojeSP, saldoLmi, situacaoDoFormulario, type EtapaSinistro, type TipoSinistro } from "@/lib/sinistros/regras";
import { emailAtualizacaoParaImobiliaria, type SinistroEmail } from "@/lib/sinistros/emails";

type Supa = Awaited<ReturnType<typeof createClient>>;

async function contexto() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const interno = isAdmin(user.email) || isColaboradorO2(user.email);
  return { supabase, user, interno };
}

async function exigirInterno() {
  const ctx = await contexto();
  if (!ctx.interno) redirect("/sinistros/gestao");
  return ctx;
}

function texto(fd: FormData, campo: string) {
  const v = fd.get(campo);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// "1.234,56", "1234,56" ou "1234.56" -> 1234.56
function valor(fd: FormData, campo: string) {
  const t = texto(fd, campo);
  if (!t) return null;
  const limpo = t.replace(/[^\d,.-]/g, "");
  const n = Number(limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo);
  return Number.isFinite(n) ? n : null;
}

function voltar(id: string, opcoes: { erro?: string; sucesso?: string; aba?: string; ctx?: string | null } = {}): never {
  const q = new URLSearchParams();
  if (opcoes.aba) q.set("aba", opcoes.aba);
  if (opcoes.ctx) q.set("ctx", opcoes.ctx);
  if (opcoes.erro) q.set("erro", opcoes.erro);
  if (opcoes.sucesso) q.set("sucesso", opcoes.sucesso);
  const qs = q.toString();
  redirect(`/sinistros/${id}${qs ? `?${qs}` : ""}`);
}

async function registrar(
  supabase: Supa,
  sinistroId: string,
  dados: { autor_tipo: "imobiliaria" | "o2" | "sistema"; texto: string; referente?: string; visivel_imobiliaria?: boolean; etapa_de?: string | null; etapa_para?: string | null }
) {
  await supabase.from("sinistro_historico").insert({ sinistro_id: sinistroId, visivel_imobiliaria: true, ...dados });
}

async function carregar(supabase: Supa, id: string) {
  const { data } = await supabase.from("sinistros").select("*, imobiliarias(nome, apelido, email)").eq("id", id).maybeSingle();
  return data;
}

function destinosImobiliaria(s: { criado_por_email: string | null; imobiliarias?: { email?: string | null } | null }) {
  const lista: string[] = [];
  if (s.criado_por_email && !s.criado_por_email.toLowerCase().endsWith(DOMINIO_O2) && s.criado_por_email !== "migracao-corp") lista.push(s.criado_por_email);
  if (s.imobiliarias?.email) lista.push(...s.imobiliarias.email.split(","));
  return lista;
}

const ETAPAS_DA_O2: EtapaSinistro[] = ["pre_analise", "na_seguradora", "em_indenizacao", "acordo_judicial", "encerrado"];

// ---------- ciclo do sinistro ----------

export async function mudarEtapa(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  const para = texto(fd, "para") as EtapaSinistro | null;
  if (!para || !ETAPAS_DA_O2.includes(para)) voltar(id, { erro: "Etapa inválida.", ctx });
  const s = await carregar(supabase, id);
  if (!s) voltar(id, { erro: "Sinistro não encontrado.", ctx });
  const mensagem = texto(fd, "mensagem");
  const hoje = hojeSP();

  const dados: Record<string, unknown> = { etapa: para };
  let resumo = `${ETAPAS[s.etapa as EtapaSinistro]?.titulo ?? s.etapa} → ${ETAPAS[para].titulo}`;
  if (para === "encerrado") {
    const { count } = await supabase.from("sinistro_indenizacoes").select("id", { count: "exact", head: true }).eq("sinistro_id", id);
    const desfecho = texto(fd, "desfecho") ?? ((count ?? 0) > 0 ? "indenizado" : null);
    dados.desfecho = desfecho === "indenizado" || desfecho === "sem_indenizacao" ? desfecho : null;
    dados.motivo_encerramento = texto(fd, "motivo");
    dados.encerrado_em = texto(fd, "data") ?? hoje;
    resumo += dados.desfecho === "indenizado" ? " (indenizado)" : dados.desfecho === "sem_indenizacao" ? " (sem indenização)" : "";
    if (dados.motivo_encerramento) resumo += ` — ${dados.motivo_encerramento}`;
  } else {
    // Saiu de encerrado (reabertura) ou mudou de fase: limpa o encerramento.
    dados.desfecho = null;
    dados.motivo_encerramento = null;
    dados.encerrado_em = null;
    if (para === "pre_analise") dados.pre_analise_desde = new Date().toISOString();
    if (para === "na_seguradora" && !s.data_abertura_seguradora) dados.data_abertura_seguradora = hoje;
  }
  // Reunião 21/10/2026: no encerramento, apólice vencida = alerta imediato;
  // encerrou sem entrega das chaves = verificar a renovação da apólice.
  const alertas: string[] = [];
  if (para === "encerrado") {
    const fimVig = s.vigencia_fim as string | null;
    const enc = dados.encerrado_em as string;
    if (fimVig && fimVig < enc) alertas.push(`Apólice vencida em ${fimVig.split("-").reverse().join("/")}: verificar a renovação com a imobiliária.`);
    if ((s.produto ?? "fianca") === "fianca" && !s.data_entrega_chaves)
      alertas.push("Sinistro encerrado sem entrega das chaves: o locatário segue no imóvel, verificar a renovação da apólice.");
    if (alertas.length && !s.proxima_acao_em) {
      dados.proxima_acao_em = hoje;
      dados.proxima_acao_descricao = "Verificar renovação da apólice";
    }
  }
  const { error } = await supabase.from("sinistros").update(dados).eq("id", id);
  if (error) voltar(id, { erro: error.message, ctx });
  await registrar(supabase, id, {
    autor_tipo: "o2",
    referente: "imobiliaria",
    texto: `${resumo}.${mensagem ? `\n\n${mensagem}` : ""}`,
    etapa_de: s.etapa,
    etapa_para: para,
  });
  for (const a of alertas) await registrar(supabase, id, { autor_tipo: "sistema", referente: "interno", visivel_imobiliaria: false, texto: `⚠ ${a}` });

  if (fd.get("avisar") === "on") {
    const destinos = destinosImobiliaria(s);
    await emailAtualizacaoParaImobiliaria(
      { ...s, etapa: para } as SinistroEmail,
      destinos,
      para === "encerrado" ? "Sinistro encerrado" : `Sinistro: ${ETAPAS[para].tituloImobiliaria}`,
      mensagem ?? resumo
    );
  }
  revalidatePath("/sinistros/gestao");
  if (alertas.length) voltar(id, { erro: `Etapa: ${ETAPAS[para].titulo}. Atenção — ${alertas.join(" ")}`, ctx });
  voltar(id, { sucesso: `Etapa: ${ETAPAS[para].titulo}.`, ctx });
}

// Acordo / judicial: nº interno, datas do acordo e das parcelas (reunião 21/10/2026).
// O cron de alertas avisa todo mês, 1 dia útil depois do vencimento da parcela.
export async function salvarAcordo(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  const s = await carregar(supabase, id);
  if (!s) voltar(id, { erro: "Sinistro não encontrado.", ctx });
  const dados: Record<string, unknown> = {
    acordo_data: texto(fd, "acordo_data"),
    acordo_vencimento_aluguel: texto(fd, "acordo_vencimento_aluguel"),
    acordo_primeira_parcela: texto(fd, "acordo_primeira_parcela"),
    acordo_ultima_parcela: texto(fd, "acordo_ultima_parcela"),
  };
  const mudaEtapa = s.etapa !== "acordo_judicial" && s.etapa !== "encerrado";
  if (mudaEtapa) dados.etapa = "acordo_judicial";
  const { error } = await supabase.from("sinistros").update(dados).eq("id", id);
  if (error) voltar(id, { erro: error.message, ctx });
  const br = (d: unknown) => (typeof d === "string" ? d.split("-").reverse().join("/") : "—");
  await registrar(supabase, id, {
    autor_tipo: "o2",
    referente: "seguradora",
    texto: `Acordo feito em ${br(dados.acordo_data)}, parcelas de ${br(dados.acordo_primeira_parcela)} a ${br(dados.acordo_ultima_parcela)}, aluguel vence em ${br(dados.acordo_vencimento_aluguel)}.`,
    etapa_de: mudaEtapa ? s.etapa : null,
    etapa_para: mudaEtapa ? "acordo_judicial" : null,
  });
  revalidatePath("/sinistros/gestao");
  voltar(id, { sucesso: "Acordo salvo.", ctx });
}

export async function salvarLmi(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  const tipo = texto(fd, "lmi_tipo") === "individual" ? "individual" : "global";
  // Individual: só as coberturas marcadas (as que a apólice tem), cada uma com
  // o seu limite; o LMI "total" vira a soma.
  const coberturas: Record<string, number> = {};
  if (tipo === "individual")
    for (const c of COBERTURAS_LMI) if (fd.get(`ativa_${c.chave}`) === "on") coberturas[c.chave] = valor(fd, `lmi_${c.chave}`) ?? 0;
  const lmi = tipo === "individual" ? (Object.keys(coberturas).length ? Object.values(coberturas).reduce((t, v) => t + v, 0) : null) : valor(fd, "lmi");
  const { error } = await supabase.from("sinistros").update({ lmi, lmi_tipo: tipo, lmi_coberturas: coberturas }).eq("id", id);
  if (error) voltar(id, { erro: error.message, aba: "pagamentos", ctx });
  const detalhe =
    tipo === "individual"
      ? `individual — ${COBERTURAS_LMI.filter((c) => coberturas[c.chave] != null).map((c) => `${c.titulo} ${formatarReais(coberturas[c.chave])}`).join(", ") || "nenhuma cobertura marcada"}`
      : `global — ${lmi != null ? formatarReais(lmi) : "removido"}`;
  await registrar(supabase, id, { autor_tipo: "o2", referente: "interno", visivel_imobiliaria: false, texto: `LMI da apólice: ${detalhe}.` });
  voltar(id, { sucesso: "LMI salvo.", aba: "pagamentos", ctx });
}

export async function registrarIndenizacao(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  const pagoEm = texto(fd, "pago_em") ?? hojeSP();
  const s = await carregar(supabase, id);
  if (!s) voltar(id, { erro: "Sinistro não encontrado.", ctx });
  // LMI individual: rateio por cobertura (interno). Sem valor total digitado,
  // o total é a soma do rateio.
  const rateio: Record<string, number> = {};
  if (s.lmi_tipo === "individual") {
    for (const c of COBERTURAS_LMI) {
      const v = valor(fd, `cob_${c.chave}`);
      if (v) rateio[c.chave] = v;
    }
  }
  const somaRateio = Object.values(rateio).reduce((t, v) => t + v, 0);
  const v = valor(fd, "valor") ?? somaRateio;
  if (!(v > 0)) voltar(id, { erro: "Informe o valor da indenização.", aba: "pagamentos", ctx });
  // Anexo (planilha da seguradora): o navegador sobe o arquivo direto pro
  // bucket e manda só o caminho -- a Server Action na Vercel não aguenta arquivo.
  const anexoPath = texto(fd, "anexo_path");
  const anexo = anexoPath && anexoPath.startsWith(`${id}/`) ? { anexo_path: anexoPath, anexo_nome: texto(fd, "anexo_nome") } : {};
  const { error } = await supabase.from("sinistro_indenizacoes").insert({
    sinistro_id: id,
    valor: v,
    pago_em: pagoEm,
    // Referência vai na observação (ajuste da equipe, 23/10/2026).
    observacao: texto(fd, "observacao"),
    valores_cobertura: rateio,
    ...anexo,
  });
  if (error) voltar(id, { erro: error.message, aba: "pagamentos", ctx });
  const mudaEtapa = ["pre_analise", "pendencia_imobiliaria", "na_seguradora"].includes(s.etapa);
  if (mudaEtapa) await supabase.from("sinistros").update({ etapa: "em_indenizacao" }).eq("id", id);
  await registrar(supabase, id, {
    autor_tipo: "o2",
    referente: "seguradora",
    texto: `Indenização registrada: ${formatarReais(v)}, paga em ${pagoEm.split("-").reverse().join("/")}.`,
    etapa_de: mudaEtapa ? s.etapa : null,
    etapa_para: mudaEtapa ? "em_indenizacao" : null,
  });
  revalidatePath("/sinistros/gestao");
  const avisos: string[] = [];
  if (somaRateio > 0 && Math.abs(somaRateio - v) > 0.009)
    avisos.push(`o rateio por cobertura (${formatarReais(somaRateio)}) não fecha com o total (${formatarReais(v)})`);
  const { data: todas } = await supabase.from("sinistro_indenizacoes").select("valor, valores_cobertura").eq("sinistro_id", id);
  const saldo = saldoLmi(s, todas ?? []);
  if (saldo.tipo === "global" && saldo.saldo != null && saldo.saldo < 0)
    avisos.push(`o total indenizado (${formatarReais(saldo.usado)}) passou do LMI (${formatarReais(saldo.lmi)})`);
  for (const l of saldo.linhas) if (l.saldo < 0) avisos.push(`${l.titulo} passou do LMI da cobertura (${formatarReais(l.usado)} de ${formatarReais(l.lmi)})`);
  if (avisos.length) voltar(id, { erro: `Indenização registrada, mas ${avisos.join("; ")}.`, aba: "pagamentos", ctx });
  voltar(id, { sucesso: "Indenização registrada.", aba: "pagamentos", ctx });
}

// Anexa (ou troca) a planilha de um pagamento já registrado. O arquivo já foi
// enviado pelo navegador para o bucket.
export async function anexarArquivoPagamento(id: string, indenizacaoId: string, caminho: string, nome: string): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await exigirInterno();
  if (!caminho.startsWith(`${id}/`)) return { ok: false, erro: "Caminho de arquivo inválido." };
  const { error } = await supabase.from("sinistro_indenizacoes").update({ anexo_path: caminho, anexo_nome: nome }).eq("id", indenizacaoId).eq("sinistro_id", id);
  if (error) return { ok: false, erro: error.message };
  revalidatePath(`/sinistros/${id}`);
  return { ok: true };
}
export async function removerIndenizacao(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  const { data: ind } = await supabase.from("sinistro_indenizacoes").select("valor, pago_em").eq("id", texto(fd, "indenizacao_id")!).maybeSingle();
  await supabase.from("sinistro_indenizacoes").delete().eq("id", texto(fd, "indenizacao_id")!);
  if (ind) await registrar(supabase, id, { autor_tipo: "o2", referente: "interno", texto: `Indenização de ${formatarReais(Number(ind.valor))} removida.`, visivel_imobiliaria: false });
  voltar(id, { aba: "pagamentos", ctx });
}

// ---------- dados do caso (editáveis em qualquer etapa pela O2) ----------

function camposCaso(fd: FormData) {
  const c: Record<string, unknown> = {};
  const textos = [
    "seguradora", "numero_apolice", "nosso_numero", "vigencia_inicio", "vigencia_fim",
    "locador_nome", "locador_documento", "locatario_nome", "locatario_documento", "locatario_telefone", "locatario_email",
    "numero_sinistro_seguradora", "data_ocorrencia", "observacoes",
  ];
  for (const k of textos) if (fd.has(k)) c[k] = texto(fd, k);
  const endereco: [string, string][] = [
    ["cep", "imovel_cep"], ["logradouro", "imovel_logradouro"], ["numero", "imovel_numero"], ["complemento", "imovel_complemento"],
    ["bairro", "imovel_bairro"], ["cidade", "imovel_cidade"], ["uf", "imovel_uf"],
  ];
  for (const [de, para] of endereco) if (fd.has(de)) c[para] = texto(fd, de);
  if (fd.has("tipo")) c.tipo = texto(fd, "tipo") as TipoSinistro | null;
  // Etapa 1 da Fiança (ocupado/desocupado + 1ª inadimplência).
  const sit = situacaoDoFormulario(texto(fd, "situacao_imovel"), texto(fd, "data_ocorrencia"), texto(fd, "data_entrega_chaves"), texto(fd, "tipo_atual"));
  if (sit) Object.assign(c, sit, (({ prazo, foraDoPrazo }) => ({ prazo_aviso: prazo, aviso_fora_prazo: foraDoPrazo }))(calcularPrazoAviso(sit)));
  if (fd.has("produto")) c.produto = texto(fd, "produto") ?? "fianca";
  if (fd.has("imobiliaria_id")) c.imobiliaria_id = texto(fd, "imobiliaria_id");
  if (fd.has("valor_avisado")) c.valor_avisado = valor(fd, "valor_avisado");
  if (fd.has("lmi")) c.lmi = valor(fd, "lmi");
  return c;
}

export async function salvarDadosCaso(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  const { error } = await supabase.from("sinistros").update(camposCaso(fd)).eq("id", id);
  if (error) redirect(`/sinistros/${id}/editar?erro=${encodeURIComponent(error.message)}`);
  await registrar(supabase, id, { autor_tipo: "o2", referente: "interno", texto: "Dados do caso atualizados pela O2.", visivel_imobiliaria: false });
  revalidatePath("/sinistros/gestao");
  voltar(id, { sucesso: "Dados salvos.", aba: "dados", ctx });
}

// Sinistro de outros produtos (Capitalização, Incêndio, Auto...) aberto pela O2
// num formulário único -- sem o assistente de Fiança.
export async function criarSinistroOutros(fd: FormData) {
  const { supabase } = await exigirInterno();
  const etapa = (texto(fd, "etapa") ?? "pre_analise") as EtapaSinistro;
  const agora = new Date().toISOString();
  const { data, error } = await supabase
    .from("sinistros")
    .insert({
      ...camposCaso(fd),
      origem: texto(fd, "origem") === "email" ? "email" : "workspace",
      etapa: ETAPAS_DA_O2.includes(etapa) ? etapa : "pre_analise",
      enviado_em: agora,
      pre_analise_desde: etapa === "pre_analise" ? agora : null,
      data_abertura_seguradora: etapa !== "pre_analise" ? hojeSP() : null,
      responsavel_o2: texto(fd, "responsavel_o2"),
      proxima_acao_em: texto(fd, "proxima_acao_em"),
      proxima_acao_descricao: texto(fd, "proxima_acao_descricao"),
    })
    .select("id")
    .single();
  if (error || !data) redirect(`/sinistros/novo?produto=${texto(fd, "produto") ?? ""}&erro=${encodeURIComponent(error?.message ?? "Não foi possível criar.")}`);
  await registrar(supabase, data.id, { autor_tipo: "o2", referente: "interno", texto: "Sinistro aberto pela equipe O2.", visivel_imobiliaria: false, etapa_para: etapa });
  revalidatePath("/sinistros/gestao");
  voltar(data.id, { sucesso: "Sinistro aberto." });
}

// "Abrir outro sinistro deste contrato": copia contrato, partes e imóvel.
export async function duplicarSinistro(fd: FormData) {
  const { supabase, interno } = await contexto();
  const id = texto(fd, "id")!;
  const s = await carregar(supabase, id);
  if (!s) voltar(id, { erro: "Sinistro não encontrado." });
  const copiar = [
    "produto", "imobiliaria_id", "seguradora", "numero_apolice", "nosso_numero", "vigencia_inicio", "vigencia_fim",
    "locador_nome", "locador_documento", "locatario_nome", "locatario_documento", "locatario_telefone", "locatario_email",
    "imovel_cep", "imovel_logradouro", "imovel_numero", "imovel_complemento", "imovel_bairro", "imovel_cidade", "imovel_uf",
    "favorecido_eh_segurado", "favorecido_nome", "favorecido_documento", "favorecido_banco", "favorecido_agencia", "favorecido_conta",
  ];
  const fianca = (s.produto ?? "fianca") === "fianca";
  const agora = new Date().toISOString();
  // Fiança volta ao assistente (rascunho); os outros produtos já nascem em pré-análise.
  const novo: Record<string, unknown> = fianca ? { origem: "workspace" } : { origem: "workspace", etapa: "pre_analise", enviado_em: agora, pre_analise_desde: agora };
  for (const k of copiar) novo[k] = (s as Record<string, unknown>)[k];
  if (interno && !fianca) novo.responsavel_o2 = s.responsavel_o2;
  const { data, error } = await supabase.from("sinistros").insert(novo).select("id").single();
  if (error || !data) voltar(id, { erro: error?.message ?? "Não foi possível duplicar." });
  await registrar(supabase, data.id, {
    autor_tipo: interno ? "o2" : "imobiliaria",
    referente: "interno",
    texto: `Aberto a partir do SIN-${s.codigo} (mesmo contrato).`,
    visivel_imobiliaria: true,
  });
  redirect(fianca ? `/sinistros/${data.id}?passo=2` : interno ? `/sinistros/${data.id}/editar` : `/sinistros/${data.id}`);
}

// ---------- responsáveis ----------

export async function atribuirResponsavel(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  const chave = texto(fd, "responsavel");
  await supabase.from("sinistros").update({ responsavel_o2: chave }).eq("id", id);
  const { data: m } = chave ? await supabase.from("sinistros_equipe").select("nome").eq("chave", chave).maybeSingle() : { data: null };
  await registrar(supabase, id, { autor_tipo: "o2", referente: "interno", texto: chave ? `Responsável: ${m?.nome ?? chave}.` : "Sem responsável.", visivel_imobiliaria: false });
  revalidatePath("/sinistros/gestao");
  voltar(id, { ctx });
}

export async function atribuirEmLote(fd: FormData) {
  const { supabase } = await exigirInterno();
  const ids = fd.getAll("ids").filter((v): v is string => typeof v === "string" && !!v);
  const chave = texto(fd, "responsavel");
  const volta = texto(fd, "volta") ?? "";
  if (!ids.length) redirect(`/sinistros/gestao?${volta}${volta ? "&" : ""}erro=${encodeURIComponent("Marque ao menos um sinistro.")}`);
  await supabase.from("sinistros").update({ responsavel_o2: chave }).in("id", ids);
  const { data: m } = chave ? await supabase.from("sinistros_equipe").select("nome").eq("chave", chave).maybeSingle() : { data: null };
  await supabase.from("sinistro_historico").insert(
    ids.map((sid) => ({
      sinistro_id: sid,
      autor_tipo: "o2",
      referente: "interno",
      visivel_imobiliaria: false,
      texto: chave ? `Responsável: ${m?.nome ?? chave} (atribuição em lote).` : "Sem responsável (atribuição em lote).",
    }))
  );
  revalidatePath("/sinistros/gestao");
  redirect(`/sinistros/gestao?${volta}${volta ? "&" : ""}sucesso=${encodeURIComponent(`${ids.length} sinistro(s) atribuídos.`)}`);
}

export async function salvarMembroEquipe(fd: FormData) {
  const { supabase } = await exigirInterno();
  const nome = texto(fd, "nome");
  const email = texto(fd, "email")?.toLowerCase() ?? null;
  const volta = texto(fd, "volta") ?? "";
  if (!nome) redirect(`/sinistros/gestao?${volta}`);
  const chaveAtual = texto(fd, "chave");
  const chave = email ?? chaveAtual ?? nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (chaveAtual && chaveAtual !== chave) {
    // Ganhou e-mail: troca a chave e leva os sinistros junto.
    await supabase.from("sinistros_equipe").delete().eq("chave", chaveAtual);
    await supabase.from("sinistros").update({ responsavel_o2: chave }).eq("responsavel_o2", chaveAtual);
  }
  await supabase.from("sinistros_equipe").upsert({ chave, nome, email, ativo: true });
  redirect(`/sinistros/gestao?${volta}${volta ? "&" : ""}sucesso=${encodeURIComponent("Equipe atualizada.")}`);
}

export async function alternarMembroEquipe(fd: FormData) {
  const { supabase } = await exigirInterno();
  const chave = texto(fd, "chave")!;
  const volta = texto(fd, "volta") ?? "";
  await supabase.from("sinistros_equipe").update({ ativo: fd.get("ativo") === "1" }).eq("chave", chave);
  redirect(`/sinistros/gestao?${volta}`);
}

// ---------- reaproveitamento ----------

export type ApoliceEncontrada = {
  nosso_numero: string;
  produto: string;
  ramo: string | null;
  seguradora: string | null;
  numero_apolice: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  imobiliaria_texto: string | null;
  imobiliaria_id: string | null;
  // Cliente do Corp = SEGURADO (na Fiança, o locador). O garantido (locatário) não vem do Corp.
  cliente_nome: string | null;
  cliente_documento: string | null;
  cliente_email: string | null;
  cliente_telefone: string | null;
  data_efetivacao: string | null;
  status: string | null;
  // Local de risco (producao_enderecos).
  imovel_logradouro: string | null;
  imovel_numero: string | null;
  imovel_complemento: string | null;
  imovel_bairro: string | null;
  imovel_cidade: string | null;
  imovel_uf: string | null;
  imovel_cep: string | null;
  // Lido do PDF da apólice (acervo do Drive ligado com certeza ao Corp -- apolice_documentos).
  apolice_arquivo_id: string | null;
  apolice_local_risco: string | null;
  locatarios_apolice: { ordem: number; nome: string | null; documento: string; telefone: string | null; email: string | null }[] | null;
};

// Busca a apólice na base de produção (Nosso Nº, CPF/CNPJ ou nome do
// locatário). A função do banco limita a imobiliária às apólices dela.
export async function buscarApolices(termo: string): Promise<ApoliceEncontrada[]> {
  const { supabase } = await contexto();
  if (termo.trim().length < 3) return [];
  const { data, error } = await supabase.rpc("buscar_apolices_sinistro", { p_q: termo });
  if (error) return [];
  return (data ?? []) as ApoliceEncontrada[];
}

// Usa no sinistro atual um documento que a imobiliária já mandou noutro
// sinistro (ex.: contrato de administração): copia o arquivo para a pasta deste.
export async function reaproveitarDocumento(fd: FormData) {
  const { supabase } = await contexto();
  const id = texto(fd, "id")!;
  const docId = texto(fd, "documento_id")!;
  const passo = texto(fd, "passo");
  const { data: origem } = await supabase.from("sinistro_documentos").select("tipo, arquivo_path, nome_arquivo, tamanho").eq("id", docId).maybeSingle();
  const destinoUrl = `/sinistros/${id}${passo ? `?passo=${passo}` : "?aba=documentos"}`;
  if (!origem) redirect(destinoUrl);
  const destino = `${id}/${origem.tipo}/${Date.now()}-${origem.arquivo_path.split("/").pop()}`;
  const { error } = await supabase.storage.from("sinistros").copy(origem.arquivo_path, destino);
  if (error) redirect(`${destinoUrl}${destinoUrl.includes("?") ? "&" : "?"}erro=${encodeURIComponent("Não foi possível copiar o arquivo: " + error.message)}`);
  await supabase.from("sinistro_documentos").insert({
    sinistro_id: id,
    tipo: origem.tipo,
    arquivo_path: destino,
    nome_arquivo: origem.nome_arquivo,
    tamanho: origem.tamanho,
  });
  redirect(destinoUrl);
}

// ---------- Tela de visualização do sinistro acionado (22/10/2026) ----------

// "Há ação de despejo em andamento?" (nº do processo) e "Há acordo em
// andamento?" (tratativa com o escritório).
export async function salvarDespejoAcordo(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  const simNao = (k: string) => (fd.get(k) === "sim" ? true : fd.get(k) === "nao" ? false : null);
  const despejo = simNao("despejo");
  const acordo = simNao("acordo_em_andamento");
  const { error } = await supabase
    .from("sinistros")
    .update({
      despejo,
      despejo_processo: despejo ? texto(fd, "despejo_processo") : null,
      acordo_em_andamento: acordo,
      acordo_tratativa: acordo ? texto(fd, "acordo_tratativa") : null,
    })
    .eq("id", id);
  if (error) voltar(id, { erro: error.message, ctx });
  voltar(id, { sucesso: "Despejo/acordo salvos.", ctx });
}

// Caixa "Setor de renovação foi sinalizado?" -- encerra os alertas da vigência.
export async function marcarRenovacaoSinalizada(fd: FormData) {
  const { supabase, user } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  await supabase.from("sinistros").update({ renovacao_sinalizada_em: new Date().toISOString(), renovacao_sinalizada_por: user.email }).eq("id", id);
  await registrar(supabase, id, { autor_tipo: "o2", referente: "interno", texto: "Setor de renovação sinalizado sobre o vencimento da apólice.", visivel_imobiliaria: false });
  voltar(id, { sucesso: "Renovação sinalizada — alertas encerrados.", ctx });
}

// Histórico do andamento INTERNO: todo evento tem data e descrição obrigatórias.
export async function salvarEventoInterno(fd: FormData) {
  const { supabase, user } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  const eventoId = texto(fd, "evento_id");
  const data = texto(fd, "data_evento");
  const descricao = texto(fd, "texto");
  if (!data || !descricao) voltar(id, { erro: "Informe a data e a descrição do evento.", aba: "interno", ctx });
  if (eventoId) {
    const { error } = await supabase
      .from("sinistro_historico")
      .update({ data_evento: data, texto: descricao, editado_em: new Date().toISOString(), editado_por: user.email })
      .eq("id", eventoId)
      .eq("sinistro_id", id)
      .eq("visivel_imobiliaria", false);
    if (error) voltar(id, { erro: error.message, aba: "interno", ctx });
  } else {
    const { error } = await supabase
      .from("sinistro_historico")
      .insert({ sinistro_id: id, autor_tipo: "o2", referente: "interno", visivel_imobiliaria: false, data_evento: data, texto: descricao });
    if (error) voltar(id, { erro: error.message, aba: "interno", ctx });
  }
  voltar(id, { aba: "interno", ctx });
}

export async function excluirEventoInterno(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  await supabase.from("sinistro_historico").delete().eq("id", texto(fd, "evento_id")!).eq("sinistro_id", id).eq("visivel_imobiliaria", false);
  voltar(id, { aba: "interno", ctx });
}
