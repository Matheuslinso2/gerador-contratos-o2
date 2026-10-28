import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chamarBitrix } from "./client";
import { buscarDocumentos, type DocumentoLista } from "@/lib/erp/documentos";

// Aba "Apólice-mãe" nos cards de ENDOSSO do Bitrix (pedido do Matheus,
// 28/10/2026): a pessoa busca a apólice na base do ERP (espelho do Corp) e
// vincula; o nº da apólice vai, no formato exato do Corp, para o campo que o
// card JÁ tem (sem campo novo -- decisão de 25/10) e o endosso fica ligado à
// apólice no ERP. Mostra vigentes e as vencidas dos últimos 12 meses
// (endosso de cancelamento costuma chegar depois do fim da vigência).

export type FunilEndosso = {
  entityTypeId: number;
  produto: string;
  categorias: number[];
  campoApolice: string; // campo do card que guarda o nº da apólice (ou do título, na Cap)
  rotuloCampo: string;
  produtosErp: (p: string | null) => boolean;
};

export const FUNIS_ENDOSSO: FunilEndosso[] = [
  {
    entityTypeId: 1042,
    produto: "Seguro Fiança",
    categorias: [42],
    campoApolice: "ufCrm10_1778258366",
    rotuloCampo: "Apólice",
    produtosErp: (p) => p === "fianca",
  },
  {
    entityTypeId: 1046,
    produto: "Ramos Elementares",
    categorias: [24],
    campoApolice: "ufCrm12NumApolice",
    rotuloCampo: "Número da apólice",
    produtosErp: (p) => !!p && !["fianca", "capitalizacao", "automovel"].includes(p),
  },
  {
    entityTypeId: 1048,
    produto: "Capitalização",
    categorias: [40],
    campoApolice: "ufCrm14_1792781102",
    rotuloCampo: "Proposta anterior (nº do título)",
    produtosErp: (p) => p === "capitalizacao",
  },
];

export const funilDaEntidade = (entityTypeId: number) => FUNIS_ENDOSSO.find((f) => f.entityTypeId === entityTypeId) ?? null;
export const chavePasseApoliceMae = (entityTypeId: number, cardId: number) => `apolice-mae:${entityTypeId}:${cardId}`;

export type CardEndosso = {
  id: number;
  titulo: string;
  categoriaId: number;
  ehEndosso: boolean;
  numeroAtual: string;
  companyId: number | null;
  imobiliariaId: string | null;
  imobiliariaNome: string | null;
};

export async function lerCardEndosso(sb: SupabaseClient, funil: FunilEndosso, cardId: number): Promise<CardEndosso> {
  const r = await chamarBitrix<{ result: { item: Record<string, unknown> } }>("crm.item.get", {
    entityTypeId: funil.entityTypeId,
    id: cardId,
  });
  const item = r.result.item;
  const categoriaId = Number(item.categoryId);
  const companyId = Number(item.companyId) || null;
  let imobiliariaId: string | null = null;
  let imobiliariaNome: string | null = null;
  if (companyId) {
    const { data } = await sb
      .from("imobiliaria_registros_fonte")
      .select("imobiliaria_id, imobiliarias(nome)")
      .eq("fonte", "bitrix_empresa")
      .eq("situacao", "confirmado")
      .eq("chave_externa", String(companyId))
      .limit(1)
      .maybeSingle();
    imobiliariaId = (data?.imobiliaria_id as string | undefined) ?? null;
    const imob = data?.imobiliarias as unknown as { nome: string } | { nome: string }[] | null;
    imobiliariaNome = (Array.isArray(imob) ? imob[0]?.nome : imob?.nome) ?? null;
  }
  return {
    id: cardId,
    titulo: String(item.title ?? ""),
    categoriaId,
    ehEndosso: funil.categorias.includes(categoriaId),
    numeroAtual: String(item[funil.campoApolice] ?? "").trim(),
    companyId,
    imobiliariaId,
    imobiliariaNome,
  };
}

const hojeMenos12Meses = () => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
};

export type FiltrosApoliceMae = { busca: string; imovel: string; soDaImobiliaria: boolean };

// Apólices (A) e faturas (F) do produto do funil, vigentes ou vencidas há até 12 meses.
export async function buscarApolicesMae(
  sb: SupabaseClient,
  funil: FunilEndosso,
  card: CardEndosso,
  f: FiltrosApoliceMae
): Promise<DocumentoLista[]> {
  const temFiltro = !!(f.busca.trim() || f.imovel.trim());
  if (!temFiltro && !(f.soDaImobiliaria && card.imobiliariaNome)) return [];
  // Card com mais de uma apólice no campo ("2166636/9791158"): busca cada número.
  const partes = f.busca.split(/s+es+|[/,;]/i).map((p) => p.trim()).filter(Boolean);
  if (partes.length > 1 && partes.every((p) => /^[d.-s]+$/.test(p))) {
    const listas = await Promise.all(partes.map((p) => buscarApolicesMae(sb, funil, card, { ...f, busca: p.replace(/D/g, "") })));
    const vistos = new Set<string>();
    return listas.flat().filter((d) => (vistos.has(d.id) ? false : (vistos.add(d.id), true)));
  }
  const { linhas } = await buscarDocumentos(sb, {
    busca: f.busca.trim(),
    imovel: f.imovel.trim() || undefined,
    imobiliaria: f.soDaImobiliaria && card.imobiliariaNome ? card.imobiliariaNome : undefined,
    produto: funil.entityTypeId === 1046 ? undefined : funil.entityTypeId === 1042 ? "fianca" : "capitalizacao",
    limite: 200,
  });
  const limite = hojeMenos12Meses();
  return linhas
    .filter((l) => (l.tipo === "A" || l.tipo === "F") && ["vigente", "vencido", "cancelado"].includes(l.situacao))
    .filter((l) => funil.produtosErp(l.produto))
    .filter((l) => !l.vigencia_fim || l.vigencia_fim >= limite)
    .sort((a, b) => (b.vigencia_fim ?? "").localeCompare(a.vigencia_fim ?? ""))
    .slice(0, 60);
}

/** Escrita no Bitrix pelo webhook de entrada (mesmo das integrações que atualizam cards). */
async function atualizarCard(entityTypeId: number, id: number, fields: Record<string, unknown>) {
  const base = process.env.BITRIX_WEBHOOK_URL;
  if (!base) throw new Error("BITRIX_WEBHOOK_URL não configurada");
  const resp = await fetch(`${base.endsWith("/") ? base : base + "/"}crm.item.update.json`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ entityTypeId, id, fields }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok || dados.error) throw new Error(dados.error_description || dados.error || `HTTP ${resp.status}`);
}

export async function vincularApoliceMae(
  sb: SupabaseClient,
  a: { funil: FunilEndosso; cardId: number; apoliceId: string; email: string }
): Promise<{ numero: string; endossoNoErp: boolean }> {
  const { data: apolice } = await sb
    .from("erp_documentos")
    .select("id, tipo, numero_apolice, nosso_numero")
    .eq("id", a.apoliceId)
    .maybeSingle();
  if (!apolice || !["A", "F"].includes(apolice.tipo)) throw new Error("Apólice não encontrada no ERP.");
  const numero = String(apolice.numero_apolice ?? "").trim();
  if (!numero) throw new Error("Essa apólice não tem nº no Corp; escolha outra ou fale com o Controle.");

  // 1) card: o nº no formato exato do Corp, no campo que o card já tem
  await atualizarCard(a.funil.entityTypeId, a.cardId, { [a.funil.campoApolice]: numero });

  // 2) ERP: liga o endosso que veio deste card (se já entrou no ERP) à apólice
  const { data: endosso } = await sb
    .from("erp_documentos")
    .select("id, documento_pai_id")
    .eq("origem", "bitrix")
    .eq("origem_ref", `${a.funil.entityTypeId}:${a.cardId}`)
    .maybeSingle();
  if (endosso && endosso.id !== apolice.id) {
    await sb.from("erp_documentos").update({ documento_pai_id: apolice.id }).eq("id", endosso.id);
    await sb.from("erp_documento_eventos").insert({
      documento_id: endosso.id,
      tipo: "vinculo_apolice",
      data: new Date().toISOString(),
      canal: "bitrix",
      usuario_email: a.email,
      detalhes: { codigo_o2_apolice: apolice.nosso_numero, numero_apolice: numero, anterior: endosso.documento_pai_id, origem: "aba Apólice-mãe do card" },
    });
  }
  return { numero, endossoNoErp: !!endosso };
}
