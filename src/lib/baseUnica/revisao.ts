import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Leitura da Base Única para a revisão uma a uma (Fase 2), dentro de
// "Imobiliárias cadastradas" (/admin/imobiliarias). O cadastro continua
// sendo só a tabela `imobiliarias`; `imobiliaria_registros_fonte` é o
// "arquivo de provas" de cada ficha (como cada fonte escreve o nome e os
// contatos dela). Ver base-unica-imobiliarias/Desenho-Base-Unica-Imobiliarias.pdf.

export const FONTES_PRODUCAO = ["planilha_fianca", "planilha_re", "planilha_cap", "bitrix_empresa", "bitrix_cap_texto"] as const;

export const ROTULO_FONTE: Record<string, string> = {
  planilha_fianca: "Planilha Fiança",
  planilha_re: "Planilha RE",
  planilha_cap: "Planilha Capitalização",
  bitrix_empresa: "Bitrix (Empresa)",
  bitrix_cap_texto: "Bitrix Capitalização",
  corp_produtor: "Corp",
  receita_cnpj: "Receita (CNPJ)",
  imobiliarias_conhecidas: "Imobiliárias conhecidas",
  email: "E-mail",
};

export const ROTULO_METODO: Record<string, string> = {
  cnpj: "mesmo CNPJ",
  codigo_corp: "mesmo código Corp",
  email_exato: "mesmo e-mail",
  email_varios: "e-mail usado por mais de uma ficha",
  nome_exato: "nome igual",
  nome_parecido: "nome parecido",
  manual: "ligado à mão",
};

export type Sugestao = { imobiliaria_id: string; motivo: string; score: number };

export type RegistroFonte = {
  id: string;
  fonte: string;
  chave_externa: string;
  nome_original: string | null;
  dados: Record<string, unknown>;
  volume: number;
  anos: number[];
  imobiliaria_id: string | null;
  situacao: "a_identificar" | "sugerido" | "confirmado" | "rejeitado" | "ignorar";
  metodo_vinculo: string | null;
  sugestoes: Sugestao[];
  confirmado_por_email: string | null;
  confirmado_em: string | null;
};

const COLUNAS =
  "id, fonte, chave_externa, nome_original, dados, volume, anos, imobiliaria_id, situacao, metodo_vinculo, sugestoes, confirmado_por_email, confirmado_em";

export async function buscarFontesDaFicha(supabase: SupabaseClient, imobiliariaId: string) {
  const [{ data: ligados }, { data: sugeridos }] = await Promise.all([
    supabase.from("imobiliaria_registros_fonte").select(COLUNAS).eq("imobiliaria_id", imobiliariaId)
      .eq("situacao", "confirmado").order("volume", { ascending: false }),
    supabase.from("imobiliaria_registros_fonte").select(COLUNAS).eq("situacao", "sugerido")
      .filter("sugestoes", "cs", JSON.stringify([{ imobiliaria_id: imobiliariaId }])).order("volume", { ascending: false }),
  ]);
  return { ligados: (ligados ?? []) as RegistroFonte[], sugeridos: (sugeridos ?? []) as RegistroFonte[] };
}

// Busca manual de nomes ainda sem dono (para "ligar outro nome a esta ficha").
export async function buscarNomesSoltos(supabase: SupabaseClient, termo: string) {
  const t = termo.trim();
  if (t.length < 2) return [] as RegistroFonte[];
  const { data } = await supabase.from("imobiliaria_registros_fonte").select(COLUNAS)
    .in("situacao", ["a_identificar", "sugerido"]).ilike("nome_original", `%${t.replace(/[%_]/g, "")}%`)
    .order("volume", { ascending: false }).limit(30);
  return (data ?? []) as RegistroFonte[];
}

// Nomes de produção sem nenhum candidato, maiores primeiro.
export async function buscarNomesSemImobiliaria(supabase: SupabaseClient, limite = 40) {
  const { data, count } = await supabase.from("imobiliaria_registros_fonte").select(COLUNAS, { count: "exact" })
    .eq("situacao", "a_identificar").in("fonte", [...FONTES_PRODUCAO])
    .order("volume", { ascending: false }).limit(limite);
  return { nomes: (data ?? []) as RegistroFonte[], total: count ?? 0 };
}

// Volume de produção por ficha (confirmado e sugerido), para ordenar a fila
// de revisão. Só fontes de produção (planilhas + Bitrix).
export async function volumePorFicha(supabase: SupabaseClient) {
  const confirmado = new Map<string, number>();
  const sugerido = new Map<string, number>();
  for (let ini = 0; ; ini += 1000) {
    const { data } = await supabase.from("imobiliaria_registros_fonte")
      .select("imobiliaria_id, situacao, sugestoes, volume")
      .in("fonte", [...FONTES_PRODUCAO]).in("situacao", ["confirmado", "sugerido"]).range(ini, ini + 999);
    for (const r of data ?? []) {
      if (r.situacao === "confirmado" && r.imobiliaria_id) {
        confirmado.set(r.imobiliaria_id, (confirmado.get(r.imobiliaria_id) ?? 0) + r.volume);
      } else {
        for (const s of (r.sugestoes ?? []) as Sugestao[]) {
          sugerido.set(s.imobiliaria_id, (sugerido.get(s.imobiliaria_id) ?? 0) + r.volume);
        }
      }
    }
    if (!data || data.length < 1000) break;
  }
  return { confirmado, sugerido };
}

// Dados de contato que as fontes JÁ LIGADAS trazem, para o "usar na ficha".
export type DadoDeFonte = { campo: "telefone" | "endereco" | "cidade" | "uf" | "bairro"; valor: string; origem: string };

export function dadosDasFontes(ligados: RegistroFonte[]): DadoDeFonte[] {
  const vistos = new Set<string>();
  const out: DadoDeFonte[] = [];
  const add = (campo: DadoDeFonte["campo"], valor: unknown, origem: string) => {
    const v = String(valor ?? "").replace(/\s+/g, " ").trim();
    if (!v || v === "0") return;
    const k = `${campo}|${v.toLowerCase()}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    out.push({ campo, valor: v, origem });
  };
  for (const r of ligados) {
    const d = r.dados as Record<string, unknown>;
    const origem = `${ROTULO_FONTE[r.fonte] ?? r.fonte}${r.nome_original ? ` — ${r.nome_original}` : ""}`;
    for (const t of (d.telefones as string[] | undefined) ?? []) add("telefone", t, origem);
    add("endereco", d.endereco, origem);
    add("bairro", d.bairro, origem);
    add("cidade", d.cidade, origem);
    add("uf", d.uf, origem);
  }
  return out;
}
