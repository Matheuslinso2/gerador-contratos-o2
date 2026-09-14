// Responsabilidade Civil Profissional (RCP) ainda não tem SPA no Bitrix --
// mesmo espírito de rcObras.ts: intake 100% por e-mail (enviarFichaRcp em
// src/app/rcp/actions.ts) mais uma linha na planilha compartilhada
// "Landing Pages O2 — Conferência" (ver planilhaRcp.ts). Esta função só
// monta o conteúdo do e-mail.

export type RcpPayload = {
  responseId: string;
  email: string;
  telefone: string;
  nomeEmpresa: string;
  cnpj: string;
  atividadeEmpresa: string;
  endereco: string;
  valorCobertura: string; // "1.000.000,00" (mascarado), "" se não preenchido
};

import { envolverEmailO2, linhaCampo, blocoSecao } from "./emailO2";

export function montarEmailRcp(p: RcpPayload): { assunto: string; html: string } {
  const corpoHtml = [
    blocoSecao("Contato", [linhaCampo("E-mail", p.email), linhaCampo("Telefone", p.telefone)].join("")),
    blocoSecao(
      "Empresa",
      [
        linhaCampo("Nome", p.nomeEmpresa),
        linhaCampo("CNPJ", p.cnpj),
        linhaCampo("Atividade da empresa", p.atividadeEmpresa),
        linhaCampo("Endereço", p.endereco),
      ].join("")
    ),
    blocoSecao("Cobertura", linhaCampo("Valor de cobertura", p.valorCobertura ? `R$ ${p.valorCobertura}` : "")),
  ].join("");

  const html = envolverEmailO2({
    badge: "Responsabilidade Civil Profissional",
    titulo: "Nova ficha preenchida! 💼",
    introducao: `${p.nomeEmpresa} acabou de preencher a ficha de RCP pela Plataforma O2. Confira tudo o que foi informado abaixo:`,
    corpoHtml,
    protocolo: p.responseId,
    origem: "/rcp",
  });

  return { assunto: `Nova cotação RCP — ${p.nomeEmpresa}`, html };
}
