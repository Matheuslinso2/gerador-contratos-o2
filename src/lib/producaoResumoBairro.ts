import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const TAMANHO_LOTE = 500;
const TAMANHO_PAGINA = 1000;

type LinhaEndereco = { ramo: string; nosso_numero: string; bairro: string | null; cidade: string | null; uf: string | null; valor_aluguel: number | null };
type LinhaErp = { ramo: string; nosso_numero: string; premio_total: number | null; valor_comissao: number | null };

// O Supabase (PostgREST) devolve no máximo 1000 linhas por consulta sem
// paginação explícita -- ver o mesmo comentário em producaoResumo.ts
// (foi o que causou o dashboard mostrar contagem errada de apólices).
async function buscarEnderecosComBairro(supabase: SupabaseServerClient): Promise<LinhaEndereco[]> {
  const linhas: LinhaEndereco[] = [];
  let inicio = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("producao_enderecos")
      .select("ramo, nosso_numero, bairro, cidade, uf, valor_aluguel")
      .not("bairro", "is", null)
      .range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw new Error(`Falha ao ler producao_enderecos: ${error.message}`);
    linhas.push(...((data ?? []) as LinhaEndereco[]));
    if (!data || data.length < TAMANHO_PAGINA) break;
    inicio += TAMANHO_PAGINA;
  }
  return linhas;
}

async function buscarPremiosErp(supabase: SupabaseServerClient): Promise<LinhaErp[]> {
  const linhas: LinhaErp[] = [];
  let inicio = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("producao_erp")
      .select("ramo, nosso_numero, premio_total, valor_comissao")
      .range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw new Error(`Falha ao ler producao_erp: ${error.message}`);
    linhas.push(...((data ?? []) as LinhaErp[]));
    if (!data || data.length < TAMANHO_PAGINA) break;
    inicio += TAMANHO_PAGINA;
  }
  return linhas;
}

// Recalcula do zero producao_resumo_bairro -- junta producao_enderecos com
// producao_erp por (ramo, nosso_numero) pra saber o prêmio de cada
// apólice endereçada. Roda só depois de processar um upload de endereços,
// nunca ao vivo (mesmo padrão de recalcularResumoProducao).
export async function recalcularResumoBairro(supabase: SupabaseServerClient): Promise<void> {
  const [enderecosData, erpData] = await Promise.all([buscarEnderecosComBairro(supabase), buscarPremiosErp(supabase)]);

  const premioPorChave = new Map<string, number>();
  const comissaoPorChave = new Map<string, number>();
  for (const l of erpData) {
    premioPorChave.set(`${l.ramo}|${l.nosso_numero}`, l.premio_total ?? 0);
    comissaoPorChave.set(`${l.ramo}|${l.nosso_numero}`, l.valor_comissao ?? 0);
  }

  type Ac = {
    ramo: string;
    bairro: string;
    cidade: string | null;
    uf: string | null;
    quantidade: number;
    premio_total: number;
    comissao_soma: number;
    aluguel_soma: number;
    aluguel_quantidade: number;
  };
  const acumulado = new Map<string, Ac>();

  // Normaliza bairro/cidade só pra fins de agrupamento (maiúsculo, sem
  // espaço duplicado) -- sem isso "Barra da Tijuca" e "BARRA DA TIJUCA"
  // viram 2 linhas diferentes no resumo, inflando a lista de bairros.
  const normalizar = (s: string | null) =>
    (s ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");

  // Variações de grafia do mesmo bairro que vêm assim do relatório de
  // origem (não é diferença de maiúscula/acento, então a normalização
  // acima não resolve sozinha) -- confirmado com o usuário.
  const SINONIMOS_BAIRRO: Record<string, string> = {
    "RECREIO DOS BANDEIRA": "RECREIO DOS BANDEIRANTES",
  };

  for (const e of enderecosData) {
    if (!e.bairro) continue;
    const bairroNorm = SINONIMOS_BAIRRO[normalizar(e.bairro)] ?? normalizar(e.bairro);
    const cidadeNorm = normalizar(e.cidade);
    const chave = `${e.ramo}|${bairroNorm}|${cidadeNorm}`;
    const atual =
      acumulado.get(chave) ??
      { ramo: e.ramo, bairro: bairroNorm, cidade: cidadeNorm || null, uf: e.uf, quantidade: 0, premio_total: 0, comissao_soma: 0, aluguel_soma: 0, aluguel_quantidade: 0 };
    atual.quantidade += 1;
    atual.premio_total += premioPorChave.get(`${e.ramo}|${e.nosso_numero}`) ?? 0;
    atual.comissao_soma += comissaoPorChave.get(`${e.ramo}|${e.nosso_numero}`) ?? 0;
    if (e.valor_aluguel !== null && e.valor_aluguel !== undefined) {
      atual.aluguel_soma += e.valor_aluguel;
      atual.aluguel_quantidade += 1;
    }
    acumulado.set(chave, atual);
  }

  const arredondar = (n: number) => Math.round(n * 100) / 100;
  const linhas = Array.from(acumulado.values()).map((a) => ({
    ...a,
    premio_total: arredondar(a.premio_total),
    comissao_soma: arredondar(a.comissao_soma),
    aluguel_soma: arredondar(a.aluguel_soma),
  }));

  await supabase.from("producao_resumo_bairro").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
    const { error } = await supabase.from("producao_resumo_bairro").insert(linhas.slice(i, i + TAMANHO_LOTE));
    if (error) throw new Error(`Falha ao gravar producao_resumo_bairro: ${error.message}`);
  }
}
