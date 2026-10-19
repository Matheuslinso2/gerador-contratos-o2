// Chamadas REST cruas ao Bitrix24 via webhook de entrada (somente leitura,
// escopo CRM + Usuários básico). Sem SDK — fetch puro, no mesmo espírito de
// src/lib/geocoding.ts pra outras APIs REST externas do projeto.

import { createServiceClient } from "@/lib/supabase/service";

function getWebhookUrl(envVar: "BITRIX_WEBHOOK_URL" | "BITRIX_WEBHOOK_URL_USUARIOS"): string {
  const url = process.env[envVar];
  if (!url) throw new Error(`${envVar} não configurada`);
  return url.endsWith("/") ? url : `${url}/`;
}

export type BitrixParamValue = string | number | Array<string | number>;

export async function chamarBitrix<T>(
  metodo: string,
  params: Record<string, BitrixParamValue> = {},
  envVar: "BITRIX_WEBHOOK_URL" | "BITRIX_WEBHOOK_URL_USUARIOS" = "BITRIX_WEBHOOK_URL"
): Promise<T> {
  const base = getWebhookUrl(envVar);
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (Array.isArray(valor)) {
      for (const item of valor) busca.append(`${chave}[]`, String(item));
    } else {
      busca.append(chave, String(valor));
    }
  }
  const url = `${base}${metodo}${busca.toString() ? `?${busca.toString()}` : ""}`;
  // O Bitrix devolve 503/429 (ou QUERY_LIMIT_EXCEEDED) quando recebe pedidos
  // demais de uma vez -- achado de 19/10/2026: o painel da Fiança ficou
  // com erro "crm.stagehistory.list falhou: HTTP 503" desde 16/10, depois que
  // vários painéis passaram a atualizar a cada 10 min em paralelo. Tenta de
  // novo com espera crescente em vez de desistir na primeira recusa.
  const ESPERAS_MS = [800, 2000, 4500, 9000];
  for (let tentativa = 0; ; tentativa++) {
    let resposta: Response | null = null;
    let erroRede: unknown = null;
    try {
      resposta = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    } catch (e) {
      erroRede = e;
    }
    const sobrecarga = resposta !== null && [429, 502, 503, 504].includes(resposta.status);
    if ((sobrecarga || erroRede) && tentativa < ESPERAS_MS.length) {
      await new Promise((r) => setTimeout(r, ESPERAS_MS[tentativa] + Math.random() * 400));
      continue;
    }
    if (erroRede || !resposta) throw erroRede instanceof Error ? erroRede : new Error(`Bitrix ${metodo} falhou: sem resposta`);
    if (!resposta.ok) throw new Error(`Bitrix ${metodo} falhou: HTTP ${resposta.status}`);
    const dados = await resposta.json();
    if (dados.error === "QUERY_LIMIT_EXCEEDED" && tentativa < ESPERAS_MS.length) {
      await new Promise((r) => setTimeout(r, ESPERAS_MS[tentativa] + Math.random() * 400));
      continue;
    }
    if (dados.error) throw new Error(`Bitrix ${metodo} erro: ${dados.error_description || dados.error}`);
    return dados as T;
  }
}

// Card bruto da SPA — campos padrão tipados, campos ufCrm10_* (dinâmicos,
// dependem da configuração da SPA) ficam soltos via index signature.
export type BitrixItemRaw = {
  id: number;
  title: string;
  categoryId: number;
  stageId: string;
  createdTime: string;
  updatedTime: string;
  movedTime: string;
  assignedById: number;
  createdBy: number;
  movedBy: number;
  companyId: number;
  [campo: string]: unknown;
};

export type BitrixStageHistoryEvent = {
  ID: number;
  TYPE_ID: number;
  OWNER_ID: number;
  CREATED_TIME: string;
  CATEGORY_ID: number;
  STAGE_SEMANTIC_ID: "P" | "S" | "F" | null;
  STAGE_ID: string;
};

const TAMANHO_PAGINA_BITRIX = 50;
// Nº de páginas buscadas ao mesmo tempo depois da primeira -- rápido o
// bastante pra não somar o tempo de cada página sequencialmente (era isso
// que estourava os 60s do Vercel com listas grandes, ex: 1.340 eventos de
// histórico em 27 páginas), mas sem disparar tudo de uma vez e arriscar
// limite de taxa do Bitrix.
const CONCORRENCIA_PAGINACAO = 6;

async function comConcorrenciaLimitada<X, Y>(itens: X[], limite: number, tarefa: (item: X) => Promise<Y>): Promise<Y[]> {
  const resultados: Y[] = new Array(itens.length);
  let proximo = 0;
  async function trabalhador() {
    for (;;) {
      const indice = proximo++;
      if (indice >= itens.length) return;
      resultados[indice] = await tarefa(itens[indice]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return resultados;
}

// Busca a 1ª página pra saber o total, depois busca o resto em paralelo (com
// limite de concorrência) em vez de uma página esperando a outra terminar.
export async function buscarTodasPaginas<X>(
  metodo: string,
  paramsBase: Record<string, BitrixParamValue>,
  concorrencia: number = CONCORRENCIA_PAGINACAO
): Promise<X[]> {
  const primeira = await chamarBitrix<{ result: { items: X[] }; next?: number; total?: number }>(metodo, {
    ...paramsBase,
    start: 0,
  });
  const itens = [...primeira.result.items];
  const total = primeira.total ?? itens.length;
  if (primeira.next === undefined || total <= itens.length) return itens;

  const starts: number[] = [];
  for (let start = TAMANHO_PAGINA_BITRIX; start < total; start += TAMANHO_PAGINA_BITRIX) starts.push(start);

  const paginas = await comConcorrenciaLimitada(starts, concorrencia, (start) =>
    chamarBitrix<{ result: { items: X[] } }>(metodo, { ...paramsBase, start })
  );
  for (const pagina of paginas) itens.push(...pagina.result.items);
  return itens;
}

// Paginação pro formato "flat array" que crm.deal.list, crm.activity.list e
// crm.lead.list usam (`{result: [...], next, total}`) -- diferente do
// formato `{result:{items:[...]}}` que buscarTodasPaginas espera (usado por
// crm.item.list/crm.stagehistory.list). Extraída de comercial.ts (2026-09-16)
// pro bloco de CRM Leads também poder usar, sem duplicar de novo.
export async function buscarTodasPaginasFlat<X>(metodo: string, paramsBase: Record<string, BitrixParamValue>): Promise<X[]> {
  const primeira = await chamarBitrix<{ result: X[]; next?: number; total?: number }>(metodo, {
    ...paramsBase,
    start: 0,
  });
  const itens = [...primeira.result];
  const total = primeira.total ?? itens.length;
  if (primeira.next === undefined || total <= itens.length) return itens;

  const starts: number[] = [];
  for (let start = TAMANHO_PAGINA_BITRIX; start < total; start += TAMANHO_PAGINA_BITRIX) starts.push(start);

  const paginas = await comConcorrenciaLimitada(starts, CONCORRENCIA_PAGINACAO, (start) =>
    chamarBitrix<{ result: X[] }>(metodo, { ...paramsBase, start })
  );
  for (const pagina of paginas) itens.push(...pagina.result);
  return itens;
}

export async function listarItensSpa(entityTypeId: number): Promise<BitrixItemRaw[]> {
  return buscarTodasPaginas<BitrixItemRaw>("crm.item.list", { entityTypeId, select: ["*", "UF_*"] });
}

// Só os cards de um funil (categoria) da SPA -- usado por painéis que
// cobrem um único funil (ex: Renovação do Seguro Fiança), pra não baixar
// a SPA inteira à toa.
export async function listarItensSpaCategoria(entityTypeId: number, categoryId: number): Promise<BitrixItemRaw[]> {
  return buscarTodasPaginas<BitrixItemRaw>("crm.item.list", {
    entityTypeId,
    select: ["*", "UF_*"],
    "filter[categoryId]": categoryId,
  });
}

// crm.item.get é universal (Lead/Deal/qualquer SPA, mesmo entityTypeId
// numérico já usado em todo o "E-mail no card") -- usado aqui pra montar o
// bloco de contexto ("sobre este card") dentro do e-mail, sem precisar de
// um fetcher dedicado por entidade como listarItensSpa/comercial.ts fazem
// pros painéis (aqui só precisamos de 3 campos universais, não da ficha
// completa).
export async function buscarItem(entityTypeId: number, id: number): Promise<BitrixItemRaw> {
  const resposta = await chamarBitrix<{ result: { item: BitrixItemRaw } }>("crm.item.get", { entityTypeId, id });
  return resposta.result.item;
}

// Histórico de etapas (crm.stagehistory.list). Só cresce, nunca é alterado --
// então fica guardado em bitrix_stagehistory_cache e cada leitura busca no
// Bitrix apenas os eventos com ID maior que o último guardado. Antes baixava
// tudo a cada vez (7.384 eventos = 148 páginas em 19/10/2026) e o Bitrix
// passou a recusar com 503, derrubando o painel da Fiança. Se o cache falhar,
// cai pra busca completa. (No Bitrix, ordenação e filtro de ID só funcionam
// com a chave em MAIÚSCULAS: order[ID], filter[>ID].)
const TAMANHO_LOTE_CACHE = 500;

type LinhaCacheHistorico = {
  entity_type_id: number;
  id: number;
  owner_id: number;
  type_id: number | null;
  category_id: number | null;
  stage_semantic_id: string | null;
  stage_id: string | null;
  created_time: string;
};

async function lerCacheHistorico(entityTypeId: number): Promise<BitrixStageHistoryEvent[]> {
  const supabase = createServiceClient();
  const eventos: BitrixStageHistoryEvent[] = [];
  for (let inicio = 0; ; inicio += 1000) {
    const { data, error } = await supabase
      .from("bitrix_stagehistory_cache")
      .select("id, owner_id, type_id, category_id, stage_semantic_id, stage_id, created_time")
      .eq("entity_type_id", entityTypeId)
      .order("id", { ascending: true })
      .range(inicio, inicio + 999);
    if (error) throw new Error(`cache do histórico: ${error.message}`);
    for (const l of data ?? []) {
      eventos.push({
        ID: Number(l.id),
        TYPE_ID: Number(l.type_id),
        OWNER_ID: Number(l.owner_id),
        CREATED_TIME: l.created_time as string,
        CATEGORY_ID: Number(l.category_id),
        STAGE_SEMANTIC_ID: (l.stage_semantic_id as BitrixStageHistoryEvent["STAGE_SEMANTIC_ID"]) ?? null,
        STAGE_ID: (l.stage_id as string) ?? "",
      });
    }
    if (!data || data.length < 1000) break;
  }
  return eventos;
}

async function guardarNoCacheHistorico(entityTypeId: number, novos: BitrixStageHistoryEvent[]): Promise<void> {
  const supabase = createServiceClient();
  for (let i = 0; i < novos.length; i += TAMANHO_LOTE_CACHE) {
    const linhas: LinhaCacheHistorico[] = novos.slice(i, i + TAMANHO_LOTE_CACHE).map((e) => ({
      entity_type_id: entityTypeId,
      id: Number(e.ID),
      owner_id: Number(e.OWNER_ID),
      type_id: e.TYPE_ID ?? null,
      category_id: e.CATEGORY_ID ?? null,
      stage_semantic_id: e.STAGE_SEMANTIC_ID ?? null,
      stage_id: e.STAGE_ID ?? null,
      created_time: e.CREATED_TIME,
    }));
    const { error } = await supabase.from("bitrix_stagehistory_cache").upsert(linhas, { onConflict: "entity_type_id,id" });
    if (error) throw new Error(`gravar cache do histórico: ${error.message}`);
  }
}

export async function listarHistoricoEtapas(entityTypeId: number): Promise<BitrixStageHistoryEvent[]> {
  let guardados: BitrixStageHistoryEvent[] = [];
  try {
    guardados = await lerCacheHistorico(entityTypeId);
  } catch (e) {
    console.error("Cache do histórico indisponível, buscando tudo no Bitrix:", e);
    return buscarTodasPaginas<BitrixStageHistoryEvent>("crm.stagehistory.list", { entityTypeId, "order[ID]": "asc" }, 3);
  }
  const ultimoId = guardados.reduce((m, e) => Math.max(m, Number(e.ID)), 0);
  const novos = await buscarTodasPaginas<BitrixStageHistoryEvent>(
    "crm.stagehistory.list",
    { entityTypeId, "order[ID]": "asc", "filter[>ID]": ultimoId },
    3
  );
  if (novos.length) {
    try {
      await guardarNoCacheHistorico(entityTypeId, novos);
    } catch (e) {
      console.error("Não consegui atualizar o cache do histórico:", e);
    }
  }
  return [...guardados, ...novos];
}

export async function listarHistoricoEtapasCategoria(
  entityTypeId: number,
  categoryId: number
): Promise<BitrixStageHistoryEvent[]> {
  return buscarTodasPaginas<BitrixStageHistoryEvent>("crm.stagehistory.list", {
    entityTypeId,
    "order[id]": "asc",
    "filter[CATEGORY_ID]": categoryId,
  });
}

export async function buscarEmpresas(ids: number[]): Promise<Record<number, string>> {
  const nomeporId: Record<number, string> = {};
  const idsUnicos = [...new Set(ids)].filter((id) => id > 0);
  if (!idsUnicos.length) return nomeporId;

  // O crm.company.list devolve no máximo 50 registros por página. Enviar todos
  // os IDs de uma vez e ler apenas o primeiro resultado fazia as empresas que
  // ficavam nas páginas seguintes aparecerem no painel como "ID 12345".
  const tamanhoLote = 50;
  for (let indice = 0; indice < idsUnicos.length; indice += tamanhoLote) {
    const lote = idsUnicos.slice(indice, indice + tamanhoLote);
    let start = 0;

    for (;;) {
      const resposta = await chamarBitrix<{
        result: { ID: string; TITLE: string }[];
        next?: number;
      }>("crm.company.list", {
        select: ["ID", "TITLE"],
        "filter[ID]": lote,
        start,
      });

      for (const empresa of resposta.result) nomeporId[Number(empresa.ID)] = empresa.TITLE;
      if (resposta.next === undefined) break;
      start = resposta.next;
    }
  }

  return nomeporId;
}

export type BitrixCampoEnum = { ID: string; VALUE: string };
export type BitrixDefinicaoCampo = { items?: BitrixCampoEnum[] };

// Definição dos campos da SPA (inclui as opções de cada campo de lista —
// "Recusado", "Pré-Aprovado" etc. — com o ID numérico que o Bitrix guarda
// no card). Buscado ao vivo em vez de fixado no código: os IDs de opção de
// cada seguradora são internos do Bitrix e arriscado demais pra copiar à
// mão sem garantia de que a lista está completa.
export async function buscarDefinicaoCampos(entityTypeId: number): Promise<Record<string, BitrixDefinicaoCampo>> {
  const resposta = await chamarBitrix<{ result: { fields: Record<string, BitrixDefinicaoCampo> } }>(
    "crm.item.fields",
    { entityTypeId }
  );
  return resposta.result.fields;
}

export async function buscarUsuarios(ids: number[]): Promise<Record<number, string>> {
  const nomePorId: Record<number, string> = {};
  const idsUnicos = [...new Set(ids)].filter((id) => id > 0);
  if (!idsUnicos.length) return nomePorId;
  const resposta = await chamarBitrix<{ result: { ID: string; NAME: string; LAST_NAME: string; EMAIL: string }[] }>(
    "user.get",
    { "FILTER[ID]": idsUnicos },
    "BITRIX_WEBHOOK_URL_USUARIOS"
  );
  for (const usuario of resposta.result) {
    const nome = [usuario.NAME, usuario.LAST_NAME].filter(Boolean).join(" ").trim();
    nomePorId[Number(usuario.ID)] = nome || usuario.EMAIL || `ID ${usuario.ID}`;
  }
  return nomePorId;
}
