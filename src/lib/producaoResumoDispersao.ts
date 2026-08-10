import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const TAMANHO_LOTE = 500;
const TAMANHO_PAGINA = 1000;

type LinhaErp = { ramo: string; premio_total: number | null };

async function buscarTudo(supabase: SupabaseServerClient): Promise<LinhaErp[]> {
  const linhas: LinhaErp[] = [];
  let inicio = 0;
  for (;;) {
    const { data, error } = await supabase.from("producao_erp").select("ramo, premio_total").range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw new Error(`Falha ao ler producao_erp: ${error.message}`);
    linhas.push(...((data ?? []) as LinhaErp[]));
    if (!data || data.length < TAMANHO_PAGINA) break;
    inicio += TAMANHO_PAGINA;
  }
  return linhas;
}

function percentil(ordenado: number[], p: number): number {
  const idx = (ordenado.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return ordenado[lo];
  return ordenado[lo] + (ordenado[hi] - ordenado[lo]) * (idx - lo);
}

// Recalcula do zero as estatísticas de dispersão de prêmio por ramo (média,
// mediana, desvio padrão populacional, quartis, coeficiente de variação) --
// roda só depois de processar um upload de grade, nunca ao vivo.
export async function recalcularResumoDispersao(supabase: SupabaseServerClient): Promise<void> {
  const linhas = await buscarTudo(supabase);

  const valoresPorRamo = new Map<string, number[]>();
  for (const l of linhas) {
    if (l.premio_total === null || l.premio_total === undefined) continue;
    const lista = valoresPorRamo.get(l.ramo) ?? [];
    lista.push(l.premio_total);
    valoresPorRamo.set(l.ramo, lista);
  }

  const arredondar = (n: number) => Math.round(n * 100) / 100;
  const resultado: Record<string, unknown>[] = [];

  for (const [ramo, valores] of valoresPorRamo.entries()) {
    const ordenado = [...valores].sort((a, b) => a - b);
    const n = ordenado.length;
    const media = ordenado.reduce((s, v) => s + v, 0) / n;
    const variancia = ordenado.reduce((s, v) => s + (v - media) ** 2, 0) / n;
    const desvioPadrao = Math.sqrt(variancia);
    const mediana = percentil(ordenado, 0.5);
    const q1 = percentil(ordenado, 0.25);
    const q3 = percentil(ordenado, 0.75);
    const coeficienteVariacao = media ? (desvioPadrao / media) * 100 : 0;

    resultado.push({
      ramo,
      quantidade: n,
      media: arredondar(media),
      mediana: arredondar(mediana),
      desvio_padrao: arredondar(desvioPadrao),
      minimo: arredondar(ordenado[0]),
      maximo: arredondar(ordenado[n - 1]),
      q1: arredondar(q1),
      q3: arredondar(q3),
      coeficiente_variacao: arredondar(coeficienteVariacao),
    });
  }

  await supabase.from("producao_resumo_dispersao").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  for (let i = 0; i < resultado.length; i += TAMANHO_LOTE) {
    const { error } = await supabase.from("producao_resumo_dispersao").insert(resultado.slice(i, i + TAMANHO_LOTE));
    if (error) throw new Error(`Falha ao gravar producao_resumo_dispersao: ${error.message}`);
  }
}
