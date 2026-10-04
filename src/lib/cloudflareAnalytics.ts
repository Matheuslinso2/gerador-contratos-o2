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

const NOMES_SITE: Record<string, string> = {
  "/": "Home",
  "/contato": "Contato",
  "/seguro-fianca-taxa-fixa": "Seguro Fiança Locatícia",
  "/titulo-de-capitalizacao-o2-seguros": "Título de Capitalização",
  "/seguro-incendio-imobiliario-o2": "Seguro Incêndio Obrigatório",
  "/seguro-para-condominios": "Seguro para Condomínios",
  "/seguro-protecao-aluguel": "Seguro Proteção Aluguel",
  "/analise-cadastral": "Análise Cadastral",
  "/seguro-automovel": "Seguro Automóvel",
  "/seguro-saude": "Seguro Saúde",
  "/seguro-de-vida": "Seguro de Vida",
  "/bate-papo-o2": "Bate Papo O2",
  "/blog": "Blog",
};

const NOMES_WORKSPACE: Record<string, string> = {
  "/": "Início",
  "/login": "Login",
  "/ferramentas": "Ferramentas (Auditor e Multa)",
  "/multa-rescisoria": "Calculadora de Multa",
  "/auditar-contrato": "Auditor de Contrato",
  "/cotacao": "Vitrine de cotação",
  "/ficha-fianca": "Ficha Seguro Fiança",
  "/capitalizacao": "Ficha Capitalização",
  "/seguro-incendio": "Ficha Seguro Incêndio",
  "/seguro-auto": "Ficha Seguro Auto",
  "/rc-obras": "Ficha RC Obras",
  "/rcp": "Ficha RCP",
  "/condominio": "Ficha Condomínio",
  "/seguro-celular": "Ficha Seguro Celular",
  "/termos": "Termos de uso",
};

// Traduz host + caminho num nome legível ("Site · Contato"). Cai no caminho
// "humanizado" quando não conhece a página (ex.: posts do blog).
function nomearPagina(host: string, caminho: string): string {
  const limpo = (caminho.length > 1 ? caminho.replace(/\/+$/, "") : caminho).toLowerCase() || "/";
  const workspace = host.startsWith("contratos.");
  const conhecido = (workspace ? NOMES_WORKSPACE : NOMES_SITE)[limpo];
  const nome =
    conhecido ??
    limpo
      .split("/")
      .filter(Boolean)
      .map((parte) => parte.replace(/-/g, " "))
      .join(" › ");
  return `${workspace ? "Workspace" : "Site"} · ${nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : "Home"}`;
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
              limit: 40
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
              dimensions { clientRequestHTTPHost clientRequestPath }
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
    type ItemPagina = { count: number; dimensions: { clientRequestHTTPHost: string; clientRequestPath: string } };
    const itensPagina = (paginas.data?.viewer?.zones?.[0]?.paginas ?? []) as ItemPagina[];
    paginas24h = somarPorNome(
      [itensPagina],
      (p) => nomearPagina(p.dimensions.clientRequestHTTPHost ?? "", p.dimensions.clientRequestPath ?? "/"),
      (p) => p.count
    ).slice(0, 8);
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
