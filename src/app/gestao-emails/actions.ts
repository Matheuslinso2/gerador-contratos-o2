"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isMatheus } from "@/lib/admin";
import { arquivarMensagem, criarRascunhoResposta, obterMensagemPorId } from "@/lib/gestaoEmails/gmail";
import { gerarRascunhoResposta } from "@/lib/gestaoEmails/respostaIA";
import { marcarComoPendente, desmarcarPendente } from "@/lib/gestaoEmails/pendentes";

// Cada action confere isMatheus de novo, mesmo a página já sendo protegida
// -- server actions são endpoints chamáveis diretamente, não só um clique de
// botão; a autorização de verdade é aqui, não na tela.
async function exigirMatheus(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isMatheus(user?.email)) throw new Error("Não autorizado.");
}

export async function arquivarAction(messageId: string): Promise<void> {
  await exigirMatheus();
  await arquivarMensagem(messageId);
  revalidatePath("/gestao-emails");
}

export async function marcarPendenteAction(messageId: string): Promise<void> {
  await exigirMatheus();
  await marcarComoPendente(messageId);
  revalidatePath("/gestao-emails");
}

export async function desmarcarPendenteAction(messageId: string): Promise<void> {
  await exigirMatheus();
  await desmarcarPendente(messageId);
  revalidatePath("/gestao-emails");
}

export async function gerarRascunhoIAAction({
  messageId,
  resumoExecutivo,
  acaoExigida,
}: {
  messageId: string;
  resumoExecutivo: string | null;
  acaoExigida: string | null;
}): Promise<void> {
  await exigirMatheus();
  const mensagem = await obterMensagemPorId(messageId);
  if (!mensagem) throw new Error("E-mail não encontrado (pode já ter saído da caixa de entrada).");
  const corpoTexto = await gerarRascunhoResposta({ mensagem, resumoExecutivo, acaoExigida });
  await criarRascunhoResposta({ mensagemOriginal: mensagem, corpoTexto });
  revalidatePath("/gestao-emails");
}
