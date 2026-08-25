"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { montarEmailRcObras, COBERTURAS_RC_OBRAS, type RcObrasPayload, type CoberturaRcObrasChave } from "@/lib/integracoes/rcObras";
import { registrarNaPlanilhaRcObras } from "@/lib/integracoes/planilhaRcObras";
import { EMAIL_COMERCIAL_O2 } from "@/lib/integracoes/emailO2";

export type EstadoEnvioRcObras = { ok: boolean; erro?: string } | null;

const EMAIL_DESTINO_RC_OBRAS = "incendio@o2seguros.com.br";

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function auditar(payload: RcObrasPayload, status: string, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert(
      {
        origem: "landing_page_rc_obras",
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
    console.warn("Auditoria da Ficha RC Obras não persistida:", error);
  }
}

export async function enviarFichaRcObras(_estadoAnterior: EstadoEnvioRcObras, formData: FormData): Promise<EstadoEnvioRcObras> {
  const responseId = campo(formData, "response_id") || randomUUID();

  const coberturas = COBERTURAS_RC_OBRAS.reduce(
    (acc, c) => {
      acc[c.chave] = campo(formData, `cobertura_${c.chave}`);
      return acc;
    },
    {} as Record<CoberturaRcObrasChave, string>
  );

  const tipoObraBruto = campo(formData, "tipo_obra");
  const reforcoBruto = campo(formData, "reforco_estrutural");
  const categoriaImovelBruta = campo(formData, "categoria_imovel");

  const payload: RcObrasPayload = {
    responseId,
    email: campo(formData, "email"),
    telefone: campo(formData, "telefone"),
    nomeCompleto: campo(formData, "nome_completo"),
    cpfCnpj: campo(formData, "cpf_cnpj"),
    obraCep: campo(formData, "obra_cep"),
    obraLogradouro: campo(formData, "obra_logradouro"),
    obraNumero: campo(formData, "obra_numero"),
    obraComplemento: campo(formData, "obra_complemento"),
    obraBairro: campo(formData, "obra_bairro"),
    obraCidade: campo(formData, "obra_cidade"),
    obraUf: campo(formData, "obra_uf"),
    categoriaImovel: categoriaImovelBruta === "Comercial" ? "Comercial" : "Residencial",
    tipoObraDetalhado: campo(formData, "tipo_obra_detalhado"),
    tipoObra: tipoObraBruto === "Construção do zero" ? "Construção do zero" : "Reforma",
    reforcoEstrutural: reforcoBruto === "Sim" ? "Sim" : "Não",
    dataInicio: campo(formData, "data_inicio"),
    dataFim: campo(formData, "data_fim"),
    evolucaoObra: campo(formData, "evolucao_obra"),
    coberturas,
  };

  if (!payload.email || !payload.telefone || !payload.nomeCompleto || !payload.cpfCnpj) {
    return { ok: false, erro: "Preencha e-mail, telefone, nome completo e CPF/CNPJ." };
  }
  if (!categoriaImovelBruta) {
    return { ok: false, erro: "Selecione se o imóvel é residencial ou comercial." };
  }
  if (!payload.tipoObraDetalhado) {
    return { ok: false, erro: "Selecione o tipo de obra." };
  }
  if (!payload.obraCep || !payload.obraLogradouro || !payload.obraNumero) {
    return { ok: false, erro: "Preencha o endereço completo da obra." };
  }
  if (!payload.dataInicio || !payload.dataFim) {
    return { ok: false, erro: "Preencha as datas de início e fim da obra." };
  }
  if (!payload.evolucaoObra) {
    return { ok: false, erro: "Selecione a porcentagem de evolução da obra." };
  }

  await auditar(payload, "processando");

  let emailEnviado = true;
  try {
    const { assunto, html } = montarEmailRcObras(payload);
    await enviarEmail({
      para: EMAIL_DESTINO_RC_OBRAS,
      cc: [EMAIL_COMERCIAL_O2],
      assunto,
      html,
      remetente: "Plataforma O2 — RC Obras",
      throwSeFalhar: true,
    });
  } catch (error) {
    emailEnviado = false;
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("RC Obras: falha ao enviar e-mail pra incendio@o2seguros.com.br:", mensagem);
    await auditar(payload, "erro", mensagem);
  }

  try {
    await registrarNaPlanilhaRcObras({ ...payload, submittedAt: new Date().toISOString(), emailEnviado });
  } catch (error) {
    console.warn("RC Obras: falha ao registrar na planilha de conferência:", error);
  }

  if (emailEnviado) await auditar(payload, "enviado");

  // Mesmo se o e-mail falhar, o payload já está preservado em
  // integracao_formularios_log (status "erro") pra reenvio manual — não
  // trava a experiência de quem preencheu.
  return { ok: true };
}
