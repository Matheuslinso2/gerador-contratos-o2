// Registra, na mesma planilha de conferência do Ficha Fiança/Capitalização/
// RC Obras (aba "Condomínio", criada automaticamente pelo Apps Script na
// primeira vez que um envio chega), uma linha por envio de /condominio.
//
// A ordem das colunas abaixo precisa ficar IDÊNTICA ao array
// CONFIG.condominio.cabecalho em
// integracoes/google-apps-script/ficha-fianca-planilha.gs — os dois lados
// só combinam por posição, não por nome.

import type { CondominioPayload } from "./condominio";

export type DadosCondominioPlanilha = CondominioPayload & {
  submittedAt: string;
  emailEnviado: boolean;
};

function montarLinha(dados: DadosCondominioPlanilha): unknown[] {
  return [
    dados.submittedAt,
    dados.responseId,
    dados.emailEnviado ? "E-mail enviado" : "Falha no envio do e-mail",

    dados.nomeCondominio,
    dados.cnpj,
    dados.endereco,
    dados.tipoEdificacao,
    dados.possuiElevador,
    dados.quantidadeElevadores,
    dados.quantidadeAndares,
    dados.sindicoTelefone,
    dados.sindicoEmail,
    dados.anexoApoliceAnterior ? "Enviada" : "",
  ];
}

// Best-effort: uma falha aqui nunca deve impedir o envio do e-mail, que já
// aconteceu antes desta função ser chamada — só registra o aviso pra quem
// chamou decidir o que fazer (mesmo espírito de planilhaRcObras.ts).
export async function registrarNaPlanilhaCondominio(dados: DadosCondominioPlanilha): Promise<void> {
  const url = process.env.GOOGLE_SHEETS_FICHA_FIANCA_URL;
  const token = process.env.GOOGLE_SHEETS_FICHA_FIANCA_SECRET;
  if (!url || !token) {
    console.warn("GOOGLE_SHEETS_FICHA_FIANCA_URL/SECRET não configuradas — envio de Condomínio não registrado na planilha.");
    return;
  }

  const resposta = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, formulario: "condominio", linha: montarLinha(dados) }),
    signal: AbortSignal.timeout(15_000),
  });
  const respostaDados = await resposta.json();
  if (!respostaDados.ok) throw new Error(`Planilha Condomínio: ${respostaDados.erro || "falha desconhecida"}`);
}
