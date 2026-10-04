import "server-only";

export type TrafegoDiario = { data: string; visitas: number; pageviews: number };
export type ItemRanking = { nome: string; valor: number };

export type ResultadoTrafego = {
  diario: TrafegoDiario[];
  totalVisitas: number;
  totalPageviews: number;
  totalRequisicoes: number;
  ameacasBloqueadas: number;
  paises: ItemRanking[];
  navegadores: ItemRanking[];
  statusHttp: ItemRanking[];
  // Últimas 24h (a API de páginas do plano grátis só olha 1 dia pra trás).
  paginas24h: ItemRanking[];
};

type RespostaGraphql = {
  data?: { viewer?: { zones?: Record<string, unknown>[] } };
  errors?: unknown[];
} | null;

async function consultarCloudflare(query: string, variables: Record<string, unknown>): Promise<RespostaGraphql> {
  try {
    const resposta = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      next: { revalidate: 900 },
    });
    return (await resposta.json().catch(() => null)) as RespostaGraphql;
  } catch (error) {
    console.error("Falha de rede ao buscar tráfego do Cloudflare:", error);
    return null;
  }
}

function somarPorNome<T>(grupos: T[][], nome: (item: T) => string, valor: (item: T) => number): ItemRanking[] {
  const mapa = new Map<string, number>();
  for (const lista of grupos) {
    for (const item of lista) mapa.set(nome(item), (mapa.get(nome(item)) ?? 0) + valor(item));
  }
  return Array.from(mapa, ([n, v]) => ({ nome: n, valor: v })).sort((a, b) => b.valor - a.valor);
}

// Lê o tráfego da zona o2seguros.com.br pela API GraphQL do Cloudflare
// (token escopado só pra leitura de Analytics). Pedido do Matheus,
// 02/10/2026 e 04/10/2026: ver no Workspace O2 o tráfego do site junto dos
// leads. Mede no servidor do Cloudflare, então inclui robôs.
export async function buscarTrafegoSite(dias: number): Promise<ResultadoTrafego | null> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!process.env.CLOUDFLARE_API_TOKEN || !zoneId) return null;

  const agora = new Date();
  const inicio = new Date(agora.getTime() - (dias - 1) * 24 * 60 * 60 * 1000);
  const dia = (d: Date) => d.toISOString().slice(0, 10);

  const [principal, paginas] = await Promise.all([
    consultarCloudflare(
      `query Trafego($zoneTag: String!, $desde: Date!, $ate: Date!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            porDia: httpRequests1dGroups(
              limit: 100
              filter: { date_geq: $desde, date_leq: $ate }
              orderBy: [date_ASC]
            ) {
              dimensions { date }
              sum {
                pageViews
                requests
                threats
                countryMap { clientCountryName requests }
                browserMap { uaBrowserFamily pageViews }
                responseStatusMap { edgeResponseStatus requests }
              }
              uniq { uniques }
            }
          }
        }
      }`,
      { zoneTag: zoneId, desde: dia(inicio), ate: dia(agora) }
    ),
    consultarCloudflare(
      `query Paginas($zoneTag: String!, $desde: Time!, $ate: Time!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            paginas: httpRequestsAdaptiveGroups(
              limit: 10
              filter: {
                datetime_geq: $desde
                datetime_leq: $ate
                requestSource: "eyeball"
                edgeResponseContentTypeName: "html"
                edgeResponseStatus: 200
              }
              orderBy: [count_DESC]
            ) {
              count
              dimensions { clientRequestPath }
            }
          }
        }
      }`,
      {
        zoneTag: zoneId,
        desde: new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        ate: agora.toISOString(),
      }
    ),
  ]);

  if (!principal || principal.errors?.length) {
    console.error("Erro da API do Cloudflare (tráfego do site):", JSON.stringify(principal?.errors ?? "sem resposta"));
    return null;
  }

  type ItemDia = {
    dimensions: { date: string };
    sum: {
      pageViews: number;
      requests: number;
      threats: number;
      countryMap: { clientCountryName: string; requests: number }[];
      browserMap: { uaBrowserFamily: string; pageViews: number }[];
      responseStatusMap: { edgeResponseStatus: number; requests: number }[];
    };
    uniq: { uniques: number };
  };
  const itens = (principal.data?.viewer?.zones?.[0]?.porDia ?? []) as ItemDia[];

  const diario: TrafegoDiario[] = itens.map((item) => ({
    data: item.dimensions.date,
    visitas: item.uniq.uniques,
    pageviews: item.sum.pageViews,
  }));

  let paginas24h: ItemRanking[] = [];
  if (!paginas || paginas.errors?.length) {
    console.error("Erro da API do Cloudflare (páginas mais acessadas):", JSON.stringify(paginas?.errors ?? "sem resposta"));
  } else {
    type ItemPagina = { count: number; dimensions: { clientRequestPath: string } };
    paginas24h = ((paginas.data?.viewer?.zones?.[0]?.paginas ?? []) as ItemPagina[]).map((p) => ({
      nome: p.dimensions.clientRequestPath || "/",
      valor: p.count,
    }));
  }

  return {
    diario,
    totalVisitas: diario.reduce((acc, d) => acc + d.visitas, 0),
    totalPageviews: diario.reduce((acc, d) => acc + d.pageviews, 0),
    totalRequisicoes: itens.reduce((acc, i) => acc + i.sum.requests, 0),
    ameacasBloqueadas: itens.reduce((acc, i) => acc + i.sum.threats, 0),
    paises: somarPorNome(itens.map((i) => i.sum.countryMap), (c) => c.clientCountryName, (c) => c.requests).slice(0, 6),
    navegadores: somarPorNome(itens.map((i) => i.sum.browserMap), (b) => b.uaBrowserFamily, (b) => b.pageViews).slice(0, 6),
    statusHttp: somarPorNome(itens.map((i) => i.sum.responseStatusMap), (s) => String(s.edgeResponseStatus), (s) => s.requests).slice(0, 6),
    paginas24h,
  };
}
