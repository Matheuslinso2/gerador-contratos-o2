import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chamarBitrix } from "@/lib/bitrix/client";
import type { Oportunidade } from "./desempenho";

// Nome do pretendente nas oportunidades em aberto (27/10/2026). No Bitrix o
// nome do pretendente é o TÍTULO do card (Fiança 1042, Capitalização 1048,
// Ramos Elementares 1046); nas planilhas de Fiança vem de locatarios.nome,
// pelo locatario_id. Sem fonte confiável o campo fica null ("—" na tela):
// nunca se inventa nome. Falha em qualquer fonte não derruba o quadro.

const ENTIDADE_BITRIX: Record<string, number> = { fianca: 1042, capitalizacao: 1048, re: 1046 };
const LOTE = 50;

async function titulosBitrix(entidade: number, ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  for (let i = 0; i < ids.length; i += LOTE) {
    const lote = ids.slice(i, i + LOTE);
    const resposta = await chamarBitrix<{ result: { items: { id: number | string; title: string | null }[] } }>("crm.item.list", {
      entityTypeId: entidade,
      "select": ["id", "title"],
      "filter[@id]": lote,
    });
    for (const item of resposta.result?.items ?? []) if (item.title) mapa.set(String(item.id), String(item.title).trim());
  }
  return mapa;
}

export async function resolverPretendentes(db: SupabaseClient, oportunidades: Oportunidade[]): Promise<void> {
  const porEntidade = new Map<number, Set<string>>();
  const locatarios = new Set<string>();
  for (const o of oportunidades) {
    const ref = o.ref;
    if (!ref) continue;
    if (ref.fonte === "bitrix" && ref.bitrixId) {
      const entidade = ENTIDADE_BITRIX[o.produto];
      if (entidade) porEntidade.set(entidade, (porEntidade.get(entidade) ?? new Set()).add(ref.bitrixId));
    } else if (ref.locatarioId) {
      locatarios.add(ref.locatarioId);
    }
  }

  const titulos = new Map<string, string>(); // `${entidade}:${id}` -> título
  await Promise.all(
    [...porEntidade].map(async ([entidade, ids]) => {
      try {
        const mapa = await titulosBitrix(entidade, [...ids]);
        for (const [id, titulo] of mapa) titulos.set(`${entidade}:${id}`, titulo);
      } catch {
        // Bitrix indisponível: fica sem nome, o link do card continua.
      }
    })
  );

  const nomesLocatario = new Map<string, string>();
  if (locatarios.size) {
    try {
      const ids = [...locatarios];
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await db.from("locatarios").select("id, nome").in("id", ids.slice(i, i + 200));
        for (const l of (data ?? []) as { id: string; nome: string | null }[]) if (l.nome) nomesLocatario.set(l.id, l.nome.trim());
      }
    } catch {
      // sem nome
    }
  }

  // Etapa do título de Capitalização solicitado (Proposta, Liberado para cadastro...), da base única.
  const etapasCap = new Map<string, string>();
  const idsCap = [...new Set(oportunidades.filter((o) => o.produto === "capitalizacao" && o.ref?.fonte === "bitrix" && o.ref.bitrixId).map((o) => o.ref!.bitrixId!))];
  for (let i = 0; i < idsCap.length; i += 200) {
    try {
      const { data } = await db
        .from("producao_unificada")
        .select("origem_bitrix_id, status_original")
        .eq("fonte", "bitrix")
        .eq("produto", "capitalizacao")
        .in("origem_bitrix_id", idsCap.slice(i, i + 200));
      for (const r of (data ?? []) as { origem_bitrix_id: string; status_original: string | null }[]) if (r.status_original) etapasCap.set(r.origem_bitrix_id, r.status_original);
    } catch {
      // sem a etapa: a oportunidade aparece só como "Solicitado"
    }
  }

  for (const o of oportunidades) {
    const ref = o.ref;
    if (o.produto === "capitalizacao" && ref?.bitrixId) o.etapa = etapasCap.get(ref.bitrixId) ?? null;
    if (ref) {
      if (ref.fonte === "bitrix" && ref.bitrixId) o.pretendente = titulos.get(`${ENTIDADE_BITRIX[o.produto]}:${ref.bitrixId}`) ?? null;
      else if (ref.locatarioId) o.pretendente = nomesLocatario.get(ref.locatarioId) ?? null;
    }
    delete o.ref;
  }
}

// Data em que a cotação foi APROVADA (03/11/2026), quando a fonte guarda: só a
// Fiança do Bitrix (producao_unificada.extras.data_aprovacao). Capitalização e as
// planilhas não têm essa data: ficam null ("não disponível"), nunca estimadas.
// Rodar ANTES de resolverPretendentes (que descarta `ref`).
export async function resolverAprovacoes(db: SupabaseClient, oportunidades: Oportunidade[]): Promise<void> {
  const ids = [...new Set(oportunidades.filter((o) => o.produto === "fianca" && o.ref?.fonte === "bitrix" && o.ref.bitrixId).map((o) => o.ref!.bitrixId!))];
  const datas = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    try {
      const { data } = await db
        .from("producao_unificada")
        .select("origem_bitrix_id, extras")
        .eq("fonte", "bitrix")
        .eq("produto", "fianca")
        .in("origem_bitrix_id", ids.slice(i, i + 200));
      for (const r of (data ?? []) as { origem_bitrix_id: string; extras: { data_aprovacao?: string | null } | null }[]) {
        const d = String(r.extras?.data_aprovacao ?? "").slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) datas.set(r.origem_bitrix_id, d);
      }
    } catch {
      // sem a data: segue "não disponível"
    }
  }
  for (const o of oportunidades) {
    o.aprovadaEm = o.produto === "fianca" && o.ref?.bitrixId ? (datas.get(o.ref.bitrixId) ?? null) : null;
  }
}
