// Seguro Celular ainda não tem SPA no Bitrix -- mesmo espírito de
// rcObras.ts: intake 100% por e-mail (enviarFichaSeguroCelular em
// src/app/seguro-celular/actions.ts) mais uma linha na planilha
// compartilhada "Landing Pages O2 — Conferência" (ver
// planilhaSeguroCelular.ts). Esta função só monta o conteúdo do e-mail.

export type SeguroCelularPayload = {
  responseId: string;
  email: string;
  telefone: string;
  nomeCompleto: string;
  cpf: string;
  numeroLinha: string; // número de telefone utilizado no aparelho
  endereco: string;
  idadeAparelho: string;
  anexoNotaFiscal: string; // caminho no bucket seguro-celular-anexos, "" se não enviado
};

import { envolverEmailO2, linhaCampo, blocoSecao, botaoPill } from "./emailO2";

export function montarEmailSeguroCelular(p: SeguroCelularPayload, linkNotaFiscal?: string): { assunto: string; html: string } {
  const corpoHtml = [
    blocoSecao("Contato", [linhaCampo("E-mail", p.email), linhaCampo("Telefone", p.telefone)].join("")),
    blocoSecao("Segurado", [linhaCampo("Nome completo", p.nomeCompleto), linhaCampo("CPF", p.cpf), linhaCampo("Endereço", p.endereco)].join("")),
    blocoSecao(
      "Aparelho",
      [
        linhaCampo("Número de telefone utilizado no aparelho", p.numeroLinha),
        linhaCampo("Idade do aparelho", p.idadeAparelho),
        linhaCampo("Nota fiscal", p.anexoNotaFiscal ? "✅ Enviada — link abaixo" : "— Não enviada"),
      ].join("")
    ),
    linkNotaFiscal ? botaoPill(linkNotaFiscal, "Baixar nota fiscal →") : "",
  ].join("");

  const html = envolverEmailO2({
    badge: "Seguro Celular",
    titulo: "Nova ficha preenchida! 📱",
    introducao: `${p.nomeCompleto} acabou de preencher a ficha de Seguro Celular pela Plataforma O2. Confira tudo o que foi informado abaixo:`,
    corpoHtml,
    protocolo: p.responseId,
    origem: "/seguro-celular",
  });

  return { assunto: `Nova cotação Seguro Celular — ${p.nomeCompleto}`, html };
}
