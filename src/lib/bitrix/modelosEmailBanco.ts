import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { ENTITY_TYPE_ID_DEAL, ENTITY_TYPE_ID_LEAD } from "./entidadesCard";

// Modelos de e-mail criados pela equipe na própria aba "E-mail" do card
// (tabela bitrix_email_modelos). Por enquanto só para Leads e Negócios da área
// comercial; os modelos dos produtos seguem em modelosEmail.ts.

export const ENTIDADES_COMERCIAL = [ENTITY_TYPE_ID_LEAD, ENTITY_TYPE_ID_DEAL];
const MAX_CORPO = 100_000;

export type ModeloBanco = {
  id: string;
  nome: string;
  assunto: string;
  corpoHtml: string;
  entidades: number[];
  /** Marca na tela: este modelo pode ser atualizado/excluído por quem o abre. */
  editavel: true;
  criadoPor: string | null;
};

type Linha = { id: string; nome: string; assunto: string; corpo_html: string; entidades: number[]; criado_por: string | null };
const paraModelo = (l: Linha): ModeloBanco => ({ id: l.id, nome: l.nome, assunto: l.assunto, corpoHtml: l.corpo_html, entidades: l.entidades, editavel: true, criadoPor: l.criado_por });

// Mesma limpeza leve do envio (enviar-email): o texto vem de uma tela
// autenticada da equipe; tira script, estilo, atributos on* e imagens que não
// sejam https (data:/blob: não abrem no e-mail de quem recebe).
export function sanitizarCorpoModelo(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<img\b[^>]*\ssrc=["'](?!https:\/\/)[^"']*["'][^>]*>/gi, "");
}

export async function listarModelosBanco(entityTypeId: number): Promise<ModeloBanco[]> {
  try {
    const { data, error } = await createServiceClient()
      .from("bitrix_email_modelos")
      .select("id, nome, assunto, corpo_html, entidades, criado_por")
      .eq("ativo", true)
      .contains("entidades", [entityTypeId])
      .order("nome", { ascending: true });
    if (error) throw error;
    return ((data ?? []) as Linha[]).map(paraModelo);
  } catch (e) {
    // Sem a tabela/banco a aba continua com os modelos do código.
    console.error("Modelos de e-mail do banco indisponíveis:", e);
    return [];
  }
}

function validar(nome: string, assunto: string, corpoHtml: string): string | null {
  if (!nome.trim()) return "Dê um nome ao modelo.";
  if (nome.trim().length > 120) return "O nome do modelo pode ter até 120 caracteres.";
  if (!corpoHtml.replace(/<[^>]*>/g, "").trim()) return "Escreva a mensagem antes de salvar o modelo.";
  if (corpoHtml.length > MAX_CORPO) return "A mensagem está grande demais para virar modelo.";
  if (assunto.length > 300) return "O assunto está grande demais.";
  return null;
}

export async function criarModelo(p: { nome: string; assunto: string; corpoHtml: string; por: string }): Promise<{ ok: true; modelo: ModeloBanco } | { ok: false; erro: string }> {
  const corpo = sanitizarCorpoModelo(p.corpoHtml);
  const erro = validar(p.nome, p.assunto, corpo);
  if (erro) return { ok: false, erro };
  const { data, error } = await createServiceClient()
    .from("bitrix_email_modelos")
    .insert({ nome: p.nome.trim(), assunto: p.assunto.trim(), corpo_html: corpo, entidades: ENTIDADES_COMERCIAL, criado_por: p.por, atualizado_por: p.por })
    .select("id, nome, assunto, corpo_html, entidades, criado_por")
    .single();
  if (error) return { ok: false, erro: error.code === "23505" ? "Já existe um modelo com esse nome." : "Não consegui salvar o modelo." };
  return { ok: true, modelo: paraModelo(data as Linha) };
}

async function podeEditar(id: string): Promise<boolean> {
  const { data } = await createServiceClient().from("bitrix_email_modelos").select("entidades, ativo").eq("id", id).maybeSingle();
  // Só edita modelo ativo da área comercial (Leads/Negócios).
  return !!data && data.ativo === true && (data.entidades as number[]).every((e) => ENTIDADES_COMERCIAL.includes(e));
}

export async function atualizarModelo(p: { id: string; assunto: string; corpoHtml: string; por: string }): Promise<{ ok: true; modelo: ModeloBanco } | { ok: false; erro: string }> {
  if (!(await podeEditar(p.id))) return { ok: false, erro: "Esse modelo não pode ser alterado por aqui." };
  const corpo = sanitizarCorpoModelo(p.corpoHtml);
  const erro = validar("x", p.assunto, corpo);
  if (erro) return { ok: false, erro };
  const { data, error } = await createServiceClient()
    .from("bitrix_email_modelos")
    .update({ assunto: p.assunto.trim(), corpo_html: corpo, atualizado_por: p.por, updated_at: new Date().toISOString() })
    .eq("id", p.id)
    .select("id, nome, assunto, corpo_html, entidades, criado_por")
    .single();
  if (error) return { ok: false, erro: "Não consegui atualizar o modelo." };
  return { ok: true, modelo: paraModelo(data as Linha) };
}

export async function excluirModelo(p: { id: string; por: string }): Promise<{ ok: boolean; erro?: string }> {
  if (!(await podeEditar(p.id))) return { ok: false, erro: "Esse modelo não pode ser excluído por aqui." };
  const { error } = await createServiceClient().from("bitrix_email_modelos").update({ ativo: false, atualizado_por: p.por, updated_at: new Date().toISOString() }).eq("id", p.id);
  return error ? { ok: false, erro: "Não consegui excluir o modelo." } : { ok: true };
}
