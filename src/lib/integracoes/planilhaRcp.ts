// Registra, na mesma planilha de conferência do Ficha Fiança/Capitalização/
// RC Obras (aba "RCP", criada automaticamente pelo Apps Script na primeira
// vez que um envio chega), uma linha por envio de /rcp.
//
// A ordem das colunas abaixo precisa ficar IDÊNTICA ao array
// CONFIG.rcp.cabecalho em
// integracoes/google-apps-script/ficha-fianca-planilha.gs — os dois lados
// só combinam por posição, não por nome.

import type { RcpPayload } from "./rcp";

export type DadosRcpPlanilha = RcpPayload & {
  submittedAt: string;
  emailEnviado: boolean;
};

function montarLinha(dados: DadosRcpPlanilha): unknown[] {
  return [
    dados.submittedAt,
    dados.responseId,
    dados.emailEnviado ? "E-mail enviado" : "Falha no envio do e-mail",

    dados.email,
    dados.telefone,
    dados.nomeEmpresa,
    dados.cnpj,
    dados.atividadeEmpresa,
    dados.endereco,
    dados.valorCobertura,
  ];
}

// Best-effort: uma falha aqui nunca deve impedir o envio do e-mail, que já
// aconteceu antes desta função ser chamada — só registra o aviso pra quem
// chamou decidir o que fazer (mesmo espírito de planilhaRcObras.ts).
export async function registrarNaPlanilhaRcp(dados: DadosRcpPlanilha): Promise<void> {
  const url = process.env.GOOGLE_SHEETS_FICHA_FIANCA_URL;
  const token = process.env.GOOGLE_SHEETS_FICHA_FIANCA_SECRET;
  if (!url || !token) {
    console.warn("GOOGLE_SHEETS_FICHA_FIANCA_URL/SECRET não configuradas — envio de RCP não registrado na planilha.");
    return;
  }

  const resposta = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, formulario: "rcp", linha: montarLinha(dados) }),
    signal: AbortSignal.timeout(15_000),
  });
  const respostaDados = await resposta.json();
  if (!respostaDados.ok) throw new Error(`Planilha RCP: ${respostaDados.erro || "falha desconhecida"}`);
}
