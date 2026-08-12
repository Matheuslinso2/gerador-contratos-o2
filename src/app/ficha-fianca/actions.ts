"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import {
  criarCardSeguroFianca,
  type FichaFiancaPayload,
  type LocatarioPfPayload,
} from "@/lib/integracoes/seguroFianca";
import { registrarNaPlanilhaFianca } from "@/lib/integracoes/planilhaSeguroFianca";

export type EstadoEnvioFichaFianca = { ok: boolean; erro?: string } | null;

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function auditar(payload: FichaFiancaPayload, status: string, itemId?: number, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert(
      {
        origem: "landing_page_seguro_fianca",
        resposta_id: payload.responseId,
        payload,
        status,
        bitrix_entity_type_id: 1042,
        bitrix_item_id: itemId ?? null,
        erro: erro ?? null,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "origem,resposta_id" }
    );
  } catch (error) {
    console.warn("Auditoria da Ficha Fiança não persistida:", error);
  }
}

function locatarioDoFormulario(formData: FormData, indice: 1 | 2 | 3): LocatarioPfPayload {
  const p = `locat${indice}`;
  return {
    nome: campo(formData, `${p}_nome`),
    cpf: campo(formData, `${p}_cpf`),
    email: campo(formData, `${p}_email`),
    telefone: campo(formData, `${p}_telefone`),
    profissao: campo(formData, `${p}_profissao`),
    rendaMensal: campo(formData, `${p}_renda`),
    empresaNome: campo(formData, `${p}_empresa_nome`),
    empresaSalarioBruto: campo(formData, `${p}_empresa_salario`),
    empresaTelefone: campo(formData, `${p}_empresa_telefone`),
  };
}

export async function enviarFichaFianca(
  _estadoAnterior: EstadoEnvioFichaFianca,
  formData: FormData
): Promise<EstadoEnvioFichaFianca> {
  const tipoPessoaLocatario = campo(formData, "tipo_pessoa_locatario") as FichaFiancaPayload["tipoPessoaLocatario"];
  const qtdLocatarios = tipoPessoaLocatario === "PJ" ? 0 : Number(tipoPessoaLocatario);

  const locatarios: LocatarioPfPayload[] = [];
  for (let i = 1; i <= qtdLocatarios; i++) {
    locatarios.push(locatarioDoFormulario(formData, i as 1 | 2 | 3));
  }

  // Gerado no navegador (um por carregamento de página) e enviado como
  // campo oculto — se faltar por algum motivo, cai pra um novo aqui, mas
  // aí perde a proteção contra clique duplicado (dois códigos diferentes).
  const responseId = campo(formData, "response_id") || randomUUID();

  const payload: FichaFiancaPayload = {
    formId: "landing-page-o2-ficha-fianca",
    responseId,
    submittedAt: new Date().toISOString(),

    emailContato: campo(formData, "email_contato"),
    vocEIs: campo(formData, "voce_e") as FichaFiancaPayload["vocEIs"],
    imovelAdministrado: (campo(formData, "imovel_administrado") || "") as FichaFiancaPayload["imovelAdministrado"],
    adminNome: campo(formData, "admin_nome"),
    adminEmail: campo(formData, "admin_email"),
    adminTelefone: campo(formData, "admin_telefone"),
    proprietarioNome: campo(formData, "proprietario_nome"),
    proprietarioEmail: campo(formData, "proprietario_email"),
    proprietarioTelefone: campo(formData, "proprietario_telefone"),

    finalidadeImovel: campo(formData, "finalidade_imovel") as FichaFiancaPayload["finalidadeImovel"],
    imovelCep: campo(formData, "imovel_cep"),
    imovelLogradouro: campo(formData, "imovel_logradouro"),
    imovelNumero: campo(formData, "imovel_numero"),
    imovelComplemento: campo(formData, "imovel_complemento"),
    imovelBairro: campo(formData, "imovel_bairro"),
    imovelCidade: campo(formData, "imovel_cidade"),
    imovelUf: campo(formData, "imovel_uf"),
    aluguel: campo(formData, "aluguel"),
    condominio: campo(formData, "condominio"),
    iptu: campo(formData, "iptu"),
    agua: campo(formData, "agua"),
    luz: campo(formData, "luz"),
    gas: campo(formData, "gas"),
    prazoVigenciaTexto: campo(formData, "prazo_vigencia"),

    tipoPessoaLocatario,
    locatarios,
    locatPjRazao: campo(formData, "locat_pj_razao"),
    locatPjCnpj: campo(formData, "locat_pj_cnpj"),
    locatPjEmail: campo(formData, "locat_pj_email"),
    locatPjTelefone: campo(formData, "locat_pj_telefone"),
    locatPjComentarios: campo(formData, "locat_pj_comentarios"),

    seguroIncendio: campo(formData, "seguro_incendio") as FichaFiancaPayload["seguroIncendio"],
  };

  try {
    await auditar(payload, "processando");
    const resultado = await criarCardSeguroFianca(payload);
    await auditar(payload, resultado.created ? "criado" : "duplicado", resultado.item.id);
    try {
      await registrarNaPlanilhaFianca(payload, resultado);
    } catch (erroPlanilha) {
      // Não falha o envio por isso — o card já foi criado, o que importa.
      // A planilha é só o registro de conferência.
      console.warn("Falha ao registrar na planilha de conferência da Ficha Fiança:", erroPlanilha);
    }
    return { ok: true };
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    await auditar(payload, "erro", undefined, mensagem);
    return { ok: false, erro: mensagem };
  }
}
