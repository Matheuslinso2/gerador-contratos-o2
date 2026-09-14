"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { montarEmailSeguroCelular, type SeguroCelularPayload } from "@/lib/integracoes/seguroCelular";
import { registrarNaPlanilhaSeguroCelular } from "@/lib/integracoes/planilhaSeguroCelular";
import { EMAIL_COMERCIAL_O2 } from "@/lib/integracoes/emailO2";

export type EstadoEnvioSeguroCelular = { ok: boolean; erro?: string } | null;

// Produto novo, ainda sem caixa própria (ex: incendio@, fianca@) -- vai
// direto pro comercial@ até o Matheus decidir se cria uma dedicada.
const EMAIL_DESTINO_SEGURO_CELULAR = EMAIL_COMERCIAL_O2;
const BUCKET_ANEXOS = "seguro-celular-anexos";

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function auditar(payload: SeguroCelularPayload, status: string, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert(
      {
        origem: "landing_page_seguro_celular",
        resposta_id: payload.responseId,
        payload,
        status,
        bitrix_entity_type_id: null,
        bitrix_item_id: null,
        erro: erro ?? null,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "origem,resposta_id" }
    );
  } catch (error) {
    console.warn("Auditoria da Ficha Seguro Celular não persistida:", error);
  }
}

export async function enviarFichaSeguroCelular(_estadoAnterior: EstadoEnvioSeguroCelular, formData: FormData): Promise<EstadoEnvioSeguroCelular> {
  const responseId = campo(formData, "response_id") || randomUUID();

  const payload: SeguroCelularPayload = {
    responseId,
    email: campo(formData, "email"),
    telefone: campo(formData, "telefone"),
    nomeCompleto: campo(formData, "nome_completo"),
    cpf: campo(formData, "cpf"),
    numeroLinha: campo(formData, "numero_linha"),
    endereco: campo(formData, "endereco"),
    idadeAparelho: campo(formData, "idade_aparelho"),
    anexoNotaFiscal: campo(formData, "anexo_nota_fiscal"),
  };

  if (!payload.email || !payload.telefone || !payload.nomeCompleto || !payload.cpf) {
    return { ok: false, erro: "Preencha e-mail, telefone, nome completo e CPF." };
  }
  if (!payload.endereco) {
    return { ok: false, erro: "Preencha o endereço." };
  }
  if (!payload.numeroLinha) {
    return { ok: false, erro: "Preencha o número de telefone utilizado no aparelho." };
  }

  await auditar(payload, "processando");

  const supabase = createServiceClient();

  // Link assinado pro time baixar a nota fiscal direto do e-mail -- não há
  // card no Bitrix aqui pra anexar o arquivo (ver seguroCelular.ts), então
  // o e-mail É o único jeito de acessar o anexo. 30 dias de validade.
  let linkNotaFiscal: string | undefined;
  if (payload.anexoNotaFiscal) {
    const { data } = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrl(payload.anexoNotaFiscal, 60 * 60 * 24 * 30);
    linkNotaFiscal = data?.signedUrl;
  }

  let emailEnviado = true;
  try {
    const { assunto, html } = montarEmailSeguroCelular(payload, linkNotaFiscal);
    await enviarEmail({
      para: EMAIL_DESTINO_SEGURO_CELULAR,
      assunto,
      html,
      remetente: "Plataforma O2 — Seguro Celular",
      throwSeFalhar: true,
    });
  } catch (error) {
    emailEnviado = false;
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("Seguro Celular: falha ao enviar e-mail:", mensagem);
    await auditar(payload, "erro", mensagem);
  }

  try {
    await registrarNaPlanilhaSeguroCelular({ ...payload, submittedAt: new Date().toISOString(), emailEnviado });
  } catch (error) {
    console.warn("Seguro Celular: falha ao registrar na planilha de conferência:", error);
  }

  if (emailEnviado) await auditar(payload, "enviado");

  // Mesmo se o e-mail falhar, o payload já está preservado em
  // integracao_formularios_log (status "erro") pra reenvio manual — não
  // trava a experiência de quem preencheu.
  return { ok: true };
}
