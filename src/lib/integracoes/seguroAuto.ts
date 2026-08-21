// Cria o card de intake na SPA "Seguro Automóvel" (entityTypeId 1050,
// pipeline único "Pipeline padrão") a partir da ficha preenchida na landing
// page /seguro-auto. Mesmo espírito de seguroFianca.ts/capitalizacao.ts:
// sem SDK, fetch puro contra o BITRIX_WEBHOOK_URL.
//
// Diferente dos outros dois: essa SPA nasceu SEM campo de observações pra
// carimbar o dedup -- usa o campo padrão xmlId ("ID externo") pra isso, que
// é exatamente pra esse tipo de uso (referência de sistema externo).
//
// Campos confirmados via crm.item.fields em 18/08/2026 (SPA criada pelo
// Matheus na mesma data). Os 3 campos de arquivo (CNH/CRLV/Apólice) são de
// arquivo ÚNICO (isMultiple: false) -- por isso a landing page também só
// aceita 1 arquivo por campo agora.
import type { SupabaseClient } from "@supabase/supabase-js";
import { envolverEmailO2, linhaCampo, blocoSecao, botaoPill } from "./emailO2";

const ENTITY_TYPE_ID = 1050;
const CATEGORY_ID = 30;

const FIELD = {
  nome: "ufCrm16_1787056933080",
  email: "ufCrm16_1787056957386",
  telefone: "ufCrm16_1787056962877",
  garagem: "ufCrm16_1787056986772",
  portao: "ufCrm16_1787057051225",
  utilizacao: "ufCrm16_1787057098438",
  usoDiario: "ufCrm16_1787057118482",
  crlv: "ufCrm16_1787057133486",
  estadoCivil: "ufCrm16_1787057276856",
  endereco: "ufCrm16_1787057323033",
  cnh: "ufCrm16_1787057362552",
  apolice: "ufCrm16_1787058926395",
} as const;

export type SeguroAutoPayload = {
  responseId: string;
  nomeCompleto: string;
  email: string;
  telefone: string;
  estadoCivil: string;
  enderecoResidencial: string;
  possuiGaragem: string; // "Sim" | "Não"
  portao: string;
  utilizacaoVeiculo: string;
  usoCarroDetalhado: string;
  anexoCnh: string; // caminho no bucket seguro-auto-anexos, "" se não enviado
  anexoCrlv: string;
  anexoApolice: string;
};

const BUCKET_ANEXOS = "seguro-auto-anexos";

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

// Baixa o arquivo do Storage (service role, já que o bucket não libera
// SELECT pro anon) e converte pro formato que a API do Bitrix espera num
// campo de arquivo: [nomeDoArquivo, conteúdoBase64].
async function arquivoParaCampoBitrix(supabase: SupabaseClient, path: string, nomeExibicao: string): Promise<[string, string] | undefined> {
  if (!path) return undefined;
  const { data, error } = await supabase.storage.from(BUCKET_ANEXOS).download(path);
  if (error || !data) {
    console.error(`Falha ao baixar anexo do Storage (${path}) pra enviar ao Bitrix:`, error);
    return undefined;
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  const extensao = path.split(".").pop() || "bin";
  return [`${nomeExibicao}.${extensao}`, buffer.toString("base64")];
}

export async function criarCardSeguroAuto(payload: SeguroAutoPayload, supabase: SupabaseClient) {
  // Dedup por xmlId ("ID externo") -- essa SPA não tem campo de observações
  // livre como Fiança/Capitalização, então usa o campo padrão do Bitrix
  // feito exatamente pra referenciar um ID de sistema externo.
  const duplicata = await bitrix<BitrixListResponse>("crm.item.list", {
    entityTypeId: ENTITY_TYPE_ID,
    filter: { xmlId: payload.responseId },
    select: ["id", "title"],
  });
  if (duplicata.result.items.length) return { created: false, item: duplicata.result.items[0] };

  const definitionResponse = await bitrix<BitrixFieldsResponse>("crm.item.fields", { entityTypeId: ENTITY_TYPE_ID });
  const defs = definitionResponse.result.fields;

  const fields: Record<string, unknown> = {
    title: payload.nomeCompleto || `Seguro Auto ${payload.responseId}`,
    xmlId: payload.responseId,
    categoryId: CATEGORY_ID,
  };

  set(fields, FIELD.nome, payload.nomeCompleto);
  set(fields, FIELD.email, payload.email);
  set(fields, FIELD.telefone, payload.telefone);
  set(fields, FIELD.estadoCivil, payload.estadoCivil);
  set(fields, FIELD.endereco, payload.enderecoResidencial);
  // Campo boolean da SPA espera JS boolean de verdade -- "1"/"0" (testado e
  // descartado) grava sempre como "N", independente do valor enviado.
  if (payload.possuiGaragem) fields[FIELD.garagem] = payload.possuiGaragem === "Sim";
  set(fields, FIELD.portao, enumId(defs, FIELD.portao, payload.portao));
  set(fields, FIELD.utilizacao, enumId(defs, FIELD.utilizacao, payload.utilizacaoVeiculo));
  set(fields, FIELD.usoDiario, enumId(defs, FIELD.usoDiario, payload.usoCarroDetalhado));

  const [cnh, crlv, apolice] = await Promise.all([
    arquivoParaCampoBitrix(supabase, payload.anexoCnh, "cnh"),
    arquivoParaCampoBitrix(supabase, payload.anexoCrlv, "crlv"),
    arquivoParaCampoBitrix(supabase, payload.anexoApolice, "apolice-anterior"),
  ]);
  set(fields, FIELD.cnh, cnh);
  set(fields, FIELD.crlv, crlv);
  set(fields, FIELD.apolice, apolice);

  const added = await bitrix<BitrixAddResponse>("crm.item.add", { entityTypeId: ENTITY_TYPE_ID, fields });
  return { created: true, item: added.result.item };
}

const BITRIX_BASE_URL = "https://o2seguros.bitrix24.com.br";

// Notifica auto@o2seguros.com.br a cada envio de /seguro-auto -- o card já
// é criado na SPA (acima), mas a caixa de e-mail é o jeito de alguém saber
// na hora que chegou uma ficha nova, sem precisar ficar checando o Bitrix.
export function montarEmailSeguroAuto(payload: SeguroAutoPayload, resultado: { created: boolean; item: { id: number } }): { assunto: string; html: string } {
  const linkCard = `${BITRIX_BASE_URL}/crm/type/${ENTITY_TYPE_ID}/details/${resultado.item.id}/`;

  const corpoHtml = [
    blocoSecao(
      "Contato",
      [linhaCampo("Nome completo", payload.nomeCompleto), linhaCampo("E-mail", payload.email), linhaCampo("Telefone", payload.telefone), linhaCampo("Estado civil", payload.estadoCivil)].join("")
    ),
    blocoSecao(
      "Veículo e uso",
      [
        linhaCampo("Endereço residencial", payload.enderecoResidencial),
        linhaCampo("Possui garagem", payload.possuiGaragem),
        linhaCampo("Portão", payload.portao),
        linhaCampo("Utilização do veículo", payload.utilizacaoVeiculo),
        linhaCampo("Uso detalhado do carro", payload.usoCarroDetalhado),
      ].join("")
    ),
    blocoSecao(
      "Anexos enviados",
      [
        linhaCampo("CNH", payload.anexoCnh ? "✅ Enviada" : "— Não enviada"),
        linhaCampo("CRLV", payload.anexoCrlv ? "✅ Enviado" : "— Não enviado"),
        linhaCampo("Apólice anterior", payload.anexoApolice ? "✅ Enviada" : "— Não enviada"),
      ].join("")
    ),
    botaoPill(linkCard, resultado.created ? "Ver card no Bitrix →" : "Ver card existente no Bitrix →"),
  ].join("");

  const html = envolverEmailO2({
    badge: "Seguro Auto",
    titulo: "Nova ficha preenchida! 🚗",
    introducao: resultado.created
      ? `${payload.nomeCompleto} acabou de preencher a ficha de Seguro Auto pela Plataforma O2. Confira tudo o que foi informado abaixo:`
      : `${payload.nomeCompleto} preencheu a ficha de novo — o protocolo já existia, então o card no Bitrix não foi duplicado.`,
    corpoHtml,
    protocolo: payload.responseId,
    origem: "/seguro-auto",
  });

  return { assunto: `Nova cotação Seguro Auto — ${payload.nomeCompleto}`, html };
}
