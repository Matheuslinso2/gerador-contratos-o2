process.loadEnvFile(".env.local");
// Classifica cada proposta/endosso EFETIVADO (card do Bitrix, ainda "proposta" no ERP) nas 3 situações do Matheus (04/11/2026):
//   1 não emitiu · 2 emitiu e não foi vinculado (documento oficial já existe no ERP) · 3 emitiu mas sem documento no ERP.
// Cruza TODAS as fontes do banco com TODAS as chaves (CPF de todas as partes, nomes, nº de proposta/apólice/orçamento,
// seguradora, datas, prêmio) e grava em erp_proposta_emissao_classif com as provas. Só leitura fora dessa tabela.
//   npx tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/classificar-propostas-emissao.ts [--gravar]
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const GRAVAR = process.argv.includes("--gravar");
const DESDE = "2026-04-01";

const cacheDig = new Map<string, string>(), cacheNorm = new Map<string, string>();
const dig = (s: unknown) => { const k = String(s ?? ""); let v = cacheDig.get(k); if (v === undefined) { v = k.replace(/\D/g, ""); cacheDig.set(k, v); } return v; };
const semZero = (s: unknown) => dig(s).replace(/^0+/, "");
const norm = (s: unknown) => { const k = String(s ?? ""); let v = cacheNorm.get(k); if (v === undefined) { v = k.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim(); cacheNorm.set(k, v); } return v; };
const PALAVRAS_FRACAS = new Set(["DA", "DE", "DO", "DOS", "DAS", "E", "LTDA", "ME", "EPP", "SA", "S"]);
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length > 1 && !PALAVRAS_FRACAS.has(t));
const dias = (a?: string | null, b?: string | null) => (a && b ? (Date.parse(a) - Date.parse(b)) / 864e5 : NaN);

// paginação SEMPRE com ordem única (sem ordem estável o range() pula linhas)
async function todas<T>(tabela: string, colunas: string, filtro?: (q: any) => any, ordem = "id"): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q = sb.from(tabela).select(colunas);
    for (const c of ordem.split(",")) q = q.order(c.trim());
    q = q.range(de, de + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

type Prova = { fonte: string; chave: string; ref: string; data?: string | null; numero?: string | null; valor?: number | null };

(async () => {
  // ---------- seguradoras: texto → id
  const segs = await todas<any>("erp_seguradoras", "id, nome, abreviacao");
  const segDoTexto = (t: unknown): string | null => {
    const n = norm(t);
    if (!n) return null;
    const s = segs.find((s) => n === norm(s.abreviacao) || n.includes(norm(s.nome).split(" ")[0]) || norm(s.nome).includes(n));
    return s?.id ?? null;
  };
  const segNome = new Map(segs.map((s) => [s.id, s.abreviacao]));

  // ---------- alvo: propostas efetivadas vindas do Bitrix
  const alvo = await todas<any>("erp_documentos", "id, tipo, tipo_corp, seguradora_id, ramo_id, locatario_id, numero_proposta, numero_apolice, documento_pai_id, vigencia_inicio, premio_liquido, premio_total, dt_proposta", (q) => q.eq("situacao", "proposta").eq("origem", "bitrix"));
  const ids = alvo.map((d) => d.id);
  const origens = (await Promise.all(chunk(ids, 200).map((c) => sb.from("erp_origens").select("documento_id, entity_type_id, item_id, categoria_id, etapa_id, titulo, dados, dados_legiveis, comentarios").in("documento_id", c)))).flatMap((r) => r.data ?? []);
  const itens = (await Promise.all(chunk(ids, 200).map((c) => sb.from("erp_documento_itens").select("id, documento_id").in("documento_id", c)))).flatMap((r) => r.data ?? []);
  const partes = (await Promise.all(chunk(itens.map((i) => i.id), 200).map((c) => sb.from("erp_item_partes").select("item_id, nome, documento_numero, papel").in("item_id", c)))).flatMap((r) => r.data ?? []);
  const locIds = [...new Set(alvo.map((d) => d.locatario_id).filter(Boolean))];
  const locs = (await Promise.all(chunk(locIds, 200).map((c) => sb.from("locatarios").select("id, nome, cpf").in("id", c)))).flatMap((r) => r.data ?? []);
  const comentCards = await todas<any>("bitrix_card_comentarios", "id, entity_type_id, item_id, comentario");
  console.log(`alvo: ${alvo.length} propostas; partes ${partes.length}; comentários avulsos ${comentCards.length}`);

  // ---------- fontes (carregadas 1 vez)
  const docsErp = await todas<any>("erp_documentos", "id, origem, tipo, tipo_corp, situacao, seguradora_id, locatario_id, numero_apolice, numero_proposta, numero_endosso, documento_pai_id, vigencia_inicio, premio_liquido, premio_total, documento_principal_id",
    (q) => q.gte("vigencia_inicio", DESDE).neq("situacao", "duplicado").neq("origem", "bitrix").not("situacao", "in", "(cotacao,recusado,perdido,proposta)"));
  const locDocs = new Map<string, any>();
  for (const c of chunk([...new Set(docsErp.map((d) => d.locatario_id).filter(Boolean))], 200)) for (const l of (await sb.from("locatarios").select("id, nome, cpf").in("id", c)).data ?? []) locDocs.set(l.id, l);
  const extratos = await todas<any>("erp_extratos_seguradora", "id, seguradora_id, competencia, pago_em");
  const extPor = new Map(extratos.map((e) => [e.id, e]));
  const extLinhas = await todas<any>("erp_extrato_linhas", "id, extrato_id, apolice, proposta, endosso, cliente, cpf_cnpj, valor_comissao, vigencia_inicio, documento_id");
  const portalCom = await todas<any>("erp_portal_comissoes", "id, seguradora_id, pago_em");
  const portalComPor = new Map(portalCom.map((p) => [p.id, p]));
  const portalLinhas = await todas<any>("erp_portal_comissao_linhas", "id, comissao_id, numero_apolice, endosso, cliente, valor_comissao, motivo");
  const portalApo = await todas<any>("erp_portal_apolices", "id, seguradora_id, numero_apolice, segurado, dt_emissao, vigencia_inicio, tipo_emissao");
  const portalParc = await todas<any>("erp_portal_parcelas", "id, seguradora_id, segurado_exibido, cpf_cnpj, numero_apolice_chave, numero_documento_portal, vencimento, status_portal");
  const portalLeit = await todas<any>("erp_portal_seguradora_leitura", "id, seguradora, numero_proposta, numero_apolice, cpf_cnpj_cliente, vigencia_inicio");
  const emitidas = await todas<any>("erp_seguradora_emitidas", "id, seguradora_id, numero_apolice, numero_proposta, nome_segurado, cpf_cnpj, vigencia_inicio, dt_emissao, documento_id");
  const corpCom = await todas<any>("erp_corp_comissoes", "id, situacao, seg_abrev, cliente, cpf_cnpj, apolice, endosso, inicio_vig, dt_emissao, valor", (q) => q.gte("inicio_vig", DESDE));
  const pdfApo = await todas<any>("erp_apolice_pdf_identidade", "fonte_pdf, documento_id, seg, numero_pdf, cpfs, vig_ini", (q) => q.gte("vig_ini", DESDE), "fonte_pdf");
  const pdfProp = await todas<any>("erp_proposta_pdf_identidade", "fonte_pdf, seg_texto, numero_proposta, cpfs, vig_ini, documento_id", undefined, "fonte_pdf");
  const pdfEnd = await todas<any>("erp_endosso_pdf_identidade", "fonte_pdf, seg_texto, numero_apolice, numero_endosso, data_endosso, mae_id, endosso_id", undefined, "fonte_pdf");
  const boletos = await todas<any>("erp_boleto_identidade", "fonte_pdf, seg_texto, numero_apolice, numero_proposta, vencimento", undefined, "fonte_pdf");
  const inad = await todas<any>("erp_parcelas_inadimplencia", "id, seguradora_id, numero_apolice, cliente, cpf_cnpj, vencimento_original");
  const proLab = await todas<any>("erp_pro_labore_linhas", "id, seguradora_id, apolice, segurado, data_pagamento");
  const planilhas = await todas<any>("erp_planilha_registro", "arquivo_id, aba, linha_n, status, data_efetivacao, inicio_vigencia, seguradora, segurado, segurado_doc, locatario, locatario_doc, apolice, proposta, orcamento",
    (q) => q.or(`data_efetivacao.gte.${DESDE},inicio_vigencia.gte.${DESDE}`).not("apolice", "is", null), "arquivo_id,aba,linha_n");
  const anexos = await todas<any>("erp_email_anexos", "id, message_id, nome, classe, seguradora, numeros, cpf_cnpj, documento_id", (q) => q.in("classe", ["apolice", "endosso", "proposta", "boleto", "certificado"]));
  const emails = await todas<any>("erp_emails", "id, message_id, data, assunto, trecho", (q) => q.gte("data", DESDE));
  const analise = await todas<any>("erp_fianca_analise_credito", "id, card_item_id, seguradora, resultado, data_email");
  console.log(`fontes: docs ${docsErp.length}, extrato ${extLinhas.length}, portal com ${portalLinhas.length}, portal apó ${portalApo.length}, parc ${portalParc.length}, emitidas ${emitidas.length}, corp com ${corpCom.length}, pdf apó ${pdfApo.length}, pdf prop ${pdfProp.length}, pdf end ${pdfEnd.length}, boletos ${boletos.length}, planilhas ${planilhas.length}, anexos ${anexos.length}, e-mails ${emails.length}`);

  // índices por CPF / número
  const idx = <T,>(xs: T[], chaves: (x: T) => (string | null | undefined)[]) => { const m = new Map<string, T[]>(); for (const x of xs) for (const k of chaves(x)) if (k && k.length >= 6) m.set(k, [...(m.get(k) ?? []), x]); return m; };
  const docsPorCpf = idx(docsErp, (d) => [dig(locDocs.get(d.locatario_id)?.cpf)]);
  const docsPorNum = idx(docsErp, (d) => [semZero(d.numero_apolice), semZero(d.numero_proposta)]);
  const docsPorNome = idx(docsErp, (d) => [norm(locDocs.get(d.locatario_id)?.nome)]);

  // documentos que NÃO identificam o cliente: CNPJ de imobiliária (estipulante), da O2/corretoras e qualquer CPF/CNPJ presente em muitas apólices
  const naoIdentifica = new Set<string>();
  for (const i of await todas<any>("imobiliarias", "id, cnpj")) if (dig(i.cnpj).length >= 11) naoIdentifica.add(dig(i.cnpj));
  for (const c of await todas<any>("erp_corretoras", "id, cnpj")) if (dig(c.cnpj).length >= 11) naoIdentifica.add(dig(c.cnpj));
  const freq = new Map<string, Set<string>>();
  for (const p of pdfApo) for (const c of p.cpfs ?? []) { const k = dig(c); if (!freq.has(k)) freq.set(k, new Set()); freq.get(k)!.add(semZero(p.numero_pdf) || p.fonte_pdf); }
  for (const [k, s] of freq) if (s.size > 5) naoIdentifica.add(k);
  console.log(`documentos ignorados como identificação do cliente: ${naoIdentifica.size}`);

  const resultados: any[] = [];
  for (const d of alvo) {
    const o = origens.find((x) => x.documento_id === d.id);
    const loc = locs.find((l) => l.id === d.locatario_id);
    const meusItens = itens.filter((i) => i.documento_id === d.id).map((i) => i.id);
    const minhasPartes = partes.filter((p) => meusItens.includes(p.item_id));
    const dl = (o?.dados_legiveis ?? {}) as Record<string, unknown>;
    const efetivado = String(dl["Data da mudança de etapa"] ?? d.dt_proposta ?? "").slice(0, 10) || null;
    const ref = d.vigencia_inicio ?? efetivado;
    const cpfs = [...new Set([dig(loc?.cpf), ...minhasPartes.map((p) => dig(p.documento_numero))].filter((c) => (c.length === 11 || c.length === 14) && !naoIdentifica.has(c)))];
    const tituloNome = norm(String(o?.titulo ?? "").replace(/^\s*(NOVO|RENOVA\S*( AUTO)?|ENDOSSO|LOTE[^-]*)\s*-\s*/i, "").split(" - ")[0].replace(/\(.*?\)/g, ""));
    const nomes = [...new Set([norm(loc?.nome), ...minhasPartes.map((p) => norm(p.nome)), tituloNome].filter((n) => tokens(n).length >= 2))];
    const numsCard = Object.entries(dl).filter(([k]) => /propost|ap[oó]lice|or[cç]amento|certificad|t[ií]tulo/i.test(k)).map(([, v]) => semZero(v)).filter((v) => v.length >= 6);
    const nums = [...new Set([semZero(d.numero_proposta), semZero(d.numero_apolice), ...numsCard].filter((v) => v.length >= 6))];
    const ehEndosso = !["A", "F"].includes(d.tipo) || o?.categoria_id === 24;
    const nomeCasa = (t: unknown) => { const n = norm(t); if (!n) return false; return nomes.some((x) => x === n || (tokens(x).length >= 3 && tokens(x).every((tk) => n.includes(tk))) || (tokens(n).length >= 3 && tokens(n).every((tk) => x.includes(tk)))); };
    const segOk = (sid: string | null | undefined) => !d.seguradora_id || !sid || sid === d.seguradora_id;
    const naJanela = (data?: string | null, antes = 45, depois = 180) => { if (!ref || !data) return true; const x = dias(data, ref); return x >= -antes && x <= depois; };
    const casa = (cpfX: unknown, nomeX: unknown, numX: unknown[], sid: string | null | undefined): string | null => {
      const c = dig(cpfX); if (c && cpfs.includes(c)) return "CPF";
      for (const n of numX) { const v = semZero(n); if (v.length >= 6 && nums.includes(v)) return "número"; }
      if (sid && d.seguradora_id && sid === d.seguradora_id && nomeCasa(nomeX)) return "nome+seguradora";
      return null;
    };
    const provas: Prova[] = []; const candidatos: any[] = []; const perda: string[] = [];

    // 2: documento oficial já existe no ERP (Corp/portal/manual), mesmo tipo (apólice × endosso)
    const cands = new Map<string, any>();
    for (const c of cpfs) for (const x of docsPorCpf.get(c) ?? []) cands.set(x.id, { ...x, via: "CPF" });
    for (const n of nums) for (const x of docsPorNum.get(n) ?? []) cands.set(x.id, { ...x, via: "número" });
    for (const n of nomes) for (const x of docsPorNome.get(n) ?? []) if (x.seguradora_id === d.seguradora_id) cands.set(x.id, cands.get(x.id) ?? { ...x, via: "nome+seguradora" });
    for (const x of cands.values()) {
      const endossoX = !["A", "F"].includes(x.tipo);
      if (endossoX !== ehEndosso || !segOk(x.seguradora_id) || !naJanela(x.vigencia_inicio, 45, 60)) continue;
      if (ehEndosso && d.documento_pai_id && x.documento_pai_id && x.documento_pai_id !== d.documento_pai_id) continue;
      candidatos.push({ id: x.id, via: x.via, origem: x.origem, tipo: x.tipo, numero: x.numero_apolice, vigencia: x.vigencia_inicio, premio: x.premio_liquido, situacao: x.situacao, premio_igual: Math.abs(Number(x.premio_liquido ?? 0) - Number(d.premio_liquido ?? 0)) <= 1 || Math.abs(Number(x.premio_total ?? 0) - Number(d.premio_liquido ?? 0)) <= 1 });
    }

    // 3: provas de emissão sem documento
    for (const l of extLinhas) { const e = extPor.get(l.extrato_id); if (!e || Number(l.valor_comissao) <= 0) continue; const k = casa(l.cpf_cnpj, l.cliente, [l.apolice, l.proposta], e.seguradora_id); if (k && naJanela(e.pago_em ?? e.competencia, 10, 200)) provas.push({ fonte: "extrato da seguradora (comissão paga)", chave: k, ref: l.id, data: e.pago_em ?? e.competencia, numero: l.apolice, valor: Number(l.valor_comissao) }); }
    for (const l of portalLinhas) { const c = portalComPor.get(l.comissao_id); if (!c || Number(l.valor_comissao) <= 0) continue; const k = casa(null, l.cliente, [l.numero_apolice], c.seguradora_id); if (k && naJanela(c.pago_em, 10, 200)) provas.push({ fonte: "portal da seguradora: comissão", chave: k, ref: l.id, data: c.pago_em, numero: l.numero_apolice, valor: Number(l.valor_comissao) }); }
    for (const a of portalApo) { const k = casa(null, a.segurado, [a.numero_apolice], a.seguradora_id); if (k && naJanela(a.vigencia_inicio, 45, 90)) provas.push({ fonte: "portal da seguradora: apólice/endosso emitido", chave: k, ref: a.id, data: a.dt_emissao, numero: a.numero_apolice }); }
    for (const p of portalParc) { const k = casa(p.cpf_cnpj, p.segurado_exibido, [p.numero_apolice_chave, p.numero_documento_portal], p.seguradora_id); if (k && naJanela(p.vencimento, 10, 400)) provas.push({ fonte: `portal da seguradora: parcela (${p.status_portal})`, chave: k, ref: p.id, data: p.vencimento, numero: p.numero_apolice_chave }); }
    for (const p of portalLeit) { const k = casa(p.cpf_cnpj_cliente, null, [p.numero_proposta, p.numero_apolice], segDoTexto(p.seguradora)); if (k && p.numero_apolice) provas.push({ fonte: "portal da seguradora: leitura da proposta/apólice", chave: k, ref: p.id, data: p.vigencia_inicio, numero: p.numero_apolice }); }
    for (const s of emitidas) { const k = casa(s.cpf_cnpj, s.nome_segurado, [s.numero_proposta, s.numero_apolice], s.seguradora_id); if (k && naJanela(s.vigencia_inicio, 45, 90)) provas.push({ fonte: "relatório de emitidas da seguradora", chave: k, ref: s.id, data: s.dt_emissao, numero: s.numero_apolice }); }
    // comissão "pendente" com apólice 0 é só a previsão de uma proposta digitada no Corp: não prova emissão
    for (const c of corpCom) { if (c.situacao !== "recebida" && semZero(c.apolice).length < 5) continue; const k = casa(c.cpf_cnpj, c.cliente, [c.apolice], segDoTexto(c.seg_abrev)); if (k && naJanela(c.inicio_vig, 45, 60)) provas.push({ fonte: `comissão no Corp (${c.situacao})`, chave: k, ref: String(c.id), data: c.dt_emissao ?? c.inicio_vig, numero: c.apolice, valor: Number(c.valor) }); }
    for (const p of pdfApo) { const k = casa((p.cpfs ?? []).find((x: string) => cpfs.includes(dig(x))), null, [p.numero_pdf], segDoTexto(p.seg)); if (k && naJanela(p.vig_ini, 45, 60)) provas.push({ fonte: "PDF da apólice lido", chave: k, ref: p.fonte_pdf, data: p.vig_ini, numero: p.numero_pdf }); }
    for (const p of pdfEnd) { if (!ehEndosso) continue; const k = casa(null, null, [p.numero_apolice], segDoTexto(p.seg_texto)); if (k && naJanela(p.data_endosso, 45, 90)) provas.push({ fonte: "PDF do endosso lido", chave: k, ref: p.fonte_pdf, data: p.data_endosso, numero: `${p.numero_apolice}/${p.numero_endosso ?? "-"}` }); }
    for (const b of boletos) { const k = casa(null, null, [b.numero_apolice, b.numero_proposta], segDoTexto(b.seg_texto)); if (k && b.numero_apolice) provas.push({ fonte: "boleto da seguradora", chave: k, ref: b.fonte_pdf, data: b.vencimento, numero: b.numero_apolice }); }
    for (const x of inad) { const k = casa(x.cpf_cnpj, x.cliente, [x.numero_apolice], x.seguradora_id); if (k) provas.push({ fonte: "comunicado de inadimplência da seguradora", chave: k, ref: x.id, data: x.vencimento_original, numero: x.numero_apolice }); }
    for (const x of proLab) { const k = casa(null, x.segurado, [x.apolice], x.seguradora_id); if (k && naJanela(x.data_pagamento, 10, 200)) provas.push({ fonte: "pró-labore pago pela seguradora", chave: k, ref: x.id, data: x.data_pagamento, numero: x.apolice }); }
    for (const p of planilhas) { if (!semZero(p.apolice)) continue; const k = casa(p.segurado_doc || p.locatario_doc, p.segurado || p.locatario, [p.proposta, p.orcamento, p.apolice], segDoTexto(p.seguradora)); if (k && naJanela(p.inicio_vigencia ?? p.data_efetivacao, 45, 60)) provas.push({ fonte: `planilha de controle (${p.aba})`, chave: k, ref: `${p.arquivo_id}#${p.aba}#${p.linha_n}`, data: p.inicio_vigencia ?? p.data_efetivacao, numero: p.apolice }); }
    for (const a of anexos) { if (!["apolice", "endosso", "certificado", "boleto"].includes(a.classe)) continue; const k = casa((a.cpf_cnpj ?? []).find((x: string) => cpfs.includes(dig(x))), null, a.numeros ?? [], segDoTexto(a.seguradora)); if (k) provas.push({ fonte: `anexo de e-mail (${a.classe})`, chave: k, ref: a.id, numero: (a.numeros ?? [])[0] ?? null }); }
    // e-mails: assunto/trecho com nome completo, CPF ou nº (sinal; emissão só se falar em apólice/emitida)
    for (const e of emails) {
      if (!naJanela(String(e.data).slice(0, 10), 30, 200)) continue;
      const txt = `${e.assunto ?? ""} ${e.trecho ?? ""}`; const t = norm(txt); const td = dig(txt);
      const k = cpfs.some((c) => td.includes(c)) ? "CPF" : nums.some((n) => td.includes(n)) ? "número" : nomes.some((n) => tokens(n).length >= 2 && t.includes(n)) ? "nome completo" : null;
      if (!k) continue;
      if (/AP[O ]?LICE|EMITID|EMISSAO|ENDOSSO EMIT|CERTIFICADO|BOLETO/.test(t)) provas.push({ fonte: "e-mail cita emissão/apólice", chave: k, ref: e.message_id, data: String(e.data).slice(0, 10) });
      if (/DESIST|CANCELAD|NAO VAI SEGUIR|NAO SEGUIR|RECUSAD|PERDID/.test(t)) perda.push(`e-mail ${String(e.data).slice(0, 10)}: ${String(e.assunto).slice(0, 80)}`);
    }
    // comentários e análise de crédito (sinais de perda)
    const coment = JSON.stringify(o?.comentarios ?? []) + " " + comentCards.filter((c) => c.entity_type_id === o?.entity_type_id && c.item_id === o?.item_id).map((c) => c.comentario).join(" ");
    const cn = norm(coment);
    if (/DESIST|NAO (VAI|QUER) (SEGUIR|CONTRATAR|FECHAR)|PERDID|CANCELAD|NAO FECHOU|RECUSAD/.test(cn)) perda.push(`comentário do card: ${coment.match(/[^."]{0,60}(desist|perdid|cancelad|recusad|não fechou|nao fechou)[^."]{0,60}/i)?.[0] ?? "(menciona perda/cancelamento)"}`);
    if (/EMITID|APOLICE (N|NUMERO)|ENDOSSO EMITIDO|TITULO EMITIDO/.test(cn)) provas.push({ fonte: "comentário do card cita emissão", chave: "card", ref: `${o?.entity_type_id}:${o?.item_id}` });
    if (o?.entity_type_id === 1042) { const an = analise.filter((a) => String(a.card_item_id) === String(o.item_id)); if (an.length && an.every((a) => /recus/i.test(a.resultado))) perda.push(`análise de crédito: todas recusadas (${an.length})`); }
    if (o?.entity_type_id === 1048 && /EMITIDO/i.test(String(o?.etapa_id))) provas.push({ fonte: "etapa do card = Emitido (Capitalização)", chave: "card", ref: `${o.entity_type_id}:${o.item_id}` });

    // dedup e decisão
    const unicas = [...new Map(provas.map((p) => [`${p.fonte}|${p.ref}`, p])).values()];
    // indício (não basta sozinho): card, e-mail que cita, planilha de controle (na aba de renovação o nº pode ser o da apólice anterior)
    const fortes = unicas.filter((p) => p.chave !== "card" && !/^(e-mail cita|planilha de controle)/.test(p.fonte));
    const candBons = candidatos.filter((c) => c.via !== "nome+seguradora" || c.premio_igual);
    let categoria: 1 | 2 | 3; let rotulo: string;
    if (candBons.length) { categoria = 2; rotulo = candBons.length === 1 ? "emitiu e não foi vinculado (1 documento oficial candidato)" : `emitiu e não foi vinculado (${candBons.length} candidatos — escolher pelo documento)`; }
    else if (fortes.length || unicas.length) { categoria = 3; rotulo = fortes.length ? "emitiu, sem documento no ERP (prova forte)" : "emitiu, sem documento no ERP (só indício: card/e-mail)"; }
    else { categoria = 1; rotulo = perda.length ? "não emitiu (há sinal de perda/desistência)" : "não emitiu (nenhuma prova em nenhuma fonte)"; }
    // nº da apólice só de fonte com número confiável (o "número" do anexo de e-mail pode ser código genérico); vários números → anota
    const numerosFortes = [...new Set(fortes.filter((p) => !/^anexo de e-mail/.test(p.fonte)).map((p) => semZero(p.numero)).filter((n) => n.length >= 5))];
    const numeroEncontrado = numerosFortes.length === 1 ? numerosFortes[0] : numerosFortes.length > 1 ? `vários: ${numerosFortes.slice(0, 4).join(", ")}` : null;
    resultados.push({ documento_id: d.id, categoria, rotulo, numero_apolice_encontrado: numeroEncontrado, candidatos: candBons.length ? candBons : candidatos, provas: unicas.slice(0, 40), sinais_perda: [...new Set(perda)].slice(0, 10),
      chaves: { card: o ? `${o.entity_type_id}:${o.item_id}` : null, etapa: o?.etapa_id, seguradora: segNome.get(d.seguradora_id) ?? null, efetivado, vigencia: d.vigencia_inicio, cpfs: cpfs.length, nomes, nums }, atualizado_em: new Date().toISOString() });
  }

  const resumo: Record<string, number> = {};
  for (const r of resultados) { const k = `${r.categoria} · ${r.rotulo}`; resumo[k] = (resumo[k] ?? 0) + 1; }
  const porFonte: Record<string, number> = {};
  for (const r of resultados) for (const f of new Set(r.provas.map((p: Prova) => p.fonte.replace(/ \(.*\)$/, "")))) porFonte[f as string] = (porFonte[f as string] ?? 0) + 1;
  console.log(resumo); console.log("propostas com prova, por fonte:", porFonte);
  console.log("com sinal de perda:", resultados.filter((r) => r.sinais_perda.length).length);
  if (process.argv.includes("--amostra")) { for (const r of resultados.filter((r) => r.categoria === 3).sort(() => Math.random() - 0.5).slice(0, 8)) console.log(JSON.stringify({ card: r.chaves.card, seg: r.chaves.seguradora, vig: r.chaves.vigencia, ef: r.chaves.efetivado, num: r.numero_apolice_encontrado, provas: r.provas.slice(0, 6).map((p: Prova) => `${p.fonte} [${p.chave}] ${p.numero ?? ""} ${p.data ?? ""}`) })); }
  if (GRAVAR) {
    for (const c of chunk(resultados, 200)) { const { error } = await sb.from("erp_proposta_emissao_classif").upsert(c, { onConflict: "documento_id" }); if (error) throw error; }
    // proposta que deixou de ser proposta sai da classificação
    const { data: velhas } = await sb.from("erp_proposta_emissao_classif").select("documento_id");
    const fora = (velhas ?? []).map((v) => v.documento_id).filter((x) => !ids.includes(x));
    for (const c of chunk(fora, 200)) await sb.from("erp_proposta_emissao_classif").delete().in("documento_id", c);
    console.log(`gravado: ${resultados.length}; removidos (já não são proposta): ${fora.length}`);
  }
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });

function chunk<T>(xs: T[], n: number): T[][] { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; }
