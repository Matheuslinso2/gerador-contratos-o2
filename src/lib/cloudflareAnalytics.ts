import "server-only";

export type TrafegoDiario = { data: string; visitas: number; pageviews: number };
export type TrafegoPorPagina = { caminho: string; visitas: number };

export type ResultadoTrafego = {
  diario: TrafegoDiario[];
  porPagina: TrafegoPorPagina[];
  totalVisitas: number;
  totalPageviews: number;
};

// Lê o Web Analytics (RUM) do Cloudflare via GraphQL -- mesmo dado que
// aparece no painel do Cloudflare em Analytics > Web Analytics, sem
// precisar do token de Zone Analytics completo (só "Zone > Analytics >
// Read" escopado pra o2seguros.com.br). Pedido do Matheus, 02/10/2026: ver
// no Workspace O2 o que já está rodando no Cloudflare, junto dos leads.
export async function buscarTrafegoSite(dias: number): Promise<ResultadoTrafego | null> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) return null;

  const until = new Date();
  const since = new Date(until.getTime() - dias * 24 * 60 * 60 * 1000);

  const query = `
    query Trafego($zoneTag: String!, $since: Time!, $until: Time!) {
      viewer {
        zones(filter: { zoneTag: $zoneTag }) {
          porDia: rumPageloadEventsAdaptiveGroups(
            limit: 1000
            filter: { datetime_geq: $since, datetime_leq: $until }
            orderBy: [date_ASC]
          ) {
            count
            sum { visits }
            dimensions { date }
          }
          porPagina: rumPageloadEventsAdaptiveGroups(
            limit: 8
            filter: { datetime_geq: $since, datetime_leq: $until }
            orderBy: [sum_visits_DESC]
          ) {
            sum { visits }
            dimensions { requestPath }
          }
        }
      }
    }
  `;

  let resposta: Response;
  try {
    resposta = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { zoneTag: zoneId, since: since.toISOString(), until: until.toISOString() },
      }),
      next: { revalidate: 900 },
    });
  } catch (error) {
    console.error("Falha de rede ao buscar tráfego do Cloudflare:", error);
    return null;
  }

  const json = await resposta.json().catch(() => null);
  if (!json || json.errors?.length) {
    console.error("Erro da API do Cloudflare (tráfego do site):", JSON.stringify(json?.errors ?? resposta.status));
    return null;
  }

  const zona = json.data?.viewer?.zones?.[0];
  if (!zona) return null;

  type ItemDia = { count: number; sum: { visits: number }; dimensions: { date: string } };
  type ItemPagina = { sum: { visits: number }; dimensions: { requestPath: string } };

  const diario: TrafegoDiario[] = ((zona.porDia ?? []) as ItemDia[]).map((item) => ({
    data: item.dimensions.date,
    visitas: item.sum.visits,
    pageviews: item.count,
  }));
  const porPagina: TrafegoPorPagina[] = ((zona.porPagina ?? []) as ItemPagina[]).map((item) => ({
    caminho: item.dimensions.requestPath,
    visitas: item.sum.visits,
  }));

  return {
    diario,
    porPagina,
    totalVisitas: diario.reduce((acc, d) => acc + d.visitas, 0),
    totalPageviews: diario.reduce((acc, d) => acc + d.pageviews, 0),
  };
}
