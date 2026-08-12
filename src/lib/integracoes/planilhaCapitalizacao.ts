// Registra, na mesma planilha de conferência do Ficha Fiança (aba
// "Capitalização", criada automaticamente pelo Apps Script na primeira
// vez que um envio chega), uma linha por envio de /capitalizacao com os
// dados completos preenchidos — mesmo espírito e mesmo Apps Script de
// planilhaSeguroFianca.ts, só que despachado pro formulário certo via
// o campo "formulario" no corpo enviado.
//
// A ordem das colunas abaixo precisa ficar IDÊNTICA ao array
// CONFIG.capitalizacao.cabecalho em
// integracoes/google-apps-script/ficha-fianca-planilha.gs — os dois
// lados só combinam por posição, não por nome.

export type DadosCapitalizacaoPlanilha = {
  responseId: string;
  submittedAt: string;
  emailContato: string;
  quemAdministra: string;
  imobiliariaNome: string;
  imobiliariaEmail: string;
  corretorNome: string;
  corretorEmail: string;

  valorTitulo: string;
  encargosConsiderados: string;
  prazo: string;
  formaPagamento: string;
  titularCartao: string;
  cpfCartao: string;

  tipoLocatario: "PF" | "PJ";
  locatEmail: string;
  locatTelefone: string;
  locatPfNome: string;
  locatPfCpf: string;
  locatPfNascimento: string;
  locatPfRg: string;
  locatPfRgOrgao: string;
  locatPfRgUf: string;
  locatPfRgEmissao: string;
  locatPfEstadoCivil: string;
  locatPfProfissao: string;
  locatPfRenda: string;
  locatPjRazao: string;
  locatPjCnpj: string;
  locatPjFundacao: string;
  locatPjInscricao: string;
  locatPjSocio: string;
  locatPjSocioCpf: string;
  locatPjRenda: string;

  imovelCep: string;
  imovelLogradouro: string;
  imovelNumero: string;
  imovelComplemento: string;
  imovelBairro: string;
  imovelCidade: string;
  imovelUf: string;

  tipoLocador: "PF" | "PJ";
  locadorPfNome: string;
  locadorPfCpf: string;
  locadorPfNascimento: string;
  locadorPfRg: string;
  locadorPfRgOrgao: string;
  locadorPfRgUf: string;
  locadorPjRazao: string;
  locadorPjCnpj: string;
  locadorPjFundacao: string;
  locadorPjInscricao: string;
  locadorPjSocio: string;
  locadorPjSocioCpf: string;
  locadorPjTelefone: string;
};

type ResultadoCriacaoCard = { created: boolean; item: { id: number; title: string } };

const ENTITY_TYPE_ID = 1048;
const BITRIX_BASE_URL = "https://o2seguros.bitrix24.com.br";

function linkDoCard(itemId: number): string {
  return `${BITRIX_BASE_URL}/crm/type/${ENTITY_TYPE_ID}/details/${itemId}/`;
}

function montarLinha(dados: DadosCapitalizacaoPlanilha, resultado: ResultadoCriacaoCard): unknown[] {
  return [
    dados.submittedAt,
    dados.responseId,
    resultado.created ? "Criado" : "Duplicado (já existia)",
    resultado.item.id,
    linkDoCard(resultado.item.id),

    dados.emailContato,
    dados.quemAdministra,
    dados.imobiliariaNome,
    dados.imobiliariaEmail,
    dados.corretorNome,
    dados.corretorEmail,

    dados.valorTitulo,
    dados.encargosConsiderados,
    dados.prazo,
    dados.formaPagamento,
    dados.titularCartao,
    dados.cpfCartao,

    dados.tipoLocatario,
    dados.locatEmail,
    dados.locatTelefone,
    dados.locatPfNome,
    dados.locatPfCpf,
    dados.locatPfNascimento,
    dados.locatPfRg,
    dados.locatPfRgOrgao,
    dados.locatPfRgUf,
    dados.locatPfRgEmissao,
    dados.locatPfEstadoCivil,
    dados.locatPfProfissao,
    dados.locatPfRenda,
    dados.locatPjRazao,
    dados.locatPjCnpj,
    dados.locatPjFundacao,
    dados.locatPjInscricao,
    dados.locatPjSocio,
    dados.locatPjSocioCpf,
    dados.locatPjRenda,

    dados.imovelCep,
    dados.imovelLogradouro,
    dados.imovelNumero,
    dados.imovelComplemento,
    dados.imovelBairro,
    dados.imovelCidade,
    dados.imovelUf,

    dados.tipoLocador,
    dados.locadorPfNome,
    dados.locadorPfCpf,
    dados.locadorPfNascimento,
    dados.locadorPfRg,
    dados.locadorPfRgOrgao,
    dados.locadorPfRgUf,
    dados.locadorPjRazao,
    dados.locadorPjCnpj,
    dados.locadorPjFundacao,
    dados.locadorPjInscricao,
    dados.locadorPjSocio,
    dados.locadorPjSocioCpf,
    dados.locadorPjTelefone,
  ];
}

// Best-effort: uma falha aqui nunca deve impedir a criação do card, que já
// aconteceu antes desta função ser chamada — só registra o aviso pra quem
// chamou decidir o que fazer (mesmo espírito da auditoria no Supabase).
export async function registrarNaPlanilhaCapitalizacao(dados: DadosCapitalizacaoPlanilha, resultado: ResultadoCriacaoCard): Promise<void> {
  const url = process.env.GOOGLE_SHEETS_FICHA_FIANCA_URL;
  const token = process.env.GOOGLE_SHEETS_FICHA_FIANCA_SECRET;
  if (!url || !token) {
    console.warn("GOOGLE_SHEETS_FICHA_FIANCA_URL/SECRET não configuradas — envio de Capitalização não registrado na planilha.");
    return;
  }

  const resposta = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, formulario: "capitalizacao", linha: montarLinha(dados, resultado) }),
    signal: AbortSignal.timeout(15_000),
  });
  const respostaDados = await resposta.json();
  if (!respostaDados.ok) throw new Error(`Planilha Capitalização: ${respostaDados.erro || "falha desconhecida"}`);
}
