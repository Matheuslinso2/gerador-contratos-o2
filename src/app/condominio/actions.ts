"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { montarEmailCondominio, type CondominioPayload } from "@/lib/integracoes/condominio";
import { registrarNaPlanilhaCondominio } from "@/lib/integracoes/planilhaCondominio";
import { EMAIL_COMERCIAL_O2 } from "@/lib/integracoes/emailO2";

export type EstadoEnvioCondominio = { ok: boolean; erro?: string } | null;

// Produto novo, ainda sem caixa própria (ex: incendio@, fianca@) -- vai
// direto pro comercial@ até o Matheus decidir se cria uma dedicada.
const EMAIL_DESTINO_CONDOMINIO = EMAIL_COMERCIAL_O2;
const BUCKET_ANEXOS = "condominio-anexos";

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function auditar(payload: CondominioPayload, status: string, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert(
      {
        origem: "landing_page_condominio",
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
    console.warn("Auditoria da Ficha Condomínio não persistida:", error);
  }
}

export async function enviarFichaCondominio(_estadoAnterior: EstadoEnvioCondominio, formData: FormData): Promise<EstadoEnvioCondominio> {
  const responseId = campo(formData, "response_id") || randomUUID();

  const tipoEdificacaoBruto = campo(formData, "tipo_edificacao");
  const possuiElevadorBruto = campo(formData, "possui_elevador");

  const payload: CondominioPayload = {
    responseId,
    nomeCondominio: campo(formData, "nome_condominio"),
    cnpj: campo(formData, "cnpj"),
    endereco: campo(formData, "endereco"),
    tipoEdificacao: tipoEdificacaoBruto === "Horizontal" ? "Horizontal" : "Vertical",
    possuiElevador: possuiElevadorBruto === "Sim" ? "Sim" : "Não",
    quantidadeElevadores: campo(formData, "quantidade_elevadores"),
    quantidadeAndares: campo(formData, "quantidade_andares"),
    sindicoTelefone: campo(formData, "sindico_telefone"),
    sindicoEmail: campo(formData, "sindico_email"),
    anexoApoliceAnterior: campo(formData, "anexo_apolice_anterior"),
  };

  if (!payload.nomeCondominio || !payload.cnpj || !payload.endereco) {
    return { ok: false, erro: "Preencha nome, CNPJ e endereço do condomínio." };
  }
  if (!tipoEdificacaoBruto) {
    return { ok: false, erro: "Selecione se o condomínio é vertical ou horizontal." };
  }
  if (!possuiElevadorBruto) {
    return { ok: false, erro: "Informe se o condomínio possui elevador." };
  }
  if (payload.possuiElevador === "Sim" && !payload.quantidadeElevadores) {
    return { ok: false, erro: "Informe quantos elevadores o condomínio possui." };
  }
  if (payload.possuiElevador !== "Sim") {
    payload.quantidadeElevadores = "";
  }
  if (!payload.quantidadeAndares) {
    return { ok: false, erro: "Informe quantos andares o condomínio tem." };
  }
  if (!payload.sindicoTelefone || !payload.sindicoEmail) {
    return { ok: false, erro: "Preencha o telefone e o e-mail do síndico." };
  }

  await auditar(payload, "processando");

  const supabase = createServiceClient();

  // Link assinado pro time baixar a apólice anterior direto do e-mail --
  // não há card no Bitrix aqui pra anexar o arquivo (ver condominio.ts),
  // então o e-mail É o único jeito de acessar o anexo. 30 dias de validade.
  let linkApolice: string | undefined;
  if (payload.anexoApoliceAnterior) {
    const { data } = await supabase.storage.from(BUCKET_ANEXOS).createSignedUrl(payload.anexoApoliceAnterior, 60 * 60 * 24 * 30);
    linkApolice = data?.signedUrl;
  }

  let emailEnviado = true;
  try {
    const { assunto, html } = montarEmailCondominio(payload, linkApolice);
    await enviarEmail({
      para: EMAIL_DESTINO_CONDOMINIO,
      assunto,
      html,
      remetente: "Plataforma O2 — Condomínio",
      throwSeFalhar: true,
    });
  } catch (error) {
    emailEnviado = false;
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error("Condomínio: falha ao enviar e-mail:", mensagem);
    await auditar(payload, "erro", mensagem);
  }

  try {
    await registrarNaPlanilhaCondominio({ ...payload, submittedAt: new Date().toISOString(), emailEnviado });
  } catch (error) {
    console.warn("Condomínio: falha ao registrar na planilha de conferência:", error);
  }

  if (emailEnviado) await auditar(payload, "enviado");

  // Mesmo se o e-mail falhar, o payload já está preservado em
  // integracao_formularios_log (status "erro") pra reenvio manual — não
  // trava a experiência de quem preencheu.
  return { ok: true };
}
