"use server";

// Operação do sinistro pela equipe O2 (21/10/2026): ciclo completo
// (indenização, acordo/judicial, encerramento, reabertura), edição dos dados
// em qualquer etapa, equipe de responsáveis, atribuição em lote, busca de
// apólice, reaproveitamento de dados/documentos e abertura de outros produtos.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2, DOMINIO_O2 } from "@/lib/admin";
import { ETAPAS, formatarReais, hojeSP, type EtapaSinistro, type TipoSinistro } from "@/lib/sinistros/regras";
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
    acordo_numero: texto(fd, "acordo_numero"),
    acordo_data: texto(fd, "acordo_data"),
    acordo_efetivacao: texto(fd, "acordo_efetivacao"),
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
    texto: `Acordo${dados.acordo_numero ? ` nº ${dados.acordo_numero}` : ""}: feito em ${br(dados.acordo_data)}, efetivado em ${br(dados.acordo_efetivacao)}, parcelas de ${br(dados.acordo_primeira_parcela)} a ${br(dados.acordo_ultima_parcela)}.`,
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
  const lmi = valor(fd, "lmi");
  await supabase.from("sinistros").update({ lmi }).eq("id", id);
  await registrar(supabase, id, { autor_tipo: "o2", referente: "interno", visivel_imobiliaria: false, texto: `LMI da apólice: ${lmi != null ? formatarReais(lmi) : "removido"}.` });
  voltar(id, { sucesso: "LMI salvo.", aba: "financeiro", ctx });
}

export async function registrarIndenizacao(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  const v = valor(fd, "valor") ?? 0;
  const mes = texto(fd, "referencia"); // "AAAA-MM"
  const pagoEm = texto(fd, "pago_em") ?? hojeSP();
  const s = await carregar(supabase, id);
  if (!s) voltar(id, { erro: "Sinistro não encontrado.", ctx });
  const { error } = await supabase.from("sinistro_indenizacoes").insert({
    sinistro_id: id,
    valor: v,
    pago_em: pagoEm,
    referencia: mes ? `${mes}-01` : null,
    observacao: texto(fd, "observacao"),
  });
  if (error) voltar(id, { erro: error.message, aba: "financeiro", ctx });
  const mudaEtapa = ["pre_analise", "pendencia_imobiliaria", "na_seguradora"].includes(s.etapa);
  if (mudaEtapa) await supabase.from("sinistros").update({ etapa: "em_indenizacao" }).eq("id", id);
  await registrar(supabase, id, {
    autor_tipo: "o2",
    referente: "seguradora",
    texto: `Indenização registrada: ${formatarReais(v)}${mes ? ` (ref. ${mes.split("-").reverse().join("/")})` : ""}, paga em ${pagoEm.split("-").reverse().join("/")}.`,
    etapa_de: mudaEtapa ? s.etapa : null,
    etapa_para: mudaEtapa ? "em_indenizacao" : null,
  });
  revalidatePath("/sinistros/gestao");
  if (s.lmi) {
    const { data: todas } = await supabase.from("sinistro_indenizacoes").select("valor").eq("sinistro_id", id);
    const usado = (todas ?? []).reduce((acc, x) => acc + Number(x.valor), 0);
    if (usado > Number(s.lmi))
      voltar(id, { erro: `Indenização registrada, mas o total (${formatarReais(usado)}) passou do LMI (${formatarReais(Number(s.lmi))}).`, aba: "financeiro", ctx });
  }
  voltar(id, { sucesso: "Indenização registrada.", aba: "financeiro", ctx });
}

export async function removerIndenizacao(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const ctx = texto(fd, "ctx");
  const { data: ind } = await supabase.from("sinistro_indenizacoes").select("valor, pago_em").eq("id", texto(fd, "indenizacao_id")!).maybeSingle();
  await supabase.from("sinistro_indenizacoes").delete().eq("id", texto(fd, "indenizacao_id")!);
  if (ind) await registrar(supabase, id, { autor_tipo: "o2", referente: "interno", texto: `Indenização de ${formatarReais(Number(ind.valor))} removida.`, visivel_imobiliaria: false });
  voltar(id, { aba: "financeiro", ctx });
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
  locatario_nome: string | null;
  locatario_documento: string | null;
  locatario_email: string | null;
  locatario_telefone: string | null;
  data_efetivacao: string | null;
  status: string | null;
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
