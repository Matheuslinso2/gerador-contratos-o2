import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type ResultadoGeocodificacao = { bairro: string | null; cidade: string | null; uf: string | null };

export function normalizarEndereco(endereco: string): string {
  return endereco.trim().toLowerCase().replace(/\s+/g, " ");
}

async function geocodificarViaGoogle(endereco: string): Promise<ResultadoGeocodificacao | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      endereco
    )}&region=br&key=${apiKey}`;
    const resposta = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resposta.ok) return null;
    const dados = await resposta.json();
    if (dados.status !== "OK" || !dados.results?.length) return null;

    const componentes = dados.results[0].address_components as { long_name: string; types: string[] }[];
    const achar = (tipo: string) => componentes.find((c) => c.types.includes(tipo))?.long_name ?? null;

    return {
      bairro: achar("sublocality_level_1") ?? achar("sublocality") ?? achar("neighborhood"),
      cidade: achar("locality") ?? achar("administrative_area_level_2"),
      uf: achar("administrative_area_level_1"),
    };
  } catch {
    return null;
  }
}

export type CacheEnderecos = Map<string, ResultadoGeocodificacao>;

// Carrega o cache de geocodificação inteiro numa única consulta — usado no
// início de uma sincronização, pra depois checar cada endereço na memória
// em vez de fazer uma consulta ao banco por linha (isso sozinho já estourava
// o tempo de execução com milhares de cotações).
export async function carregarCacheEnderecos(supabase: SupabaseServerClient): Promise<CacheEnderecos> {
  const cache: CacheEnderecos = new Map();
  const { data } = await supabase.from("enderecos_geocodificados").select("endereco_normalizado, bairro, cidade, uf");
  for (const linha of data ?? []) {
    cache.set(linha.endereco_normalizado, { bairro: linha.bairro, cidade: linha.cidade, uf: linha.uf });
  }
  return cache;
}

// Resolve um endereço usando o cache já carregado em memória; só chama o
// Google Maps (e grava no cache, atualizando o mapa em memória também) se o
// endereço nunca foi visto. `orcamentoNovasConsultas` limita quantas
// chamadas novas ao Maps uma sincronização pode disparar de uma vez, pra
// não deixar a execução lenta demais num cache ainda frio — o resto do
// histórico vai sendo geocodificado aos poucos nas próximas sincronizações.
export async function resolverEnderecoComCache(
  supabase: SupabaseServerClient,
  endereco: string,
  cache: CacheEnderecos,
  orcamentoNovasConsultas: { restante: number }
): Promise<ResultadoGeocodificacao | null> {
  const chave = normalizarEndereco(endereco);
  if (!chave) return null;

  const existente = cache.get(chave);
  if (existente) return existente;

  if (orcamentoNovasConsultas.restante <= 0) return null;
  orcamentoNovasConsultas.restante--;

  const resultado = await geocodificarViaGoogle(endereco);
  if (!resultado) return null;

  cache.set(chave, resultado);
  await supabase
    .from("enderecos_geocodificados")
    .upsert({ endereco_normalizado: chave, ...resultado }, { onConflict: "endereco_normalizado" });

  return resultado;
}
