import "server-only";

export type TrafegoDiario = { data: string; visitas: number; pageviews: number };
export type TrafegoPorPagina = { caminho: string; visitas: number };

export type ResultadoTrafego = {
  diario: TrafegoDiario[];
  porPagina: TrafegoPorPagina[];
  totalVisitas: number;
  totalPageviews: number;
};

type RespostaGraphql = { data?: { viewer?: { zones?: Record<string, unknown>[] } }; errors?: unknown[] } | null;

async function consultarCloudflare(query: string, variables: Record<string, unknown>): Promise<RespostaGraphql> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  try {
    const resposta = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      next: { revalidate: 900 },
    });
    return (await resposta.json().catch(() => null)) as RespostaGraphql;
  } catch (error) {
    console.error("Falha de rede ao buscar tráfego do Cloudflare:", error);
    return null;
  }
}

// Lista os campos de zona que a API expõe pra esse token -- só roda quando uma
// consulta falha, pra eu acertar o nome do dataset olhando o log do Vercel
// (o token nunca passa por mim).
async function logarCamposDisponiveis() {
  const resposta = await consultarCloudflare(
    `query { __type(name: "zone") { fields { name } } }`,
    {}
  );
  const campos = (resposta as { data?: { __type?: { fields?: { name: string }[] } } } | null)?.data?.__type?.fields;
  const relevantes = (campos ?? []).map((c) => c.name).filter((n) => /http|rum|firewall|dns/i.test(n));
  console.error("Campos de zona do Cloudflare disponíveis:", relevantes.join(", "));
}

// Lê o tráfego da zona o2seguros.com.br pela API GraphQL do Cloudflare
// (token escopado só pra leitura de Analytics). Pedido do Matheus,
// 02/10/2026: ver no Workspace O2 o tráfego do site junto dos leads.
export async function buscarTrafegoSite(dias: number): Promise<ResultadoTrafego | null> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!process.env.CLOUDFLARE_API_TOKEN || !zoneId) return null;

  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (dias - 1) * 24 * 60 * 60 * 1000);
  const dia = (d: Date) => d.toISOString().slice(0, 10);

  const resposta = await consultarCloudflare(
    `query Trafego($zoneTag: String!, $desde: Date!, $ate: Date!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          porDia: httpRequests1dGroups(
            limit: 100
            filter: { date_geq: $desde, date_leq: $ate }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum { pageViews }
            uniq { uniques }
          }
        }
      }
    }`,
    { zoneTag: zoneId, desde: dia(inicio), ate: dia(hoje) }
  );

  if (!resposta || resposta.errors?.length) {
    console.error("Erro da API do Cloudflare (tráfego do site):", JSON.stringify(resposta?.errors ?? "sem resposta"));
    await logarCamposDisponiveis();
    return null;
  }

  type ItemDia = { dimensions: { date: string }; sum: { pageViews: number }; uniq: { uniques: number } };
  const itens = (resposta.data?.viewer?.zones?.[0]?.porDia ?? []) as ItemDia[];

  const diario: TrafegoDiario[] = itens.map((item) => ({
    data: item.dimensions.date,
    visitas: item.uniq.uniques,
    pageviews: item.sum.pageViews,
  }));

  return {
    diario,
    porPagina: [],
    totalVisitas: diario.reduce((acc, d) => acc + d.visitas, 0),
    totalPageviews: diario.reduce((acc, d) => acc + d.pageviews, 0),
  };
}
