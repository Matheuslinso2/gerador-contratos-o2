import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const TAMANHO_LOTE = 500;
const TAMANHO_PAGINA = 1000;

type LinhaErp = { ramo: string; cliente_cpf_cnpj: string | null };

async function buscarTudo(supabase: SupabaseServerClient): Promise<LinhaErp[]> {
  const linhas: LinhaErp[] = [];
  let inicio = 0;
  for (;;) {
    const { data, error } = await supabase.from("producao_erp").select("ramo, cliente_cpf_cnpj").range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw new Error(`Falha ao ler producao_erp: ${error.message}`);
    linhas.push(...((data ?? []) as LinhaErp[]));
    if (!data || data.length < TAMANHO_PAGINA) break;
    inicio += TAMANHO_PAGINA;
  }
  return linhas;
}

async function reescrever(supabase: SupabaseServerClient, tabela: string, linhas: Record<string, unknown>[]) {
  await supabase.from(tabela).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
    const { error } = await supabase.from(tabela).insert(linhas.slice(i, i + TAMANHO_LOTE));
    if (error) throw new Error(`Falha ao gravar ${tabela}: ${error.message}`);
  }
}

// Recalcula do zero as estatísticas de cross-sell (cliente com mais de um
// ramo, via CPF/CNPJ) -- roda só depois de processar um upload de grade,
// nunca ao vivo. Não guarda nem exibe nomes/CPFs, só contagens agregadas.
export async function recalcularResumoCruzamento(supabase: SupabaseServerClient): Promise<void> {
  const linhas = await buscarTudo(supabase);

  const ramosPorCliente = new Map<string, Set<string>>();
  for (const l of linhas) {
    const cpf = l.cliente_cpf_cnpj?.trim();
    if (!cpf) continue;
    const set = ramosPorCliente.get(cpf) ?? new Set<string>();
    set.add(l.ramo);
    ramosPorCliente.set(cpf, set);
  }

  const clientesPorRamo = new Map<string, number>();
  const paresContagem = new Map<string, number>();
  let totalClientesImobiliario = 0;
  let clientesImobiliarioComAuto = 0;

  for (const ramos of ramosPorCliente.values()) {
    for (const r of ramos) clientesPorRamo.set(r, (clientesPorRamo.get(r) ?? 0) + 1);

    const ramosOrdenados = Array.from(ramos).sort();
    for (let i = 0; i < ramosOrdenados.length; i++) {
      for (let j = i + 1; j < ramosOrdenados.length; j++) {
        const chave = `${ramosOrdenados[i]}|${ramosOrdenados[j]}`;
        paresContagem.set(chave, (paresContagem.get(chave) ?? 0) + 1);
      }
    }

    const temImobiliario = Array.from(ramos).some((r) => r !== "automovel");
    if (temImobiliario) {
      totalClientesImobiliario++;
      if (ramos.has("automovel")) clientesImobiliarioComAuto++;
    }
  }

  await reescrever(
    supabase,
    "producao_resumo_clientes_ramo",
    Array.from(clientesPorRamo.entries()).map(([ramo, clientes_distintos]) => ({ ramo, clientes_distintos }))
  );

  await reescrever(
    supabase,
    "producao_resumo_cruzamento",
    Array.from(paresContagem.entries()).map(([chave, clientes_em_comum]) => {
      const [ramo_a, ramo_b] = chave.split("|");
      return { ramo_a, ramo_b, clientes_em_comum };
    })
  );

  await reescrever(supabase, "producao_resumo_cross_sell", [
    { total_clientes_imobiliario: totalClientesImobiliario, clientes_imobiliario_com_auto: clientesImobiliarioComAuto },
  ]);
}
