import type { SupabaseClient } from "@supabase/supabase-js";

// ERP O2 — integração com o Nibo (gestão financeira), SÓ LEITURA (doc: https://nibo.readme.io/reference/como-utilizar-a-api).
// Token por empresa do Nibo, guardado só na Vercel (nunca no código nem no chat):
//   NIBO_API_TOKEN      → O2 Corretora (padrão)
//   NIBO_API_TOKEN_CAP  → O2 Capitalização (se for uma empresa separada no Nibo)
// API em OData: $filter, $orderby (obrigatório p/ paginar), $skip, $top (máx. 500 por chamada).
const BASE = "https://api.nibo.com.br/empresas/v1";

export type EmpresaNibo = { empresa: "corretora" | "capitalizacao"; token: string };

export function empresasNibo(): EmpresaNibo[] {
  const lista: EmpresaNibo[] = [];
  if (process.env.NIBO_API_TOKEN) lista.push({ empresa: "corretora", token: process.env.NIBO_API_TOKEN });
  if (process.env.NIBO_API_TOKEN_CAP) lista.push({ empresa: "capitalizacao", token: process.env.NIBO_API_TOKEN_CAP });
  return lista;
}

async function niboGet<T>(token: string, caminho: string, params: Record<string, string> = {}): Promise<{ items: T[]; count?: number }> {
  const url = new URL(BASE + caminho);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { ApiToken: token, Accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`Nibo ${caminho}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  if (r.status === 204) return { items: [] };
  return (await r.json()) as { items: T[]; count?: number };
}

/** Busca páginas ordenadas por data decrescente até passar de `desde` (evita depender da sintaxe de data do $filter). */
async function listarDesde<T extends { date?: string }>(token: string, caminho: string, desde: string, maxPaginas = 40): Promise<T[]> {
  const todos: T[] = [];
  for (let p = 0; p < maxPaginas; p++) {
    const { items } = await niboGet<T>(token, caminho, { $orderby: "date desc", $top: "500", $skip: String(p * 500) });
    todos.push(...items);
    const ultimo = items.at(-1)?.date?.slice(0, 10);
    if (items.length < 500 || (ultimo && ultimo < desde)) break;
  }
  return todos.filter((i) => (i.date ?? "").slice(0, 10) >= desde);
}

type Conta = { id: string; name: string; type: string; bankNumber?: string; bankAgency?: string; bankAccount?: string; isArchived?: boolean };
type Lanc = {
  entryId: string;
  scheduleId?: string;
  account?: { id: string; name: string };
  stakeholder?: { id: string; name: string };
  category?: { name?: string };
  categories?: { categoryName?: string; value?: number }[];
  date?: string;
  accrualDate?: string;
  value: number;
  description?: string;
  reference?: string;
  identifier?: string;
  isReconciliated?: boolean;
};

const dia = (v?: string) => (v ? v.slice(0, 10) : null);

/** Sincroniza contas, recebimentos e pagamentos realizados desde `desde` (AAAA-MM-DD) de cada empresa configurada. */
export async function sincronizarNibo(sb: SupabaseClient, o: { desde: string }) {
  const empresas = empresasNibo();
  if (!empresas.length) return { ok: false, erro: "NIBO_API_TOKEN não configurado na Vercel" };
  const resumo: Record<string, { contas: number; recebimentos: number; pagamentos: number; erros: string[] }> = {};
  for (const { empresa, token } of empresas) {
    const erros: string[] = [];
    const { items: contas } = await niboGet<Conta>(token, "/accounts", { $orderby: "name", $top: "500" }).catch((e) => { erros.push((e as Error).message); return { items: [] as Conta[] }; });
    if (contas.length) {
      const { error } = await sb.from("erp_nibo_contas").upsert(
        contas.map((c) => ({ id: c.id, empresa, nome: c.name, tipo: c.type, banco: c.bankNumber ?? null, agencia: c.bankAgency ?? null, conta: c.bankAccount ?? null, arquivada: !!c.isArchived, sincronizado_em: new Date().toISOString() }))
      );
      if (error) throw new Error(`erp_nibo_contas: ${error.message}`);
    }
    const r = { contas: contas.length, recebimentos: 0, pagamentos: 0, erros };
    for (const [tipo, caminho] of [["recebimento", "/receipts"], ["pagamento", "/payments"]] as const) {
      // um erro numa rota não impede a outra nem a outra empresa
      const itens = await listarDesde<Lanc>(token, caminho, o.desde).catch((e) => { erros.push((e as Error).message); return [] as Lanc[]; });
      const linhas = itens.map((l) => ({
        entry_id: l.entryId,
        empresa,
        tipo,
        conta_id: l.account?.id ?? null,
        conta_nome: l.account?.name ?? null,
        stakeholder_id: l.stakeholder?.id ?? null,
        stakeholder_nome: l.stakeholder?.name ?? null,
        categoria: l.category?.name ?? l.categories?.[0]?.categoryName ?? null,
        categorias: l.categories ?? null,
        data: dia(l.date),
        competencia: dia(l.accrualDate),
        valor: Math.abs(Number(l.value ?? 0)),
        descricao: l.description ?? null,
        referencia: l.reference ?? null,
        identificador: l.identifier ?? null,
        conciliado: l.isReconciliated ?? null,
        schedule_id: l.scheduleId ?? null,
        sincronizado_em: new Date().toISOString(),
      }));
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await sb.from("erp_nibo_lancamentos").upsert(linhas.slice(i, i + 500), { onConflict: "entry_id" });
        if (error) throw new Error(`erp_nibo_lancamentos: ${error.message}`);
      }
      r[tipo === "recebimento" ? "recebimentos" : "pagamentos"] = linhas.length;
    }
    resumo[empresa] = r;
  }
  return { ok: true, desde: o.desde, resumo };
}
