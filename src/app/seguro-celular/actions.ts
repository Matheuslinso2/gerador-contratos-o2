"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { criarCardSeguroCelular, montarEmailSeguroCelular, type SeguroCelularPayload } from "@/lib/integracoes/seguroCelular";
import { registrarNaPlanilhaSeguroCelular } from "@/lib/integracoes/planilhaSeguroCelular";
import { EMAIL_COMERCIAL_O2 } from "@/lib/integracoes/emailO2";

export type EstadoEnvioSeguroCelular = { ok: boolean; erro?: string; pendente?: boolean } | null;

// Produto novo, ainda sem caixa própria (ex: incendio@, fianca@) -- vai
// direto pro comercial@ até o Matheus decidir se cria uma dedicada.
const EMAIL_DESTINO_SEGURO_CELULAR = EMAIL_COMERCIAL_O2;

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function auditar(payload: SeguroCelularPayload, status: string, itemId?: number, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert(
      {
        origem: "landing_page_seguro_celular",
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

  try {
    await auditar(payload, "processando");
    const supabase = createServiceClient();
    const resultado = await criarCardSeguroCelular(payload, supabase);
    await auditar(payload, resultado.created ? "criado" : "duplicado", resultado.item.id);

    // Best-effort: o card já foi criado, uma falha aqui não deve derrubar o
    // envio nem confundir quem preencheu a ficha.
    try {
      const { assunto, html } = montarEmailSeguroCelular(payload, resultado);
      await enviarEmail({ para: EMAIL_DESTINO_SEGURO_CELULAR, assunto, html, remetente: "Plataforma O2 — Seguro Celular" });
    } catch (erroEmail) {
      console.warn("Seguro Celular: falha ao enviar e-mail:", erroEmail);
    }

    try {
      await registrarNaPlanilhaSeguroCelular({ ...payload, submittedAt: new Date().toISOString(), emailEnviado: true });
    } catch (erroPlanilha) {
      console.warn("Seguro Celular: falha ao registrar na planilha de conferência:", erroPlanilha);
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
    console.error("Seguro Celular: card no Bitrix não criado, dado preservado no Supabase para backfill:", mensagem);
    return { ok: true, pendente: true };
  }
}
