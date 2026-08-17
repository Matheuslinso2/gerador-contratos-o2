"use server";

import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ITEM,
  criarCardCapitalizacao,
  type CapitalizacaoFormPayload,
} from "@/lib/integracoes/capitalizacao";
import { registrarNaPlanilhaCapitalizacao, type DadosCapitalizacaoPlanilha } from "@/lib/integracoes/planilhaCapitalizacao";

export type EstadoEnvioCapitalizacao = { ok: boolean; erro?: string; pendente?: boolean } | null;

function campo(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function auditar(payload: CapitalizacaoFormPayload, status: string, itemId?: number, erro?: string) {
  try {
    const supabase = createServiceClient();
    await supabase.from("integracao_formularios_log").upsert(
      {
        origem: "landing_page_capitalizacao",
        resposta_id: payload.responseId,
        payload,
        status,
        bitrix_entity_type_id: 1048,
        bitrix_item_id: itemId ?? null,
        erro: erro ?? null,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "origem,resposta_id" }
    );
  } catch (error) {
    console.warn("Auditoria do formulário de Capitalização não persistida:", error);
  }
}

export async function enviarFormularioCapitalizacao(
  _estadoAnterior: EstadoEnvioCapitalizacao,
  formData: FormData
): Promise<EstadoEnvioCapitalizacao> {
  const quemAdministra = campo(formData, "quem_administra");
  const tipoLocatario = campo(formData, "tipo_locatario");
  const tipoLocador = campo(formData, "tipo_locador");
  const formaPagamento = campo(formData, "forma_pagamento");
  const emailContato = campo(formData, "email_contato");

  const locatEmail = campo(formData, "locat_email");
  const locatTelefone = campo(formData, "locat_telefone");

  const logradouro = campo(formData, "imovel_logradouro");
  const numero = campo(formData, "imovel_numero");
  const complemento = campo(formData, "imovel_complemento");
  const bairro = campo(formData, "imovel_bairro");
  const cidade = campo(formData, "imovel_cidade");
  const uf = campo(formData, "imovel_uf");
  const enderecoImovel = [logradouro && numero ? `${logradouro}, nº ${numero}` : logradouro || (numero ? `nº ${numero}` : ""), complemento]
    .filter(Boolean)
    .join(" – ");
  const cidadeComUf = uf ? [cidade, uf].filter(Boolean).join("/") : cidade;
  const localidadeImovel = [bairro, cidadeComUf].filter(Boolean).join(", ");

  const answers: Record<string, string> = {
    [ITEM.origem]: quemAdministra,
    [ITEM.imobiliaria]: campo(formData, "imobiliaria_nome"),
    [ITEM.emailImobiliaria]: campo(formData, "imobiliaria_email"),
    [ITEM.corretor]: campo(formData, "corretor_nome"),
    [ITEM.emailCorretor]: campo(formData, "corretor_email"),

    [ITEM.premioTotal]: campo(formData, "valor_titulo"),
    [ITEM.encargos]: campo(formData, "encargos_considerados"),
    [ITEM.prazo]: campo(formData, "prazo"),
    [ITEM.pagamento]: formaPagamento,
    [ITEM.titularCartao]: campo(formData, "titular_cartao"),
    [ITEM.cpfCartao]: campo(formData, "cpf_cartao"),

    [ITEM.tipoLocatario]: tipoLocatario === "PJ" ? "Pessoa jurídica" : "Pessoa física",
    [ITEM.locatEmail]: locatEmail,
    [ITEM.locatPjEmail]: locatEmail,
    [ITEM.locatTelefone]: locatTelefone,
    [ITEM.locatPjTelefone]: locatTelefone,
    [ITEM.locatPfNome]: campo(formData, "locat_pf_nome"),
    [ITEM.locatPfCpf]: campo(formData, "locat_pf_cpf"),
    [ITEM.locatPfNascimento]: campo(formData, "locat_pf_nascimento"),
    [ITEM.locatPfDocumento]: campo(formData, "locat_pf_rg"),
    [ITEM.locatPfOrgao]: campo(formData, "locat_pf_rg_orgao"),
    [ITEM.locatPfUf]: campo(formData, "locat_pf_rg_uf"),
    [ITEM.locatPfEmissao]: campo(formData, "locat_pf_rg_emissao"),
    [ITEM.locatPfCivil]: campo(formData, "locat_pf_estado_civil"),
    [ITEM.locatPfProfissao]: campo(formData, "locat_pf_profissao"),
    [ITEM.locatPfRenda]: campo(formData, "locat_pf_renda"),
    [ITEM.locatPjRazao]: campo(formData, "locat_pj_razao"),
    [ITEM.locatPjCnpj]: campo(formData, "locat_pj_cnpj"),
    [ITEM.locatPjFundacao]: campo(formData, "locat_pj_fundacao"),
    [ITEM.locatPjInscricao]: campo(formData, "locat_pj_inscricao"),
    [ITEM.locatPjSocio]: campo(formData, "locat_pj_socio"),
    [ITEM.locatPjCpf]: campo(formData, "locat_pj_socio_cpf"),
    [ITEM.locatPjRenda]: campo(formData, "locat_pj_renda"),

    [ITEM.imovelCep]: campo(formData, "imovel_cep"),
    [ITEM.imovelEndereco]: enderecoImovel,
    [ITEM.imovelLocalidade]: localidadeImovel,

    [ITEM.tipoLocador]: tipoLocador === "PJ" ? "Pessoa jurídica" : "Pessoa física",
    [ITEM.locadorPfNome]: campo(formData, "locador_pf_nome"),
    [ITEM.locadorPfCpf]: campo(formData, "locador_pf_cpf"),
    [ITEM.locadorPfNascimento]: campo(formData, "locador_pf_nascimento"),
    [ITEM.locadorPfDocumento]: campo(formData, "locador_pf_rg"),
    [ITEM.locadorPfOrgao]: campo(formData, "locador_pf_rg_orgao"),
    [ITEM.locadorPfUf]: campo(formData, "locador_pf_rg_uf"),
    [ITEM.locadorPjRazao]: campo(formData, "locador_pj_razao"),
    [ITEM.locadorPjCnpj]: campo(formData, "locador_pj_cnpj"),
    [ITEM.locadorPjFundacao]: campo(formData, "locador_pj_fundacao"),
    [ITEM.locadorPjInscricao]: campo(formData, "locador_pj_inscricao"),
    [ITEM.locadorPjSocio]: campo(formData, "locador_pj_socio"),
    [ITEM.locadorPjCpf]: campo(formData, "locador_pj_socio_cpf"),
    [ITEM.locadorPjTelefone]: campo(formData, "locador_pj_telefone"),
  };

  const responseId = randomUUID();
  const submittedAt = new Date().toISOString();

  const payload: CapitalizacaoFormPayload = {
    formId: "landing-page-o2-capitalizacao",
    responseId,
    submittedAt,
    respondentEmail: emailContato || null,
    editResponseUrl: null,
    answers,
  };

  const dadosPlanilha: DadosCapitalizacaoPlanilha = {
    responseId,
    submittedAt,
    emailContato,
    quemAdministra,
    imobiliariaNome: campo(formData, "imobiliaria_nome"),
    imobiliariaEmail: campo(formData, "imobiliaria_email"),
    corretorNome: campo(formData, "corretor_nome"),
    corretorEmail: campo(formData, "corretor_email"),

    valorTitulo: campo(formData, "valor_titulo"),
    encargosConsiderados: campo(formData, "encargos_considerados"),
    prazo: campo(formData, "prazo"),
    formaPagamento,
    titularCartao: campo(formData, "titular_cartao"),
    cpfCartao: campo(formData, "cpf_cartao"),

    tipoLocatario: tipoLocatario === "PJ" ? "PJ" : "PF",
    locatEmail,
    locatTelefone,
    locatPfNome: campo(formData, "locat_pf_nome"),
    locatPfCpf: campo(formData, "locat_pf_cpf"),
    locatPfNascimento: campo(formData, "locat_pf_nascimento"),
    locatPfRg: campo(formData, "locat_pf_rg"),
    locatPfRgOrgao: campo(formData, "locat_pf_rg_orgao"),
    locatPfRgUf: campo(formData, "locat_pf_rg_uf"),
    locatPfRgEmissao: campo(formData, "locat_pf_rg_emissao"),
    locatPfEstadoCivil: campo(formData, "locat_pf_estado_civil"),
    locatPfProfissao: campo(formData, "locat_pf_profissao"),
    locatPfRenda: campo(formData, "locat_pf_renda"),
    locatPjRazao: campo(formData, "locat_pj_razao"),
    locatPjCnpj: campo(formData, "locat_pj_cnpj"),
    locatPjFundacao: campo(formData, "locat_pj_fundacao"),
    locatPjInscricao: campo(formData, "locat_pj_inscricao"),
    locatPjSocio: campo(formData, "locat_pj_socio"),
    locatPjSocioCpf: campo(formData, "locat_pj_socio_cpf"),
    locatPjRenda: campo(formData, "locat_pj_renda"),

    imovelCep: campo(formData, "imovel_cep"),
    imovelLogradouro: logradouro,
    imovelNumero: numero,
    imovelComplemento: complemento,
    imovelBairro: bairro,
    imovelCidade: cidade,
    imovelUf: uf,

    tipoLocador: tipoLocador === "PJ" ? "PJ" : "PF",
    locadorPfNome: campo(formData, "locador_pf_nome"),
    locadorPfCpf: campo(formData, "locador_pf_cpf"),
    locadorPfNascimento: campo(formData, "locador_pf_nascimento"),
    locadorPfRg: campo(formData, "locador_pf_rg"),
    locadorPfRgOrgao: campo(formData, "locador_pf_rg_orgao"),
    locadorPfRgUf: campo(formData, "locador_pf_rg_uf"),
    locadorPjRazao: campo(formData, "locador_pj_razao"),
    locadorPjCnpj: campo(formData, "locador_pj_cnpj"),
    locadorPjFundacao: campo(formData, "locador_pj_fundacao"),
    locadorPjInscricao: campo(formData, "locador_pj_inscricao"),
    locadorPjSocio: campo(formData, "locador_pj_socio"),
    locadorPjSocioCpf: campo(formData, "locador_pj_socio_cpf"),
    locadorPjTelefone: campo(formData, "locador_pj_telefone"),
  };

  try {
    await auditar(payload, "processando");
    const resultado = await criarCardCapitalizacao(payload);
    await auditar(payload, resultado.created ? "criado" : "duplicado", resultado.item.id);
    try {
      await registrarNaPlanilhaCapitalizacao(dadosPlanilha, resultado);
    } catch (erroPlanilha) {
      // Não falha o envio por isso — o card já foi criado, o que importa.
      // A planilha é só o registro de conferência.
      console.warn("Falha ao registrar na planilha de conferência da Capitalização:", erroPlanilha);
    }
    return { ok: true };
  } catch (error) {
    // Mesmo espírito do ficha-fianca/actions.ts: o card no Bitrix falhou,
    // mas o payload já está salvo em integracao_formularios_log (status
    // "processando" logo acima) — devolve sucesso pro visitante e deixa o
    // backfill manual pra quando o Bitrix voltar (buscar status "erro").
    const mensagem = error instanceof Error ? error.message : String(error);
    await auditar(payload, "erro", undefined, mensagem);
    console.error("Capitalização: card no Bitrix não criado, dado preservado no Supabase para backfill:", mensagem);
    return { ok: true, pendente: true };
  }
}
