// Carrega o relatório OFICIAL "Apólices Emitidas" baixado do portal da seguradora (Tokio: XML <apolicesEmitidasResumido> ou XLS "ApolicesEmitidas"; mesmo formato nos outros meses) = nível 1.
// 1) grava TODAS as linhas em erp_seguradora_emitidas (linha completa em jsonb; arquivo + sha256; chave seguradora+apólice+endosso+parcela; reprocessar não duplica);
// 2) vincula ao ERP pelo nº da apólice (+ seguradora): dt_emissao nível 1 onde vazia/nível mais baixo (divergência com nível 1 só é listada); vigência, prêmio, CPF/CNPJ e imobiliária só COMPARAM;
//    proposta pendente que o relatório prova emitida vira apólice (nº + nome/CPF + vigência batendo; senão 'provável'); apólice sem documento no ERP vai para erp_emissao_sem_documento;
//    parcela/vencimento compara com erp_parcelas (sem sobrescrever vencimento provado por fatura/PDF); "Parceiro de negócio" vira registro de fonte (sugestão), nunca cria imobiliária.
// Ensaio por padrão; --gravar grava.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-emitidas-seguradora.ts <arquivo> [<arquivo>...] [--seguradora TOKI] [--gravar]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
// @ts-expect-error xml2js sem tipos
import { parseStringPromise } from "xml2js";
import { createServiceClient } from "@/lib/supabase/service";
import { normNome } from "@/lib/erp/tarefaCadastro";

const args = process.argv.slice(2);
const GRAVAR = args.includes("--gravar");
const SEGURADORA = args.includes("--seguradora") ? args[args.indexOf("--seguradora") + 1] : "TOKI";
const arquivos = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--seguradora");
const sb = createServiceClient();
const PORTAL = ({ TOKI: "tokio" } as Record<string, string>)[SEGURADORA] ?? SEGURADORA.toLowerCase(); // nome do portal nas fontes (portal_tokio)
const LOTE = `EMITIDAS-${SEGURADORA}-${new Date().toISOString().slice(0, 10)}`;
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const sem0 = (s: unknown) => dig(s).replace(/^0+/, "");
const em = <T,>(xs: T[], n = 150) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const txt = (v: unknown) => { const s = String(v ?? "").replace(/\s+/g, " ").trim(); return s === "" ? null : s; };
const dataBr = (s: unknown): string | null => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s ?? "")); if (!m) return null; const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); return d.getUTCMonth() === +m[2] - 1 ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const num = (s: unknown): number | null => { if (s == null || s === "") return null; const t = String(s).trim(); const n = /,\d{1,2}$/.test(t) ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t); return Number.isFinite(n) ? n : null; };

type Linha = { numero_apolice: string; endosso: string; parcela: string; dt_emissao: string | null; vigencia_inicio: string | null; produto: string | null; ramo: string | null; premio: number | null; comissao: number | null; nome_segurado: string | null; cpf_cnpj: string | null; parceiro_codigo: string | null; parceiro_nome: string | null; codigo_cliente: string | null; numero_operacao: string | null; numero_certificado: string | null; tipo_recebimento: string | null; tipo_seguro: string | null; vencimento: string | null; chassi: string | null; origem_venda: string | null; linha: Record<string, unknown> };

async function lerArquivo(arq: string): Promise<Linha[]> {
  const ext = path.extname(arq).toLowerCase(); const out: Linha[] = [];
  if (ext === ".xml") {
    const j = await parseStringPromise(fs.readFileSync(arq, "utf8"), { explicitArray: false, trim: true });
    const lista = j?.apolicesEmitidasResumido?.apolicesEmitidas?.apolice; const itens = Array.isArray(lista) ? lista : lista ? [lista] : [];
    for (const a of itens as Record<string, string>[]) {
      const pcod = txt(a.codigoParceiroNegocio); const pnome = txt(a.nomeParceiroNegocio);
      out.push({ numero_apolice: String(a.apolice).trim(), endosso: String(a.endosso ?? "0").trim() || "0", parcela: "", dt_emissao: dataBr(a.dataEmissao), vigencia_inicio: dataBr(a.vigencia ?? a.vigenciaFormatada), produto: txt(a.descricaoProduto), ramo: txt(a.ramo), premio: num(a.premio), comissao: num(a.comissao), nome_segurado: txt(a.nomeSegurado), cpf_cnpj: txt(a.cpfCnpj), parceiro_codigo: pcod && pcod !== "0" ? pcod : null, parceiro_nome: pnome, codigo_cliente: txt(a.cdCliente), numero_operacao: txt(a.numeroOperacaoAcsel), numero_certificado: txt(a.numeroCertificadoAcsel), tipo_recebimento: txt(a.tipoRecebimento), tipo_seguro: txt(a.tipoSeguro), vencimento: null, chassi: null, origem_venda: null, linha: a });
    }
  } else {
    const wb = XLSX.readFile(arq, { raw: false }); const ws = wb.Sheets[wb.SheetNames[0]];
    for (const r of XLSX.utils.sheet_to_json<Record<string, string>>(ws, { raw: false, defval: "" })) {
      if (!txt(r["Apolice"])) continue;
      const parceiro = txt(r["Parceiro de negocio"]); const m = parceiro ? /^(\d+)\s*-\s*(.+)$/.exec(parceiro) : null;
      out.push({ numero_apolice: String(r["Apolice"]).trim(), endosso: "0", parcela: txt(r["Parcela"]) ?? "", dt_emissao: dataBr(r["Emissao"]), vigencia_inicio: dataBr(r["Vigencia"]), produto: null, ramo: txt(r["Ramo"]), premio: num(r["Premio"]), comissao: null, nome_segurado: txt(r["Segurado"]), cpf_cnpj: txt(r["CPF/CNPJ"]), parceiro_codigo: m ? m[1] : null, parceiro_nome: m ? m[2].trim() : parceiro, codigo_cliente: txt(r["Codigo Cliente"]), numero_operacao: null, numero_certificado: null, tipo_recebimento: null, tipo_seguro: null, vencimento: dataBr(r["Vencimento"]), chassi: txt(r["Chassi"]), origem_venda: txt(r["Origem Venda"]), linha: r });
    }
  }
  return out;
}

(async () => {
  if (!arquivos.length) throw new Error("informe o(s) arquivo(s) do relatório");
  const { data: segs } = await sb.from("erp_seguradoras").select("id,abreviacao").eq("abreviacao", SEGURADORA); const segId = segs?.[0]?.id ?? null;
  if (!segId) throw new Error(`seguradora ${SEGURADORA} não encontrada`);
  const todas: (Linha & { arquivo: string; sha: string; formato: string; competencia: string | null })[] = [];
  for (const arq of arquivos) {
    const buf = fs.readFileSync(arq); const sha = createHash("sha256").update(buf).digest("hex"); const ls = await lerArquivo(arq);
    const meses: Record<string, number> = {}; for (const l of ls) if (l.dt_emissao) meses[l.dt_emissao.slice(0, 7)] = (meses[l.dt_emissao.slice(0, 7)] ?? 0) + 1;
    const comp = Object.entries(meses).sort((a, b) => b[1] - a[1])[0]?.[0];
    console.log(`${path.basename(arq)}: ${ls.length} linhas, ${new Set(ls.map((l) => l.numero_apolice)).size} apólices, competência ${comp ?? "?"}`);
    for (const l of ls) todas.push({ ...l, arquivo: path.basename(arq), sha, formato: path.extname(arq).slice(1).toLowerCase(), competencia: comp ? `${comp}-01` : null });
  }
  const numeros = [...new Set(todas.map((l) => l.numero_apolice))];

  // ---- ERP: documentos pelos números, propostas pendentes, locatários ----
  const docs = new Map<string, any[]>();
  for (const g of em(numeros)) { const { data } = await sb.from("erp_documentos").select("id,numero_apolice,numero_endosso,tipo,situacao,seguradora_id,locatario_id,imobiliaria_principal_id,vigencia_inicio,dt_emissao,dt_emissao_fonte,dt_emissao_nivel,premio_liquido,premio_total,nosso_numero_corp").in("numero_apolice", g); for (const d of data ?? []) (docs.get(d.numero_apolice) ?? docs.set(d.numero_apolice, []).get(d.numero_apolice)!).push(d); }
  const { data: segAll } = await sb.from("erp_seguradoras").select("id,abreviacao"); const segAbrev = new Map((segAll ?? []).map((s) => [s.id, s.abreviacao]));
  const pend: any[] = []; for (let de = 0; ; de += 1000) { const { data } = await sb.from("erp_documentos").select("id,locatario_id,seguradora_id,vigencia_inicio,imobiliaria_principal_id,nosso_numero_corp").eq("situacao", "proposta").is("numero_apolice", null).order("id").range(de, de + 999); pend.push(...(data ?? [])); if (!data || data.length < 1000) break; }
  const locIds = [...new Set([...[...docs.values()].flat(), ...pend].map((d) => d.locatario_id).filter(Boolean))] as string[]; const loc = new Map<string, { nome: string; cpf: string }>();
  for (const g of em(locIds, 200)) { const { data } = await sb.from("locatarios").select("id,nome,cpf").in("id", g); for (const l of data ?? []) loc.set(l.id, { nome: l.nome, cpf: dig(l.cpf) }); }
  const imIds = [...new Set([...docs.values()].flat().map((d) => d.imobiliaria_principal_id).filter(Boolean))] as string[]; const imNome = new Map<string, string>();
  for (const g of em(imIds, 200)) { const { data } = await sb.from("imobiliarias").select("id,nome").in("id", g); for (const i of data ?? []) imNome.set(i.id, i.nome); }
  const { data: todasIm } = await sb.from("imobiliarias").select("id,nome,codigo_produtor_corp");
  const parcelasPorDoc = new Map<string, any[]>(); const docIdsLig = [...docs.values()].flat().map((d) => d.id);
  for (const g of em(docIdsLig)) { const { data } = await sb.from("erp_parcelas").select("id,documento_id,n,valor,vencimento,vencimento_origem,vencimento_fonte").in("documento_id", g); for (const p of data ?? []) (parcelasPorDoc.get(p.documento_id) ?? parcelasPorDoc.set(p.documento_id, []).get(p.documento_id)!).push(p); }

  const cont: Record<string, number> = {}; const c = (k: string) => (cont[k] = (cont[k] ?? 0) + 1);
  const linhasBanco: Record<string, unknown>[] = []; const updDoc: { id: string; patch: Record<string, unknown> }[] = []; const updParc: { id: string; patch: Record<string, unknown> }[] = [];
  const acomp: Record<string, unknown>[] = []; const semDoc: Record<string, unknown>[] = []; const fontesIm: Record<string, unknown>[] = [];
  const hoje = new Date().toISOString().slice(0, 10);
  const imMatch = (nome: string | null) => { if (!nome) return []; const k = normNome(nome).replace(/\b(IMOBILIARIA|IMOVEIS|LTDA|EPP|ME|SA|S A)\b/g, "").replace(/\s+/g, " ").trim(); if (k.length < 5) return []; return (todasIm ?? []).filter((i) => { const n = normNome(i.nome).replace(/\b(IMOBILIARIA|IMOVEIS|LTDA|EPP|ME|SA|S A)\b/g, "").replace(/\s+/g, " ").trim(); return n === k || n.includes(k) || k.includes(n) && n.length >= 6; }); };
  const vistoApolice = new Set<string>();

  for (const l of todas) {
    const conf: Record<string, unknown> = {}; let docId: string | null = null; let status = "sem_documento"; let imobId: string | null = null;
    const cands = (docs.get(l.numero_apolice) ?? []).filter((d) => d.tipo !== "X");
    const daSeg = cands.filter((d) => d.seguradora_id === segId); const pool = daSeg.length ? daSeg : [];
    const porVig = pool.filter((d) => d.vigencia_inicio === l.vigencia_inicio);
    const doc = pool.length === 1 ? pool[0] : porVig.length === 1 ? porVig[0] : null;
    if (!doc && pool.length > 1) { status = "ambiguo"; conf.motivo = `${pool.length} documentos com o mesmo nº`; c("ambiguo"); }
    if (!doc && cands.length && !daSeg.length) { conf.seguradora_no_erp = [...new Set(cands.map((d) => segAbrev.get(d.seguradora_id)))].join(","); }
    if (doc) {
      docId = doc.id; status = "ligado"; c("ligado");
      // dt_emissao
      if (l.dt_emissao) {
        if (!doc.dt_emissao || (doc.dt_emissao_nivel ?? 99) > 1) { conf.dt_emissao = { acao: doc.dt_emissao ? "substituido" : "preenchido", anterior: doc.dt_emissao, fonte_anterior: doc.dt_emissao_fonte, novo: l.dt_emissao }; updDoc.push({ id: doc.id, patch: { dt_emissao: l.dt_emissao, dt_emissao_fonte: "portal_tokio", dt_emissao_nivel: 1, dt_emissao_lida_em: new Date().toISOString() } }); c(doc.dt_emissao ? "dt_emissao_substituida" : "dt_emissao_preenchida"); }
        else if (doc.dt_emissao === l.dt_emissao) { conf.dt_emissao = { acao: "conferido" }; c("dt_emissao_conferida"); }
        else { conf.dt_emissao = { acao: "divergente", erp: doc.dt_emissao, fonte_erp: doc.dt_emissao_fonte, relatorio: l.dt_emissao }; c("dt_emissao_divergente"); }
      }
      // vigência, prêmio, CPF, imobiliária: só comparam
      if (l.vigencia_inicio && doc.vigencia_inicio) { const ok = doc.vigencia_inicio === l.vigencia_inicio; conf.vigencia = ok ? { acao: "conferido" } : { acao: "divergente", erp: doc.vigencia_inicio, relatorio: l.vigencia_inicio }; c(ok ? "vigencia_conferida" : "vigencia_divergente"); }
      if (l.premio != null && !l.parcela) { const ok = [doc.premio_total, doc.premio_liquido].some((v) => v != null && Math.abs(Number(v) - l.premio!) <= 0.05); conf.premio = ok ? { acao: "conferido" } : { acao: "divergente", erp_total: doc.premio_total, erp_liquido: doc.premio_liquido, relatorio: l.premio }; c(ok ? "premio_conferido" : "premio_divergente"); }
      const lo = doc.locatario_id ? loc.get(doc.locatario_id) : null;
      if (l.cpf_cnpj && lo?.cpf) { const ok = dig(l.cpf_cnpj) === lo.cpf; conf.cpf_cnpj = ok ? { acao: "conferido" } : { acao: "divergente", erp: lo.cpf, relatorio: dig(l.cpf_cnpj) }; c(ok ? "cpf_conferido" : "cpf_divergente"); }
      if (l.parceiro_nome) { const m = imMatch(l.parceiro_nome); const atual = doc.imobiliaria_principal_id; if (atual) { const ok = m.some((i) => i.id === atual); conf.imobiliaria = ok ? { acao: "conferido", erp: imNome.get(atual) } : { acao: "divergente", erp: imNome.get(atual), relatorio: l.parceiro_nome }; c(ok ? "imobiliaria_conferida" : "imobiliaria_divergente"); } imobId = atual ?? null; }
      // parcelas: no XLS a coluna "Parcela" é o VALOR da parcela e "Vencimento" a data. Acha a parcela do ERP pelo vencimento (e confere o valor) ou, se não houver, pelo valor (e confere o vencimento).
      if (l.parcela && l.vencimento) {
        const valorRel = num(l.parcela); const eps = parcelasPorDoc.get(doc.id) ?? [];
        const porVenc = eps.filter((p) => p.vencimento === l.vencimento); const porValor = valorRel == null ? [] : eps.filter((p) => p.valor != null && Math.abs(Number(p.valor) - valorRel) <= 0.05);
        if (porVenc.length === 1) { const ok = valorRel == null || porVenc[0].valor == null || Math.abs(Number(porVenc[0].valor) - valorRel) <= 0.05; conf.parcela = ok ? { acao: "conferido" } : { acao: "divergente", campo: "valor", erp: porVenc[0].valor, relatorio: valorRel }; c(ok ? "parcela_conferida" : "parcela_valor_divergente"); }
        else if (porValor.length >= 1 && !porVenc.length) { const ep = porValor.sort((x, y) => Math.abs(Date.parse(x.vencimento) - Date.parse(l.vencimento!)) - Math.abs(Date.parse(y.vencimento) - Date.parse(l.vencimento!)))[0]; const provado = ep.vencimento_fonte === "fatura" || ep.vencimento_origem === "fatura_seguradora" || ep.vencimento_origem === "pdf_apolice"; conf.parcela = { acao: "divergente", campo: "vencimento", erp: ep.vencimento, relatorio: l.vencimento, valor: valorRel, vencimento_provado_no_erp: provado }; c(provado ? "parcela_venc_divergente_provada" : "parcela_venc_divergente"); }
        else { conf.parcela = { acao: "sem_parcela_no_erp", valor: valorRel, vencimento: l.vencimento }; c("parcela_inexistente"); }
      }
    } else if (status !== "ambiguo") {
      // proposta pendente provada pelo relatório: nome (ou CPF) + vigência batendo
      const kn = normNome(l.nome_segurado ?? ""); const cpf = dig(l.cpf_cnpj);
      const porNome = pend.filter((p) => { const lo = p.locatario_id ? loc.get(p.locatario_id) : null; return lo && ((kn.length > 5 && normNome(lo.nome) === kn) || (cpf.length >= 11 && lo.cpf === cpf)); });
      // forte = nome/CPF + vigência batendo; ou, quando a proposta ainda não tem vigência (card do Bitrix), nome IGUAL + CPF igual
      const forte = porNome.filter((p) => { const lo = p.locatario_id ? loc.get(p.locatario_id) : null; return p.vigencia_inicio === l.vigencia_inicio || (!p.vigencia_inicio && !!lo && cpf.length >= 11 && lo.cpf === cpf && normNome(lo.nome) === kn); });
      if (forte.length === 1) {
        const p = forte[0]; docId = p.id; status = "proposta_emitida"; c("proposta_emitida"); const patch: Record<string, unknown> = { numero_apolice: l.numero_apolice }; if (!p.vigencia_inicio && l.vigencia_inicio) patch.vigencia_inicio = l.vigencia_inicio;
        if (l.dt_emissao) { patch.dt_emissao = l.dt_emissao; patch.dt_emissao_fonte = "portal_tokio"; patch.dt_emissao_nivel = 1; patch.dt_emissao_lida_em = new Date().toISOString(); }
        if (p.seguradora_id !== segId) { patch.seguradora_id = segId; conf.seguradora_corrigida = { de: segAbrev.get(p.seguradora_id), para: SEGURADORA, prova: "relatório oficial da seguradora: nº + nome/CPF + vigência" }; c("seguradora_corrigida"); }
        conf.proposta = { acao: "virou_apolice", nosso_numero_corp: p.nosso_numero_corp }; updDoc.push({ id: p.id, patch });
        acomp.push({ documento_id: p.id, motivo: "emitida_pela_seguradora", evidencia_tipo: "relatorio_seguradora", evidencia_ref: l.arquivo, evidencia_resumo: `Relatório oficial ${SEGURADORA} (${l.competencia?.slice(0, 7)}): apólice ${l.numero_apolice} emitida em ${l.dt_emissao}`, data_evidencia: new Date().toISOString(), confianca: "forte", detalhes: { seguradora: SEGURADORA, numero_apolice: l.numero_apolice }, fonte: "portal_tokio", nivel: 1, lote: LOTE });
        const idx = pend.findIndex((x) => x.id === p.id); if (idx >= 0) pend.splice(idx, 1);
      } else if (porNome.length >= 1) {
        status = "proposta_provavel"; c("proposta_provavel"); conf.proposta = { acao: "provavel", candidatos: porNome.map((p) => ({ doc: p.id, corp: p.nosso_numero_corp, vigencia: p.vigencia_inicio, seguradora: segAbrev.get(p.seguradora_id) })), vigencia_relatorio: l.vigencia_inicio, motivo: forte.length > 1 ? "mais de uma proposta com o mesmo nome e vigência" : "nome bate, vigência não" };
        for (const p of porNome.slice(0, 3)) acomp.push({ documento_id: p.id, motivo: "emitida_pela_seguradora", evidencia_tipo: "relatorio_seguradora", evidencia_ref: l.arquivo, evidencia_resumo: `Relatório oficial ${SEGURADORA}: apólice ${l.numero_apolice} do mesmo segurado (conferir vigência)`, data_evidencia: new Date().toISOString(), confianca: "provavel", detalhes: { seguradora: SEGURADORA, numero_apolice: l.numero_apolice }, fonte: "portal_tokio", nivel: 1, lote: LOTE });
      } else { c("sem_documento"); }
    }
    if (status === "sem_documento" && !vistoApolice.has(`${l.numero_apolice}|${l.endosso}`)) semDoc.push({ message_id: `portal_${PORTAL}:${l.numero_apolice}:${l.endosso}`, seguradora: SEGURADORA, codigo_padrao: "relatorio_apolices_emitidas", data_email: l.dt_emissao ? `${l.dt_emissao}T12:00:00Z` : null, tipo: l.endosso !== "0" ? "endosso" : "apolice", numero_extraido: l.numero_apolice, segurado_nome: l.nome_segurado, anexo_pdf: false, classificacao: "forte", seguradora_id: segId, baixar_no_portal: true, motivo: `Apólice do relatório oficial ${SEGURADORA} (${l.competencia?.slice(0, 7)}) sem documento no ERP: cadastrar quando chegar o PDF`, fonte: `portal_${PORTAL}`, nivel: 1, lote: LOTE, dados: l.linha });
    vistoApolice.add(`${l.numero_apolice}|${l.endosso}`);
    // Parceiro de negócio: registro de fonte (sugestão); nunca cria imobiliária
    if (l.parceiro_nome) { const m = imMatch(l.parceiro_nome); fontesIm.push({ fonte: "portal_seguradora_parceiro", chave_externa: `${SEGURADORA}:${l.parceiro_codigo ?? normNome(l.parceiro_nome)}`, nome_original: l.parceiro_nome, dados: { seguradora: SEGURADORA, codigo_parceiro: l.parceiro_codigo }, situacao: m.length === 1 ? "sugerido" : "a_identificar", metodo_vinculo: m.length === 1 ? "nome_parecido" : null, imobiliaria_id: null, sugestoes: m.map((i) => ({ imobiliaria_id: i.id, nome: i.nome, motivo: "nome do parceiro no relatório da seguradora" })), lido_em: new Date().toISOString() }); }
    linhasBanco.push({ seguradora: SEGURADORA, seguradora_id: segId, competencia: l.competencia, formato: l.formato, arquivo: l.arquivo, arquivo_sha256: l.sha, numero_apolice: l.numero_apolice, endosso: l.endosso, parcela: l.parcela, dt_emissao: l.dt_emissao, vigencia_inicio: l.vigencia_inicio, produto: l.produto, ramo: l.ramo, premio: l.premio, comissao: l.comissao, nome_segurado: l.nome_segurado, cpf_cnpj: l.cpf_cnpj, parceiro_codigo: l.parceiro_codigo, parceiro_nome: l.parceiro_nome, codigo_cliente: l.codigo_cliente, numero_operacao: l.numero_operacao, numero_certificado: l.numero_certificado, tipo_recebimento: l.tipo_recebimento, tipo_seguro: l.tipo_seguro, vencimento: l.vencimento, chassi: l.chassi, origem_venda: l.origem_venda, linha: l.linha, lote: LOTE, documento_id: docId, imobiliaria_id: imobId, vinculo_status: status, conferencia: Object.keys(conf).length ? conf : null, dt_emissao_anterior: (conf.dt_emissao as any)?.anterior ?? null, dt_emissao_fonte_anterior: (conf.dt_emissao as any)?.fonte_anterior ?? null });
  }
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"} (${LOTE}): ${linhasBanco.length} linhas de ${new Set(todas.map((l) => l.numero_apolice)).size} apólices`);
  console.log(JSON.stringify(cont));
  console.log(`documentos a atualizar ${updDoc.length}; acompanhamentos ${acomp.length}; sem documento ${semDoc.length}; parceiros ${new Set(fontesIm.map((f) => f.chave_externa)).size}`);
  for (const d of linhasBanco.filter((x) => (x.conferencia as any)?.proposta || (x.conferencia as any)?.seguradora_corrigida || (x.conferencia as any)?.seguradora_no_erp || x.vinculo_status === "sem_documento")) console.log(`  proposta ${d.numero_apolice} ${d.nome_segurado}: ${JSON.stringify(d.conferencia)}`);
  if (!GRAVAR) return;
  if (args.includes("--so-parcelas")) { // só refaz a conferência de parcelas das linhas que têm Parcela/Vencimento (sem mexer no resto)
    let n = 0; for (const l of linhasBanco.filter((x) => x.parcela)) { const { data: ex } = await sb.from("erp_seguradora_emitidas").select("id,conferencia").eq("seguradora", SEGURADORA).eq("numero_apolice", l.numero_apolice as string).eq("endosso", l.endosso as string).eq("parcela", l.parcela as string).maybeSingle(); if (!ex) continue; const conf = { ...((ex.conferencia as object) ?? {}), parcela: (l.conferencia as any)?.parcela }; const { error } = await sb.from("erp_seguradora_emitidas").update({ conferencia: conf }).eq("id", ex.id); if (!error) n++; }
    console.log(`conferência de parcelas refeita em ${n} linhas`); return;
  }
  for (const g of em(linhasBanco, 100)) { const { error } = await sb.from("erp_seguradora_emitidas").upsert(g, { onConflict: "seguradora,numero_apolice,endosso,parcela" }); if (error) throw new Error("emitidas: " + error.message); }
  for (const x of updDoc) { const { error } = await sb.from("erp_documentos").update(x.patch).eq("id", x.id); if (error) console.log(`doc ${x.id}: ${error.message}`); }
  for (const g of em(acomp, 100)) { const { error } = await sb.from("erp_proposta_acompanhamento").upsert(g, { onConflict: "documento_id" }); if (error) console.log("acompanhamento:", error.message); }
  for (const g of em(semDoc, 100)) { const { error } = await sb.from("erp_emissao_sem_documento").upsert(g, { onConflict: "message_id" }); if (error) console.log("sem_documento:", error.message); }
  const unicos = [...new Map(fontesIm.map((f) => [f.chave_externa as string, f])).values()];
  for (const g of em(unicos, 100)) { const { error } = await sb.from("imobiliaria_registros_fonte").upsert(g, { onConflict: "fonte,chave_externa", ignoreDuplicates: true }); if (error) console.log("registros_fonte:", error.message); }
  console.log("gravado");
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
