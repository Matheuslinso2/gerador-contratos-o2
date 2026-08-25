"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { criarCardSeguroAuto, montarEmailSeguroAuto, type SeguroAutoPayload } from "@/lib/integracoes/seguroAuto";
import { EMAIL_COMERCIAL_O2 } from "@/lib/integracoes/emailO2";
import { enviarEmail } from "@/lib/email";

export type EstadoEnvioSeguroAuto = { ok: boolean; erro?: string; pendente?: boolean } | null;

const EMAIL_DESTINO_SEGURO_AUTO = "auto@o2seguros.com.br";

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function auditar(payload: SeguroAutoPayload, status: string, itemId?: number, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert(
      {
        origem: "landing_page_seguro_auto",
        resposta_id: payload.responseId,
        payload,
        status,
        bitrix_entity_type_id: 1050,
        bitrix_item_id: itemId ?? null,
        erro: erro ?? null,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "origem,resposta_id" }
    );
  } catch (error) {
    console.warn("Auditoria da Ficha Seguro Auto não persistida:", error);
  }
}

export async function enviarFichaSeguroAuto(
  _estadoAnterior: EstadoEnvioSeguroAuto,
  formData: FormData
): Promise<EstadoEnvioSeguroAuto> {
  const responseId = campo(formData, "response_id") || randomUUID();

  const payload: SeguroAutoPayload = {
    responseId,
    email: campo(formData, "email"),
    nomeCompleto: campo(formData, "nome_completo"),
    telefone: campo(formData, "telefone"),
    estadoCivil: campo(formData, "estado_civil"),
    enderecoResidencial: campo(formData, "endereco_residencial"),
    possuiGaragem: campo(formData, "possui_garagem"),
    portao: campo(formData, "portao"),
    utilizacaoVeiculo: campo(formData, "utilizacao_veiculo"),
    usoCarroDetalhado: campo(formData, "uso_carro_detalhado"),
    anexoCnh: campo(formData, "anexo_cnh"),
    anexoCrlv: campo(formData, "anexo_crlv"),
    anexoApolice: campo(formData, "anexo_apolice"),
  };

  if (!payload.email || !payload.nomeCompleto || !payload.telefone) {
    return { ok: false, erro: "Preencha e-mail, nome completo e telefone." };
  }

  try {
    await auditar(payload, "processando");
    const supabase = createServiceClient();
    const resultado = await criarCardSeguroAuto(payload, supabase);
    await auditar(payload, resultado.created ? "criado" : "duplicado", resultado.item.id);

    // Best-effort: o card já foi criado, uma falha aqui não deve derrubar o
    // envio nem confundir quem preencheu a ficha.
    try {
      const { assunto, html } = montarEmailSeguroAuto(payload, resultado);
      await enviarEmail({
        para: EMAIL_DESTINO_SEGURO_AUTO,
        cc: [EMAIL_COMERCIAL_O2],
        assunto,
        html,
        remetente: "Plataforma O2 — Seguro Auto",
      });
    } catch (erroEmail) {
      console.warn("Seguro Auto: falha ao enviar e-mail pra auto@o2seguros.com.br:", erroEmail);
    }

    return { ok: true };
  } catch (error) {
    // Mesmo espírito de ficha-fianca/actions.ts e capitalizacao/actions.ts:
    // o card no Bitrix não foi criado, mas o payload já está salvo em
    // integracao_formularios_log (status "processando" logo acima) --
    // devolve sucesso pro visitante e deixa o backfill manual pra quando o
    // Bitrix voltar (buscar status "erro").
    const mensagem = error instanceof Error ? error.message : String(error);
    await auditar(payload, "erro", undefined, mensagem);
    console.error("Seguro Auto: card no Bitrix não criado, dado preservado no Supabase para backfill:", mensagem);
    return { ok: true, pendente: true };
  }
}
