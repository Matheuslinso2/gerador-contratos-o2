// Registra, na mesma planilha de conferência do Ficha Fiança/Capitalização
// (aba "RC Obras", criada automaticamente pelo Apps Script na primeira vez
// que um envio chega), uma linha por envio de /rc-obras.
//
// A ordem das colunas abaixo precisa ficar IDÊNTICA ao array
// CONFIG.rc_obras.cabecalho em
// integracoes/google-apps-script/ficha-fianca-planilha.gs — os dois lados
// só combinam por posição, não por nome.

import { COBERTURAS_RC_OBRAS, type RcObrasPayload } from "./rcObras";

export type DadosRcObrasPlanilha = RcObrasPayload & {
  submittedAt: string;
  emailEnviado: boolean;
};

function montarLinha(dados: DadosRcObrasPlanilha): unknown[] {
  return [
    dados.submittedAt,
    dados.responseId,
    dados.emailEnviado ? "E-mail enviado" : "Falha no envio do e-mail",

    dados.email,
    dados.telefone,
    dados.nomeCompleto,
    dados.cpfCnpj,

    dados.obraCep,
    dados.obraLogradouro,
    dados.obraNumero,
    dados.obraComplemento,
    dados.obraBairro,
    dados.obraCidade,
    dados.obraUf,

    dados.tipoObra,
    dados.reforcoEstrutural,
    dados.dataInicio,
    dados.dataFim,
    dados.evolucaoObra,

    ...COBERTURAS_RC_OBRAS.map((c) => dados.coberturas[c.chave] || ""),
  ];
}

// Best-effort: uma falha aqui nunca deve impedir o envio do e-mail, que já
// aconteceu antes desta função ser chamada — só registra o aviso pra quem
// chamou decidir o que fazer (mesmo espírito de planilhaCapitalizacao.ts).
export async function registrarNaPlanilhaRcObras(dados: DadosRcObrasPlanilha): Promise<void> {
  const url = process.env.GOOGLE_SHEETS_FICHA_FIANCA_URL;
  const token = process.env.GOOGLE_SHEETS_FICHA_FIANCA_SECRET;
  if (!url || !token) {
    console.warn("GOOGLE_SHEETS_FICHA_FIANCA_URL/SECRET não configuradas — envio de RC Obras não registrado na planilha.");
    return;
  }

  const resposta = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, formulario: "rc_obras", linha: montarLinha(dados) }),
    signal: AbortSignal.timeout(15_000),
  });
  const respostaDados = await resposta.json();
  if (!respostaDados.ok) throw new Error(`Planilha RC Obras: ${respostaDados.erro || "falha desconhecida"}`);
}
