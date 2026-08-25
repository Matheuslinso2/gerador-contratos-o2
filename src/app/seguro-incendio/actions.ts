"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import {
  criarCardSeguroIncendio,
  montarEmailSeguroIncendio,
  type SeguroIncendioPayload,
  type ModalidadeIncendio,
} from "@/lib/integracoes/seguroIncendio";
import { EMAIL_COMERCIAL_O2 } from "@/lib/integracoes/emailO2";
import { enviarEmail } from "@/lib/email";

export type EstadoEnvioSeguroIncendio = { ok: boolean; erro?: string; pendente?: boolean } | null;

const EMAIL_DESTINO_SEGURO_INCENDIO = "incendio@o2seguros.com.br";

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

const MODALIDADES_VALIDAS: ModalidadeIncendio[] = ["Residencial", "Empresarial", "Imobiliario"];
const SOLICITANTES_VALIDOS = ["Proprietário", "Inquilino", "Imobiliária/Administradora"];

// Mesma lógica do formatarMoedaDigitada (validacoesBr.ts), mas server-side:
// o valor já chega mascarado ("2.000,00") pelo CampoMoeda, então basta
// desfazer a máscara pt-BR pra validar o número de verdade.
function paraNumero(valor: string): number {
  const limpo = valor.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : 0;
}

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
    solicitante: campo(formData, "solicitante"),
    finsLocacao: campo(formData, "fins_locacao"),
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
    if (!SOLICITANTES_VALIDOS.includes(payload.solicitante)) {
      return { ok: false, erro: "Informe quem está solicitando a ficha." };
    }
    if (payload.solicitante === "Proprietário" && payload.finsLocacao !== "Sim" && payload.finsLocacao !== "Não") {
      return { ok: false, erro: "Informe se a cotação é para fins de locação a terceiros." };
    }
    // Inquilino e Imobiliária/Administradora sempre pedem cotação de imóvel
    // alugado; Proprietário só pede metragem/aluguel quando confirma que é
    // para locação a terceiros -- mesma regra calculada no formulário.
    const precisaDadosAluguel =
      payload.solicitante === "Inquilino" ||
      payload.solicitante === "Imobiliária/Administradora" ||
      (payload.solicitante === "Proprietário" && payload.finsLocacao === "Sim");
    if (precisaDadosAluguel) {
      if (!payload.metragem || paraNumero(payload.metragem) <= 0) {
        return { ok: false, erro: "Informe a metragem do imóvel (maior que zero)." };
      }
      if (!payload.valorAluguel || paraNumero(payload.valorAluguel) <= 0) {
        return { ok: false, erro: "Informe o valor do aluguel (maior que zero)." };
      }
    }
  }

  try {
    await auditar(payload, "processando");
    const supabase = createServiceClient();
    const resultado = await criarCardSeguroIncendio(payload, supabase);
    await auditar(payload, resultado.created ? "criado" : "duplicado", resultado.item.id);

    // Best-effort: o card já foi criado, uma falha aqui não deve derrubar o
    // envio nem confundir quem preencheu a ficha.
    try {
      const { assunto, html } = montarEmailSeguroIncendio(payload, resultado);
      await enviarEmail({
        para: EMAIL_DESTINO_SEGURO_INCENDIO,
        cc: [EMAIL_COMERCIAL_O2],
        assunto,
        html,
        remetente: "Plataforma O2 — Seguro Incêndio",
      });
    } catch (erroEmail) {
      console.warn("Seguro Incêndio: falha ao enviar e-mail pra incendio@o2seguros.com.br:", erroEmail);
    }

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
