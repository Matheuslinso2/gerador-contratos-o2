// RC Obras (Seguro de Responsabilidade Civil de Obras) passa a criar card
// na mesma SPA "Produção Incêndio" (entityTypeId 1046, categoria 22 "Contratações
// e Renovações", etapa inicial DT1046_22:NEW) usada pelo Seguro Incêndio --
// mesma decisão do Matheus de 14/09/2026 que já trouxe Seguro Celular, RCP
// e Condomínio pra esse pipeline (ver src/lib/integracoes/seguroCelular.ts,
// mesmo espírito de código aqui). Continua também mandando e-mail pra
// incendio@ e registrando na planilha de conferência -- nada disso mudou.
//
// IMPORTANTE: a opção "RC Obras" no campo Produto (ufCrm12Produto) dessa
// SPA precisa ser cadastrada manualmente no Bitrix (Configurações > Campos
// personalizados) antes de existir -- a API do Bitrix não expõe um método
// de escrita pra opções de campo customizado de SPA/item dinâmico (só pra
// entidades padrão como Lead/Deal/Empresa; confirmado via `methods` em
// 15/09/2026, nenhum `crm.item.userfield.*` disponível). Até a opção ser
// cadastrada, enumId() abaixo devolve undefined e o card é criado sem
// Produto preenchido (mesmo comportamento defensivo de seguroCelular.ts).

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

export const TIPOS_OBRA_DETALHADO = [
  "Reforma não estrutural de Imóvel Residencial",
  "Reforma não estrutural de Imóvel Comercial",
  "Reforma não estrutural de Loja de Rua",
  "Reforma não estrutural de Loja em Shopping",
  "Reforma não estrutural de Escritório",
  "Reforma não estrutural de Apartamento Habitual",
] as const;

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
  categoriaImovel: "Residencial" | "Comercial";
  tipoObraDetalhado: string;
  tipoObra: "Reforma" | "Construção do zero";
  reforcoEstrutural: "Sim" | "Não";
  dataInicio: string;
  dataFim: string;
  evolucaoObra: string;
  coberturas: Record<CoberturaRcObrasChave, string>;
};

import { envolverEmailO2, linhaCampo, blocoSecao, formatarData, botaoPill } from "./emailO2";

const ENTITY_TYPE_ID = 1046;
const CATEGORY_ID = 22;
const STAGE_ID = "DT1046_22:NEW";
const BITRIX_BASE_URL = "https://o2seguros.bitrix24.com.br";

const FIELD = {
  tipoProcesso: "ufCrm12TipoProcesso",
  produto: "ufCrm12Produto",
  origemProducao: "ufCrm12OrigemProducao",
  observacoes: "ufCrm12Observacoes",
} as const;

type BitrixFieldDefinition = { items?: Array<{ ID?: string; VALUE?: string }> };
type BitrixFieldsResponse = { result: { fields: Record<string, BitrixFieldDefinition> } };
type BitrixListResponse = { result: { items: Array<{ id: number; title: string }> } };
type BitrixAddResponse = { result: { item: { id: number; title: string } } };

function webhookUrl() {
  const value = process.env.BITRIX_WEBHOOK_URL;
  if (!value) throw new Error("BITRIX_WEBHOOK_URL não configurada");
  return value.endsWith("/") ? value : `${value}/`;
}

async function bitrix<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${webhookUrl()}${method}.json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`Bitrix ${method}: ${data.error_description || data.error || `HTTP ${response.status}`}`);
  }
  return data as T;
}

function normalizar(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function enumId(defs: Record<string, BitrixFieldDefinition>, campo: string, desejado: string): string | undefined {
  if (!desejado) return undefined;
  const alvo = normalizar(desejado);
  const item = defs[campo]?.items?.find((i) => normalizar(i.VALUE ?? "") === alvo);
  return item?.ID;
}

function set(fields: Record<string, unknown>, name: string, value: unknown) {
  if (value !== undefined && value !== null && value !== "") fields[name] = value;
}

function montarObservacoes(p: RcObrasPayload): string {
  const enderecoObra = [
    [p.obraLogradouro, p.obraNumero].filter(Boolean).join(", "),
    p.obraComplemento,
    p.obraBairro,
    p.obraCidade && p.obraUf ? `${p.obraCidade}/${p.obraUf}` : "",
    p.obraCep ? `CEP ${p.obraCep}` : "",
  ]
    .filter(Boolean)
    .join(" — ");

  const coberturas = COBERTURAS_RC_OBRAS.filter((c) => p.coberturas[c.chave])
    .map((c) => `  - ${c.label}: R$ ${p.coberturas[c.chave]}`)
    .join("\n");

  return [
    `Nome completo: ${p.nomeCompleto}`,
    `CPF/CNPJ: ${p.cpfCnpj}`,
    `E-mail: ${p.email}`,
    `Telefone: ${p.telefone}`,
    `Endereço da obra: ${enderecoObra}`,
    `Categoria do imóvel: ${p.categoriaImovel}`,
    `Tipo de obra: ${p.tipoObra}${p.tipoObraDetalhado ? ` — ${p.tipoObraDetalhado}` : ""}`,
    `Reforço estrutural: ${p.reforcoEstrutural}`,
    `Início da obra: ${formatarData(p.dataInicio)}`,
    `Fim da obra: ${formatarData(p.dataFim)}`,
    `Evolução da obra: ${p.evolucaoObra}`,
    coberturas ? `Coberturas solicitadas:\n${coberturas}` : "Coberturas solicitadas: nenhuma marcada (apenas cotação geral).",
    "Origem: ficha online /rc-obras",
  ]
    .filter(Boolean)
    .join("\n");
}

// Sem parâmetro de SupabaseClient (diferente de criarCardSeguroCelular) --
// RC Obras não tem anexo, então não precisa baixar nada do Storage.
export async function criarCardRcObras(payload: RcObrasPayload) {
  // Dedup por xmlId ("ID externo") -- mesmo padrão de seguroCelular.ts.
  const duplicata = await bitrix<BitrixListResponse>("crm.item.list", {
    entityTypeId: ENTITY_TYPE_ID,
    filter: { xmlId: payload.responseId },
    select: ["id", "title"],
  });
  if (duplicata.result.items.length) return { created: false, item: duplicata.result.items[0] };

  const definitionResponse = await bitrix<BitrixFieldsResponse>("crm.item.fields", { entityTypeId: ENTITY_TYPE_ID });
  const defs = definitionResponse.result.fields;

  const fields: Record<string, unknown> = {
    title: payload.nomeCompleto || `RC Obras ${payload.responseId}`,
    xmlId: payload.responseId,
    categoryId: CATEGORY_ID,
    stageId: STAGE_ID,
  };

  set(fields, FIELD.tipoProcesso, enumId(defs, FIELD.tipoProcesso, "Novo"));
  set(fields, FIELD.produto, enumId(defs, FIELD.produto, "RC Obras"));
  set(fields, FIELD.origemProducao, enumId(defs, FIELD.origemProducao, "Ficha"));
  set(fields, FIELD.observacoes, montarObservacoes(payload));

  const added = await bitrix<BitrixAddResponse>("crm.item.add", { entityTypeId: ENTITY_TYPE_ID, fields });
  return { created: true, item: added.result.item };
}

export function montarEmailRcObras(
  p: RcObrasPayload,
  resultado?: { created: boolean; item: { id: number } }
): { assunto: string; html: string } {
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
        linhaCampo("Categoria do imóvel", p.categoriaImovel),
        linhaCampo("Tipo de obra", p.tipoObraDetalhado),
        linhaCampo("Reforma ou construção do zero", p.tipoObra),
        linhaCampo("Reforço estrutural", p.reforcoEstrutural),
        linhaCampo("Início da obra", formatarData(p.dataInicio)),
        linhaCampo("Fim da obra", formatarData(p.dataFim)),
        linhaCampo("Evolução da obra", p.evolucaoObra),
      ].join("")
    ),
    blocoSecao("Coberturas solicitadas", linhasCoberturas),
    resultado ? botaoPill(`${BITRIX_BASE_URL}/crm/type/${ENTITY_TYPE_ID}/details/${resultado.item.id}/`, resultado.created ? "Ver card no Bitrix →" : "Ver card existente no Bitrix →") : "",
  ].join("");

  const html = envolverEmailO2({
    badge: "Seguro Obra — RC Obras",
    titulo: "Nova ficha preenchida! 📋",
    introducao:
      resultado && !resultado.created
        ? `${p.nomeCompleto} preencheu a ficha de novo — o protocolo já existia, então o card no Bitrix não foi duplicado.`
        : `${p.nomeCompleto} acabou de preencher a ficha de RC Obras pela Plataforma O2. Confira tudo o que foi informado abaixo:`,
    corpoHtml,
    protocolo: p.responseId,
    origem: "/rc-obras",
  });

  return { assunto: `Nova cotação RC Obras — ${p.nomeCompleto}`, html };
}
