// Seguro Condomínio ainda não tem SPA no Bitrix -- mesmo espírito de
// rcObras.ts: intake 100% por e-mail (enviarFichaCondominio em
// src/app/condominio/actions.ts) mais uma linha na planilha compartilhada
// "Landing Pages O2 — Conferência" (ver planilhaCondominio.ts). Esta
// função só monta o conteúdo do e-mail.

export type CondominioPayload = {
  responseId: string;
  nomeCondominio: string;
  cnpj: string;
  endereco: string;
  tipoEdificacao: "Vertical" | "Horizontal";
  possuiElevador: "Sim" | "Não";
  quantidadeElevadores: string; // só relevante quando possuiElevador === "Sim"
  quantidadeAndares: string;
  sindicoTelefone: string;
  sindicoEmail: string;
  anexoApoliceAnterior: string; // caminho no bucket condominio-anexos, "" se não enviado
};

import { envolverEmailO2, linhaCampo, blocoSecao, botaoPill } from "./emailO2";

export function montarEmailCondominio(p: CondominioPayload, linkApolice?: string): { assunto: string; html: string } {
  const corpoHtml = [
    blocoSecao(
      "Condomínio",
      [
        linhaCampo("Nome", p.nomeCondominio),
        linhaCampo("CNPJ", p.cnpj),
        linhaCampo("Endereço", p.endereco),
        linhaCampo("Vertical ou horizontal", p.tipoEdificacao),
        linhaCampo("Possui elevador", p.possuiElevador === "Sim" ? `Sim — ${p.quantidadeElevadores || "quantidade não informada"}` : "Não"),
        linhaCampo("Quantidade de andares", p.quantidadeAndares),
      ].join("")
    ),
    blocoSecao("Contato do síndico", [linhaCampo("Telefone", p.sindicoTelefone), linhaCampo("E-mail", p.sindicoEmail)].join("")),
    blocoSecao("Apólice anterior", linhaCampo("Anexo", p.anexoApoliceAnterior ? "✅ Enviada — link abaixo" : "— Não enviada")),
    linkApolice ? botaoPill(linkApolice, "Baixar apólice anterior →") : "",
  ].join("");

  const html = envolverEmailO2({
    badge: "Seguro Condomínio",
    titulo: "Nova ficha preenchida! 🏢",
    introducao: `${p.nomeCondominio} acabou de preencher a ficha de Seguro Condomínio pela Plataforma O2. Confira tudo o que foi informado abaixo:`,
    corpoHtml,
    protocolo: p.responseId,
    origem: "/condominio",
  });

  return { assunto: `Nova cotação Condomínio — ${p.nomeCondominio}`, html };
}
