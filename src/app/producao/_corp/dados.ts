import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { lista } from "./comum";
import type { CampoFiltro } from "./FiltrosCorp";

export type Opcoes = {
  seguradoras: string[];
  grupos: string[];
  ramos: string[];
  centralizadores: string[];
  produtores: string[];
  origens: string[];
  ramos_flash: string[];
  meses: string[];
  situacoes: { codigo: string; descricao: string }[];
  importado_em: string | null;
  arquivo_modificado_em: string | null;
};

export async function abrirPainel() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  const pronto = await lerPronto(supabase, "opcoes");
  if (pronto) return { supabase, user, opcoes: pronto as Opcoes };
  const { data, error } = await supabase.rpc("corp_opcoes_filtro");
  if (error) throw new Error(`não foi possível ler as opções do painel: ${error.message}`);
  return { supabase, user, opcoes: data as Opcoes };
}

type Cliente = Awaited<ReturnType<typeof createClient>>;

// Tela pronta (gerada a cada importação em corp_painel_pronto): sem filtro, o
// site só lê uma linha em vez de calcular. null = ainda não gerada.
export async function lerPronto(supabase: Cliente, chave: string): Promise<unknown | null> {
  const { data } = await supabase.from("corp_painel_pronto").select("dados").eq("chave", chave).maybeSingle();
  return data?.dados ?? null;
}

// Usa a tela pronta quando não há filtro; senão (ou se faltar) calcula na hora.
export async function prontoOuCalcula<T>(
  supabase: Cliente,
  chave: string | null,
  calcular: () => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ data: T | null; error: { message: string } | null }> {
  if (chave) {
    const p = await lerPronto(supabase, chave);
    if (p) return { data: p as T, error: null };
  }
  const r = await calcular();
  return { data: (r.data as T) ?? null, error: r.error };
}

const TIPOS = [
  { valor: "RENV", rotulo: "Renovado" },
  { valor: "NOVO", rotulo: "Novo" },
  { valor: "FAT", rotulo: "Faturado" },
  { valor: "END", rotulo: "Endosso" },
  { valor: "CANC", rotulo: "Cancelado" },
];
export const ROTULO_TIPO: Record<string, string> = Object.fromEntries(TIPOS.map((t) => [t.valor, t.rotulo.toUpperCase()]));
export const ROTULO_CANCELADO: Record<string, string> = { F: "VIGENTE", T: "CANCELADO" };

const op = (v: string[]) => v.map((x) => ({ valor: x, rotulo: x }));

// Campos de filtro da produção (mesmos segmentadores do Power BI).
export function camposProducao(o: Opcoes): CampoFiltro[] {
  return [
    { chave: "seg", rotulo: "Seguradora", opcoes: op(o.seguradoras ?? []) },
    { chave: "grupo", rotulo: "Grupo de ramo", opcoes: op(o.grupos ?? []) },
    { chave: "ramo", rotulo: "Ramo", opcoes: op(o.ramos ?? []) },
    { chave: "central", rotulo: "Centralizador", opcoes: op(o.centralizadores ?? []) },
    { chave: "produtor", rotulo: "Produtor", opcoes: op(o.produtores ?? []) },
    { chave: "origem", rotulo: "Origem", opcoes: op(o.origens ?? []) },
    { chave: "tipo", rotulo: "Tipo de operação", opcoes: TIPOS },
    { chave: "canc", rotulo: "Situação", opcoes: [{ valor: "F", rotulo: "Vigente" }, { valor: "T", rotulo: "Cancelado" }] },
  ];
}

// Parâmetros da RPC a partir da URL (null = sem filtro).
export function filtrosProducao(sp: Record<string, string | undefined>) {
  const v = (k: string) => {
    const l = lista(sp[k]);
    return l.length ? l : null;
  };
  return {
    p_seg: v("seg"),
    p_grupo: v("grupo"),
    p_ramo: v("ramo"),
    p_central: v("central"),
    p_produtor: v("produtor"),
    p_origem: v("origem"),
    p_tipo: v("tipo"),
    p_cancelado: v("canc"),
  };
}

export const temFiltro = (f: Record<string, unknown>) => Object.values(f).some((v) => v !== null);
