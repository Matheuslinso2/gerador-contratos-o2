import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseEnderecoResposta, ccPorEntidade } from "@/lib/bitrix/entidadesCard";
import { registrarAtividadeEmail } from "@/lib/bitrix/atividades";
import { enviarEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

// Recebe a resposta do cliente ao e-mail enviado pelo card (Fase 2, ver
// C:\Users\O2-Grupo\.claude\plans\frolicking-floating-frog.md). Chamado pelo
// Cloudflare Email Worker que escuta *@notificacoes.o2seguros.com.br --
// mesmo padrão de autenticação de src/app/api/integracoes/incendio-email/route.ts
// (header + secret dedicado), já que também roda sem cookie de sessão.
function autorizado(request: NextRequest) {
  const secret = process.env.BITRIX_EMAIL_RESPOSTA_SECRET;
  return Boolean(secret && request.headers.get("x-o2-integracao-token") === secret);
}

export async function POST(request: NextRequest) {
  if (!autorizado(request)) return NextResponse.json({ ok: false, erro: "não autorizado" }, { status: 401 });

  let corpo: {
    messageId?: string;
    para?: string;
    remetente?: string;
    assunto?: string;
    texto?: string;
  };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "corpo inválido" }, { status: 400 });
  }

  const { messageId, para, remetente, assunto, texto } = corpo;
  if (!messageId || !para || !remetente || !assunto) {
    return NextResponse.json({ ok: false, erro: "payload incompleto (messageId, para, remetente e assunto são obrigatórios)" }, { status: 400 });
  }

  const destino = parseEnderecoResposta(para);
  if (!destino) {
    // Endereço fora do padrão card-<entityTypeId>-<itemId>@... -- não é um
    // erro do Worker, pode ser resposta a um e-mail antigo/genérico. Só
    // registra pra investigar depois, não falha a chamada.
    console.warn("Resposta recebida em endereço fora do padrão card-<id>-<id>:", para);
    return NextResponse.json({ ok: true, ignorado: true });
  }

  const supabase = createServiceClient();

  const { data: existente } = await supabase
    .from("bitrix_email_respostas_log")
    .select("id")
    .eq("message_id", messageId)
    .maybeSingle();
  if (existente) return NextResponse.json({ ok: true, duplicado: true });

  const { entityTypeId, itemId } = destino;
  const corpoTexto = texto ?? "";

  let atividadeRegistrada = false;
  let erroAtividade: string | null = null;
  try {
    await registrarAtividadeEmail({
      entityTypeId,
      itemId,
      assunto,
      corpo: corpoTexto,
      direcao: "recebido",
      enderecoEnvolvido: remetente,
    });
    atividadeRegistrada = true;
  } catch (erro) {
    erroAtividade = erro instanceof Error ? erro.message : String(erro);
    console.error("Falha ao registrar atividade de e-mail recebido no card:", erro);
  }

  // Aviso pro time responsável -- ninguém fica sabendo de uma resposta só
  // olhando o histórico do card o tempo todo, mesma lógica do CC na Fase 1.
  try {
    await enviarEmail({
      para: ccPorEntidade(entityTypeId),
      assunto: `Resposta recebida: ${assunto}`,
      html: `<p>Nova resposta de <strong>${remetente}</strong> no card #${itemId}:</p><p>${corpoTexto.replace(/\n/g, "<br>")}</p>`,
    });
  } catch (erro) {
    console.warn("Falha ao notificar o time sobre resposta recebida:", erro);
  }

  await supabase.from("bitrix_email_respostas_log").insert({
    message_id: messageId,
    entity_type_id: entityTypeId,
    item_id: itemId,
    remetente,
    assunto,
    atividade_registrada: atividadeRegistrada,
    erro: erroAtividade,
  });

  return NextResponse.json({ ok: true, atividadeRegistrada });
}
