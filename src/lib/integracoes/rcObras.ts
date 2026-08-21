// RC Obras (Seguro de Responsabilidade Civil de Obras) ainda não tem SPA no
// Bitrix -- diferente dos outros formulários desta pasta, aqui não existe
// criarCard*(). O intake é 100% por e-mail (enviarFichaRcObras em
// src/app/rc-obras/actions.ts chama enviarEmail() de src/lib/email.ts) mais
// uma linha na planilha compartilhada "Landing Pages O2 — Conferência"
// (ver planilhaRcObras.ts). Esta função só monta o conteúdo do e-mail.

export const COBERTURAS_RC_OBRAS = [
  { chave: "coberturaBasica", label: "Cobertura Básica - Obras Civis em Construção" },
  { chave: "despesasDesentulho", label: "Despesas de Desentulho" },
  { chave: "errosProjeto", label: "Danos em Consequência de Erro de Projeto/Risco do Fabricante" },
  { chave: "equipamentosMoveisEstacionarios", label: "Equipamentos Móveis e Estacionários" },
  { chave: "equipamentosPequenoMedioPorte", label: "Equipamentos de Pequeno e Médio Porte" },
  { chave: "rcGeralCruzada", label: "Responsabilidade Civil Geral e Cruzada Riscos de Engenharia" },
  { chave: "rcDanosMoraisEngenharia", label: "Responsabilidade Civil Geral Por Danos Morais Riscos de Engenharia" },
  { chave: "rcDanosMoraisEmpregador", label: "Responsabilidade Civil por Danos Morais Empregador" },
  { chave: "rcEmpregador", label: "Responsabilidade Civil Do Empregador" },
] as const;

export type CoberturaRcObrasChave = (typeof COBERTURAS_RC_OBRAS)[number]["chave"];

export type RcObrasPayload = {
  responseId: string;
  email: string;
  telefone: string;
  nomeCompleto: string;
  cpfCnpj: string;
  obraCep: string;
  obraLogradouro: string;
  obraNumero: string;
  obraComplemento: string;
  obraBairro: string;
  obraCidade: string;
  obraUf: string;
  tipoObra: "Reforma" | "Construção do zero";
  reforcoEstrutural: "Sim" | "Não";
  dataInicio: string;
  dataFim: string;
  evolucaoObra: string;
  coberturas: Record<CoberturaRcObrasChave, string>;
};

import { envolverEmailO2, linhaCampo, blocoSecao } from "./emailO2";

function formatarData(iso: string): string {
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

export function montarEmailRcObras(p: RcObrasPayload): { assunto: string; html: string } {
  const enderecoObra = [
    [p.obraLogradouro, p.obraNumero].filter(Boolean).join(", "),
    p.obraComplemento,
    p.obraBairro,
    p.obraCidade && p.obraUf ? `${p.obraCidade}/${p.obraUf}` : "",
    p.obraCep ? `CEP ${p.obraCep}` : "",
  ]
    .filter(Boolean)
    .join(" — ");

  const coberturasSelecionadas = COBERTURAS_RC_OBRAS.filter((c) => p.coberturas[c.chave]);
  const totalCoberturas = coberturasSelecionadas.reduce((soma, c) => {
    const numero = Number(p.coberturas[c.chave].replace(/\./g, "").replace(",", "."));
    return soma + (Number.isFinite(numero) ? numero : 0);
  }, 0);

  const linhasCoberturas = coberturasSelecionadas.length
    ? coberturasSelecionadas
        .map(
          (c) => `
      <tr>
        <td style="padding:10px 14px;font-size:13px;color:#01192e;font-family:'Poppins',Arial,sans-serif;border-bottom:1px solid #f2f2f2;">${c.label}</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#01192e;font-family:'Poppins',Arial,sans-serif;border-bottom:1px solid #f2f2f2;text-align:right;white-space:nowrap;">R$ ${p.coberturas[c.chave]}</td>
      </tr>`
        )
        .join("") +
      `<tr>
        <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#F8540D;font-family:'Poppins',Arial,sans-serif;">Total das coberturas solicitadas</td>
        <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#F8540D;font-family:'Poppins',Arial,sans-serif;text-align:right;white-space:nowrap;">R$ ${totalCoberturas.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>`
    : `<tr><td colspan="2" style="padding:10px 14px;font-size:13px;color:#8d8683;font-family:'Poppins',Arial,sans-serif;">Nenhuma cobertura específica marcada — apenas cotação geral.</td></tr>`;

  const corpoHtml = [
    blocoSecao(
      "Contato",
      [linhaCampo("E-mail", p.email), linhaCampo("Telefone", p.telefone)].join("")
    ),
    blocoSecao(
      "Segurado",
      [linhaCampo("Nome completo", p.nomeCompleto), linhaCampo("CPF/CNPJ", p.cpfCnpj)].join("")
    ),
    blocoSecao(
      "Dados da obra",
      [
        linhaCampo("Endereço", enderecoObra),
        linhaCampo("Reforma ou construção do zero", p.tipoObra),
        linhaCampo("Reforço estrutural", p.reforcoEstrutural),
        linhaCampo("Início da obra", formatarData(p.dataInicio)),
        linhaCampo("Fim da obra", formatarData(p.dataFim)),
        linhaCampo("Evolução da obra", p.evolucaoObra),
      ].join("")
    ),
    blocoSecao("Coberturas solicitadas", linhasCoberturas),
  ].join("");

  const html = envolverEmailO2({
    badge: "Seguro Obra — RC Obras",
    titulo: "Nova ficha preenchida! 📋",
    introducao: `${p.nomeCompleto} acabou de preencher a ficha de RC Obras pela Plataforma O2. Confira tudo o que foi informado abaixo:`,
    corpoHtml,
    protocolo: p.responseId,
    origem: "/rc-obras",
  });

  return { assunto: `Nova cotação RC Obras — ${p.nomeCompleto}`, html };
}
