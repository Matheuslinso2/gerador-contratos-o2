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
      let fimBruto = String(i[f.campoFim] ?? "");
      // Capitalização: o fim do card é o da NOVA vigência (reaplicação); a data do vencimento que está sendo renovado é a do título ("VENCE dd/mm/aaaa")
      if (f.produto === "capitalizacao") { const m = titulo.match(/VENCE\s+(\d{2})\/(\d{2})\/(\d{4})/i); if (m) fimBruto = m[3] + "-" + m[2] + "-" + m[1]; }
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

type DocMin = { imob: string; seg: string; cliente: string; id: string; nosso_numero_corp: number | null; numero_apolice: string | null; vigencia_fim: string | null; produto: string };
export type Ligacao = { documentoId: string; card: CardBitrix; via: "apolice" | "nosso_numero_corp" | "nome_e_fim" | "apolice_parcial" | "imobiliaria_seguradora_mes" };

/** documentos vigentes (qualquer fim de vigência) do ERP, para casar com os cards */
export async function lerDocumentosParaLigar(sb: SupabaseClient, de?: string, ate?: string): Promise<DocMin[]> {
  const docs: DocMin[] = [];
  for (let a = 0; ; a += 1000) {
    let q = sb.from("erp_documentos").select("id, nosso_numero_corp, numero_apolice, vigencia_fim, ramo:erp_ramos(produto), loc:locatarios!erp_documentos_locatario_id_fkey(nome), imo:imobiliarias!erp_documentos_imobiliaria_principal_id_fkey(nome, apelido), sg:erp_seguradoras(abreviacao)")
      .neq("tipo", "F").or("tipo_corp.is.null,tipo_corp.neq.END").order("id").range(a, a + 999);
    if (de) q = q.gte("vigencia_fim", de);
    if (ate) q = q.lte("vigencia_fim", ate);
    const { data, error } = await q;
    if (error) throw new Error(`documentos: ${error.message}`);
    for (const d of (data ?? []) as unknown as (Omit<DocMin, "produto" | "cliente" | "imob" | "seg"> & { imo: { nome: string; apelido: string | null } | { nome: string; apelido: string | null }[] | null; sg: { abreviacao: string } | { abreviacao: string }[] | null; loc: { nome: string } | { nome: string }[] | null; ramo: { produto: string } | { produto: string }[] | null })[]) {
      const r = Array.isArray(d.ramo) ? d.ramo[0] : d.ramo;
      const lo = Array.isArray(d.loc) ? d.loc[0] : d.loc;
      const im = Array.isArray(d.imo) ? d.imo[0] : d.imo;
      const sg = Array.isArray(d.sg) ? d.sg[0] : d.sg;
      docs.push({ imob: [im?.nome, im?.apelido].filter(Boolean).join(" | "), seg: sg?.abreviacao ?? "", cliente: lo?.nome ?? "", id: d.id, nosso_numero_corp: d.nosso_numero_corp, numero_apolice: d.numero_apolice, vigencia_fim: d.vigencia_fim, produto: r?.produto ?? "" });
    }
    if (!data || data.length < 1000) break;
  }
  return docs;
}

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const mesmoProdutoDoFunil = (c: CardBitrix, d: DocMin) => (c.produto === "re" ? !["fianca", "capitalizacao", "automovel"].includes(d.produto) : d.produto === c.produto);
const SEG_TITULO: [RegExp, string][] = [[/TOKIO/, "TOKI"], [/YELL?UM/, "YELU"], [/PORTO/, "PORT"], [/ALLIANZ/, "ALLI"], [/ZURICH/, "ZURI"], [/SULAMERICA/, "SULA"], [/ALFA/, "ALF"], [/BRADESCO/, "BRAD"]];
/** título tipo "RENOVAÇÃO [RAMO] - IMOBILIÁRIA - [SEG/]SEGURADORA - MM.AAAA": o documento é do lote? */
export function loteDoTitulo(c: CardBitrix, d: DocMin): boolean {
  if (!mesmoProdutoDoFunil(c, d) || !d.vigencia_fim) return false;
  const t = norm(c.titulo);
  const m = c.titulo.match(/(\d{2})\.(\d{4})/);
  if (!m || d.vigencia_fim.slice(0, 7) !== m[2] + "-" + m[1]) return false;
  const seg = SEG_TITULO.find(([r]) => r.test(t))?.[1];
  if (seg && !d.seg.startsWith(seg)) return false;
  const partes = c.titulo.replace(/^RENOVA[^-]*-\s*/i, "").replace(/\s*-\s*\d{2}\.\d{4}.*$/, "").split(/\s+-\s+/).map(norm)
    .filter((p) => p.length >= 5 && !SEG_TITULO.some(([r]) => r.test(p)) && !/SEM PARCERIA|^SEG /.test(p));
  // o nome do título pode ser mais longo ("RIO CAPITAL IMOBILIARIA") ou mais curto que o da ficha ("RIO CAPITAL"): vale a inclusão nos dois sentidos
  const alvos = [...d.imob.split(" | "), d.cliente].map(norm).filter((a) => a.length >= 5);
  return partes.some((p) => alvos.some((a) => a.includes(p) || p.includes(a)));
}
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
    // Nº da apólice com pontuação/prefixo (Porto "0746.86.26.405-9", Pottencial "0306920249907460392298000" = prefixo + nº do ERP): compara só os dígitos, pelo final
    if (!achados.size && c.apolices.length) {
      // Porto formatada "0746.86.26.405-9" = prefixo do ramo + "26405" + dígito → no ERP vira "264059"; sem pontuação tiramos o prefixo "074686"
      const dg = c.apolices.flatMap((a) => { const dig = a.replace(/\D/g, ""); return /^0?746\.86\./.test(a) ? [dig, dig.replace(/^0?74686/, "")] : [dig]; }).filter((a) => a.length >= 5);
      for (const d of docs) {
        const dd = (d.numero_apolice ?? "").replace(/\D/g, "");
        if (dd.length < 5 || !mesmoProdutoDoFunil(c, d)) continue;
        if (dg.some((a) => a === dd || (dd.length >= 7 && a.length > dd.length && (a.endsWith(dd) || (dd.length >= 8 && a.includes(dd)))))) achados.set(d.id, { d, via: "apolice_parcial" });
      }
    }
    // Ramos Elementares sem Nº da apólice no card (lotes manuais): imobiliária (ou cliente) do título + seguradora do título + mês do título
    if (!achados.size && c.produto === "re" && !c.apolices.length) for (const d of docs) if (loteDoTitulo(c, d)) achados.set(d.id, { d, via: "imobiliaria_seguradora_mes" });
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
