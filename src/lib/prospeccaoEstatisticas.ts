import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export const FAIXAS_ALUGUEL: { label: string; min: number; max: number | null }[] = [
  { label: "até R$ 2.000", min: 0, max: 2000 },
  { label: "R$ 2.000 – R$ 4.000", min: 2000, max: 4000 },
  { label: "R$ 4.000 – R$ 6.000", min: 4000, max: 6000 },
  { label: "R$ 6.000 – R$ 10.000", min: 6000, max: 10000 },
  { label: "acima de R$ 10.000", min: 10000, max: null },
];

function faixaDoAluguel(aluguel: number): string | null {
  const f = FAIXAS_ALUGUEL.find((f) => aluguel >= f.min && (f.max === null || aluguel < f.max));
  return f?.label ?? null;
}

type Chave = string; // `${nivel}|${chave}|${cidade}|${tipo}|${faixa}`
type Acumulador = { soma: number; contagem: number; nivel: string; chave: string; cidade: string; tipo: string; faixa: string };

// Recalcula do zero a tabela estatisticas_ticket a partir de todo o cache de
// cotações — roda só ao final de uma sincronização (não a cada relatório).
// Agrega em 3 níveis (bairro, região, cidade) pra permitir o "plano B"
// (bairro sem dado suficiente -> região -> cidade) numa leitura rápida
// depois, sem precisar juntar níveis na hora do relatório.
export async function recalcularEstatisticas(supabase: SupabaseServerClient): Promise<number> {
  const [{ data: cotacoes }, { data: regioes }] = await Promise.all([
    supabase.from("cotacoes_cache").select("tipo, cidade, bairro, aluguel, premio"),
    supabase.from("bairros_regioes").select("bairro, cidade, regiao"),
  ]);

  const regiaoPorBairroCidade = new Map<string, string>();
  for (const r of regioes ?? []) {
    regiaoPorBairroCidade.set(`${r.bairro.toLowerCase()}|${r.cidade.toLowerCase()}`, r.regiao);
  }

  const acumuladores = new Map<Chave, Acumulador>();

  function acumular(nivel: string, chave: string, cidade: string, tipo: string, faixa: string, premio: number) {
    const k = `${nivel}|${chave}|${cidade}|${tipo}|${faixa}`;
    const atual = acumuladores.get(k) ?? { soma: 0, contagem: 0, nivel, chave, cidade, tipo, faixa };
    atual.soma += premio;
    atual.contagem += 1;
    acumuladores.set(k, atual);
  }

  for (const c of cotacoes ?? []) {
    if (!c.cidade || !c.tipo || !c.premio || !c.aluguel) continue;
    const faixa = faixaDoAluguel(c.aluguel);
    if (!faixa) continue;

    acumular("cidade", c.cidade, c.cidade, c.tipo, faixa, c.premio);

    if (c.bairro) {
      acumular("bairro", c.bairro, c.cidade, c.tipo, faixa, c.premio);
      const regiao = regiaoPorBairroCidade.get(`${c.bairro.toLowerCase()}|${c.cidade.toLowerCase()}`);
      if (regiao) acumular("regiao", regiao, c.cidade, c.tipo, faixa, c.premio);
    }
  }

  const linhas = Array.from(acumuladores.values()).map((a) => ({
    nivel: a.nivel,
    chave: a.chave,
    cidade: a.cidade,
    tipo: a.tipo,
    faixa: a.faixa,
    ticket_medio: Math.round((a.soma / a.contagem) * 100) / 100,
    quantidade: a.contagem,
  }));

  // Recria do zero — mais simples e seguro que tentar fazer upsert
  // incremental, e o cálculo inteiro é rápido (tudo já está no banco local).
  await supabase.from("estatisticas_ticket").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (linhas.length) {
    const TAMANHO_LOTE = 500;
    for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
      await supabase.from("estatisticas_ticket").insert(linhas.slice(i, i + TAMANHO_LOTE));
    }
  }

  return linhas.length;
}

export type FaixaTicket = {
  faixa: string;
  ticket_medio: number | null;
  quantidade: number;
  nivel: "bairro" | "regiao" | "cidade" | null;
};

export type TicketPorLocal = {
  bairro_informado: string | null;
  regiao_informada: string | null;
  cidade_informada: string | null;
  incendio_por_faixa: FaixaTicket[];
  fianca_por_faixa: FaixaTicket[];
};

const AMOSTRA_MINIMA = 3;

type LinhaEstatistica = { nivel: string; chave: string; tipo: string; faixa: string; ticket_medio: number; quantidade: number };

// Combina várias linhas (ex: 3 bairros selecionados) numa média ponderada
// pela quantidade de cada uma.
function combinar(linhas: LinhaEstatistica[]): { ticket_medio: number; quantidade: number } | null {
  if (!linhas.length) return null;
  const quantidade = linhas.reduce((s, l) => s + l.quantidade, 0);
  if (!quantidade) return null;
  const soma = linhas.reduce((s, l) => s + l.ticket_medio * l.quantidade, 0);
  return { ticket_medio: Math.round((soma / quantidade) * 100) / 100, quantidade };
}

// Leitura rápida (sem nenhum cálculo) das estatísticas já prontas — aceita
// um ou vários bairros selecionados (combinados numa média ponderada),
// caindo para a(s) região(ões) correspondente(s) e depois para a cidade,
// faixa por faixa, quando a amostra do bairro for pequena demais.
export async function buscarTicketPorLocal(
  supabase: SupabaseServerClient,
  bairros: string[],
  cidade: string
): Promise<TicketPorLocal | null> {
  const bairrosValidos = bairros.map((b) => b.trim()).filter(Boolean);
  if (!bairrosValidos.length && !cidade) return null;

  const regioes = new Set<string>();
  if (bairrosValidos.length) {
    const { data } = await supabase
      .from("bairros_regioes")
      .select("bairro, regiao, cidade")
      .in(
        "bairro",
        bairrosValidos.map((b) => b)
      );
    for (const r of data ?? []) {
      regioes.add(r.regiao);
      if (!cidade) cidade = r.cidade;
    }
  }
  const regioesArr = Array.from(regioes);

  const chaves = [...bairrosValidos, ...regioesArr, cidade].filter((v): v is string => !!v);
  if (!chaves.length) return null;

  const { data: linhas } = await supabase
    .from("estatisticas_ticket")
    .select("nivel, chave, tipo, faixa, ticket_medio, quantidade")
    .in("chave", chaves);

  const porNivel = (nivel: string, chavesAceitas: string[], tipo: string, faixa: string) =>
    (linhas ?? []).filter(
      (l) =>
        l.nivel === nivel &&
        l.tipo === tipo &&
        l.faixa === faixa &&
        chavesAceitas.some((c) => c.toLowerCase() === l.chave.toLowerCase())
    );

  function montarFaixas(tipo: string): FaixaTicket[] {
    return FAIXAS_ALUGUEL.map(({ label }) => {
      const doBairro = combinar(porNivel("bairro", bairrosValidos, tipo, label));
      if (doBairro && doBairro.quantidade >= AMOSTRA_MINIMA) {
        return { faixa: label, ...doBairro, nivel: "bairro" as const };
      }
      const daRegiao = combinar(porNivel("regiao", regioesArr, tipo, label));
      if (daRegiao && daRegiao.quantidade >= AMOSTRA_MINIMA) {
        return { faixa: label, ...daRegiao, nivel: "regiao" as const };
      }
      const daCidade = combinar(porNivel("cidade", cidade ? [cidade] : [], tipo, label));
      if (daCidade) {
        return { faixa: label, ...daCidade, nivel: "cidade" as const };
      }
      return { faixa: label, ticket_medio: null, quantidade: 0, nivel: null };
    });
  }

  return {
    bairro_informado: bairrosValidos.join(", ") || null,
    regiao_informada: regioesArr.join(", ") || null,
    cidade_informada: cidade || null,
    incendio_por_faixa: montarFaixas("incendio"),
    fianca_por_faixa: montarFaixas("fianca"),
  };
}
