import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemAgrupado, ItemImobiliariaFonte } from "./analise";

// Quadro de imobiliárias da Visão geral do /ramos-elementares (Matheus,
// 22/10/2026): novos + renovações juntos, pela BASE UNIFICADA de imobiliárias
// -- o mesmo cadastro do Power BI / Imobiliária 360. Cada imobiliária de fonte
// (Empresa do card no Bitrix, nome da planilha de RE) vai para a ficha com
// vínculo CONFIRMADO em imobiliaria_registros_fonte. Fichas de um grupo
// "mesma_empresa" (ex.: Ramiro Sá PF + PJ) somam numa linha só; grupo
// "rede_filiais" (ex.: Renascença) mantém cada unidade, que é imobiliária
// própria. Sem vínculo confirmado: fica com o nome da fonte e a marca
// semVinculo, para revisão em /admin/imobiliarias.

export type ImobiliariaUnificada = ItemAgrupado & { semVinculo?: boolean };

type Destino = { chave: string; nome: string; semVinculo: boolean };

type Resolvedor = {
  porChave: (chave: string, nomeFonte: string) => Destino;
  porNome: (nomeFonte: string) => Destino;
};

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().replace(/\s+/g, " ").toUpperCase();
}

async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const linhas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    linhas.push(...(data ?? []));
    if (!data || data.length < 1000) return linhas;
  }
}

export async function montarResolvedorImobiliarias(supabase: SupabaseClient): Promise<Resolvedor> {
  const [registros, fichas, grupos] = await Promise.all([
    lerTudo<{ fonte: string; chave_externa: string; nome_original: string | null; imobiliaria_id: string | null }>((de, ate) =>
      supabase
        .from("imobiliaria_registros_fonte")
        .select("fonte, chave_externa, nome_original, imobiliaria_id")
        .in("fonte", ["bitrix_empresa", "planilha_re"])
        .eq("situacao", "confirmado")
        .not("imobiliaria_id", "is", null)
        .range(de, ate)
    ),
    lerTudo<{ id: string; nome: string; apelido: string | null; grupo_id: string | null }>((de, ate) =>
      supabase.from("imobiliarias").select("id, nome, apelido, grupo_id").range(de, ate)
    ),
    lerTudo<{ id: string; nome: string; tipo: string | null }>((de, ate) =>
      supabase.from("imobiliaria_grupos").select("id, nome, tipo").range(de, ate)
    ),
  ]);

  const grupoPorId = new Map(grupos.map((g) => [g.id, g]));
  const destinoDaFicha = new Map<string, Destino>();
  for (const ficha of fichas) {
    const grupo = ficha.grupo_id ? grupoPorId.get(ficha.grupo_id) : undefined;
    destinoDaFicha.set(
      ficha.id,
      grupo && grupo.tipo === "mesma_empresa"
        ? { chave: `g:${grupo.id}`, nome: grupo.nome.toUpperCase(), semVinculo: false }
        : { chave: `i:${ficha.id}`, nome: (ficha.apelido || ficha.nome).toUpperCase(), semVinculo: false }
    );
  }

  const porChaveFonte = new Map<string, Destino>();
  const porNomeFonte = new Map<string, Destino>();
  for (const registro of registros) {
    const destino = destinoDaFicha.get(registro.imobiliaria_id!);
    if (!destino) continue;
    porChaveFonte.set(`${registro.fonte}:${registro.chave_externa}`, destino);
    const nome = registro.fonte === "planilha_re" ? registro.chave_externa : registro.nome_original;
    if (nome) porNomeFonte.set(normalizar(nome), destino);
  }

  const semVinculo = (nomeFonte: string): Destino => ({
    chave: `n:${normalizar(nomeFonte || "NÃO INFORMADA")}`,
    nome: (nomeFonte || "NÃO INFORMADA").toUpperCase(),
    semVinculo: !!nomeFonte && normalizar(nomeFonte) !== "NAO INFORMADA",
  });

  return {
    porChave: (chave, nomeFonte) => porChaveFonte.get(chave) ?? porNomeFonte.get(normalizar(nomeFonte)) ?? semVinculo(nomeFonte),
    porNome: (nomeFonte) => porNomeFonte.get(normalizar(nomeFonte)) ?? semVinculo(nomeFonte),
  };
}

function somar(a: ImobiliariaUnificada, b: ItemAgrupado): ImobiliariaUnificada {
  const soma = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  const total = a.total + b.total;
  const efetivados = a.efetivados + b.efetivados;
  return {
    ...a,
    total,
    efetivados,
    conversao: total ? (efetivados / total) * 100 : null,
    comissao: a.comissao + b.comissao,
    comissaoEfetivada: a.comissaoEfetivada + b.comissaoEfetivada,
    emAndamento: soma(a.emAndamento, b.emAndamento),
    encerrados: soma(a.encerrados, b.encerrados),
    premioEfetivado: soma(a.premioEfetivado, b.premioEfetivado),
    premioCotado: soma(a.premioCotado, b.premioCotado),
    itensCotados: soma(a.itensCotados, b.itensCotados),
    itensContratados: soma(a.itensContratados, b.itensContratados),
    efetivadosSemItensContratados: soma(a.efetivadosSemItensContratados, b.efetivadosSemItensContratados),
  };
}

function juntar(itens: { destino: Destino; item: ItemAgrupado }[]): ImobiliariaUnificada[] {
  const porDestino = new Map<string, ImobiliariaUnificada>();
  for (const { destino, item } of itens) {
    const atual = porDestino.get(destino.chave);
    porDestino.set(
      destino.chave,
      atual ? somar(atual, item) : { ...item, nome: destino.nome, semVinculo: destino.semVinculo || undefined }
    );
  }
  return [...porDestino.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
}

export function unificarImobiliarias(itens: ItemImobiliariaFonte[], resolvedor: Resolvedor): ImobiliariaUnificada[] {
  return juntar(itens.map((item) => ({ destino: resolvedor.porChave(item.chave, item.nome), item })));
}

// Retrato antigo (sem imobiliariasConsolidado): junta novos + renovações pelo
// nome da imobiliária -- usado só para a tendência do mês anterior.
export function unificarPorNome(listas: ItemAgrupado[][], resolvedor: Resolvedor): ImobiliariaUnificada[] {
  return juntar(listas.flat().map((item) => ({ destino: resolvedor.porNome(item.nome), item })));
}
