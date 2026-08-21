"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import {
  criarCardSeguroIncendio,
  type SeguroIncendioPayload,
  type ModalidadeIncendio,
} from "@/lib/integracoes/seguroIncendio";

export type EstadoEnvioSeguroIncendio = { ok: boolean; erro?: string; pendente?: boolean } | null;

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

const MODALIDADES_VALIDAS: ModalidadeIncendio[] = ["Residencial", "Empresarial", "Imobiliario"];

async function auditar(payload: SeguroIncendioPayload, status: string, itemId?: number, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert(
      {
        origem: "landing_page_seguro_incendio",
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
    console.warn("Auditoria da Ficha Seguro Incêndio não persistida:", error);
  }
}

export async function enviarFichaSeguroIncendio(
  _estadoAnterior: EstadoEnvioSeguroIncendio,
  formData: FormData
): Promise<EstadoEnvioSeguroIncendio> {
  const responseId = campo(formData, "response_id") || randomUUID();
  const modalidadeBruta = campo(formData, "modalidade");
  const modalidade: ModalidadeIncendio = MODALIDADES_VALIDAS.includes(modalidadeBruta as ModalidadeIncendio)
    ? (modalidadeBruta as ModalidadeIncendio)
    : "Residencial";

  const payload: SeguroIncendioPayload = {
    responseId,
    modalidade,
    email: campo(formData, "email"),
    nomeProprietario: campo(formData, "nome_proprietario"),
    cpfProprietario: campo(formData, "cpf_proprietario"),
    atividadeComercial: campo(formData, "atividade_comercial"),
    imovelCep: campo(formData, "imovel_cep"),
    imovelEndereco: campo(formData, "imovel_endereco"),
    metragem: campo(formData, "metragem"),
    valorAluguel: campo(formData, "valor_aluguel"),
    administradoPorImobiliaria: campo(formData, "administrado_por_imobiliaria"),
    nomeImobiliaria: campo(formData, "nome_imobiliaria"),
    preferencias: campo(formData, "preferencias"),
    telefone: campo(formData, "telefone"),
    qtdEnderecos: campo(formData, "qtd_enderecos"),
    anexoPlanilha: campo(formData, "anexo_planilha"),
    anexoPlanilhaNome: campo(formData, "anexo_planilha_nome"),
  };

  if (modalidade === "Imobiliario") {
    if (!payload.nomeImobiliaria || !payload.email || !payload.telefone) {
      return { ok: false, erro: "Preencha nome da imobiliária, e-mail e telefone." };
    }
    if (!payload.anexoPlanilha) {
      return { ok: false, erro: "Anexe a planilha antes de enviar." };
    }
  } else {
    if (!payload.email || !payload.nomeProprietario || !payload.cpfProprietario || !payload.telefone) {
      return { ok: false, erro: "Preencha e-mail, nome, CPF do proprietário e telefone." };
    }
    if (modalidade === "Empresarial" && !payload.atividadeComercial) {
      return { ok: false, erro: "Descreva a atividade comercial do imóvel." };
    }
  }

  try {
    await auditar(payload, "processando");
    const supabase = createServiceClient();
    const resultado = await criarCardSeguroIncendio(payload, supabase);
    await auditar(payload, resultado.created ? "criado" : "duplicado", resultado.item.id);
    return { ok: true };
  } catch (error) {
    // Mesmo espírito de seguro-auto/ficha-fianca/capitalizacao: o card no
    // Bitrix não foi criado, mas o payload já está salvo em
    // integracao_formularios_log (status "processando" logo acima) --
    // devolve sucesso pro visitante e deixa o backfill manual pra quando o
    // Bitrix voltar (buscar status "erro").
    const mensagem = error instanceof Error ? error.message : String(error);
    await auditar(payload, "erro", undefined, mensagem);
    console.error("Seguro Incêndio: card no Bitrix não criado, dado preservado no Supabase para backfill:", mensagem);
    return { ok: true, pendente: true };
  }
}
