"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarEmail } from "@/lib/email";
import { criarCardCondominio, montarEmailCondominio, type CondominioPayload } from "@/lib/integracoes/condominio";
import { registrarNaPlanilhaCondominio } from "@/lib/integracoes/planilhaCondominio";
import { EMAIL_COMERCIAL_O2 } from "@/lib/integracoes/emailO2";

export type EstadoEnvioCondominio = { ok: boolean; erro?: string; pendente?: boolean } | null;

// Produto novo, ainda sem caixa própria (ex: incendio@, fianca@) -- vai
// direto pro comercial@ até o Matheus decidir se cria uma dedicada.
const EMAIL_DESTINO_CONDOMINIO = EMAIL_COMERCIAL_O2;

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function auditar(payload: CondominioPayload, status: string, itemId?: number, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert(
      {
        origem: "landing_page_condominio",
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

  try {
    await auditar(payload, "processando");
    const supabase = createServiceClient();
    const resultado = await criarCardCondominio(payload, supabase);
    await auditar(payload, resultado.created ? "criado" : "duplicado", resultado.item.id);

    // Best-effort: o card já foi criado, uma falha aqui não deve derrubar o
    // envio nem confundir quem preencheu a ficha.
    try {
      const { assunto, html } = montarEmailCondominio(payload, resultado);
      await enviarEmail({ para: EMAIL_DESTINO_CONDOMINIO, assunto, html, remetente: "Plataforma O2 — Condomínio" });
    } catch (erroEmail) {
      console.warn("Condomínio: falha ao enviar e-mail:", erroEmail);
    }

    try {
      await registrarNaPlanilhaCondominio({ ...payload, submittedAt: new Date().toISOString(), emailEnviado: true });
    } catch (erroPlanilha) {
      console.warn("Condomínio: falha ao registrar na planilha de conferência:", erroPlanilha);
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
    console.error("Condomínio: card no Bitrix não criado, dado preservado no Supabase para backfill:", mensagem);
    return { ok: true, pendente: true };
  }
}
