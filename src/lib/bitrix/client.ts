// Chamadas REST cruas ao Bitrix24 via webhook de entrada (somente leitura,
// escopo CRM + Usuários básico). Sem SDK — fetch puro, no mesmo espírito de
// src/lib/geocoding.ts pra outras APIs REST externas do projeto.

function getWebhookUrl(envVar: "BITRIX_WEBHOOK_URL" | "BITRIX_WEBHOOK_URL_USUARIOS"): string {
  const url = process.env[envVar];
  if (!url) throw new Error(`${envVar} não configurada`);
  return url.endsWith("/") ? url : `${url}/`;
}

type BitrixParamValue = string | number | Array<string | number>;

async function chamarBitrix<T>(
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
  const resposta = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!resposta.ok) throw new Error(`Bitrix ${metodo} falhou: HTTP ${resposta.status}`);
  const dados = await resposta.json();
  if (dados.error) throw new Error(`Bitrix ${metodo} erro: ${dados.error_description || dados.error}`);
  return dados as T;
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

// crm.item.list pagina de 50 em 50 — busca todas as páginas até acabar.
export async function listarItensSpa(entityTypeId: number): Promise<BitrixItemRaw[]> {
  const itens: BitrixItemRaw[] = [];
  let start = 0;
  for (;;) {
    const pagina = await chamarBitrix<{ result: { items: BitrixItemRaw[] }; next?: number }>("crm.item.list", {
      entityTypeId,
      select: ["*", "UF_*"],
      start,
    });
    itens.push(...pagina.result.items);
    if (pagina.next === undefined) break;
    start = pagina.next;
  }
  return itens;
}

export async function listarHistoricoEtapas(entityTypeId: number): Promise<BitrixStageHistoryEvent[]> {
  const eventos: BitrixStageHistoryEvent[] = [];
  let start = 0;
  for (;;) {
    const pagina = await chamarBitrix<{ result: { items: BitrixStageHistoryEvent[] }; next?: number }>(
      "crm.stagehistory.list",
      { entityTypeId, "order[id]": "asc", start }
    );
    eventos.push(...pagina.result.items);
    if (pagina.next === undefined) break;
    start = pagina.next;
  }
  return eventos;
}

export async function buscarEmpresas(ids: number[]): Promise<Record<number, string>> {
  const nomeporId: Record<number, string> = {};
  const idsUnicos = [...new Set(ids)].filter((id) => id > 0);
  if (!idsUnicos.length) return nomeporId;
  const resposta = await chamarBitrix<{ result: { ID: string; TITLE: string }[] }>("crm.company.list", {
    select: ["ID", "TITLE"],
    "filter[ID]": idsUnicos,
  });
  for (const empresa of resposta.result) nomeporId[Number(empresa.ID)] = empresa.TITLE;
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
