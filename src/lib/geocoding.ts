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

// Consulta o cache primeiro; só chama o Google Maps (e grava no cache) se o
// endereço nunca foi visto. `orcamentoNovasConsultas` limita quantas
// chamadas novas ao Maps um único relatório pode disparar, pra não deixar a
// geração lenta demais num cache ainda frio — o resto do histórico vai
// sendo geocodificado aos poucos em gerações futuras.
export async function resolverEnderecoComCache(
  supabase: SupabaseServerClient,
  endereco: string,
  orcamentoNovasConsultas: { restante: number }
): Promise<ResultadoGeocodificacao | null> {
  const chave = normalizarEndereco(endereco);
  if (!chave) return null;

  const { data: existente } = await supabase
    .from("enderecos_geocodificados")
    .select("bairro, cidade, uf")
    .eq("endereco_normalizado", chave)
    .maybeSingle();
  if (existente) return existente;

  if (orcamentoNovasConsultas.restante <= 0) return null;
  orcamentoNovasConsultas.restante--;

  const resultado = await geocodificarViaGoogle(endereco);
  if (!resultado) return null;

  await supabase
    .from("enderecos_geocodificados")
    .upsert({ endereco_normalizado: chave, ...resultado }, { onConflict: "endereco_normalizado" });

  return resultado;
}
