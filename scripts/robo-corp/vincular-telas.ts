// Vincula ao ERP o que foi LIDO das telas do Corp (erp_corp_telas_documento.dados, status 'lida'; OCR local, nível 8 = Corp só comparação).
// Regras: só preenche o que está VAZIO e passa na validação cruzada; nunca sobrescreve; vencimento provado (PDF/fatura) nunca é mexido; nº da apólice faltante = sugestão.
// Tudo fica em erp_corp_tela_vinculos (preenchido / conferido / divergente / sugestão, com valor_anterior=null para o desfazer) = lista de divergências do Matheus.
// Ensaio por padrão; --gravar grava; --so NN[,NN] limita.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/vincular-telas.ts [--gravar] [--so 101336]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { normNome } from "@/lib/erp/tarefaCadastro";
import { validarCnpjOuCpf } from "@/lib/validacoesBr";

const GRAVAR = process.argv.includes("--gravar");
const so = process.argv.includes("--so") ? new Set(process.argv[process.argv.indexOf("--so") + 1].split(",")) : null;
const LOTE = `TELAS-VINCULO-${new Date().toISOString().slice(0, 10)}`;
const VERSAO = 2;
const sb = createServiceClient();
const em = <T,>(xs: T[], n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const digs = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
const eq = (a: number | null | undefined, b: number | null | undefined, tol = 0.05) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol;
const hoje = new Date().toISOString().slice(0, 10);

async function todas<T>(tabela: string, cols: string, filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    let q: any = sb.from(tabela).select(cols).order("id").range(de, de + 999); if (filtro) q = filtro(q);
    const { data, error } = await q; if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  return out;
}
const FORMA: Record<string, string> = { cheque: "fatura", fatura: "fatura", boleto: "boleto", cartao: "cartao", "cartão": "cartao", debito: "debito", "débito": "debito", pix: "pix", dinheiro: "dinheiro" };
const formaDe = (t: unknown) => { const k = String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, ""); return FORMA[k] ?? null; };

type V = { nosso_numero_corp: number; documento_id: string; parcela_id: string | null; tela: string; campo: string; acao: "preenchido" | "conferido" | "divergente" | "sugestao"; valor_erp: string | null; valor_tela: string | null };

(async () => {
  const telas = await todas<any>("erp_corp_telas_documento", "id,nosso_numero_corp,tela,dados,documento_id,imobiliaria_id,locatario_id", (q) => { q = q.eq("status", "lida").not("documento_id", "is", null); return so ? q.in("nosso_numero_corp", [...so].map(Number)) : q; });
  const porNn = new Map<number, { documento_id: string; telas: Record<string, any> }>();
  for (const t of telas) { const d: { documento_id: string; telas: Record<string, any> } = porNn.get(t.nosso_numero_corp) ?? { documento_id: t.documento_id, telas: {} }; d.telas[t.tela] = t.dados?.campos ?? {}; porNn.set(t.nosso_numero_corp, d); }
  const docIds = [...new Set([...porNn.values()].map((d) => d.documento_id))];
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${porNn.size} documentos com telas lidas`);

  const docs = new Map<string, any>(), parcelas = new Map<string, any[]>(), itens = new Map<string, any[]>(), partes = new Map<string, any[]>(), anexosN = new Map<number, number>(), locNome = new Map<string, string>(), imobNome = new Map<string, string>();
  for (const g of em(docIds)) {
    const { data: ds } = await sb.from("erp_documentos").select("id,nosso_numero_corp,tipo,numero_apolice,numero_endosso,dt_proposta,dt_emissao,dt_emissao_fonte,vigencia_inicio,vigencia_fim,numero_proposta,forma_pagamento,qtd_parcelas,prazo_1a_dias,dia_fixo,premio_liquido,premio_adicional,desconto,custo_apolice,iof,premio_total,comissao_pct,comissao_valor,comissao_base,locatario_id,imobiliaria_principal_id").in("id", g);
    for (const d of ds ?? []) docs.set(d.id, d);
    const { data: ps } = await sb.from("erp_parcelas").select("id,documento_id,n,vencimento,valor,quitada_em,valor_quitado,vencimento_origem,vencimento_fonte").in("documento_id", g);
    for (const p of ps ?? []) (parcelas.get(p.documento_id) ?? parcelas.set(p.documento_id, []).get(p.documento_id)!).push(p);
    const { data: its } = await sb.from("erp_documento_itens").select("id,documento_id,item_n,cep,logradouro,numero,complemento,bairro,cidade,uf,contrato_inicio,contrato_fim").in("documento_id", g);
    for (const i of its ?? []) (itens.get(i.documento_id) ?? itens.set(i.documento_id, []).get(i.documento_id)!).push(i);
    const itemIds = (its ?? []).map((i) => i.id);
    for (const gi of em(itemIds)) { const { data: pt } = await sb.from("erp_item_partes").select("id,item_id,papel,nome,documento_numero").in("item_id", gi); for (const p of pt ?? []) (partes.get(p.item_id) ?? partes.set(p.item_id, []).get(p.item_id)!).push(p); }
  }
  const locIds = [...new Set([...docs.values()].map((d) => d.locatario_id).filter(Boolean))] as string[];
  for (const g of em(locIds, 200)) { const { data } = await sb.from("locatarios").select("id,nome").in("id", g); for (const l of data ?? []) locNome.set(l.id, l.nome); }
  const imIds = [...new Set([...docs.values()].map((d) => d.imobiliaria_principal_id).filter(Boolean))] as string[];
  for (const g of em(imIds, 200)) { const { data } = await sb.from("imobiliarias").select("id,nome").in("id", g); for (const l of data ?? []) imobNome.set(l.id, l.nome); }
  for (const g of em([...porNn.keys()], 100)) { const { data } = await sb.from("corp_anexos").select("nosso_numero").in("nosso_numero", g.map(String)); for (const a of data ?? []) anexosN.set(Number(a.nosso_numero), (anexosN.get(Number(a.nosso_numero)) ?? 0) + 1); }

  const vinc: V[] = []; const patchDoc = new Map<string, Record<string, unknown>>(); const patchParc: { id: string; patch: Record<string, unknown> }[] = []; const patchItem: { id: string; patch: Record<string, unknown> }[] = []; const patchParte: { id: string; patch: Record<string, unknown> }[] = [];
  const cont: Record<string, number> = {};
  const conta = (k: string) => (cont[k] = (cont[k] ?? 0) + 1);

  for (const [nn, info] of porNn) {
    const doc = docs.get(info.documento_id); if (!doc) continue;
    const T: Record<string, any> = info.telas;
    const cabOk = Object.values(T).every((c: any) => !c.cabecalho || c.cabecalho.nosso_numero == null || c.cabecalho.nosso_numero === nn);
    if (!cabOk) { conta("doc_ignorado_cabecalho_diferente"); continue; }
    const reg = (tela: string, campo: string, acao: V["acao"], erp: unknown, lida: unknown, parcela_id: string | null = null) => { vinc.push({ nosso_numero_corp: nn, documento_id: doc.id, parcela_id, tela, campo, acao, valor_erp: erp == null ? null : String(erp), valor_tela: lida == null ? null : String(lida) }); conta(`${tela}.${acao}`); };
    const pd = patchDoc.get(doc.id) ?? {}; patchDoc.set(doc.id, pd);
    const D = T.documento ?? {}; const A = T.acompanhamento ?? {};

    // ---- números do documento: nunca grava nº de apólice (só sugestão se o ERP está vazio) ----
    for (const [campo, lida, erp] of [["numero_apolice", D.numero_apolice ?? A.numero_apolice, doc.numero_apolice], ["numero_endosso", D.numero_endosso ?? A.numero_endosso, doc.numero_endosso]] as const) {
      const l = digs(lida); if (l.length < 5) continue;
      if (!erp) reg("documento", campo, "sugestao", null, l);
      else reg("documento", campo, digs(erp) === l ? "conferido" : "divergente", erp, l);
    }
    // ---- datas ----
    const dataCampo = (tela: string, campo: string, lida: string | null, erp: string | null, plaus: (x: string) => boolean = () => true) => {
      if (!lida || !plaus(lida)) return null;
      if (!erp) { reg(tela, campo, "preenchido", null, lida); return lida; }
      reg(tela, campo, erp === lida ? "conferido" : "divergente", erp, lida); return null;
    };
    const emDocA = D.dt_emissao && A.dt_emissao ? (D.dt_emissao === A.dt_emissao ? D.dt_emissao : null) : (D.dt_emissao ?? A.dt_emissao ?? null); // duas leituras que discordam = não confia
    const dem = dataCampo("documento", "dt_emissao", emDocA, doc.dt_emissao, (x) => x <= hoje && x >= "2000-01-01" && (!(D.dt_proposta ?? doc.dt_proposta) || x >= (D.dt_proposta ?? doc.dt_proposta)));
    if (dem) { pd.dt_emissao = dem; pd.dt_emissao_fonte = "corp_tela"; pd.dt_emissao_nivel = 8; pd.dt_emissao_lida_em = new Date().toISOString(); }
    const dpr = dataCampo("documento", "dt_proposta", D.dt_proposta, doc.dt_proposta, (x) => x <= hoje && x >= "2000-01-01"); if (dpr) pd.dt_proposta = dpr;
    const vi = D.vigencia_inicio, vf = D.vigencia_fim, okVig = vi && vf && vf > vi && vf <= "2100-01-01";
    if (okVig) {
      const a = dataCampo("documento", "vigencia_inicio", vi, doc.vigencia_inicio); if (a) pd.vigencia_inicio = a;
      const b = dataCampo("documento", "vigencia_fim", vf, doc.vigencia_fim); if (b) pd.vigencia_fim = b;
    }
    // ---- nº da proposta, forma de pagamento, parcelas, prazo, dia fixo ----
    const np = digs(D.numero_proposta); if (np.length >= 5) { if (!doc.numero_proposta) { reg("documento", "numero_proposta", "preenchido", null, np); pd.numero_proposta = np; } else reg("documento", "numero_proposta", digs(doc.numero_proposta) === np ? "conferido" : "divergente", doc.numero_proposta, np); }
    const fp = formaDe(D.forma_pagamento);
    if (fp) { if (!doc.forma_pagamento) { reg("documento", "forma_pagamento", "preenchido", null, fp); pd.forma_pagamento = fp; } else reg("documento", "forma_pagamento", doc.forma_pagamento === fp ? "conferido" : "divergente", doc.forma_pagamento, fp); }
    const nTela = (T.parcelas?.parcelas ?? []).length;
    const inteiroCampo = (campo: string, lida: unknown, erp: unknown, ok: (n: number) => boolean) => { if (typeof lida !== "number" || !ok(lida)) return; if (erp == null) { reg("documento", campo, "preenchido", null, lida); pd[campo === "qtde_parcelas" ? "qtd_parcelas" : campo === "prazo_1a_parcela" ? "prazo_1a_dias" : "dia_fixo"] = lida; } else reg("documento", campo, Number(erp) === lida ? "conferido" : "divergente", erp, lida); };
    inteiroCampo("qtde_parcelas", nTela && D.qtde_parcelas === nTela ? D.qtde_parcelas : (D.qtde_parcelas && !nTela ? D.qtde_parcelas : null), doc.qtd_parcelas, (n) => n >= 1 && n <= 60); // preenche só se bate com as linhas da tela Parcelas
    inteiroCampo("prazo_1a_parcela", D.prazo_1a_parcela, doc.prazo_1a_dias, (n) => n >= 0 && n <= 120);
    inteiroCampo("dia_fixo", D.dia_fixo, doc.dia_fixo, (n) => n >= 0 && n <= 31);
    // ---- prêmios: preenche vazio só se a soma fecha (líquido + adicional + custo + IOF − desconto = total) ----
    const liq = D.premio_liquido, adi = D.premio_adicional ?? 0, cus = D.custo ?? 0, iof = D.iof ?? 0, des = D.desconto ?? 0, tot = D.premio_total;
    const somaFecha = liq != null && tot != null && eq(liq + adi + cus + iof - des, tot, 0.06);
    for (const [campo, col, lida] of [["premio_liquido", "premio_liquido", D.premio_liquido], ["premio_adicional", "premio_adicional", D.premio_adicional], ["desconto", "desconto", D.desconto], ["custo", "custo_apolice", D.custo], ["iof", "iof", D.iof], ["premio_total", "premio_total", D.premio_total]] as const) {
      if (typeof lida !== "number") continue; const erp = doc[col];
      if (erp == null) { if (somaFecha) { reg("documento", campo, "preenchido", null, lida); pd[col] = lida; } } else reg("documento", campo, eq(Number(erp), lida) ? "conferido" : "divergente", erp, lida);
    }
    // ---- comissão: preenche % só se base × % ≈ valor ----
    const cb = D.comissao_base, cp = D.comissao_pct ?? T.comissoes?.pct_sobre_base, cv = T.comissoes?.valor_total ?? D.comissao_valor;
    const comFecha = cb != null && cp != null && cv != null && eq(cb * cp / 100, cv, 0.06);
    if (typeof cp === "number") { if (doc.comissao_pct == null) { if (comFecha) { reg("comissoes", "comissao_pct", "preenchido", null, cp); pd.comissao_pct = cp; } } else reg("comissoes", "comissao_pct", eq(Number(doc.comissao_pct), cp, 0.01) ? "conferido" : "divergente", doc.comissao_pct, cp); }
    if (typeof cv === "number") { if (doc.comissao_valor == null) { if (comFecha) { reg("comissoes", "comissao_valor", "preenchido", null, cv); pd.comissao_valor = cv; } } else reg("comissoes", "comissao_valor", eq(Number(doc.comissao_valor), cv) ? "conferido" : "divergente", doc.comissao_valor, cv); }
    // ---- cliente (titular): confere o nome com o locatário ----
    const nomeT = D.cliente?.nome; if (nomeT && doc.locatario_id && locNome.get(doc.locatario_id)) { const a = normNome(nomeT), b = normNome(locNome.get(doc.locatario_id)!); reg("documento", "cliente_nome", a === b || a.startsWith(b) || b.startsWith(a) ? "conferido" : "divergente", locNome.get(doc.locatario_id), nomeT); }

    // ---- parcelas: confere vencimento/valor; vencimento provado (PDF/fatura) nunca é mexido; igual => marca origem 'tela_corp' só quando ainda sem origem ----
    const ep = parcelas.get(doc.id) ?? [];
    for (const p of (T.parcelas?.parcelas ?? []) as any[]) {
      const e = ep.find((x) => x.n === p.n);
      if (!e) { reg("parcelas", `parcela_${p.n}`, "sugestao", null, `${p.vencimento} ${p.valor}`); continue; }
      const provado = e.vencimento_origem === "pdf_apolice" || e.vencimento_origem === "fatura_seguradora" || e.vencimento_fonte === "fatura";
      if (p.vencimento) {
        if (!e.vencimento) { if (!provado) { reg("parcelas", "vencimento", "preenchido", null, p.vencimento, e.id); patchParc.push({ id: e.id, patch: { vencimento: p.vencimento, vencimento_origem: "tela_corp" } }); } }
        else if (e.vencimento === p.vencimento) { reg("parcelas", "vencimento", "conferido", e.vencimento, p.vencimento, e.id); if (!e.vencimento_origem) patchParc.push({ id: e.id, patch: { vencimento_origem: "tela_corp" } }); }
        else reg("parcelas", "vencimento", "divergente", e.vencimento, p.vencimento, e.id);
      }
      if (typeof p.valor === "number") { if (e.valor == null) { reg("parcelas", "valor", "preenchido", null, p.valor, e.id); patchParc.push({ id: e.id, patch: { valor: p.valor } }); } else reg("parcelas", "valor", eq(Number(e.valor), p.valor) ? "conferido" : "divergente", e.valor, p.valor, e.id); }
      if (p.dt_quitacao) { if (!e.quitada_em) reg("parcelas", "quitada_em", "sugestao", null, p.dt_quitacao, e.id); else reg("parcelas", "quitada_em", e.quitada_em === p.dt_quitacao ? "conferido" : "divergente", e.quitada_em, p.dt_quitacao, e.id); }
    }
    if (nTela) for (const e of ep) if (!(T.parcelas.parcelas as any[]).some((p) => p.n === e.n)) reg("parcelas", `parcela_${e.n}`, "divergente", `${e.vencimento} ${e.valor}`, null, e.id);

    // ---- itens: endereço e contrato (preenche vazio) + CPF/CNPJ dos garantidos (só válido e com o nome batendo) ----
    const I = T.itens; const ei = (itens.get(doc.id) ?? [])[0];
    if (I && ei) {
      const pi: Record<string, unknown> = {};
      for (const [campo, col, lida] of [["cep", "cep", I.cep], ["logradouro", "logradouro", I.logradouro], ["numero", "numero", I.numero], ["complemento", "complemento", I.complemento], ["bairro", "bairro", I.bairro], ["cidade", "cidade", I.cidade], ["uf", "uf", I.uf && /^[A-Z]{2}$/.test(String(I.uf)) ? I.uf : null], ["inicio_contrato", "contrato_inicio", I.inicio_contrato], ["final_contrato", "contrato_fim", I.final_contrato]] as const) {
        if (lida == null || lida === "") continue; const erp = (ei as any)[col];
        if (erp == null || erp === "") { reg("itens", campo, "preenchido", null, lida); pi[col] = lida; }
        else { const a = normNome(String(erp)), b = normNome(String(lida)); reg("itens", campo, a === b || a.includes(b) || b.includes(a) ? "conferido" : "divergente", erp, lida); }
      }
      if (Object.keys(pi).length) patchItem.push({ id: ei.id, patch: pi });
      for (const g of (I.garantidos ?? []) as any[]) {
        const parte = (partes.get(ei.id) ?? []).find((p) => normNome(p.nome ?? "") === normNome(g.nome ?? "") && g.nome);
        if (!parte || !g.cpf_cnpj) continue;
        if (!validarCnpjOuCpf(g.cpf_cnpj)) { reg("itens", "garantido_cpf_cnpj", "sugestao", parte.documento_numero, `${g.cpf_cnpj} (dígito verificador inválido: conferir)`); continue; }
        if (!parte.documento_numero) { reg("itens", "garantido_cpf_cnpj", "preenchido", null, g.cpf_cnpj); patchParte.push({ id: parte.id, patch: { documento_numero: g.cpf_cnpj } }); }
        else reg("itens", "garantido_cpf_cnpj", digs(parte.documento_numero) === digs(g.cpf_cnpj) ? "conferido" : "divergente", parte.documento_numero, g.cpf_cnpj);
      }
    }
    // ---- repasses: o produtor lido deve bater com a imobiliária do documento ----
    for (const r of (T.repasses?.repasses ?? []) as any[]) {
      if (!r.produtor || /segimob|o2 corretora/i.test(r.produtor)) continue;
      const im = doc.imobiliaria_principal_id ? imobNome.get(doc.imobiliaria_principal_id) : null;
      if (!im) { reg("repasses", "produtor", "sugestao", null, r.produtor); continue; }
      const a = normNome(r.produtor), b = normNome(im);
      reg("repasses", "produtor", a === b || b.includes(a) || a.includes(b) ? "conferido" : "divergente", im, r.produtor);
    }
    // ---- observações: pró-labore (só sugestão: a regra existente decide) ----
    if (T.observacoes?.tem_pro_labore) reg("observacoes", "pro_labore", "sugestao", null, "observação menciona pró-labore");
    // ---- anexos: a tela mostra mais anexos do que temos baixados ----
    const q = T.anexos?.quantidade; if (typeof q === "number" && q > 0) { const tem = anexosN.get(nn) ?? 0; reg("anexos", "quantidade", q <= tem ? "conferido" : "divergente", tem, q); }
    if (Object.keys(pd).length === 0) patchDoc.delete(doc.id);
  }

  console.log("registros:", JSON.stringify(cont));
  const porAcao: Record<string, number> = {}; for (const v of vinc) porAcao[v.acao] = (porAcao[v.acao] ?? 0) + 1;
  console.log(`vínculos: ${vinc.length} ${JSON.stringify(porAcao)} | documentos a atualizar ${patchDoc.size}, parcelas ${patchParc.length}, itens ${patchItem.length}, partes ${patchParte.length}`);
  if (!GRAVAR) return;

  let erros = 0;
  for (const [id, patch] of patchDoc) { const { error } = await sb.from("erp_documentos").update(patch).eq("id", id); if (error) { erros++; console.log(`doc ${id}: ${error.message}`); } }
  for (const x of patchParc) { const { error } = await sb.from("erp_parcelas").update(x.patch).eq("id", x.id); if (error) { erros++; console.log(`parcela ${x.id}: ${error.message}`); } }
  for (const x of patchItem) { const { error } = await sb.from("erp_documento_itens").update(x.patch).eq("id", x.id); if (error) { erros++; console.log(`item ${x.id}: ${error.message}`); } }
  for (const x of patchParte) { const { error } = await sb.from("erp_item_partes").update(x.patch).eq("id", x.id); if (error) { erros++; console.log(`parte ${x.id}: ${error.message}`); } }
  // log dos vínculos: o que já foi 'preenchido' numa rodada anterior é mantido (é o registro do desfazer); o resto é substituído
  const existentes = new Map<string, { id: string; acao: string }>();
  for (const g of em([...porNn.keys()], 100)) { const { data } = await sb.from("erp_corp_tela_vinculos").select("id,nosso_numero_corp,tela,campo,parcela_id,acao").in("nosso_numero_corp", g); for (const e of data ?? []) existentes.set(`${e.nosso_numero_corp}|${e.tela}|${e.campo}|${e.parcela_id ?? ""}`, { id: e.id, acao: e.acao }); }
  const novos: any[] = []; let atualizados = 0, mantidos = 0;
  for (const v of vinc) {
    const k = `${v.nosso_numero_corp}|${v.tela}|${v.campo}|${v.parcela_id ?? ""}`; const ex = existentes.get(k);
    const row = { ...v, fonte: "corp_tela", nivel: 8, versao_leitor: VERSAO, lote: LOTE };
    if (!ex) { novos.push(row); continue; }
    if (ex.acao === "preenchido") { mantidos++; continue; }
    const { error } = await sb.from("erp_corp_tela_vinculos").update({ acao: v.acao, valor_erp: row.valor_erp, valor_tela: row.valor_tela, lote: LOTE, versao_leitor: VERSAO }).eq("id", ex.id); if (error) erros++; else atualizados++;
  }
  for (const g of em(novos, 500)) { const { error } = await sb.from("erp_corp_tela_vinculos").insert(g); if (error) { erros++; console.log("insert vínculos:", error.message); } }
  console.log(`gravado: documentos ${patchDoc.size}, parcelas ${patchParc.length}, itens ${patchItem.length}, partes ${patchParte.length}; vínculos novos ${novos.length}, atualizados ${atualizados}, mantidos (preenchido) ${mantidos}; erros ${erros}`);
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
