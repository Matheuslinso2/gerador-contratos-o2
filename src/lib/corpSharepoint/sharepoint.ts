import "server-only";
import type { TipoArquivo } from "./gravar";
import { LISTAS_SHAREPOINT, type ListaBruta } from "./listas";

// Acesso de leitura ao SharePoint "O2 Data Analytics" pelo Microsoft Graph,
// com o aplicativo "Workspace O2 - leitura SharePoint" (permissão
// Sites.Selected, liberado só para este site, só leitura). Variáveis na Vercel:
//   SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET

const HOST = "o2seguroscombr.sharepoint.com";
const SITE = "/sites/analyticspwb";
const RAIZ = "01. BASES DE DADOS";
const PASTAS: { tipo: TipoArquivo; caminho: string; filtro: (nome: string) => boolean }[] = [
  { tipo: "cidades", caminho: `${RAIZ}/00. BASES AUXILIARES`, filtro: (n) => /^cidades_padronizadas\.xlsx$/i.test(n) },
  { tipo: "clientes", caminho: `${RAIZ}/01. EXTRAÇÕES CORP/CORP_02.05 - Clientes com Documentos`, filtro: (n) => /\.xlsx$/i.test(n) },
  { tipo: "grade", caminho: `${RAIZ}/01. EXTRAÇÕES CORP/CORP_01.02 - Propostas Grade por Produtor`, filtro: (n) => /\.xlsx$/i.test(n) },
  { tipo: "sinistros", caminho: `${RAIZ}/01. EXTRAÇÕES CORP/CORP_05.02 - Sinistros Geral Grade`, filtro: (n) => /\.xlsx$/i.test(n) },
];

export function sharepointConfigurado() {
  return !!(process.env.SHAREPOINT_TENANT_ID && process.env.SHAREPOINT_CLIENT_ID && process.env.SHAREPOINT_CLIENT_SECRET);
}

async function token(): Promise<string> {
  const tenant = process.env.SHAREPOINT_TENANT_ID;
  const corpo = new URLSearchParams({
    client_id: process.env.SHAREPOINT_CLIENT_ID ?? "",
    client_secret: process.env.SHAREPOINT_CLIENT_SECRET ?? "",
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, { method: "POST", body: corpo });
  const j = await r.json();
  if (!r.ok) throw new Error(`Microsoft recusou o acesso: ${j.error_description ?? j.error ?? r.status}`);
  return j.access_token as string;
}

type Graph = <T = Record<string, unknown>>(caminho: string) => Promise<T>;

async function conectar(): Promise<{ graph: Graph; siteId: string; tk: string }> {
  const tk = await token();
  const graph: Graph = async (caminho) => {
    const r = await fetch(caminho.startsWith("https://") ? caminho : `https://graph.microsoft.com/v1.0${caminho}`, {
      headers: { Authorization: `Bearer ${tk}` },
    });
    if (!r.ok) throw new Error(`SharePoint ${r.status} em ${caminho}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
  };
  const site = await graph<{ id: string }>(`/sites/${HOST}:${SITE}`);
  return { graph, siteId: site.id, tk };
}

export type ArquivoSharepoint = {
  tipo: TipoArquivo;
  nome: string;
  pasta: string;
  modificadoEm: string;
  etag: string;
  baixar: () => Promise<Uint8Array>;
};

// Lista os arquivos das pastas do Corp (sem baixar).
export async function listarArquivos(): Promise<ArquivoSharepoint[]> {
  const { graph, siteId, tk } = await conectar();
  const out: ArquivoSharepoint[] = [];
  for (const p of PASTAS) {
    const caminho = encodeURI(p.caminho);
    const r = await graph<{ value: { name: string; lastModifiedDateTime: string; eTag: string; file?: unknown; "@microsoft.graph.downloadUrl"?: string; id: string }[] }>(
      `/sites/${siteId}/drive/root:/${caminho}:/children?$select=id,name,lastModifiedDateTime,eTag,file`);
    for (const it of r.value) {
      if (!it.file || !p.filtro(it.name)) continue;
      out.push({
        tipo: p.tipo, nome: it.name, pasta: p.caminho, modificadoEm: it.lastModifiedDateTime, etag: it.eTag,
        baixar: async () => {
          const resp = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drive/items/${it.id}/content`, {
            headers: { Authorization: `Bearer ${tk}` },
          });
          if (!resp.ok) throw new Error(`não consegui baixar ${it.name}: ${resp.status}`);
          return new Uint8Array(await resp.arrayBuffer());
        },
      });
    }
  }
  return out;
}

// Lê as 5 listas de regras no mesmo formato do arquivo sp_listas.json.
export async function lerListas(): Promise<Record<keyof typeof LISTAS_SHAREPOINT, ListaBruta>> {
  const { graph, siteId } = await conectar();
  const ler = async (id: string): Promise<ListaBruta> => {
    const cols = await graph<{ value: { name: string; displayName: string; hidden?: boolean; readOnly?: boolean }[] }>(
      `/sites/${siteId}/lists/${id}/columns`);
    const fields = cols.value.filter((c) => !c.hidden && !c.readOnly).map((c) => ({ InternalName: c.name, Title: c.displayName }));
    const items: Record<string, unknown>[] = [];
    let url: string | undefined = `/sites/${siteId}/lists/${id}/items?$expand=fields&$top=999`;
    while (url) {
      const r: { value: { id: string; fields: Record<string, unknown> }[]; "@odata.nextLink"?: string } = await graph(url);
      for (const it of r.value) items.push({ ...it.fields, Id: Number(it.id) });
      url = r["@odata.nextLink"];
    }
    return { fields, items };
  };
  return {
    produtores: await ler(LISTAS_SHAREPOINT.produtores),
    ramos: await ler(LISTAS_SHAREPOINT.ramos),
    seguradoras: await ler(LISTAS_SHAREPOINT.seguradoras),
    metas: await ler(LISTAS_SHAREPOINT.metas),
    analises: await ler(LISTAS_SHAREPOINT.analises),
  };
}
