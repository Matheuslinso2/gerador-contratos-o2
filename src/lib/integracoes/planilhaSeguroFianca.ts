// Registra, numa planilha do Google Sheets própria (não a do Google Forms
// original — ver decisão em integracoes/google-apps-script/README.md),
// uma linha por envio da landing page /ficha-fianca com os dados
// completos preenchidos. Serve pra conferência: o que a pessoa realmente
// digitou, lado a lado com o card criado no Bitrix e qualquer aviso de
// campo que não bateu com as opções do CRM (ver setEnumComAviso em
// seguroFianca.ts).
//
// A ordem das colunas abaixo precisa ficar IDÊNTICA ao array CABECALHO em
// integracoes/google-apps-script/ficha-fianca-planilha.gs — os dois lados
// só combinam por posição, não por nome.

import type { FichaFiancaPayload } from "./seguroFianca";

type ResultadoCriacaoCard = {
  created: boolean;
  item: { id: number; title: string };
  avisos: string[];
};

const ENTITY_TYPE_ID = 1042;
const BITRIX_BASE_URL = "https://o2seguros.bitrix24.com.br";

function linkDoCard(itemId: number): string {
  return `${BITRIX_BASE_URL}/crm/type/${ENTITY_TYPE_ID}/details/${itemId}/`;
}

function montarLinha(payload: FichaFiancaPayload, resultado: ResultadoCriacaoCard): unknown[] {
  const l1 = payload.locatarios[0];
  const l2 = payload.locatarios[1];
  const l3 = payload.locatarios[2];

  return [
    payload.submittedAt,
    payload.responseId,
    resultado.created ? "Criado" : "Duplicado (já existia)",
    resultado.item.id,
    linkDoCard(resultado.item.id),
    resultado.avisos.join(" | "),

    payload.emailContato,
    payload.vocEIs,
    payload.imovelAdministrado,
    payload.adminNome,
    payload.adminEmail,
    payload.adminTelefone,
    payload.proprietarioNome,
    payload.proprietarioEmail,
    payload.proprietarioTelefone,

    payload.finalidadeImovel,
    payload.imovelCep,
    payload.imovelLogradouro,
    payload.imovelNumero,
    payload.imovelComplemento,
    payload.imovelBairro,
    payload.imovelCidade,
    payload.imovelUf,
    payload.aluguel,
    payload.condominio,
    payload.iptu,
    payload.agua,
    payload.luz,
    payload.gas,
    "", // Pacote Locação (Total) — calculado dentro de criarCardSeguroFianca; ver card pelo link se precisar do valor exato
    payload.prazoVigenciaTexto,

    payload.tipoPessoaLocatario,
    payload.locatPjRazao,
    payload.locatPjCnpj,
    payload.locatPjEmail,
    payload.locatPjTelefone,
    payload.locatPjComentarios,

    l1?.nome ?? "",
    l1?.cpf ?? "",
    l1?.email ?? "",
    l1?.telefone ?? "",
    l1?.profissao ?? "",
    l1?.rendaMensal ?? "",
    l1?.empresaNome ?? "",
    l1?.empresaSalarioBruto ?? "",
    l1?.empresaTelefone ?? "",

    l2?.nome ?? "",
    l2?.cpf ?? "",
    l2?.email ?? "",
    l2?.telefone ?? "",
    l2?.profissao ?? "",
    l2?.rendaMensal ?? "",
    l2?.empresaNome ?? "",
    l2?.empresaSalarioBruto ?? "",
    l2?.empresaTelefone ?? "",

    l3?.nome ?? "",
    l3?.cpf ?? "",
    l3?.email ?? "",
    l3?.telefone ?? "",
    l3?.profissao ?? "",
    l3?.rendaMensal ?? "",
    l3?.empresaNome ?? "",
    l3?.empresaSalarioBruto ?? "",
    l3?.empresaTelefone ?? "",

    payload.seguroIncendio,
  ];
}

// Best-effort: uma falha aqui nunca deve impedir a criação do card, que já
// aconteceu antes desta função ser chamada — só registra o aviso pra quem
// chamou decidir o que fazer (mesmo espírito da auditoria no Supabase).
export async function registrarNaPlanilhaFianca(payload: FichaFiancaPayload, resultado: ResultadoCriacaoCard): Promise<void> {
  const url = process.env.GOOGLE_SHEETS_FICHA_FIANCA_URL;
  const token = process.env.GOOGLE_SHEETS_FICHA_FIANCA_SECRET;
  if (!url || !token) {
    console.warn("GOOGLE_SHEETS_FICHA_FIANCA_URL/SECRET não configuradas — envio não registrado na planilha.");
    return;
  }

  const resposta = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, formulario: "ficha_fianca", linha: montarLinha(payload, resultado) }),
    signal: AbortSignal.timeout(15_000),
  });
  const dados = await resposta.json();
  if (!dados.ok) throw new Error(`Planilha Ficha Fiança: ${dados.erro || "falha desconhecida"}`);
}
