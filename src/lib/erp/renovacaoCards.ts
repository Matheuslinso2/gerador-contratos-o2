import type { SupabaseClient } from "@supabase/supabase-js";
import { listarItensSpaCategoria } from "@/lib/bitrix/client";

// ERP O2 — ligação entre a aba Renovação e os cards de renovação que já existem no Bitrix (Matheus 28/10/2026: é a mesma base).
// Funis lidos (SÓ LEITURA no Bitrix): Fiança SPA 1042 cat. 32 · Capitalização SPA 1048 cat. 38 · Ramos Elementares SPA 1046 cat. 34.
// A ligação é pelo Nº da apólice que está no card (campo próprio de cada funil; na Capitalização também o "CORP nnn" do título).
// O resultado vai para erp_renovacoes (bitrix_card_id = "<SPA>:<id do card>", status pela etapa do card).

export const FUNIS_RENOVACAO = [
  { entity: 1042, cat: 32, nome: "Seguro Fiança", produto: "fianca", camposApolice: ["ufCrm10_1790800677"], campoFim: "ufCrm10_1790800678", campoCorp: "ufCrm10_1778258392" },
  { entity: 1048, cat: 38, nome: "Capitalização", produto: "capitalizacao", camposApolice: ["ufCrm14_1792781102"], campoFim: "ufCrm14CapVigFim", campoCorp: "" },
  { entity: 1046, cat: 34, nome: "Ramos Elementares", produto: "re", camposApolice: ["ufCrm12NumApolice"], campoFim: "ufCrm12FimVigencia", campoCorp: "" },
] as const;

export type CardBitrix = { entity: number; id: number; titulo: string; etapa: string; funil: string; produto: string; apolices: string[]; corp: string[]; fim: string | null; nome: string };

const so1a9 = (t: string) => /[1-9]/.test(t);

export async function lerCardsRenovacao(): Promise<CardBitrix[]> {
  const out: CardBitrix[] = [];
  for (const f of FUNIS_RENOVACAO) {
    const itens = await listarItensSpaCategoria(f.entity, f.cat);
    for (const i of itens as unknown as Record<string, unknown>[]) {
      const apolices = new Set<string>();
      for (const c of f.camposApolice) String(i[c] ?? "").split(/[;,\s]+/).map((t) => t.trim()).filter((t) => t && so1a9(t)).forEach((t) => apolices.add(t));
      const titulo = String(i.title ?? "");
      const corp = [...titulo.matchAll(/CORP\s*(\d{4,})/gi)].map((m) => m[1]);
      const fimBruto = String(i[f.campoFim] ?? "");
      out.push({
        entity: f.entity, id: Number(i.id), titulo, etapa: String(i.stageId ?? ""), funil: f.nome, produto: f.produto,
        apolices: [...apolices], corp, fim: /^\d{4}-\d{2}-\d{2}/.test(fimBruto) ? fimBruto.slice(0, 10) : null, nome: titulo.split(" - ")[0].trim(),
      });
    }
  }
  return out;
}

/** etapa do card → status da renovação no ERP */
export function statusPelaEtapa(etapa: string): "a_renovar" | "em_cotacao" | "renovado" | "nao_renovado" {
  if (/:SUCCESS$/.test(etapa)) return "renovado";
  if (/:FAIL$|:APOLOGY$|:LOSE$/.test(etapa)) return "nao_renovado";
  if (/:NEW$/.test(etapa)) return "a_renovar";
  return "em_cotacao";
}

type DocMin = { cliente: string; id: string; nosso_numero_corp: number | null; numero_apolice: string | null; vigencia_fim: string | null; produto: string };
export type Ligacao = { documentoId: string; card: CardBitrix; via: "apolice" | "nosso_numero_corp" | "nome_e_fim" };

/** documentos vigentes (qualquer fim de vigência) do ERP, para casar com os cards */
export async function lerDocumentosParaLigar(sb: SupabaseClient, de?: string, ate?: string): Promise<DocMin[]> {
  const docs: DocMin[] = [];
  for (let a = 0; ; a += 1000) {
    let q = sb.from("erp_documentos").select("id, nosso_numero_corp, numero_apolice, vigencia_fim, ramo:erp_ramos(produto), loc:locatarios!erp_documentos_locatario_id_fkey(nome)")
      .eq("situacao", "vigente").neq("tipo", "F").or("tipo_corp.is.null,tipo_corp.neq.END").order("id").range(a, a + 999);
    if (de) q = q.gte("vigencia_fim", de);
    if (ate) q = q.lte("vigencia_fim", ate);
    const { data, error } = await q;
    if (error) throw new Error(`documentos: ${error.message}`);
    for (const d of (data ?? []) as unknown as (Omit<DocMin, "produto" | "cliente"> & { loc: { nome: string } | { nome: string }[] | null; ramo: { produto: string } | { produto: string }[] | null })[]) {
      const r = Array.isArray(d.ramo) ? d.ramo[0] : d.ramo;
      const lo = Array.isArray(d.loc) ? d.loc[0] : d.loc;
      docs.push({ cliente: lo?.nome ?? "", id: d.id, nosso_numero_corp: d.nosso_numero_corp, numero_apolice: d.numero_apolice, vigencia_fim: d.vigencia_fim, produto: r?.produto ?? "" });
    }
    if (!data || data.length < 1000) break;
  }
  return docs;
}

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;

/** Casa cada card com o(s) documento(s) do ERP: Nº da apólice (mesmo produto do funil) e, na Capitalização, "CORP nnn" do título. Em empate, vale o fim de vigência mais próximo; card com fim >120 dias do documento é ignorado. */
export function casarCardsComDocumentos(cards: CardBitrix[], docs: DocMin[]): { ligacoes: Ligacao[]; cardsSemDocumento: CardBitrix[] } {
  const porApolice = new Map<string, DocMin[]>();
  const porCorp = new Map<string, DocMin>();
  for (const d of docs) {
    const k = (d.numero_apolice ?? "").trim();
    if (k && so1a9(k)) porApolice.set(k, [...(porApolice.get(k) ?? []), d]);
    if (d.nosso_numero_corp != null) porCorp.set(String(d.nosso_numero_corp), d);
  }
  const ligacoes: Ligacao[] = [];
  const semDoc: CardBitrix[] = [];
  const usados = new Set<string>(); // documento já ligado a um card mais recente não é ligado de novo
  for (const c of [...cards].sort((a, b) => b.id - a.id)) {
    const achados = new Map<string, { d: DocMin; via: Ligacao["via"] }>();
    for (const ap of c.apolices) for (const d of porApolice.get(ap) ?? []) {
      const mesmoProduto = c.produto === "re" ? !["fianca", "capitalizacao", "automovel"].includes(d.produto) : d.produto === c.produto;
      if (mesmoProduto) achados.set(d.id, { d, via: "apolice" });
    }
    for (const n of c.corp) { const d = porCorp.get(n); if (d) achados.set(d.id, { d, via: "nosso_numero_corp" }); }
    // Fiança sem Nº da apólice no card (lote de 23/10): fim da vigência anterior igual + nome do título contido no nome do cliente
    if (!achados.size && c.produto === "fianca" && c.fim) {
      const n = norm(c.nome);
      for (const d of docs) if (d.produto === "fianca" && d.vigencia_fim === c.fim && n.length >= 8 && (norm(d.cliente).includes(n) || (norm(d.cliente).length >= 8 && n.includes(norm(d.cliente))))) achados.set(d.id, { d, via: "nome_e_fim" });
    }
    let ok = [...achados.values()].filter(({ d }) => !(c.fim && d.vigencia_fim) || dias(c.fim, d.vigencia_fim) <= 120);
    // mesmo Nº de apólice em mais de um documento: fica o de fim de vigência mais próximo do card (não vale para lote RE, que tem várias apólices diferentes)
    if (c.apolices.length <= 1 && ok.length > 1 && c.fim) ok = [ok.sort((x, y) => dias(c.fim!, x.d.vigencia_fim ?? c.fim!) - dias(c.fim!, y.d.vigencia_fim ?? c.fim!))[0]];
    ok = ok.filter(({ d }) => !usados.has(d.id));
    if (!ok.length) { semDoc.push(c); continue; }
    for (const { d, via } of ok) { usados.add(d.id); ligacoes.push({ documentoId: d.id, card: c, via }); }
  }
  return { ligacoes, cardsSemDocumento: semDoc };
}

export const urlCard = (entity: number, id: number) => `https://o2seguros.bitrix24.com.br/crm/type/${entity}/details/${id}/`;
