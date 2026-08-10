import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type LinhaBase = {
  ramo: string;
  competencia: string | null;
  tipo: string | null;
  produtor: string | null;
  seguradora: string;
  premio_total: number | null;
  valor_comissao: number | null;
  valor_comissao_produtor: number | null;
};

const TAMANHO_LOTE = 500;
const TAMANHO_PAGINA = 1000;

// O Supabase (PostgREST) devolve no máximo 1000 linhas por consulta por
// padrão, mesmo sem `.limit()` -- sem paginar explicitamente, uma base com
// mais de 1000 linhas fica cortada silenciosamente (foi exatamente isso
// que causou a Fiança aparecer com 866 em vez de 2.263 no dashboard).
async function buscarTudo<T>(supabase: SupabaseServerClient, tabela: string, colunas: string): Promise<T[]> {
  const linhas: T[] = [];
  let inicio = 0;
  for (;;) {
    const { data, error } = await supabase.from(tabela).select(colunas).range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw new Error(`Falha ao ler ${tabela}: ${error.message}`);
    linhas.push(...((data ?? []) as T[]));
    if (!data || data.length < TAMANHO_PAGINA) break;
    inicio += TAMANHO_PAGINA;
  }
  return linhas;
}

async function reescrever(supabase: SupabaseServerClient, tabela: string, linhas: Record<string, unknown>[]) {
  await supabase.from(tabela).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
    const lote = linhas.slice(i, i + TAMANHO_LOTE);
    const { error } = await supabase.from(tabela).insert(lote);
    if (error) throw new Error(`Falha ao gravar ${tabela}: ${error.message}`);
  }
}

// Recalcula do zero as 3 tabelas-resumo a partir de TODA a producao_erp --
// roda só depois de processar um upload, nunca ao vivo numa consulta do
// dashboard (mesmo padrão já usado em recalcularEstatisticas/
// recalcularMetricasImobiliarias da antiga Prospecção).
export async function recalcularResumoProducao(supabase: SupabaseServerClient): Promise<void> {
  const linhas = await buscarTudo<LinhaBase>(
    supabase,
    "producao_erp",
    "ramo, competencia, tipo, produtor, seguradora, premio_total, valor_comissao, valor_comissao_produtor"
  );

  type AcMensal = { ramo: string; competencia: string; tipo: string; quantidade: number; premio_total: number; comissao_corretora: number };
  type AcProdutor = { produtor: string; ramo: string; quantidade: number; premio_total: number; comissao_corretora: number; comissao_produtor: number };
  type AcSeguradora = { seguradora: string; ramo: string; quantidade: number; premio_total: number; comissao_corretora: number };

  const mensal = new Map<string, AcMensal>();
  const produtor = new Map<string, AcProdutor>();
  const seguradora = new Map<string, AcSeguradora>();

  for (const l of linhas) {
    const premio = l.premio_total ?? 0;
    const comissaoCorretora = l.valor_comissao ?? 0;
    const comissaoProdutor = l.valor_comissao_produtor ?? 0;

    if (l.competencia && l.tipo) {
      const chave = `${l.ramo}|${l.competencia}|${l.tipo}`;
      const atual = mensal.get(chave) ?? { ramo: l.ramo, competencia: l.competencia, tipo: l.tipo, quantidade: 0, premio_total: 0, comissao_corretora: 0 };
      atual.quantidade += 1;
      atual.premio_total += premio;
      atual.comissao_corretora += comissaoCorretora;
      mensal.set(chave, atual);
    }

    if (l.produtor) {
      const chave = `${l.produtor}|${l.ramo}`;
      const atual = produtor.get(chave) ?? { produtor: l.produtor, ramo: l.ramo, quantidade: 0, premio_total: 0, comissao_corretora: 0, comissao_produtor: 0 };
      atual.quantidade += 1;
      atual.premio_total += premio;
      atual.comissao_corretora += comissaoCorretora;
      atual.comissao_produtor += comissaoProdutor;
      produtor.set(chave, atual);
    }

    {
      // Variações de grafia da mesma seguradora que vêm assim do relatório
      // de origem -- confirmado com o usuário.
      const SINONIMOS_SEGURADORA: Record<string, string> = {
        ALFA: "ALFA SEGUROS E PREVIDENCIA S.A.",
      };
      const seguradoraNome = SINONIMOS_SEGURADORA[l.seguradora] ?? l.seguradora;
      const chave = `${seguradoraNome}|${l.ramo}`;
      const atual = seguradora.get(chave) ?? { seguradora: seguradoraNome, ramo: l.ramo, quantidade: 0, premio_total: 0, comissao_corretora: 0 };
      atual.quantidade += 1;
      atual.premio_total += premio;
      atual.comissao_corretora += comissaoCorretora;
      seguradora.set(chave, atual);
    }
  }

  const arredondar = (n: number) => Math.round(n * 100) / 100;

  await reescrever(
    supabase,
    "producao_resumo_mensal",
    Array.from(mensal.values()).map((a) => ({ ...a, premio_total: arredondar(a.premio_total), comissao_corretora: arredondar(a.comissao_corretora) }))
  );
  await reescrever(
    supabase,
    "producao_resumo_produtor",
    Array.from(produtor.values()).map((a) => ({
      ...a,
      premio_total: arredondar(a.premio_total),
      comissao_corretora: arredondar(a.comissao_corretora),
      comissao_produtor: arredondar(a.comissao_produtor),
    }))
  );
  await reescrever(
    supabase,
    "producao_resumo_seguradora",
    Array.from(seguradora.values()).map((a) => ({ ...a, premio_total: arredondar(a.premio_total) }))
  );
}
