// Liga cada LOTE de renovação (proposta criada do card, SPA 1046) às APÓLICES ANTERIORES, item a item (pedido do Matheus, 03/11/2026).
// Fonte dos itens: planilha da equipe "COTAÇÃO DIÁRIA RE" (Drive, abas RN OUTUBRO e RN NOVEMBRO) — uma linha por apólice anterior (F9, pista).
// Prova: o Nº da apólice da linha existe no ERP com a MESMA seguradora, fim de vigência (±3 dias) e (quando houver) o mesmo CPF; e a imobiliária + seguradora + mês do lote batem.
//   confirmado = linha da planilha achada no ERP e dentro de um único lote  |  sugestão = só imobiliária+seguradora+mês (sem linha na planilha)  |  sem par = linha sem apólice no ERP ou sem lote.
// Bitrix/Drive/Corp: só leitura. Sem --gravar só conta e escreve o CSV.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/renovacoes-re/ligar-lotes-itens.ts [--gravar] [--desfazer <lote_carga>]
process.loadEnvFile(".env.local");
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import { drive as criarDrive } from "@googleapis/drive";
import { obterAutenticacaoGoogle } from "@/lib/googleAuth";
import { lerCardsRenovacao, statusPelaEtapa } from "@/lib/erp/renovacaoCards";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const PLANILHA = "1wDXR5jW0oyQjR0BRMXaRlMOBvhPR3UkjCzE68cCYVHg"; // "10 OUTUBRO /2026- COTAÇÃO DIÁRIA RE"
const ABAS = ["RN OUTUBRO", "RN NOVEMBRO"];
const SAIDA = path.resolve(process.cwd(), "..", "renovacoes-re", "lotes-itens");
const lotes = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
const iso = (serial: unknown) => (typeof serial === "number" && serial > 40000 ? new Date(Date.UTC(1899, 11, 30) + serial * 864e5).toISOString().slice(0, 10) : null);
const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
const seg3 = (s: string | null | undefined) => (s ?? "").toUpperCase().slice(0, 3);

type Linha = { aba: string; linha: number; operacao: string; apolice: string; fim: string | null; imob: string; segurado: string; cpf: string; ramo: string; seg: string; status: string; obs: string; bruto: Record<string, unknown> };
type Doc = { id: string; numero_apolice: string | null; nosso_numero: number; nosso_numero_corp: number | null; vigencia_fim: string | null; vigencia_inicio: string | null; imobiliaria_principal_id: string | null; seguradora_id: string | null; locatario_id: string | null; ramo_id: string | null };

(async () => {
  const desfazer = arg("desfazer");
  if (desfazer) {
    await sb.from("erp_renovacao_itens").delete().eq("lote_carga", desfazer);
    await sb.from("erp_renovacao_leituras").delete().eq("lote_id", desfazer);
    console.log("desfeito (itens e leituras da planilha):", desfazer, "— documento_novo_id/status em erp_renovacoes deste lote: use as observações 'Lote de itens'");
    await sb.from("erp_renovacoes").update({ documento_novo_id: null }).eq("lote_id", desfazer);
    return;
  }
  const loteCarga = randomUUID();
  const lidoEm = new Date().toISOString();

  // 1) planilha
  const drive = criarDrive({ version: "v3", auth: obterAutenticacaoGoogle(["https://www.googleapis.com/auth/drive.readonly"]) });
  const r = await drive.files.export({ fileId: PLANILHA, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { responseType: "arraybuffer" });
  const wb = XLSX.read(Buffer.from(r.data as ArrayBuffer));
  const linhas: Linha[] = [];
  for (const aba of ABAS) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba], { header: 1, defval: "" });
    const cab = (rows[0] as string[]).map((c) => String(c).trim());
    const col = (n: string) => cab.findIndex((c) => c.toUpperCase().startsWith(n));
    const [cOp, cAp, cFim, cImob, cSeg, cCpf, cRamo, cSeguradora, cSt, cObs] = [col("OPERA"), col("APOLICE"), col("FIM. VIG"), col("IMOBILI"), col("SEGURADO"), col("CPF"), col("RAMO"), col("SEGURADORA"), 0, col("OBSE")];
    for (let i = 1; i < rows.length; i++) {
      const x = rows[i] as unknown[];
      if (!String(x[cAp] ?? "").trim() || !iso(x[cFim])) continue;
      const bruto: Record<string, unknown> = {}; cab.forEach((c, k) => { if (c && x[k] !== "" && x[k] != null) bruto[c] = x[k]; });
      linhas.push({ aba, linha: i + 1, operacao: String(x[cOp] ?? ""), apolice: dig(x[cAp]), fim: iso(x[cFim]), imob: String(x[cImob] ?? ""), segurado: String(x[cSeg] ?? ""), cpf: dig(x[cCpf]), ramo: String(x[cRamo] ?? ""), seg: String(x[cSeguradora] ?? ""), status: String(x[cSt] ?? ""), obs: String(x[cObs] ?? ""), bruto });
    }
  }
  console.log(`planilha: ${linhas.length} linhas (${ABAS.join(" + ")})`);

  // 2) documentos do ERP (apólices que vencem de agosto/26 a janeiro/27) e lotes (propostas de renovação criadas dos cards RE)
  const SEL = "id, numero_apolice, nosso_numero, nosso_numero_corp, vigencia_fim, vigencia_inicio, imobiliaria_principal_id, seguradora_id, locatario_id, ramo_id";
  const docs: Doc[] = [];
  for (let a = 0; ; a += 1000) {
    const { data, error } = await sb.from("erp_documentos").select(SEL).eq("tipo", "A").gte("vigencia_fim", "2026-08-01").lte("vigencia_fim", "2027-01-31").order("id").range(a, a + 999);
    if (error) throw new Error(error.message);
    docs.push(...((data ?? []) as Doc[]));
    if (!data || data.length < 1000) break;
  }
  const { data: loteRaw } = await sb.from("erp_documentos").select(SEL + ", origem_ref").eq("origem", "bitrix").eq("tipo_corp", "RENV").is("nosso_numero_corp", null).like("origem_ref", "1046:%");
  const loteDocs = (loteRaw ?? []) as unknown as (Doc & { origem_ref: string })[];
  const { data: segs } = await sb.from("erp_seguradoras").select("id, abreviacao");
  const segDe = new Map((segs ?? []).map((s) => [s.id, s.abreviacao as string]));
  const { data: imobs } = await sb.from("imobiliarias").select("id, grupo_id, nome");
  const grupoDe = new Map((imobs ?? []).map((i) => [i.id, (i.grupo_id as string | null) ?? i.id]));
  const nomeImob = new Map((imobs ?? []).map((i) => [i.id, i.nome as string]));
  const cards = await lerCardsRenovacao();
  const cardPorRef = new Map(cards.filter((c) => c.entity === 1046).map((c) => [`1046:${c.id}`, c]));

  // CPF dos clientes das apólices candidatas
  const locIds = [...new Set(docs.map((d) => d.locatario_id).filter(Boolean))] as string[];
  const cpfDe = new Map<string, string>();
  for (const l of lotes(locIds, 150)) { const { data } = await sb.from("locatarios").select("id, cpf").in("id", l); for (const x of data ?? []) cpfDe.set(x.id, dig(x.cpf)); }

  // índice por Nº da apólice (dígitos; aceita "16911 | 16912")
  const idx = new Map<string, Doc[]>();
  for (const d of docs) for (const t of String(d.numero_apolice ?? "").split(/[|;,]/)) { const k = dig(t); if (k.length >= 4) idx.set(k, [...(idx.get(k) ?? []), d]); }

  type Lote = { doc: Doc & { origem_ref: string }; card: ReturnType<typeof cardPorRef.get>; seg: string; grupo: string | null; mes: string; segimob: boolean };
  // lote sem imobiliária no documento (ex.: Pintas/Ribas-HP): acha a ficha pelo texto entre parênteses do título ("ANTIGA RIBAS-HP"), só se der 1 grupo
  const nrm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const grupoPeloTitulo = (titulo: string): string | null => {
    const p = titulo.match(/\(([^)]{6,})\)/)?.[1];
    if (!p) return null;
    const gs = new Set((imobs ?? []).filter((i) => nrm(i.nome as string).includes(nrm(p))).map((i) => grupoDe.get(i.id)!));
    return gs.size === 1 ? [...gs][0] : null;
  };
  const lotesL: Lote[] = loteDocs.map((d) => {
    const card = cardPorRef.get(d.origem_ref);
    const grupo = d.imobiliaria_principal_id ? grupoDe.get(d.imobiliaria_principal_id) ?? null : grupoPeloTitulo(card?.titulo ?? "");
    return { doc: d, card, seg: segDe.get(d.seguradora_id ?? "") ?? "", grupo, mes: (d.vigencia_inicio ?? "").slice(0, 7), segimob: /SEG\//i.test(card?.titulo ?? "") };
  });

  // 3) cada linha da planilha → apólice anterior (prova) → lote
  type Par = { linha: Linha; ant: Doc; lote: Lote; nivel: "confirmado" | "sugestao"; criterio: string };
  const pares: Par[] = [];
  const semApolice: Linha[] = [], semLote: { linha: Linha; ant: Doc }[] = [], ambLote: { linha: Linha; ant: Doc }[] = [], ambApolice: Linha[] = [];
  for (const L of linhas) {
    const cand = (idx.get(L.apolice) ?? []).filter((d) => seg3(segDe.get(d.seguradora_id ?? "")) === seg3(L.seg) && d.vigencia_fim && L.fim && dias(d.vigencia_fim, L.fim) <= 3);
    let alvo = cand;
    if (alvo.length > 1 && L.cpf) alvo = alvo.filter((d) => cpfDe.get(d.locatario_id ?? "") === L.cpf);
    if (!alvo.length) { semApolice.push(L); continue; }
    if (alvo.length > 1) { ambApolice.push(L); continue; }
    const ant = alvo[0];
    const g = ant.imobiliaria_principal_id ? grupoDe.get(ant.imobiliaria_principal_id) : null;
    let ls = lotesL.filter((l) => l.grupo && l.grupo === g && seg3(l.seg) === seg3(L.seg) && l.mes === (ant.vigencia_fim ?? "").slice(0, 7));
    if (ls.length > 1) { const s2 = ls.filter((l) => l.segimob === /SEGIMOB/i.test(L.operacao)); if (s2.length) ls = s2; }
    if (!ls.length) { semLote.push({ linha: L, ant }); continue; }
    if (ls.length > 1) { ambLote.push({ linha: L, ant }); continue; }
    pares.push({ linha: L, ant, lote: ls[0], nivel: "confirmado", criterio: "Nº da apólice + seguradora + fim de vigência (±3 dias)" + (L.cpf ? " + CPF" : "") + " na planilha RN; imobiliária + seguradora + mês do lote batem" });
  }
  const confirmadosPorAnt = new Set(pares.map((p) => p.ant.id));

  // 4) sugestões: apólice anterior da mesma imobiliária (grupo) + seguradora + mês do lote, sem linha na planilha
  const sugestoes: Par[] = [];
  for (const l of lotesL) {
    if (!l.grupo) continue;
    for (const d of docs) {
      if (confirmadosPorAnt.has(d.id) || !d.vigencia_fim || d.vigencia_fim.slice(0, 7) !== l.mes) continue;
      if (d.imobiliaria_principal_id && grupoDe.get(d.imobiliaria_principal_id) === l.grupo && seg3(segDe.get(d.seguradora_id ?? "")) === seg3(l.seg)) sugestoes.push({ linha: null as unknown as Linha, ant: d, lote: l, nivel: "sugestao", criterio: "imobiliária + seguradora + mês do lote (sem linha na planilha)" });
    }
  }

  // 5) relatório
  const porLote = new Map<string, { conf: number; sug: number }>();
  for (const p of pares) { const k = p.lote.doc.id; porLote.set(k, { conf: (porLote.get(k)?.conf ?? 0) + 1, sug: porLote.get(k)?.sug ?? 0 }); }
  for (const p of sugestoes) { const k = p.lote.doc.id; porLote.set(k, { conf: porLote.get(k)?.conf ?? 0, sug: (porLote.get(k)?.sug ?? 0) + 1 }); }
  const lotesComConf = [...porLote.values()].filter((v) => v.conf > 0).length;
  console.log(`LOTES (propostas RE de card): ${lotesL.length} · com itens confirmados: ${lotesComConf} · só sugestão: ${[...porLote.values()].filter((v) => !v.conf && v.sug).length} · sem nenhum par: ${lotesL.length - porLote.size}`);
  console.log(`ITENS da planilha: ${linhas.length} → confirmados em lote: ${pares.length} · apólice não achada no ERP: ${semApolice.length} · apólice ambígua: ${ambApolice.length} · achada mas sem lote (imob+seg+mês): ${semLote.length} · em mais de um lote: ${ambLote.length}`);
  console.log(`SUGESTÕES (apólice do ERP sem linha na planilha, mesma imobiliária+seguradora+mês do lote): ${sugestoes.length}`);

  fs.mkdirSync(SAIDA, { recursive: true });
  const csv = (nome: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    fs.writeFileSync(path.join(SAIDA, nome), "﻿" + [cols.join(";"), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(";"))].join("\r\n"));
  };
  const rotuloLote = (l: Lote) => `${l.card?.titulo ?? l.doc.origem_ref}`;
  csv("itens-confirmados.csv", pares.map((p) => ({ "Lote (card)": rotuloLote(p.lote), "Código O2 do lote": p.lote.doc.nosso_numero, "Código O2 da apólice anterior": p.ant.nosso_numero, "Nº da apólice": p.ant.numero_apolice, "Fim vig.": p.ant.vigencia_fim, Planilha: `${p.linha.aba} L${p.linha.linha}`, Segurado: p.linha.segurado, Critério: p.criterio })));
  csv("itens-sem-apolice-no-erp.csv", semApolice.map((l) => ({ Planilha: `${l.aba} L${l.linha}`, "Nº da apólice": l.apolice, "Fim vig.": l.fim, Imobiliária: l.imob, Seguradora: l.seg, Segurado: l.segurado, Operação: l.operacao })));
  csv("itens-sem-lote.csv", semLote.map((x) => ({ Planilha: `${x.linha.aba} L${x.linha.linha}`, "Código O2 da apólice": x.ant.nosso_numero, "Nº da apólice": x.linha.apolice, Imobiliária: nomeImob.get(x.ant.imobiliaria_principal_id ?? "") ?? x.linha.imob, Seguradora: x.linha.seg, "Fim vig.": x.ant.vigencia_fim })));
  csv("lotes-resumo.csv", lotesL.map((l) => ({ Card: rotuloLote(l), "Código O2 do lote": l.doc.nosso_numero, Imobiliária: nomeImob.get(l.doc.imobiliaria_principal_id ?? "") ?? "", Seguradora: l.seg, Mês: l.mes, "Quantidade de endereços no card": l.card?.bruto?.ufCrm12QtdEnderecos ?? "", Confirmados: porLote.get(l.doc.id)?.conf ?? 0, Sugestões: porLote.get(l.doc.id)?.sug ?? 0 })));
  if (!GRAVAR) return;

  // 6) gravação: itens (confirmado + sugestão), leituras das linhas da planilha (tudo estruturado), e nas apólices anteriores CONFIRMADAS o vínculo com o lote
  const itens = [...pares, ...sugestoes].map((p) => ({
    lote_carga: loteCarga, documento_lote_id: p.lote.doc.id, documento_anterior_id: p.ant.id, nivel_prova: p.nivel, criterio: p.criterio, fonte: "F9", fonte_nivel: 7,
    fonte_detalhe: p.linha ? `Drive · 10 OUTUBRO /2026- COTAÇÃO DIÁRIA RE · ${p.linha.aba} · linha ${p.linha.linha}` : "ERP · mesma imobiliária+seguradora+mês", dados: p.linha ? p.linha.bruto : {}, lido_em: lidoEm,
  }));
  for (const l of lotes(itens, 200)) { const { error } = await sb.from("erp_renovacao_itens").upsert(l, { onConflict: "documento_lote_id,documento_anterior_id", ignoreDuplicates: true }); if (error) throw new Error(error.message); }
  const leituras = linhas.map((L) => {
    const par = pares.find((p) => p.linha === L);
    return { lote_id: loteCarga, entidade: "planilha_rn_linha", chave: `${L.aba}:${L.linha}`, documento_id: par?.ant.id ?? null, fonte: "F9", fonte_nivel: 7, fonte_detalhe: `Drive · COTAÇÃO DIÁRIA RE · ${L.aba}`, lido_em: lidoEm, dados: L.bruto, documento_novo_id: par?.lote.doc.id ?? null, vinculo_status: par ? "ligado" : "pendente", vinculo_motivo: par ? null : "linha da planilha sem apólice/lote confirmado no ERP" };
  });
  for (const l of lotes(leituras, 200)) { const { error } = await sb.from("erp_renovacao_leituras").insert(l); if (error) throw new Error(error.message); }

  let ok = 0;
  for (const p of pares) {
    const card = p.lote.card;
    const statusPlan = /EFETIVADO/i.test(p.linha.status) ? "renovado" : null;
    const valor: Record<string, unknown> = { documento_novo_id: p.lote.doc.id, lote_id: loteCarga, fonte: "F9", fonte_nivel: 7, lido_em: lidoEm, updated_at: lidoEm, card_ligado_via: "lote_item_planilha" };
    if (card) { valor.bitrix_card_id = `1046:${card.id}`; valor.card_titulo = card.titulo; valor.card_etapa = card.etapa; }
    const { data: ex } = await sb.from("erp_renovacoes").select("id, status").eq("documento_id", p.ant.id).limit(1);
    if (ex?.length) { await sb.from("erp_renovacoes").update({ ...valor, ...(statusPlan ? { status: statusPlan } : {}) }).eq("id", ex[0].id); ok++; }
    else {
      const { error } = await sb.from("erp_renovacoes").insert({ documento_id: p.ant.id, vence_em: p.ant.vigencia_fim, status: statusPlan ?? (card ? statusPelaEtapa(card.etapa) : "a_renovar"), ...valor, observacoes: `Lote de itens: ${p.lote.card?.titulo ?? ""} · ${p.linha.aba} L${p.linha.linha}` });
      if (error) console.log("erro", error.message); else ok++;
    }
  }
  // lote com UM item confirmado e sem anterior registrada: aponta a apólice anterior (único caso em que documento_renovado_id é certo)
  let unicos = 0;
  for (const [loteId, v] of porLote) {
    if (v.conf !== 1) continue;
    const lote = lotesL.find((l) => l.doc.id === loteId)!;
    const p = pares.find((x) => x.lote.doc.id === loteId)!;
    const { data: cur } = await sb.from("erp_documentos").select("documento_renovado_id").eq("id", loteId).single();
    if (cur && !cur.documento_renovado_id && lote.card?.bruto?.ufCrm12QtdEnderecos && Number(lote.card.bruto.ufCrm12QtdEnderecos) === 1) { await sb.from("erp_documentos").update({ documento_renovado_id: p.ant.id }).eq("id", loteId); unicos++; }
  }
  fs.writeFileSync(path.join(SAIDA, "ultimo-lote-carga.txt"), loteCarga + "\n");
  console.log(`gravado: ${itens.length} itens (${pares.length} confirmados), ${leituras.length} linhas da planilha registradas, ${ok} apólices anteriores ligadas ao lote, ${unicos} lotes de 1 item com documento_renovado_id. Desfazer: --desfazer ${loteCarga}`);
})();
