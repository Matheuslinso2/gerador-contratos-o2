"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { criarCardRcp, montarEmailRcp, type RcpPayload } from "@/lib/integracoes/rcp";
import { registrarNaPlanilhaRcp } from "@/lib/integracoes/planilhaRcp";
import { EMAIL_COMERCIAL_O2 } from "@/lib/integracoes/emailO2";

export type EstadoEnvioRcp = { ok: boolean; erro?: string; pendente?: boolean } | null;

// Produto novo, ainda sem caixa própria (ex: incendio@, fianca@) -- vai
// direto pro comercial@ até o Matheus decidir se cria uma dedicada.
const EMAIL_DESTINO_RCP = EMAIL_COMERCIAL_O2;

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function auditar(payload: RcpPayload, status: string, itemId?: number, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert(
      {
        origem: "landing_page_rcp",
        resposta_id: payload.responseId,
        payload,
        status,
        bitrix_entity_type_id: 1046,
        bitrix_item_id: itemId ?? null,
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

  try {
    await auditar(payload, "processando");
    const supabase = createServiceClient();
    const resultado = await criarCardRcp(payload, supabase);
    await auditar(payload, resultado.created ? "criado" : "duplicado", resultado.item.id);

    // Best-effort: o card já foi criado, uma falha aqui não deve derrubar o
    // envio nem confundir quem preencheu a ficha.
    try {
      const { assunto, html } = montarEmailRcp(payload, resultado);
      await enviarEmail({ para: EMAIL_DESTINO_RCP, assunto, html, remetente: "Plataforma O2 — RCP" });
    } catch (erroEmail) {
      console.warn("RCP: falha ao enviar e-mail:", erroEmail);
    }

    try {
      await registrarNaPlanilhaRcp({ ...payload, submittedAt: new Date().toISOString(), emailEnviado: true });
    } catch (erroPlanilha) {
      console.warn("RCP: falha ao registrar na planilha de conferência:", erroPlanilha);
    }

    return { ok: true };
  } catch (error) {
    // Mesmo espírito de seguro-incendio/actions.ts: o card no Bitrix não
    // foi criado, mas o payload já está preservado em
    // integracao_formularios_log (status "processando" logo acima) --
    // devolve sucesso pro visitante e deixa o backfill manual pra quando o
    // Bitrix voltar (buscar status "erro").
    const mensagem = error instanceof Error ? error.message : String(error);
    await auditar(payload, "erro", undefined, mensagem);
    console.error("RCP: card no Bitrix não criado, dado preservado no Supabase para backfill:", mensagem);
    return { ok: true, pendente: true };
  }
}
