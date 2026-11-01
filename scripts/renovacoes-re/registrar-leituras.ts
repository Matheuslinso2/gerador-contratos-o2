// Registra TODA a informação lida na renovação (princípio do Matheus, 01/11/2026): cards do Bitrix (F8, nível 6) e relatório de Renovações do Corp (F10, nível 8),
// estruturados, com fonte, nível do guia, data de leitura e lote. Também completa erp_renovacoes com os campos do card. Bitrix e Corp: só leitura.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/renovacoes-re/registrar-leituras.ts [--mes 2027-01] [--gravar]
//      ... --desfazer <lote_id>   apaga as leituras do lote e zera os campos do card em erp_renovacoes desse lote
process.loadEnvFile(".env.local");
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { casarCardsComDocumentos, lerCardsRenovacao, lerDocumentosParaLigar, type CardBitrix } from "@/lib/erp/renovacaoCards";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const mes = arg("mes") ?? "2027-01";
const LOTE_DESFAZER = arg("desfazer");
const lotes = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

/** só campos com valor, textos longos cortados (nada de chat/e-mail bruto) */
function limpar(o: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length)) continue;
    r[k] = typeof v === "string" && v.length > 400 ? v.slice(0, 400) + "…" : v;
  }
  return r;
}
const dia = (s: unknown) => (/^\d{4}-\d{2}-\d{2}/.test(String(s ?? "")) ? String(s).slice(0, 10) : null);

(async () => {
  if (LOTE_DESFAZER) {
    await sb.from("erp_renovacao_leituras").delete().eq("lote_id", LOTE_DESFAZER);
    await sb.from("erp_renovacoes").update({ lote_id: null, card_titulo: null, card_etapa: null, card_fim_anterior: null, card_apolices: null, card_responsavel_id: null, card_criado_em: null, card_atualizado_em: null, card_ligado_via: null, fonte: null, fonte_nivel: null, lido_em: null }).eq("lote_id", LOTE_DESFAZER);
    console.log("lote desfeito:", LOTE_DESFAZER);
    return;
  }
  const lote = randomUUID();
  const lidoEm = new Date().toISOString();
  const cards = await lerCardsRenovacao();
  const docs = await lerDocumentosParaLigar(sb);
  const { ligacoes } = casarCardsComDocumentos(cards, docs);
  const docDoCard = new Map<number, string>(); // card.id (por SPA) → 1º documento
  const cardKey = (c: CardBitrix) => `${c.entity}:${c.id}`;
  const porCard = new Map<string, string[]>();
  for (const l of ligacoes) porCard.set(cardKey(l.card), [...(porCard.get(cardKey(l.card)) ?? []), l.documentoId]);
  void docDoCard;

  // 1) leituras dos cards
  const leiturasCards = cards.map((c) => ({
    lote_id: lote, entidade: "card_bitrix", chave: cardKey(c), documento_id: porCard.get(cardKey(c))?.[0] ?? null,
    fonte: "F8", fonte_nivel: 6, fonte_detalhe: `${c.funil} (SPA ${c.entity}) · crm.item.list`, lido_em: lidoEm,
    dados: { ...limpar(c.bruto), _apolices_no_card: c.apolices, _nosso_n_corp_no_card: c.corp, _documentos_ligados: porCard.get(cardKey(c)) ?? [] },
  }));

  // 2) leituras do relatório de Renovações do Corp (Simplificado c/ Produtor + Simplificado, todas as colunas)
  const base = `../renovacoes-re/corp-${mes}`;
  const ler = (f: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.readFile(`${base}/${f}`).Sheets[XLSX.readFile(`${base}/${f}`).SheetNames[0]], { defval: "" });
  const prod = ler(`jan${mes.slice(0, 4) === "2027" ? "2027" : mes} - Simplificado com Produtor.xlsx`);
  const simp = new Map(ler(`jan${mes.slice(0, 4) === "2027" ? "2027" : mes} - Simplificado.xlsx`).map((r) => [String(r["Nosso Nº"]), r]));
  const nossos = prod.map((r) => Number(r["Nosso Nº"]));
  const docPorNosso = new Map<number, string>();
  for (const l of lotes(nossos, 150)) {
    const { data } = await sb.from("erp_documentos").select("id,nosso_numero_corp,tipo").in("nosso_numero_corp", l).neq("tipo", "F");
    for (const d of data ?? []) if (!docPorNosso.has(d.nosso_numero_corp)) docPorNosso.set(d.nosso_numero_corp, d.id);
  }
  const leiturasCorp = prod.map((r) => ({
    lote_id: lote, entidade: "corp_renovacao_linha", chave: String(r["Nosso Nº"]), documento_id: docPorNosso.get(Number(r["Nosso Nº"])) ?? null,
    fonte: "F10", fonte_nivel: 8, fonte_detalhe: `Corp · Documentos → Renovações · fim de vigência ${mes} · modelos Simplificado c/ Produtor + Simplificado`, lido_em: lidoEm,
    dados: { simplificado_com_produtor: limpar(r), simplificado: limpar(simp.get(String(r["Nosso Nº"])) ?? {}) },
  }));

  console.log(`lote ${lote}: ${leiturasCards.length} cards (F8) + ${leiturasCorp.length} linhas do Corp (F10) · ${ligacoes.length} ligações a completar em erp_renovacoes`);
  if (!GRAVAR) return;

  for (const l of lotes([...leiturasCards, ...leiturasCorp], 200)) {
    const { error } = await sb.from("erp_renovacao_leituras").insert(l);
    if (error) throw new Error(error.message);
  }
  // 3) completa erp_renovacoes com os campos do card
  let ok = 0;
  for (const l of ligacoes) {
    const b = l.card.bruto as Record<string, unknown>;
    const { error } = await sb.from("erp_renovacoes").update({
      lote_id: lote, card_titulo: l.card.titulo, card_etapa: l.card.etapa, card_fim_anterior: l.card.fim, card_apolices: l.card.apolices.length ? l.card.apolices : null,
      card_responsavel_id: Number(b.assignedById) || null, card_criado_em: b.createdTime ? new Date(String(b.createdTime)).toISOString() : null,
      card_atualizado_em: b.updatedTime ? new Date(String(b.updatedTime)).toISOString() : null, card_ligado_via: l.via, fonte: "F8", fonte_nivel: 6, lido_em: lidoEm,
    }).eq("documento_id", l.documentoId);
    if (error) console.log("erro", error.message); else ok++;
  }
  // 4) chaves do ERP em cada leitura (documento novo, cliente, seguradora, imobiliária); sem vínculo = pendente + motivo
  const { data: resumoVinculo, error: eV } = await sb.rpc("erp_vincular_leituras_renovacao", { p_lote: lote });
  console.log("vínculo com o ERP:", eV ? eV.message : JSON.stringify(resumoVinculo));
  fs.writeFileSync(`../renovacoes-re/corp-${mes}/ultimo-lote-leituras.txt`, lote + "\n");
  console.log(`gravado: ${leiturasCards.length + leiturasCorp.length} leituras; ${ok} linhas de erp_renovacoes completadas. Desfazer: --desfazer ${lote}`);
  void dia;
})();
