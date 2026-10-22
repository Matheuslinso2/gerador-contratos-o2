// Cria o card de intake na mesma SPA "Produção Incêndio" (entityTypeId
// 1046, categoria 22 "Contratações e Renovações", etapa inicial
// DT1046_22:NEW) usada pelo Seguro Incêndio -- decisão do Matheus em
// 14/09/2026 de reaproveitar esse pipeline pros produtos novos em vez de
// manter só por e-mail. Opções "Seguro Celular"/"RCP"/"Condomínio"
// adicionadas ao campo Produto nesse mesmo dia (confirmadas via
// crm.item.fields). Mesmo espírito de seguroIncendio.ts: sem SDK, fetch
// puro contra o BITRIX_WEBHOOK_URL.
//
// Essa SPA não tem campo de observações estruturado pros dados brutos do
// segurado (CPF, endereço, aparelho...) -- só campos de produção
// (seguradora, prêmio, comissão, preenchidos depois pela equipe). Por
// isso os dados brutos vão formatados em texto dentro de "Observações
// operacionais" (ufCrm12Observacoes), igual seguroIncendio.ts.
//
// O campo "Planilha de itens" (ufCrm12PlanilhaItens) é o único campo de
// arquivo dessa SPA -- reaproveitado aqui pra nota fiscal do aparelho,
// mesmo sendo pensado originalmente pra planilha do Incêndio Imobiliário.
import type { SupabaseClient } from "@supabase/supabase-js";
import { envolverEmailO2, linhaCampo, blocoSecao, botaoPill } from "./emailO2";
import { baixarAnexoFormulario, separarResultados, type AnexoBaixado, type AnexoFalha } from "./anexosFormulario";

const ENTITY_TYPE_ID = 1046;
const CATEGORY_ID = 22;
const STAGE_ID = "DT1046_22:NEW";

const FIELD = {
  tipoProcesso: "ufCrm12TipoProcesso",
  produto: "ufCrm12Produto",
  origemProducao: "ufCrm12OrigemProducao",
  observacoes: "ufCrm12Observacoes",
  planilhaItens: "ufCrm12PlanilhaItens",
} as const;

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

const BUCKET_ANEXOS = "seguro-celular-anexos";

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

export type ResultadoCardCelular = { created: boolean; item: { id: number; title?: string }; anexos?: AnexoBaixado[]; falhas?: AnexoFalha[] };

function montarObservacoes(p: SeguroCelularPayload): string {
  return [
    `Nome completo: ${p.nomeCompleto}`,
    `CPF: ${p.cpf}`,
    `E-mail: ${p.email}`,
    `Telefone: ${p.telefone}`,
    `Endereço: ${p.endereco}`,
    `Número de telefone utilizado no aparelho: ${p.numeroLinha}`,
    `Idade do aparelho: ${p.idadeAparelho}`,
    "Origem: ficha online /seguro-celular",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function criarCardSeguroCelular(payload: SeguroCelularPayload, supabase: SupabaseClient): Promise<ResultadoCardCelular> {
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
    title: payload.nomeCompleto || `Seguro Celular ${payload.responseId}`,
    xmlId: payload.responseId,
    categoryId: CATEGORY_ID,
    stageId: STAGE_ID,
  };

  set(fields, FIELD.tipoProcesso, enumId(defs, FIELD.tipoProcesso, "Novo"));
  set(fields, FIELD.produto, enumId(defs, FIELD.produto, "Seguro Celular"));
  set(fields, FIELD.origemProducao, enumId(defs, FIELD.origemProducao, "Ficha"));
  set(fields, FIELD.observacoes, montarObservacoes(payload));

  const notaFiscal = await baixarAnexoFormulario(supabase, BUCKET_ANEXOS, payload.anexoNotaFiscal, "Nota fiscal", "nota-fiscal");
  const { anexos, falhas } = separarResultados([notaFiscal]);
  if (notaFiscal && "anexo" in notaFiscal) fields[FIELD.planilhaItens] = [notaFiscal.anexo.paraBitrix];
  if (falhas.length) console.error("Seguro Celular: anexo(s) NÃO baixado(s) do Storage:", falhas);

  const added = await bitrix<BitrixAddResponse>("crm.item.add", { entityTypeId: ENTITY_TYPE_ID, fields });
  return { created: true, item: added.result.item, anexos, falhas };
}

const BITRIX_BASE_URL = "https://o2seguros.bitrix24.com.br";

export function montarEmailSeguroCelular(p: SeguroCelularPayload, resultado: ResultadoCardCelular): { assunto: string; html: string } {
  const linkCard = `${BITRIX_BASE_URL}/crm/type/${ENTITY_TYPE_ID}/details/${resultado.item.id}/`;

  const corpoHtml = [
    blocoSecao("Contato", [linhaCampo("E-mail", p.email), linhaCampo("Telefone", p.telefone)].join("")),
    blocoSecao("Segurado", [linhaCampo("Nome completo", p.nomeCompleto), linhaCampo("CPF", p.cpf), linhaCampo("Endereço", p.endereco)].join("")),
    blocoSecao(
      "Aparelho",
      [
        linhaCampo("Número de telefone utilizado no aparelho", p.numeroLinha),
        linhaCampo("Idade do aparelho", p.idadeAparelho),
        linhaCampo("Nota fiscal", p.anexoNotaFiscal ? "✅ Enviada" : "— Não enviada"),
        ...(resultado.falhas ?? []).map((f) => linhaCampo(`⚠️ ${f.rotulo}`, "NÃO foi anexada ao card nem a este e-mail (falha ao baixar o arquivo) — peça de novo ao cliente")),
      ].join("")
    ),
    botaoPill(linkCard, resultado.created ? "Ver card no Bitrix →" : "Ver card existente no Bitrix →"),
  ].join("");

  const html = envolverEmailO2({
    badge: "Seguro Celular",
    titulo: "Nova ficha preenchida! 📱",
    introducao: resultado.created
      ? `${p.nomeCompleto} acabou de preencher a ficha de Seguro Celular pela Plataforma O2. Confira tudo o que foi informado abaixo:`
      : `${p.nomeCompleto} preencheu a ficha de novo — o protocolo já existia, então o card no Bitrix não foi duplicado.`,
    corpoHtml,
    protocolo: p.responseId,
    origem: "/seguro-celular",
  });

  return { assunto: `Nova cotação Seguro Celular — ${p.nomeCompleto}`, html };
}
