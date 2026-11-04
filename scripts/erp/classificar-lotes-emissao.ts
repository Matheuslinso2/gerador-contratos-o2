process.loadEnvFile(".env.local");
// Lotes de RE (SPA 1046, efetivados, ainda "proposta"): classifica CADA ITEM (cada item = uma apólice individual — Matheus 04/11/2026).
//   Renovação: item = apólice anterior (erp_renovacao_itens) → 2 se a apólice nova já existe no ERP, 3 se há prova de emissão
//   (extrato, portal, emitidas, comissão do Corp, PDF, anexo, pró-labore) pelo CPF/nome do segurado, 1 se nada.
//   Lote de novos (sem lista de itens): itens = apólices novas da mesma imobiliária/seguradora com início perto da efetivação.
// Grava erp_lote_item_emissao e o resumo em erp_proposta_emissao_classif.lote.
//   npx tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/classificar-lotes-emissao.ts [--gravar]
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const GRAVAR = process.argv.includes("--gravar");
const DESDE = "2026-04-01";
const cacheD = new Map<string, string>(), cacheN = new Map<string, string>();
const dig = (s: unknown) => { const k = String(s ?? ""); let v = cacheD.get(k); if (v === undefined) { v = k.replace(/\D/g, ""); cacheD.set(k, v); } return v; };
const semZero = (s: unknown) => dig(s).replace(/^0+/, "");
const norm = (s: unknown) => { const k = String(s ?? ""); let v = cacheN.get(k); if (v === undefined) { v = k.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim(); cacheN.set(k, v); } return v; };
const dias = (a?: string | null, b?: string | null) => (a && b ? (Date.parse(a) - Date.parse(b)) / 864e5 : NaN);
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function todas<T>(tabela: string, colunas: string, filtro?: (q: any) => any, ordem = "id"): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q = sb.from(tabela).select(colunas); for (const c of ordem.split(",")) q = q.order(c.trim()); q = q.range(de, de + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q; if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...((data ?? []) as T[])); if (!data || data.length < 1000) return out;
  }
}
const porId = async (tabela: string, colunas: string, ids: string[]) => (await Promise.all(chunk([...new Set(ids.filter(Boolean))], 200).map((c) => sb.from(tabela).select(colunas).in("id", c)))).flatMap((r) => (r.data ?? []) as any[]);

(async () => {
  const segs = await todas<any>("erp_seguradoras", "id, nome, abreviacao");
  const segDoTexto = (t: unknown): string | null => { const n = norm(t); if (!n) return null; return segs.find((s) => n === norm(s.abreviacao) || n.includes(norm(s.nome).split(" ")[0]) || norm(s.nome).includes(n))?.id ?? null; };

  // lotes: cards 1046 classificados (proposta) com mais de 1 endereço ou com itens de renovação
  const classif = await todas<any>("erp_proposta_emissao_classif", "documento_id, chaves", undefined, "documento_id");
  const docIds = classif.map((c) => c.documento_id);
  const origens = (await Promise.all(chunk(docIds, 200).map((c) => sb.from("erp_origens").select("documento_id, entity_type_id, item_id, titulo, dados_legiveis").in("documento_id", c).eq("entity_type_id", 1046)))).flatMap((r) => r.data ?? []);
  const itensRen = (await Promise.all(chunk(origens.map((o) => o.documento_id), 200).map((c) => sb.from("erp_renovacao_itens").select("documento_lote_id, documento_anterior_id").in("documento_lote_id", c)))).flatMap((r) => r.data ?? []);
  const lotes = origens.filter((o) => Number((o.dados_legiveis as any)?.["Quantidade de endereços"] ?? 1) > 1 || itensRen.some((i) => i.documento_lote_id === o.documento_id));
  const loteDocs = await porId("erp_documentos", "id, seguradora_id, imobiliaria_principal_id, vigencia_inicio, dt_proposta", lotes.map((l) => l.documento_id));
  const anteriores = await porId("erp_documentos", "id, seguradora_id, locatario_id, ramo_id, numero_apolice, vigencia_fim", itensRen.map((i) => i.documento_anterior_id));
  const locIds = anteriores.map((a) => a.locatario_id);
  console.log(`lotes: ${lotes.length} (com itens de renovação: ${new Set(itensRen.map((i) => i.documento_lote_id)).size}); itens de renovação: ${itensRen.length}`);

  // documentos do ERP que podem ser a apólice nova
  const docs = await todas<any>("erp_documentos", "id, origem, tipo, tipo_corp, situacao, seguradora_id, locatario_id, ramo_id, imobiliaria_principal_id, numero_apolice, vigencia_inicio, documento_renovado_id",
    (q) => q.gte("vigencia_inicio", DESDE).in("tipo", ["A", "F"]).not("situacao", "in", "(duplicado,cotacao,recusado,perdido)"));
  const ramos = await todas<any>("erp_ramos", "id, produto");
  const produto = new Map(ramos.map((r) => [r.id, r.produto]));
  const porRenovado = new Map<string, any[]>(); const porLoc = new Map<string, any[]>();
  for (const d of docs) { if (d.documento_renovado_id) porRenovado.set(d.documento_renovado_id, [...(porRenovado.get(d.documento_renovado_id) ?? []), d]); if (d.locatario_id) porLoc.set(d.locatario_id, [...(porLoc.get(d.locatario_id) ?? []), d]); }
  const locs = new Map((await porId("locatarios", "id, nome, cpf", [...locIds, ...docs.map((d) => d.locatario_id)])).map((l) => [l.id, l]));

  // fontes de prova de emissão (mesmas regras do classificador de propostas)
  const naoIdentifica = new Set<string>();
  for (const i of await todas<any>("imobiliarias", "id, cnpj")) if (dig(i.cnpj).length >= 11) naoIdentifica.add(dig(i.cnpj));
  for (const c of await todas<any>("erp_corretoras", "id, cnpj")) if (dig(c.cnpj).length >= 11) naoIdentifica.add(dig(c.cnpj));
  const extratos = new Map((await todas<any>("erp_extratos_seguradora", "id, seguradora_id, competencia, pago_em")).map((e) => [e.id, e]));
  const extLinhas = await todas<any>("erp_extrato_linhas", "id, extrato_id, apolice, cliente, cpf_cnpj, valor_comissao");
  const portalCom = new Map((await todas<any>("erp_portal_comissoes", "id, seguradora_id, pago_em")).map((p) => [p.id, p]));
  const portalLinhas = await todas<any>("erp_portal_comissao_linhas", "id, comissao_id, numero_apolice, cliente, valor_comissao");
  const portalParc = await todas<any>("erp_portal_parcelas", "id, seguradora_id, segurado_exibido, cpf_cnpj, numero_apolice_chave, vencimento, status_portal");
  const emitidas = await todas<any>("erp_seguradora_emitidas", "id, seguradora_id, numero_apolice, nome_segurado, cpf_cnpj, vigencia_inicio, dt_emissao");
  const corpCom = await todas<any>("erp_corp_comissoes", "id, situacao, seg_abrev, cliente, cpf_cnpj, apolice, inicio_vig, dt_emissao", (q) => q.gte("inicio_vig", DESDE));
  const pdfApo = await todas<any>("erp_apolice_pdf_identidade", "fonte_pdf, seg, numero_pdf, cpfs, vig_ini", (q) => q.gte("vig_ini", DESDE), "fonte_pdf");
  const freq = new Map<string, Set<string>>();
  for (const p of pdfApo) for (const c of p.cpfs ?? []) { const k = dig(c); if (!freq.has(k)) freq.set(k, new Set()); freq.get(k)!.add(semZero(p.numero_pdf) || p.fonte_pdf); }
  for (const [k, s] of freq) if (s.size > 5) naoIdentifica.add(k);
  const anexos = await todas<any>("erp_email_anexos", "id, classe, seguradora, numeros, cpf_cnpj", (q) => q.in("classe", ["apolice", "certificado", "boleto"]));
  const proLab = await todas<any>("erp_pro_labore_linhas", "id, seguradora_id, apolice, segurado, data_pagamento");
  const idxCpf = <T,>(xs: T[], f: (x: T) => unknown[]) => { const m = new Map<string, T[]>(); for (const x of xs) for (const v of f(x)) { const k = dig(v); if (k.length >= 11 && !naoIdentifica.has(k)) m.set(k, [...(m.get(k) ?? []), x]); } return m; };
  const idxNome = <T,>(xs: T[], f: (x: T) => unknown) => { const m = new Map<string, T[]>(); for (const x of xs) { const k = norm(f(x)); if (k.split(" ").length >= 2) m.set(k, [...(m.get(k) ?? []), x]); } return m; };
  const iExtCpf = idxCpf(extLinhas, (l) => [l.cpf_cnpj]), iExtNome = idxNome(extLinhas, (l) => l.cliente);
  const iPortNome = idxNome(portalLinhas, (l) => l.cliente);
  const iParcCpf = idxCpf(portalParc, (p) => [p.cpf_cnpj]), iParcNome = idxNome(portalParc, (p) => p.segurado_exibido);
  const iEmiCpf = idxCpf(emitidas, (s) => [s.cpf_cnpj]), iEmiNome = idxNome(emitidas, (s) => s.nome_segurado);
  const iCorpCpf = idxCpf(corpCom.filter((c) => c.situacao === "recebida" || semZero(c.apolice).length >= 5), (c) => [c.cpf_cnpj]);
  const iPdfCpf = idxCpf(pdfApo, (p) => p.cpfs ?? []);
  const iAnexoCpf = idxCpf(anexos, (a) => a.cpf_cnpj ?? []);
  const iProLabNome = idxNome(proLab, (x) => x.segurado);
  console.log(`docs ${docs.length}; fontes carregadas`);

  const provasDo = (cpf: string, nome: string, ref: string | null) => {
    const p: any[] = []; const jan = (d?: string | null, a = 30, b = 150) => !ref || !d || (dias(d, ref) >= -a && dias(d, ref) <= b);
    const ok = cpf.length >= 11 && !naoIdentifica.has(cpf); const n = norm(nome); const nomeOk = n.split(" ").length >= 2;
    for (const l of [...(ok ? iExtCpf.get(cpf) ?? [] : []), ...(nomeOk ? iExtNome.get(n) ?? [] : [])]) { const e = extratos.get(l.extrato_id); if (e && Number(l.valor_comissao) > 0 && jan(e.pago_em ?? e.competencia, 10, 200)) p.push({ fonte: "extrato da seguradora (comissão paga)", ref: l.id, numero: l.apolice, data: e.pago_em ?? e.competencia }); }
    for (const l of nomeOk ? iPortNome.get(n) ?? [] : []) { const c = portalCom.get(l.comissao_id); if (c && Number(l.valor_comissao) > 0 && jan(c.pago_em, 10, 200)) p.push({ fonte: "portal da seguradora: comissão", ref: l.id, numero: l.numero_apolice, data: c.pago_em }); }
    for (const x of [...(ok ? iParcCpf.get(cpf) ?? [] : []), ...(nomeOk ? iParcNome.get(n) ?? [] : [])]) if (jan(x.vencimento, 10, 400)) p.push({ fonte: `portal da seguradora: parcela (${x.status_portal})`, ref: x.id, numero: x.numero_apolice_chave, data: x.vencimento });
    for (const x of [...(ok ? iEmiCpf.get(cpf) ?? [] : []), ...(nomeOk ? iEmiNome.get(n) ?? [] : [])]) if (jan(x.vigencia_inicio, 30, 90)) p.push({ fonte: "relatório de emitidas da seguradora", ref: x.id, numero: x.numero_apolice, data: x.dt_emissao });
    for (const x of ok ? iCorpCpf.get(cpf) ?? [] : []) if (jan(x.inicio_vig, 30, 60)) p.push({ fonte: `comissão no Corp (${x.situacao})`, ref: String(x.id), numero: x.apolice, data: x.inicio_vig });
    for (const x of ok ? iPdfCpf.get(cpf) ?? [] : []) if (jan(x.vig_ini, 30, 60)) p.push({ fonte: "PDF da apólice lido", ref: x.fonte_pdf, numero: x.numero_pdf, data: x.vig_ini });
    for (const x of ok ? iAnexoCpf.get(cpf) ?? [] : []) p.push({ fonte: `anexo de e-mail (${x.classe})`, ref: x.id });
    for (const x of nomeOk ? iProLabNome.get(n) ?? [] : []) if (jan(x.data_pagamento, 10, 200)) p.push({ fonte: "pró-labore pago pela seguradora", ref: x.id, numero: x.apolice, data: x.data_pagamento });
    return [...new Map(p.map((x) => [`${x.fonte}|${x.ref}`, x])).values()];
  };

  const linhas: any[] = []; const resumoLote = new Map<string, any>();
  for (const l of lotes) {
    const ld = loteDocs.find((d) => d.id === l.documento_id); const dl = (l.dados_legiveis ?? {}) as any;
    const ef = String(dl["Data da mudança de etapa"] ?? ld?.dt_proposta ?? "").slice(0, 10) || null;
    const meus = itensRen.filter((i) => i.documento_lote_id === l.documento_id);
    const res = { qtd: Number(dl["Quantidade de endereços"] ?? 0) || null, contratados: Number(dl["Endereços contratados"] ?? 0) || null, itens: 0, emitidos_vinculaveis: 0, emitidos_sem_documento: 0, nao_emitidos: 0, tipo: meus.length ? "renovação" : "novos" };
    const usadas = new Set<string>();
    if (meus.length) {
      for (const it of meus) {
        const a = anteriores.find((x) => x.id === it.documento_anterior_id); if (!a) continue;
        const loc = locs.get(a.locatario_id); const prod = produto.get(a.ramo_id);
        // cada apólice nova responde por UM item (segurado com vários imóveis no lote não pode reaproveitar a mesma)
        const livre = (n: any) => !usadas.has(n.id);
        const nova = (porRenovado.get(a.id) ?? []).find(livre) ?? (porLoc.get(a.locatario_id) ?? []).find((n) => livre(n) && n.id !== a.id && produto.get(n.ramo_id) === prod && Math.abs(dias(n.vigencia_inicio, a.vigencia_fim)) <= 30 && dias(n.vigencia_inicio, a.vigencia_fim) >= -20);
        if (nova) usadas.add(nova.id);
        let cat: 1 | 2 | 3, rot: string, provas: any[] = [], num: string | null = null;
        if (nova) { cat = 2; rot = nova.seguradora_id !== a.seguradora_id ? "renovado em outra seguradora (apólice nova no ERP)" : "renovado (apólice nova no ERP)"; num = nova.numero_apolice; }
        else { provas = provasDo(dig(loc?.cpf), loc?.nome ?? "", a.vigencia_fim);
          const fortes = provas.filter((p) => !/^anexo/.test(p.fonte)); const nums = [...new Set(fortes.map((p) => semZero(p.numero)).filter((x) => x.length >= 5 && x !== semZero(a.numero_apolice)))];
          if (nums.length || fortes.some((p) => /comissão|parcela|emitidas/.test(p.fonte) && semZero(p.numero) !== semZero(a.numero_apolice))) { cat = 3; rot = "emitido, sem documento no ERP"; num = nums.length === 1 ? nums[0] : nums.length ? `vários: ${nums.slice(0, 3).join(", ")}` : null; }
          else { cat = 1; rot = (a.vigencia_fim ?? "") >= new Date().toISOString().slice(0, 10) ? "ainda não venceu / não emitido" : "não renovado / não emitido (nenhuma prova)"; } }
        res.itens++; if (cat === 2) res.emitidos_vinculaveis++; else if (cat === 3) res.emitidos_sem_documento++; else res.nao_emitidos++;
        linhas.push({ lote_documento_id: l.documento_id, documento_anterior_id: a.id, documento_novo_id: nova?.id ?? null, categoria: cat, rotulo: rot, numero_apolice_encontrado: num, segurado: loc?.nome ?? null, provas: provas.slice(0, 15) });
      }
    } else if (ld?.imobiliaria_principal_id && ef) {
      const novos = docs.filter((d) => d.origem !== "bitrix" && d.imobiliaria_principal_id === ld.imobiliaria_principal_id && (!ld.seguradora_id || d.seguradora_id === ld.seguradora_id) && d.tipo_corp === "NOVO" && dias(d.vigencia_inicio, ef) >= -20 && dias(d.vigencia_inicio, ef) <= 45);
      for (const n of novos) { res.itens++; res.emitidos_vinculaveis++; linhas.push({ lote_documento_id: l.documento_id, documento_anterior_id: null, documento_novo_id: n.id, categoria: 2, rotulo: "apólice nova da imobiliária no período do lote (conferir item)", numero_apolice_encontrado: n.numero_apolice, segurado: locs.get(n.locatario_id)?.nome ?? null, provas: [] }); }
      const esperado = res.contratados ?? res.qtd ?? 0; if (esperado > res.itens) res.nao_emitidos = esperado - res.itens;
    }
    resumoLote.set(l.documento_id, res);
  }
  const tot = { lotes: resumoLote.size, itens: linhas.length, cat2: linhas.filter((x) => x.categoria === 2).length, cat3: linhas.filter((x) => x.categoria === 3).length, cat1: linhas.filter((x) => x.categoria === 1).length };
  console.log(tot);
  console.log([...resumoLote.entries()].sort((a, b) => (b[1].contratados ?? b[1].qtd ?? 0) - (a[1].contratados ?? a[1].qtd ?? 0)).slice(0, 15).map(([id, r]) => `${lotes.find((l) => l.documento_id === id)?.item_id} ${String(lotes.find((l) => l.documento_id === id)?.titulo).slice(0, 34)} | ${r.tipo} qtd ${r.qtd} contrat ${r.contratados} | vinc ${r.emitidos_vinculaveis} semdoc ${r.emitidos_sem_documento} nao ${r.nao_emitidos}`).join("\n"));
  if (GRAVAR) {
    await sb.from("erp_lote_item_emissao").delete().in("lote_documento_id", [...resumoLote.keys()]);
    for (const c of chunk(linhas, 300)) { const { error } = await sb.from("erp_lote_item_emissao").insert(c.map((x) => ({ ...x, atualizado_em: new Date().toISOString() }))); if (error) throw error; }
    for (const [id, r] of resumoLote) {
      const esperado = r.contratados ?? r.qtd; const emitidos = r.emitidos_vinculaveis + r.emitidos_sem_documento;
      const rot = `lote (${r.tipo}): ${emitidos}${esperado ? ` de ${esperado} contratados` : ""} emitidos — ${r.emitidos_vinculaveis} com apólice no ERP, ${r.emitidos_sem_documento} sem documento; ${r.nao_emitidos} sem prova`;
      const cat = r.emitidos_sem_documento ? 3 : r.emitidos_vinculaveis ? 2 : 1;
      await sb.from("erp_proposta_emissao_classif").update({ lote: r, rotulo: rot, categoria: cat, numero_apolice_encontrado: null }).eq("documento_id", id);
    }
    console.log("gravado");
  }
})().catch((e) => { console.error(e.message ?? e); process.exit(1); });
