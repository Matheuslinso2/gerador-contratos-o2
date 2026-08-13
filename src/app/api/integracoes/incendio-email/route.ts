import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extrairDadosEmailIncendio } from "@/lib/incendioEmailIA";
import { encontrarCorrespondenciaPlanilha } from "@/lib/incendioPlanilhaMatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function autorizado(request: NextRequest) {
  const secret = process.env.INCENDIO_EMAIL_INTEGRACAO_SECRET;
  return Boolean(secret && request.headers.get("x-o2-integracao-token") === secret);
}

// Status da planilha que consideramos "bate" com cada tipo de confirmação
// recebido por e-mail -- se o status na planilha não estiver nessa lista (ou
// a linha nem for encontrada), é sinal de descompasso entre o que o e-mail
// diz e o que está registrado, e vira divergência pra conferência manual.
const STATUS_COMPATIVEIS: Record<string, string[]> = {
  contratacao_confirmada: ["EFETIVADO"],
  apolice_emitida: ["EFETIVADO"],
  cancelamento_confirmado: ["CANCELADO"],
};

function statusCompativel(tipo: string, statusPlanilha: string | null): boolean {
  const aceitos = STATUS_COMPATIVEIS[tipo];
  if (!aceitos) return true; // "outro" não tem status esperado -- não gera divergência de status
  if (!statusPlanilha) return false;
  return aceitos.some((s) => statusPlanilha.toUpperCase().includes(s));
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ ok: false, erro: "não autorizado" }, { status: 401 });

  let corpo: {
    messageId?: string;
    threadId?: string;
    remetente?: string;
    assunto?: string;
    corpo?: string;
    dataRecebida?: string;
  };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "corpo inválido" }, { status: 400 });
  }

  const { messageId, threadId, remetente, assunto, corpo: corpoTexto, dataRecebida } = corpo;
  if (!messageId || !assunto || !corpoTexto) {
    return NextResponse.json({ ok: false, erro: "payload incompleto (messageId, assunto e corpo são obrigatórios)" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: existente } = await supabase
    .from("incendio_emails_confirmacao")
    .select("id")
    .eq("gmail_message_id", messageId)
    .maybeSingle();
  if (existente) return NextResponse.json({ ok: true, duplicado: true });

  let extraido;
  try {
    extraido = await extrairDadosEmailIncendio(assunto, corpoTexto, remetente ?? "");
  } catch (error) {
    return NextResponse.json({ ok: false, erro: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }

  const dataEmail = dataRecebida ? new Date(dataRecebida) : new Date();

  let correspondencia: { encontrado: boolean; aba: string | null; linha: number | null; status: string | null } = {
    encontrado: false,
    aba: null,
    linha: null,
    status: null,
  };
  if (extraido.tipo_confirmacao !== "nao_identificado" && extraido.cliente_nome) {
    try {
      correspondencia = await encontrarCorrespondenciaPlanilha({
        clienteNome: extraido.cliente_nome,
        seguradora: extraido.seguradora,
        numeroApolice: extraido.numero_apolice,
        dataReferencia: dataEmail,
      });
    } catch (error) {
      console.warn("Falha ao cruzar e-mail de incêndio com a planilha:", error);
    }
  }

  const relevante = extraido.tipo_confirmacao !== "nao_identificado" && extraido.tipo_confirmacao !== "outro";
  const divergencia = relevante && (!correspondencia.encontrado || !statusCompativel(extraido.tipo_confirmacao, correspondencia.status));
  const divergenciaMotivo = !divergencia
    ? null
    : !correspondencia.encontrado
      ? "Nenhuma linha correspondente encontrada na planilha do mês (por segurado/seguradora ou apólice)."
      : `Status na planilha ("${correspondencia.status}") não bate com o que o e-mail confirma.`;

  const { error: erroInsert } = await supabase.from("incendio_emails_confirmacao").insert({
    gmail_message_id: messageId,
    gmail_thread_id: threadId ?? null,
    recebido_em: dataEmail.toISOString(),
    remetente: remetente ?? "",
    assunto,
    corpo_texto: corpoTexto,
    tipo_confirmacao: extraido.tipo_confirmacao,
    seguradora: extraido.seguradora,
    cliente_nome: extraido.cliente_nome,
    ramo: extraido.ramo,
    numero_apolice: extraido.numero_apolice,
    valor: extraido.valor,
    planilha_encontrada: correspondencia.encontrado,
    planilha_aba: correspondencia.aba,
    planilha_linha: correspondencia.linha,
    planilha_status: correspondencia.status,
    divergencia,
    divergencia_motivo: divergenciaMotivo,
  });

  if (erroInsert) return NextResponse.json({ ok: false, erro: erroInsert.message }, { status: 500 });

  return NextResponse.json({ ok: true, tipo_confirmacao: extraido.tipo_confirmacao, divergencia });
}
