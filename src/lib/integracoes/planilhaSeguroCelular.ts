// Registra, na mesma planilha de conferência do Ficha Fiança/Capitalização/
// RC Obras (aba "Seguro Celular", criada automaticamente pelo Apps Script
// na primeira vez que um envio chega), uma linha por envio de
// /seguro-celular.
//
// A ordem das colunas abaixo precisa ficar IDÊNTICA ao array
// CONFIG.seguro_celular.cabecalho em
// integracoes/google-apps-script/ficha-fianca-planilha.gs — os dois lados
// só combinam por posição, não por nome.

import type { SeguroCelularPayload } from "./seguroCelular";

export type DadosSeguroCelularPlanilha = SeguroCelularPayload & {
  submittedAt: string;
  emailEnviado: boolean;
};

function montarLinha(dados: DadosSeguroCelularPlanilha): unknown[] {
  return [
    dados.submittedAt,
    dados.responseId,
    dados.emailEnviado ? "E-mail enviado" : "Falha no envio do e-mail",

    dados.email,
    dados.telefone,
    dados.nomeCompleto,
    dados.cpf,
    dados.endereco,

    dados.numeroLinha,
    dados.idadeAparelho,
    dados.anexoNotaFiscal ? "Enviada" : "",
  ];
}

// Best-effort: uma falha aqui nunca deve impedir o envio do e-mail, que já
// aconteceu antes desta função ser chamada — só registra o aviso pra quem
// chamou decidir o que fazer (mesmo espírito de planilhaRcObras.ts).
export async function registrarNaPlanilhaSeguroCelular(dados: DadosSeguroCelularPlanilha): Promise<void> {
  const url = process.env.GOOGLE_SHEETS_FICHA_FIANCA_URL;
  const token = process.env.GOOGLE_SHEETS_FICHA_FIANCA_SECRET;
  if (!url || !token) {
    console.warn("GOOGLE_SHEETS_FICHA_FIANCA_URL/SECRET não configuradas — envio de Seguro Celular não registrado na planilha.");
    return;
  }

  const resposta = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, formulario: "seguro_celular", linha: montarLinha(dados) }),
    signal: AbortSignal.timeout(15_000),
  });
  const respostaDados = await resposta.json();
  if (!respostaDados.ok) throw new Error(`Planilha Seguro Celular: ${respostaDados.erro || "falha desconhecida"}`);
}
