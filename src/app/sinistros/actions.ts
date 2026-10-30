"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2, DOMINIO_O2 } from "@/lib/admin";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";
import {
  COBERTURAS,
  PRAZO_PENDENCIA_DIAS,
  TEXTO_CIENCIA,
  TEXTO_PRAZO_ANALISE,
  regrasDoSinistro,
  calcularPrazoAviso,
  formatarData,
  hojeSP,
  montarChecklist,
  situacaoDoFormulario,
  somarDias,
  totalDebitos,
  validarEnvio,
  type Debito,
  type TipoSinistro,
} from "@/lib/sinistros/regras";
import {
  emailAtualizacaoParaImobiliaria,
  emailNovidadeParaO2,
  emailNovoSinistroParaO2,
  emailPendenciaParaImobiliaria,
  emailRespostaPendenciaParaO2,
  type SinistroEmail,
} from "@/lib/sinistros/emails";

async function contexto() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const interno = isAdmin(user.email) || isColaboradorO2(user.email);
  return { supabase, user, interno };
}

type Supa = Awaited<ReturnType<typeof createClient>>;

function texto(fd: FormData, campo: string) {
  const v = fd.get(campo);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function bool(fd: FormData, campo: string): boolean | null {
  const v = fd.get(campo);
  if (v === "sim") return true;
  if (v === "nao") return false;
  return null;
}

function voltar(id: string, passo: number | null, erro?: string): never {
  const q = new URLSearchParams();
  if (passo) q.set("passo", String(passo));
  if (erro) q.set("erro", erro);
  const qs = q.toString();
  redirect(`/sinistros/${id}${qs ? `?${qs}` : ""}`);
}

async function carregar(supabase: Supa, id: string) {
  const { data } = await supabase.from("sinistros").select("*, imobiliarias(nome, apelido, email)").eq("id", id).maybeSingle();
  return data;
}

function nomeImobiliaria(s: { imobiliarias?: { nome?: string | null; apelido?: string | null } | null }) {
  return s.imobiliarias?.apelido || s.imobiliarias?.nome || "Imobiliária";
}

// Quem recebe os avisos do lado da imobiliária: quem abriu o sinistro (se
// não foi alguém da O2 abrindo em nome dela) + o e-mail do cadastro.
function destinosImobiliaria(s: { criado_por_email: string | null; imobiliarias?: { email?: string | null } | null }) {
  const lista: string[] = [];
  if (s.criado_por_email && !s.criado_por_email.toLowerCase().endsWith(DOMINIO_O2)) lista.push(s.criado_por_email);
  if (s.imobiliarias?.email) lista.push(...s.imobiliarias.email.split(","));
  return lista;
}

const SEM_EMAIL = "Atenção: a imobiliária não tem e-mail cadastrado (nem quem abriu o sinistro é da imobiliária), então ninguém foi avisado por e-mail. Avise por telefone/WhatsApp e cadastre o e-mail em Configurações → Imobiliárias.";

async function registrar(
  supabase: Supa,
  sinistroId: string,
  dados: {
    autor_tipo: "imobiliaria" | "o2" | "sistema";
    texto: string;
    referente?: string | null;
    visivel_imobiliaria?: boolean;
    etapa_de?: string | null;
    etapa_para?: string | null;
  }
) {
  await supabase.from("sinistro_historico").insert({
    sinistro_id: sinistroId,
    visivel_imobiliaria: true,
    ...dados,
  });
}

// ---------- Imobiliária: passo 1 (contrato) ----------

function camposContrato(fd: FormData) {
  return {
    seguradora: texto(fd, "seguradora"),
    numero_apolice: texto(fd, "numero_apolice"),
    vigencia_inicio: texto(fd, "vigencia_inicio"),
    vigencia_fim: texto(fd, "vigencia_fim"),
    locador_nome: texto(fd, "locador_nome"),
    locador_documento: texto(fd, "locador_documento"),
    locatario_nome: texto(fd, "locatario_nome"),
    locatario_documento: texto(fd, "locatario_documento"),
    locatario_telefone: texto(fd, "locatario_telefone"),
    locatario_email: texto(fd, "locatario_email"),
    imovel_cep: texto(fd, "cep"),
    imovel_logradouro: texto(fd, "logradouro"),
    imovel_numero: texto(fd, "numero"),
    imovel_complemento: texto(fd, "complemento"),
    imovel_bairro: texto(fd, "bairro"),
    imovel_cidade: texto(fd, "cidade"),
    imovel_uf: texto(fd, "uf"),
    nosso_numero: texto(fd, "nosso_numero"),
    data_ocorrencia: texto(fd, "data_ocorrencia"),
  };
}

// Imóvel desocupado: a entrega das chaves vira demanda da emissão/controle (reunião 21/10/2026).
async function demandaChaves(supabase: Supa, id: string, nova: string | null | undefined, anterior: string | null | undefined) {
  if (!nova || nova === anterior) return;
  await registrar(supabase, id, {
    autor_tipo: "sistema",
    referente: "interno",
    visivel_imobiliaria: false,
    texto: `Demanda para emissão e controle: imóvel desocupado, chaves entregues em ${formatarData(nova)}. Verificar endosso/cancelamento da apólice.`,
  });
}

// Etapa 1: ocupado/desocupado + ocorrência -> tipo, datas e prazo de aviso.
function situacaoComPrazo(fd: FormData, tipoAtual: string | null | undefined) {
  const sit = situacaoDoFormulario(texto(fd, "situacao_imovel"), texto(fd, "data_ocorrencia"), texto(fd, "data_entrega_chaves"), tipoAtual);
  if (!sit) return {};
  const prazo = calcularPrazoAviso(sit);
  return { ...sit, prazo_aviso: prazo.prazo, aviso_fora_prazo: prazo.foraDoPrazo };
}

export async function criarRascunho(fd: FormData) {
  const { supabase, user, interno } = await contexto();
  // Fase de testes (19/10/2026): nenhum campo obrigatório -- salva o que vier.
  const campos = { ...camposContrato(fd), ...situacaoComPrazo(fd, null) };

  let imobiliariaId: string | null = null;
  let origem = "workspace";
  if (interno) {
    imobiliariaId = texto(fd, "imobiliaria_id");
    origem = texto(fd, "origem") === "email" ? "email" : "workspace";
  } else {
    const imob = await buscarImobiliariaDoUsuario(supabase, user);
    if (!imob) redirect("/imobiliaria");
    imobiliariaId = imob.id;
  }

  // R3: um sinistro em andamento por contrato. Mesma apólice (ou, sem
  // apólice, mesmo locatário) dessa imobiliária leva pro que já existe.
  const norm = (v: string | null | undefined) => (v ?? "").replace(/\W/g, "").toUpperCase();
  const temChave = !!(norm(campos.numero_apolice) || norm(campos.locatario_nome));
  const { data: abertos } =
    imobiliariaId && temChave
      ? await supabase
          .from("sinistros")
          .select("id, numero_apolice, locatario_nome")
          .eq("imobiliaria_id", imobiliariaId)
          .not("etapa", "in", "(encerrado,cancelado)")
      : { data: [] as { id: string; numero_apolice: string | null; locatario_nome: string | null }[] };
  const existente = (abertos ?? []).find((a) =>
    campos.numero_apolice ? norm(a.numero_apolice) === norm(campos.numero_apolice) : norm(a.locatario_nome) === norm(campos.locatario_nome)
  );
  if (existente) {
    redirect(
      `/sinistros/${existente.id}?erro=${encodeURIComponent(
        "Já existe um sinistro em andamento para este contrato. Registre a novidade nele em vez de abrir outro."
      )}`
    );
  }

  const { data, error } = await supabase
    .from("sinistros")
    .insert({ ...campos, imobiliaria_id: imobiliariaId, origem })
    .select("id")
    .single();
  if (error || !data) redirect("/sinistros/novo?erro=" + encodeURIComponent("Não foi possível criar o sinistro: " + (error?.message ?? "")));
  await demandaChaves(supabase, data.id, (campos as { data_entrega_chaves?: string | null }).data_entrega_chaves, null);
  redirect(`/sinistros/${data.id}?passo=2`);
}

export async function salvarContrato(fd: FormData) {
  const { supabase, interno } = await contexto();
  const id = texto(fd, "id")!;
  const { data: atual } = await supabase.from("sinistros").select("tipo, data_entrega_chaves").eq("id", id).maybeSingle();
  const situacao = situacaoComPrazo(fd, atual?.tipo);
  const campos = { ...camposContrato(fd), ...situacao };
  // Equipe O2 pode definir/trocar a imobiliária no próprio passo 1.
  const extra =
    interno && fd.has("imobiliaria_id")
      ? { imobiliaria_id: texto(fd, "imobiliaria_id"), origem: texto(fd, "origem") === "email" ? "email" : "workspace" }
      : {};
  const { error } = await supabase.from("sinistros").update({ ...campos, ...extra }).eq("id", id);
  if (error) voltar(id, 1, error.message);
  await demandaChaves(supabase, id, (situacao as { data_entrega_chaves?: string | null }).data_entrega_chaves, atual?.data_entrega_chaves);
  voltar(id, 2);
}

// ---------- Etapa 2 (coberturas) ----------

export async function salvarSituacao(fd: FormData) {
  const { supabase } = await contexto();
  const id = texto(fd, "id")!;
  const { data: s } = await supabase
    .from("sinistros")
    .select("tipo, data_primeiro_vencimento, data_segundo_vencimento, data_entrega_chaves")
    .eq("id", id)
    .single();
  if (!s) voltar(id, 2, "Sinistro não encontrado.");
  // Ocupado/desocupado vem da Etapa 1; aqui o desocupado vira "com danos" se
  // danos ao imóvel ou pintura forem marcados.
  const tipoForm = texto(fd, "tipo");
  const tipo = (["ocupado", "chaves_sem_danos", "chaves_com_danos"].includes(tipoForm ?? "") ? tipoForm : s.tipo ?? null) as TipoSinistro | null;
  const coberturasValidas = new Set(COBERTURAS.map((c) => c.chave));
  const coberturas = fd.getAll("coberturas").filter((c): c is string => typeof c === "string" && coberturasValidas.has(c as never));

  const dados = {
    locatario_assinou_documentos: tipo !== "ocupado" ? bool(fd, "locatario_assinou_documentos") : null,
    pintura_vistoria_nova: coberturas.includes("pintura") ? bool(fd, "pintura_vistoria_nova") : null,
    pintura_vistoria_assinada: coberturas.includes("pintura") ? bool(fd, "pintura_vistoria_assinada") : null,
    incluir_parcelas_fianca: coberturas.includes("aluguel") && fd.get("incluir_parcelas_fianca") === "on",
    coberturas,
    observacoes: texto(fd, "observacoes"),
  };
  const prazo = calcularPrazoAviso({ ...s, tipo });
  const { error } = await supabase
    .from("sinistros")
    .update({ ...dados, tipo, prazo_aviso: prazo.prazo, aviso_fora_prazo: prazo.foraDoPrazo })
    .eq("id", id);
  if (error) voltar(id, 2, error.message);
  voltar(id, 3);
}

// ---------- passo 3 (débitos) -- chamado pelo editor no navegador ----------

export async function salvarDebitos(id: string, debitos: Debito[]): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await contexto();
  const linhas = debitos
    // Guarda a linha com qualquer coisa preenchida.
    .filter((d) => (Number(d.valor) || 0) > 0 || (Number(d.multa) || 0) > 0 || (Number(d.acrescimos) || 0) > 0 || !!d.vencimento || !!d.competencia)
    .map((d, i) => ({
      sinistro_id: id,
      discriminacao: d.discriminacao || "Outros encargos",
      vencimento: d.vencimento || null,
      competencia: d.competencia || null,
      valor: Number(d.valor) || 0,
      multa: Number(d.multa) || 0,
      acrescimos: Number(d.acrescimos) || 0,
      ordem: i,
    }));
  const { error: errDel } = await supabase.from("sinistro_debitos").delete().eq("sinistro_id", id);
  if (errDel) return { ok: false, erro: errDel.message };
  if (linhas.length) {
    const { error } = await supabase.from("sinistro_debitos").insert(linhas);
    if (error) return { ok: false, erro: error.message };
  }
  revalidatePath(`/sinistros/${id}`);
  return { ok: true };
}

// ---------- passo 4 (documentos) -- arquivo já subiu do navegador ----------

export async function registrarDocumento(
  id: string,
  tipo: string,
  arquivoPath: string,
  nomeArquivo: string,
  tamanho: number,
  pasta: string | null = null
): Promise<{ ok: boolean; erro?: string }> {
  const { supabase, interno } = await contexto();
  if (!arquivoPath.startsWith(`${id}/`)) return { ok: false, erro: "Caminho de arquivo inválido." };
  // Reenvio de um documento recusado: o recusado sai da lista ativa.
  await supabase.from("sinistro_documentos").update({ situacao: "substituido" }).eq("sinistro_id", id).eq("tipo", tipo).eq("situacao", "recusado");
  const { error } = await supabase
    .from("sinistro_documentos")
    .insert({ sinistro_id: id, tipo, arquivo_path: arquivoPath, nome_arquivo: nomeArquivo, tamanho, pasta });
  if (error) return { ok: false, erro: error.message };
  // Notificação de novo documento anexado para validação (fora do rascunho).
  if (!interno) {
    const s = await carregar(supabase, id);
    if (s && s.etapa !== "rascunho")
      await emailNovidadeParaO2(s as SinistroEmail, nomeImobiliaria(s), "documento", `${nomeArquivo}${pasta ? ` (pasta ${pasta})` : ""}`);
  }
  revalidatePath(`/sinistros/${id}`);
  return { ok: true };
}

export async function removerDocumento(fd: FormData) {
  const { supabase } = await contexto();
  const id = texto(fd, "id")!;
  const docId = texto(fd, "documento_id")!;
  const passo = Number(texto(fd, "passo")) || null;
  await supabase.from("sinistro_documentos").update({ situacao: "substituido" }).eq("id", docId).eq("situacao", "enviado");
  voltar(id, passo);
}

// ---------- Etapa 4 (dados bancários do favorecido) ----------

export async function salvarFavorecido(fd: FormData) {
  const { supabase } = await contexto();
  const id = texto(fd, "id")!;
  const { error } = await supabase
    .from("sinistros")
    .update({
      favorecido_eh_segurado: bool(fd, "favorecido_eh_segurado"),
      favorecido_nome: texto(fd, "favorecido_nome"),
      favorecido_documento: texto(fd, "favorecido_documento"),
      favorecido_banco: texto(fd, "favorecido_banco"),
      favorecido_agencia: texto(fd, "favorecido_agencia"),
      favorecido_conta: texto(fd, "favorecido_conta"),
    })
    .eq("id", id);
  if (error) voltar(id, 4, error.message);
  voltar(id, 5);
}

// ---------- Etapa 5 (validação + ciência + envio) ----------

export async function enviarSinistro(fd: FormData) {
  const { supabase, user } = await contexto();
  const id = texto(fd, "id")!;
  const favorecido = fd.has("justificativa_fora_prazo") ? { justificativa_fora_prazo: texto(fd, "justificativa_fora_prazo") } : {};
  const ciencia = fd.get("ciencia") === "on";
  const mensagem = texto(fd, "mensagem");

  // Salva o que foi digitado mesmo se o envio for barrado, pra não perder.
  if (Object.keys(favorecido).length) await supabase.from("sinistros").update(favorecido).eq("id", id);

  const s = await carregar(supabase, id);
  if (!s) voltar(id, 5, "Sinistro não encontrado.");
  if (s.etapa !== "rascunho" && s.etapa !== "pendencia_imobiliaria") voltar(id, null);

  const { data: debitos } = await supabase.from("sinistro_debitos").select("*").eq("sinistro_id", id).order("ordem");
  const { data: docs } = await supabase.from("sinistro_documentos").select("tipo, situacao").eq("sinistro_id", id);
  const cienciaOk = ciencia || !!s.ciencia_aceita_em;
  const validacao = validarEnvio({ ...s, ...favorecido }, (debitos ?? []) as Debito[], docs ?? [], cienciaOk);
  // Fase de testes (19/10/2026): o envio não é barrado; o que faltar vai pro histórico.
  const pendenciasEnvio = validacao.bloqueios;

  const agora = new Date().toISOString();
  // Sem tabela de débitos (22/10/2026): só recalcula o valor avisado se houver linhas antigas.
  const valorAvisado = (debitos ?? []).length ? totalDebitos((debitos ?? []) as Debito[]) : s.valor_avisado;
  const eraRascunho = s.etapa === "rascunho";
  const prazo = calcularPrazoAviso(s);

  const { error } = await supabase
    .from("sinistros")
    .update({
      etapa: "pre_analise",
      pre_analise_desde: agora,
      pendencia_desde: null,
      pendencia_prazo: null,
      valor_avisado: valorAvisado,
      ...(eraRascunho
        ? {
            enviado_em: agora,
            prazo_aviso: prazo.prazo,
            aviso_fora_prazo: prazo.foraDoPrazo,
            ...(ciencia
              ? { ciencia_texto: TEXTO_CIENCIA.join("\n"), ciencia_aceita_em: agora, ciencia_aceita_por: user.email }
              : {}),
          }
        : {}),
    })
    .eq("id", id);
  if (error) voltar(id, 5, error.message);

  const faltando = validacao.documentosFaltando.map((d) => d.titulo);
  await registrar(supabase, id, {
    autor_tipo: "imobiliaria",
    referente: "imobiliaria",
    texto: eraRascunho
      ? `Aviso de sinistro enviado${prazo.foraDoPrazo ? " (fora do prazo)" : " dentro do prazo"}.${
          faltando.length ? ` Documentos ainda faltando: ${faltando.join("; ")}.` : ""
        }${pendenciasEnvio.length ? ` Enviado com pendências: ${pendenciasEnvio.join(" ")}` : ""}${mensagem ? `\n\n${mensagem}` : ""}`
      : `Pendência respondida.${mensagem ? `\n\n${mensagem}` : ""}`,
    etapa_de: s.etapa,
    etapa_para: "pre_analise",
  });

  const paraEmail = { ...s, etapa: "pre_analise", valor_avisado: valorAvisado } as SinistroEmail;
  if (eraRascunho) await emailNovoSinistroParaO2(paraEmail, nomeImobiliaria(s), faltando);
  else await emailRespostaPendenciaParaO2(paraEmail, nomeImobiliaria(s), mensagem ?? "");

  redirect(`/sinistros/${id}?sucesso=${encodeURIComponent(eraRascunho ? "Aviso enviado à O2." : "Pendência respondida. A O2 vai revisar.")}`);
}

export async function cancelarRascunho(fd: FormData) {
  const { supabase } = await contexto();
  const id = texto(fd, "id")!;
  const { data: s } = await supabase.from("sinistros").select("etapa").eq("id", id).single();
  if (s?.etapa !== "rascunho") voltar(id, null, "Só dá pra descartar um rascunho.");
  await supabase.from("sinistros").update({ etapa: "cancelado", motivo_encerramento: "Rascunho descartado" }).eq("id", id);
  redirect("/sinistros/gestao?sucesso=" + encodeURIComponent("Rascunho descartado."));
}

// ---------- O2: pré-análise ----------

async function exigirInterno() {
  const ctx = await contexto();
  if (!ctx.interno) redirect("/sinistros/gestao");
  return ctx;
}

export async function analisarDocumento(fd: FormData) {
  const { supabase, user } = await exigirInterno();
  const id = texto(fd, "id")!;
  const docId = texto(fd, "documento_id")!;
  const decisao = texto(fd, "decisao");
  const motivo = [texto(fd, "motivo_lista"), texto(fd, "motivo_texto") ?? texto(fd, "observacao")].filter(Boolean).join(" — ");
  if (decisao === "recusado" && !motivo) voltar(id, null, "Escolha ou escreva o motivo da recusa.");
  await supabase
    .from("sinistro_documentos")
    .update({
      situacao: decisao === "aprovado" ? "aprovado" : decisao === "recusado" ? "recusado" : "enviado",
      // Recusado: motivo; aprovado: observação opcional (lista padronizada, reunião 21/10/2026).
      motivo_recusa: decisao === "recusado" ? motivo : decisao === "aprovado" ? texto(fd, "observacao") : null,
      analisado_por: user.email,
      analisado_em: new Date().toISOString(),
    })
    .eq("id", docId);
  // Volta para onde estava: etapa 3 se o caso ainda é rascunho; senão a aba Anexos.
  const { data: sin } = await supabase.from("sinistros").select("etapa").eq("id", id).maybeSingle();
  redirect(sin?.etapa === "rascunho" ? `/sinistros/${id}?passo=3` : `/sinistros/${id}?aba=anexos`);
}

export async function assumirSinistro(fd: FormData) {
  const { supabase, user } = await exigirInterno();
  const id = texto(fd, "id")!;
  const responsavel = texto(fd, "responsavel") ?? user.email ?? null;
  await supabase.from("sinistros").update({ responsavel_o2: responsavel }).eq("id", id);
  await registrar(supabase, id, { autor_tipo: "o2", referente: "interno", texto: `Responsável: ${responsavel}.`, visivel_imobiliaria: false });
  voltar(id, null);
}

export async function devolverComPendencia(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const mensagem = texto(fd, "mensagem") ?? "";
  const s = await carregar(supabase, id);
  if (!s) voltar(id, null, "Sinistro não encontrado.");

  const { data: docs } = await supabase.from("sinistro_documentos").select("tipo, situacao, motivo_recusa, nome_arquivo").eq("sinistro_id", id);
  const checklist = montarChecklist(s);
  const tituloDe = (tipo: string) => checklist.find((c) => c.chave === tipo)?.titulo ?? tipo;
  const recusados = (docs ?? []).filter((d) => d.situacao === "recusado").map((d) => `${tituloDe(d.tipo)} (${d.nome_arquivo}): ${d.motivo_recusa}`);
  const ativos = new Set((docs ?? []).filter((d) => d.situacao === "enviado" || d.situacao === "aprovado").map((d) => d.tipo));
  const faltando = checklist.filter((c) => c.obrigatorio && !ativos.has(c.chave) && !(docs ?? []).some((d) => d.tipo === c.chave && d.situacao === "recusado")).map((c) => `Falta: ${c.titulo}`);
  const itens = [...recusados, ...faltando];
  if (!itens.length && !mensagem) voltar(id, null, "Não há documento recusado nem faltando — escreva o que a imobiliária precisa fazer.");

  const prazo = somarDias(hojeSP(), PRAZO_PENDENCIA_DIAS);
  await supabase
    .from("sinistros")
    .update({ etapa: "pendencia_imobiliaria", pendencia_desde: new Date().toISOString(), pendencia_prazo: prazo, pre_analise_desde: null })
    .eq("id", id);
  await registrar(supabase, id, {
    autor_tipo: "o2",
    referente: "imobiliaria",
    texto: `Pendência para a imobiliária (responder até ${prazo.split("-").reverse().join("/")}):\n${itens.map((i) => `• ${i}`).join("\n")}${mensagem ? `\n\n${mensagem}` : ""}`,
    etapa_de: s.etapa,
    etapa_para: "pendencia_imobiliaria",
  });
  const destinos = destinosImobiliaria(s);
  await emailPendenciaParaImobiliaria({ ...s, etapa: "pendencia_imobiliaria" } as SinistroEmail, destinos, itens, mensagem, prazo);
  voltar(id, null, destinos.length ? undefined : SEM_EMAIL);
}

// Etapa 5 da abertura, lado O2: "Acionamento autorizado? SIM" -- gera o
// número do aviso, inicia o chat e o caso segue para a seguradora. (O "NÃO"
// é devolverComPendencia.)
export async function marcarAbertoNaSeguradora(fd: FormData) {
  const { supabase, user } = await exigirInterno();
  const id = texto(fd, "id")!;
  // Ajuste da equipe (23/10/2026): o nº do aviso é o que a O2 digita (o da
  // seguradora); não há mais número gerado pelo sistema.
  const numero = texto(fd, "numero_sinistro_seguradora");
  const data = texto(fd, "data_abertura_seguradora") ?? hojeSP();
  const docCompleta = fd.get("documentacao_completa") === "on";
  const s = await carregar(supabase, id);
  if (!s) voltar(id, null, "Sinistro não encontrado.");
  const primeiraVez = !s.autorizado_em;
  // O prazo de 10 dias úteis de análise e os 4 dias do pagamento valem só para a Capitalização (Matheus, 30/10/2026).
  const prazoCap = s.produto === "capitalizacao";
  await supabase
    .from("sinistros")
    .update({
      autorizado_em: s.autorizado_em ?? new Date().toISOString(),
      etapa: "na_seguradora",
      numero_sinistro_seguradora: numero,
      data_abertura_seguradora: data,
      documentacao_completa_em: docCompleta ? hojeSP() : null,
      pre_analise_desde: null,
      pendencia_desde: null,
      pendencia_prazo: null,
    })
    .eq("id", id);
  if (primeiraVez)
    await registrar(supabase, id, {
      autor_tipo: "o2",
      referente: "imobiliaria",
      texto: `Acionamento autorizado pela O2 (${user.email}).${numero ? ` Nº do aviso: ${numero}.` : ""} A partir de agora a conversa sobre este sinistro fica neste chat.${prazoCap ? `\n\n${TEXTO_PRAZO_ANALISE.join("\n")}` : ""}`,
    });
  await registrar(supabase, id, {
    autor_tipo: "o2",
    referente: "seguradora",
    texto: `Sinistro aberto na ${s.seguradora ?? "seguradora"}${numero ? ` — aviso nº ${numero}` : " (nº do aviso ainda não informado)"}.${
      docCompleta ? " Documentação completa: o prazo de análise da seguradora (até 30 dias) começa agora." : ""
    }`,
    etapa_de: s.etapa,
    etapa_para: "na_seguradora",
  });
  const destinos = destinosImobiliaria(s);
  const regras = regrasDoSinistro({ ...s, etapa: "na_seguradora" });
  await emailAtualizacaoParaImobiliaria(
    { ...s, etapa: "na_seguradora", numero_sinistro_seguradora: numero } as SinistroEmail,
    destinos,
    `Acionamento autorizado${numero ? ` — aviso ${numero}` : ""}`,
    `A O2 autorizou o acionamento.${numero ? ` Sinistro aberto na ${s.seguradora} com o aviso nº ${numero}.` : ""}${prazoCap ? ` ${TEXTO_PRAZO_ANALISE.join(" ")}` : ""}${regras.length ? " A partir de agora, atenção às regras:" : ""}`,
    regras
  );
  voltar(id, null, destinos.length ? undefined : SEM_EMAIL);
}

export async function registrarNoHistorico(fd: FormData) {
  const { supabase, interno } = await contexto();
  const id = texto(fd, "id")!;
  const msg = texto(fd, "texto");
  if (!msg) voltar(id, null, "Escreva o texto do registro.");
  if (!interno) {
    await registrar(supabase, id, { autor_tipo: "imobiliaria", referente: "imobiliaria", texto: msg });
    // Notificação de mensagem recebida no chat.
    const s = await carregar(supabase, id);
    if (s) await emailNovidadeParaO2(s as SinistroEmail, nomeImobiliaria(s), "mensagem", msg);
    voltar(id, null);
  }
  const visivel = fd.get("visivel_imobiliaria") === "on";
  const mandarEmail = visivel && fd.get("enviar_email") === "on";
  await registrar(supabase, id, {
    autor_tipo: "o2",
    referente: texto(fd, "referente") ?? "interno",
    texto: msg,
    visivel_imobiliaria: visivel,
  });
  if (mandarEmail) {
    const s = await carregar(supabase, id);
    if (s) {
      const destinos = destinosImobiliaria(s);
      await emailAtualizacaoParaImobiliaria(s as SinistroEmail, destinos, "Atualização do seu sinistro", msg);
      if (!destinos.length) voltar(id, null, SEM_EMAIL);
    }
  }
  voltar(id, null);
}

export async function cancelarSinistroO2(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const motivo = texto(fd, "motivo");
  if (!motivo) voltar(id, null, "Informe o motivo do cancelamento.");
  const { data: s } = await supabase.from("sinistros").select("etapa").eq("id", id).single();
  await supabase.from("sinistros").update({ etapa: "cancelado", motivo_encerramento: motivo, encerrado_em: hojeSP() }).eq("id", id);
  await registrar(supabase, id, { autor_tipo: "o2", referente: "imobiliaria", texto: `Sinistro cancelado: ${motivo}`, etapa_de: s?.etapa, etapa_para: "cancelado" });
  voltar(id, null);
}

// ---------- O2: agenda de próxima ação ----------

export async function salvarProximaAcao(fd: FormData) {
  const { supabase } = await exigirInterno();
  const id = texto(fd, "id")!;
  const voltarPara = texto(fd, "voltar");
  const ctx = texto(fd, "ctx");
  const limpar = fd.get("limpar") === "1";
  const dados = limpar
    ? { proxima_acao_em: null, proxima_acao_descricao: null, proxima_acao_responsavel: null }
    : {
        proxima_acao_em: texto(fd, "proxima_acao_em"),
        proxima_acao_descricao: texto(fd, "proxima_acao_descricao"),
        // O dono da agenda é o responsável do caso (21/10/2026).
        proxima_acao_responsavel: null,
      };
  const { error } = await supabase.from("sinistros").update(dados).eq("id", id);
  if (error) voltar(id, null, error.message);
  await registrar(supabase, id, {
    autor_tipo: "o2",
    referente: "interno",
    texto: limpar
      ? "Próxima ação concluída/removida da agenda."
      : `Próxima ação agendada${dados.proxima_acao_em ? ` para ${formatarData(dados.proxima_acao_em)}` : ""}${
          dados.proxima_acao_descricao ? `: ${dados.proxima_acao_descricao}` : ""
        }.`,
    visivel_imobiliaria: false,
  });
  revalidatePath("/sinistros/gestao");
  if (voltarPara === "gestao") redirect("/sinistros/gestao?sucesso=" + encodeURIComponent("Agenda atualizada."));
  redirect(`/sinistros/${id}?${ctx ? `ctx=${encodeURIComponent(ctx)}&` : ""}sucesso=${encodeURIComponent("Agenda atualizada.")}`);
}
