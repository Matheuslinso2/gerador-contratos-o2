// Cria o card de intake na mesma SPA "Produção Incêndio" (entityTypeId
// 1046, categoria 22 "Contratações e Renovações", etapa inicial
// DT1046_22:NEW) usada pelo Seguro Incêndio -- decisão do Matheus em
// 14/09/2026 de reaproveitar esse pipeline pros produtos novos em vez de
// manter só por e-mail. Opção "RCP" adicionada ao campo Produto nesse
// mesmo dia (confirmada via crm.item.fields). Mesmo espírito de
// seguroIncendio.ts: sem SDK, fetch puro contra o BITRIX_WEBHOOK_URL.
//
// Essa SPA não tem campo de observações estruturado pros dados brutos da
// empresa (CNPJ, atividade, cobertura...) -- só campos de produção
// (seguradora, prêmio, comissão, preenchidos depois pela equipe). Por
// isso os dados brutos vão formatados em texto dentro de "Observações
// operacionais" (ufCrm12Observacoes), igual seguroIncendio.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { envolverEmailO2, linhaCampo, blocoSecao, botaoPill } from "./emailO2";

const ENTITY_TYPE_ID = 1046;
const CATEGORY_ID = 22;
const STAGE_ID = "DT1046_22:NEW";

const FIELD = {
  tipoProcesso: "ufCrm12TipoProcesso",
  produto: "ufCrm12Produto",
  origemProducao: "ufCrm12OrigemProducao",
  observacoes: "ufCrm12Observacoes",
} as const;

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

function montarObservacoes(p: RcpPayload): string {
  return [
    `Nome da empresa: ${p.nomeEmpresa}`,
    `CNPJ: ${p.cnpj}`,
    `Atividade da empresa: ${p.atividadeEmpresa}`,
    `E-mail: ${p.email}`,
    `Telefone: ${p.telefone}`,
    `Endereço: ${p.endereco}`,
    p.valorCobertura ? `Valor de cobertura desejado: R$ ${p.valorCobertura}` : "",
    "Origem: ficha online /rcp",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function criarCardRcp(payload: RcpPayload, supabase: SupabaseClient) {
  // supabase não é usado aqui (RCP não tem anexo), mas mantido no
  // parâmetro pra manter a mesma assinatura de criarCard* dos outros
  // produtos dessa SPA (seguroIncendio.ts, seguroCelular.ts, condominio.ts).
  void supabase;

  // Dedup por xmlId ("ID externo") -- mesmo padrão de seguroIncendio.ts.
  const duplicata = await bitrix<BitrixListResponse>("crm.item.list", {
    entityTypeId: ENTITY_TYPE_ID,
    filter: { xmlId: payload.responseId },
    select: ["id", "title"],
  });
  if (duplicata.result.items.length) return { created: false, item: duplicata.result.items[0] };

  const definitionResponse = await bitrix<BitrixFieldsResponse>("crm.item.fields", { entityTypeId: ENTITY_TYPE_ID });
  const defs = definitionResponse.result.fields;

  const fields: Record<string, unknown> = {
    title: payload.nomeEmpresa || `RCP ${payload.responseId}`,
    xmlId: payload.responseId,
    categoryId: CATEGORY_ID,
    stageId: STAGE_ID,
  };

  set(fields, FIELD.tipoProcesso, enumId(defs, FIELD.tipoProcesso, "Novo"));
  set(fields, FIELD.produto, enumId(defs, FIELD.produto, "RCP"));
  set(fields, FIELD.origemProducao, enumId(defs, FIELD.origemProducao, "Ficha"));
  set(fields, FIELD.observacoes, montarObservacoes(payload));

  const added = await bitrix<BitrixAddResponse>("crm.item.add", { entityTypeId: ENTITY_TYPE_ID, fields });
  return { created: true, item: added.result.item };
}

const BITRIX_BASE_URL = "https://o2seguros.bitrix24.com.br";

export function montarEmailRcp(p: RcpPayload, resultado: { created: boolean; item: { id: number } }): { assunto: string; html: string } {
  const linkCard = `${BITRIX_BASE_URL}/crm/type/${ENTITY_TYPE_ID}/details/${resultado.item.id}/`;

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
    botaoPill(linkCard, resultado.created ? "Ver card no Bitrix →" : "Ver card existente no Bitrix →"),
  ].join("");

  const html = envolverEmailO2({
    badge: "Responsabilidade Civil Profissional",
    titulo: "Nova ficha preenchida! 💼",
    introducao: resultado.created
      ? `${p.nomeEmpresa} acabou de preencher a ficha de RCP pela Plataforma O2. Confira tudo o que foi informado abaixo:`
      : `${p.nomeEmpresa} preencheu a ficha de novo — o protocolo já existia, então o card no Bitrix não foi duplicado.`,
    corpoHtml,
    protocolo: p.responseId,
    origem: "/rcp",
  });

  return { assunto: `Nova cotação RCP — ${p.nomeEmpresa}`, html };
}
