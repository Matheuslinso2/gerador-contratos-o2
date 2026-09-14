"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { montarEmailRcp, type RcpPayload } from "@/lib/integracoes/rcp";
import { registrarNaPlanilhaRcp } from "@/lib/integracoes/planilhaRcp";
import { EMAIL_COMERCIAL_O2 } from "@/lib/integracoes/emailO2";

export type EstadoEnvioRcp = { ok: boolean; erro?: string } | null;

// Produto novo, ainda sem caixa própria (ex: incendio@, fianca@) -- vai
// direto pro comercial@ até o Matheus decidir se cria uma dedicada.
const EMAIL_DESTINO_RCP = EMAIL_COMERCIAL_O2;

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function auditar(payload: RcpPayload, status: string, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert(
      {
        origem: "landing_page_rcp",
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
    console.warn("Auditoria da Ficha RCP não persistida:", error);
  }
}

export async function enviarFichaRcp(_estadoAnterior: EstadoEnvioRcp, formData: FormData): Promise<EstadoEnvioRcp> {
  const responseId = campo(formData, "response_id") || randomUUID();

  const payload: RcpPayload = {
    responseId,
    email: campo(formData, "email"),
    telefone: campo(formData, "telefone"),
    nomeEmpresa: campo(formData, "nome_empresa"),
    cnpj: campo(formData, "cnpj"),
    atividadeEmpresa: campo(formData, "atividade_empresa"),
    endereco: campo(formData, "endereco"),
    valorCobertura: campo(formData, "valor_cobertura"),
  };

  if (!payload.email || !payload.telefone || !payload.nomeEmpresa || !payload.cnpj) {
    return { ok: false, erro: "Preencha e-mail, telefone, nome da empresa e CNPJ." };
  }
  if (!payload.atividadeEmpresa || !payload.endereco) {
    return { ok: false, erro: "Preencha a atividade da empresa e o endereço." };
  }

  await auditar(payload, "processando");

  let emailEnviado = true;
  try {
    const { assunto, html } = montarEmailRcp(payload);
    await enviarEmail({
      para: EMAIL_DESTINO_RCP,
      assunto,
      html,
      remetente: "Plataforma O2 — RCP",
      throwSeFalhar: true,
    });
  } catch (error) {
    emailEnviado = false;
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("RCP: falha ao enviar e-mail:", mensagem);
    await auditar(payload, "erro", mensagem);
  }

  try {
    await registrarNaPlanilhaRcp({ ...payload, submittedAt: new Date().toISOString(), emailEnviado });
  } catch (error) {
    console.warn("RCP: falha ao registrar na planilha de conferência:", error);
  }

  if (emailEnviado) await auditar(payload, "enviado");

  // Mesmo se o e-mail falhar, o payload já está preservado em
  // integracao_formularios_log (status "erro") pra reenvio manual — não
  // trava a experiência de quem preencheu.
  return { ok: true };
}
