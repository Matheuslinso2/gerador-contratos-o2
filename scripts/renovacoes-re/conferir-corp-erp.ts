// Conferência SÓ LEITURA: relatório de Renovações do Corp (Excel) × erp_documentos e cadastros ligados.
// Não grava nada no banco, no Corp nem no Bitrix. Gera JSON de resumo + CSV de divergências.
// uso: npx tsx scripts/renovacoes-re/conferir-corp-erp.ts --mes 2027-01 --produtor <xlsx Simplificado com Produtor> [--simples <xlsx Simplificado>] --saida <pasta>
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const MES = arg("mes")!; // AAAA-MM
const ARQ_PROD = arg("produtor")!;
const ARQ_SIMP = arg("simples");
const SAIDA = arg("saida")!;
fs.mkdirSync(SAIDA, { recursive: true });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const [ANO, M] = MES.split("-").map(Number);
const INI = `${MES}-01`;
const FIM = new Date(Date.UTC(ANO, M, 0)).toISOString().slice(0, 10);

const txt = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (typeof v === "number" ? v : Number(txt(v).replace(/\./g, "").replace(",", ".")) || 0);
const dig = (s: unknown) => txt(s).replace(/\D/g, "");
const iso = (v: unknown): string | null => {
  if (typeof v === "number" && v > 0) return new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10);
  const m = txt(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/^IMOB\s*-\s*/, "").replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const cpfChave = (d: string) => (d.length <= 11 ? d.padStart(11, "0") : d.padStart(14, "0"));

// Regra do Matheus (escolherProdutor em src/lib/baseUnica/corpPropostas.ts + Sohtec, 22/10/2026)
const CANAL = /^(SEGIMOB|BASE SOFTWARE|SUPERLOGICA|SOHTEC)\b/;
const NAO_IMOB = /^((O2 CORRETORA|O2 SEGUROS|SEGIMOB|BASE SOFTWARE|SUPERLOGICA|SOHTEC)\b|RETRANSMISS|TOMBAMENTO)/;
function escolher(prods: string[]) {
  const imobs = prods.filter((p) => !NAO_IMOB.test(norm(p)));
  const temO2 = prods.some((p) => /^O2 CORRETORA/.test(norm(p)));
  const canais = prods.filter((p) => CANAL.test(norm(p)));
  return { imob: imobs[0] ?? null, vendaDireta: !imobs.length && temO2, canais };
}

type Linha = Record<string, string | number | null>;
function ler(arq: string) {
  const wb = XLSX.readFile(arq);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
}

async function todos<T>(q: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await q(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const lotes = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

async function main() {
  const corp = ler(ARQ_PROD);
  const simp = ARQ_SIMP ? ler(ARQ_SIMP) : [];
  const simpPor = new Map(simp.map((r) => [txt(r["Nosso Nº"]), r]));
  console.log(`Corp: ${corp.length} linhas (produtor), ${simp.length} (simplificado)`);

  // ---------------- cadastros de apoio
  const segs = await todos<{ id: string; abreviacao: string; nome: string }>((a, b) => sb.from("erp_seguradoras").select("id, abreviacao, nome").range(a, b));
  const ramos = await todos<{ id: string; abreviacao: string; produto: string; nome: string }>((a, b) => sb.from("erp_ramos").select("id, abreviacao, produto, nome").range(a, b));
  const segPorAbrev = new Map(segs.map((s) => [s.abreviacao, s]));
  const ramoPorAbrev = new Map(ramos.map((r) => [r.abreviacao, r]));
  const imobs = await todos<{ id: string; nome: string; apelido: string | null; receita_razao_social: string | null; grupo_id: string | null; cnpj: string | null }>((a, b) =>
    sb.from("imobiliarias").select("id, nome, apelido, receita_razao_social, grupo_id, cnpj").range(a, b));
  const codigos = await todos<{ imobiliaria_id: string; nome_corp: string | null }>((a, b) => sb.from("imobiliaria_codigos_corp").select("imobiliaria_id, nome_corp").range(a, b));
  const imobPorNome = new Map<string, Set<string>>();
  const addNome = (n: string | null | undefined, id: string) => { if (!n) return; const k = norm(n); if (!k) return; (imobPorNome.get(k) ?? imobPorNome.set(k, new Set()).get(k)!).add(id); };
  for (const i of imobs) { addNome(i.nome, i.id); addNome(i.apelido, i.id); addNome(i.receita_razao_social, i.id); }
  for (const c of codigos) addNome(c.nome_corp, c.imobiliaria_id);
  const imobPorId = new Map(imobs.map((i) => [i.id, i]));

  // ---------------- ERP: tudo que vence no mês + tudo que o relatório cita
  const SEL = "id, nosso_numero_corp, nosso_numero, tipo, tipo_corp, situacao, numero_apolice, vigencia_inicio, vigencia_fim, premio_liquido, premio_total, comissao_pct, canal_venda, imobiliaria_principal_id, locatario_id, seguradora_id, ramo_id, documento_renovado_id";
  type Doc = { id: string; nosso_numero_corp: number | null; nosso_numero: number | null; tipo: string; tipo_corp: string | null; situacao: string; numero_apolice: string | null; vigencia_inicio: string | null; vigencia_fim: string | null; premio_liquido: number | null; premio_total: number | null; comissao_pct: number | null; canal_venda: string | null; imobiliaria_principal_id: string | null; locatario_id: string | null; seguradora_id: string | null; ramo_id: string | null; documento_renovado_id: string | null };
  const doMes = await todos<Doc>((a, b) => sb.from("erp_documentos").select(SEL).gte("vigencia_fim", INI).lte("vigencia_fim", FIM).order("id").range(a, b));
  const nossos = corp.map((r) => Number(r["Nosso Nº"])).filter(Boolean);
  const porNosso = new Map<number, Doc[]>();
  const juntar = (d: Doc) => { if (d.nosso_numero_corp != null) (porNosso.get(d.nosso_numero_corp) ?? porNosso.set(d.nosso_numero_corp, []).get(d.nosso_numero_corp)!).push(d); };
  doMes.forEach(juntar);
  const vistos = new Set(doMes.map((d) => d.id));
  for (const l of lotes(nossos, 150)) {
    const { data, error } = await sb.from("erp_documentos").select(SEL).in("nosso_numero_corp", l);
    if (error) throw new Error(error.message);
    for (const d of (data ?? []) as Doc[]) if (!vistos.has(d.id)) { vistos.add(d.id); juntar(d); }
  }
  console.log(`ERP: ${doMes.length} documentos com fim de vigência em ${MES} (qualquer tipo/situação)`);

  // clientes
  const locIds = [...new Set([...porNosso.values()].flat().map((d) => d.locatario_id).filter(Boolean))] as string[];
  const locs = new Map<string, { id: string; nome: string; cpf: string | null; cadastro_incompleto: boolean | null; email: string | null; telefone: string | null }>();
  for (const l of lotes(locIds, 150)) {
    const { data } = await sb.from("locatarios").select("id, nome, cpf, cadastro_incompleto, email, telefone").in("id", l);
    for (const x of data ?? []) locs.set(x.id, x);
  }
  const cpfsCorp = [...new Set(corp.map((r) => cpfChave(dig(r["CPF/CNPJ"]))).filter((c) => c.replace(/0/g, "")))];
  const locPorCpf = new Map<string, { id: string; nome: string; cadastro_incompleto: boolean | null; email: string | null; telefone: string | null }[]>();
  for (const l of lotes(cpfsCorp, 120)) {
    {
      const sem0 = l.map((c) => c.replace(/^0+/, ""));
      const { data } = await sb.from("locatarios").select("id, nome, cpf, cadastro_incompleto, email, telefone").in("cpf", [...l, ...sem0]);
      for (const x of data ?? []) {
        const k = cpfChave(dig(x.cpf));
        const arr = locPorCpf.get(k) ?? locPorCpf.set(k, []).get(k)!;
        if (!arr.some((y) => y.id === x.id)) arr.push(x);
      }
    }
  }

  const ehEndosso = (d: { tipo: string; tipo_corp: string | null }) => d.tipo_corp === "END" || d.tipo === "C" || d.tipo === "M";
  const ehFatura = (d: { tipo: string; tipo_corp: string | null }) => d.tipo_corp === "FAT" || d.tipo === "F";
  // ---------------- cruzamento linha a linha
  const linhas: Linha[] = [];
  const cont = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
  const por = { ramo: {} as Record<string, number>, seg: {} as Record<string, number>, produto: {} as Record<string, number>, segPorProduto: {} as Record<string, number> };
  const lig = { semSeg: 0, semRamo: 0, semCliente: 0, clienteIncompleto: 0, semCpfCorp: 0, clienteDiferente: 0, semImob: 0, vendaDireta: 0, soCanal: 0, nomeNaoCasa: 0, nomeAmbiguo: 0, imobErpDiferente: 0, imobErpVazia: 0, imobCasaErpIgual: 0 };
  const div = { situacao: 0, fim: 0, inicio: 0, premioTotal: 0, premioLiquido: 0, pct: 0, apolice: 0, naoNoErp: 0, noErpVariosDocs: 0, canceladoNoCorp: 0, comSinistro: 0 };
  let achados = 0;
  const corpNossos = new Set<number>();

  for (const r of corp) {
    const nosso = Number(r["Nosso Nº"]);
    corpNossos.add(nosso);
    const sp = simpPor.get(txt(r["Nosso Nº"]));
    const abSeg = txt(r["Seguradora"]);
    const abRamo = txt(r["Ramo"]);
    const ramo = ramoPorAbrev.get(abRamo);
    const seg = segPorAbrev.get(abSeg);
    const produto = ramo?.produto ?? "(sem ramo no ERP)";
    cont(por.ramo, abRamo); cont(por.seg, abSeg); cont(por.produto, produto); cont(por.segPorProduto, `${produto} | ${abSeg}`);
    if (!seg) lig.semSeg++;
    if (!ramo) lig.semRamo++;

    const fimCorp = iso(r["Final Vig."]);
    const iniCorp = iso(r["Início Vig."]);
    const totalCorp = num(r["Prêmio Total"]);
    const liqCorp = sp ? num(sp["Prêmio Líquido"]) : null;
    const pctCorp = num(r["% Com."]);
    const apCorp = txt(r["Apólice"]);
    const cpf = dig(r["CPF/CNPJ"]);
    const prods = [txt(r["Produtor 1"]), txt(r["Produtor 2"]), txt(r["Produtor 3"])].filter(Boolean);
    const esc = escolher(prods);
    const cancelado = txt(r["Cancelado"]) === "V" || txt(r["Doc. Cancelado"]) !== "";
    if (cancelado) div.canceladoNoCorp++;
    if (num(r["Sinistro"]) > 0 || num(r["Qtde. Sinistros"]) > 0) div.comSinistro++;

    const docs = porNosso.get(nosso) ?? [];
    const d = docs.find((x) => !ehEndosso(x) && !ehFatura(x)) ?? docs[0];
    const dv: string[] = [];
    if (!d) { div.naoNoErp++; dv.push("NÃO EXISTE NO ERP"); } else {
      achados++;
      if (docs.length > 1) div.noErpVariosDocs++;
      if (!["vigente", "digitado"].includes(d.situacao)) { div.situacao++; dv.push(`situação no ERP = ${d.situacao}`); }
      if (d.vigencia_fim !== fimCorp) { div.fim++; dv.push(`fim de vigência: Corp ${fimCorp} × ERP ${d.vigencia_fim}`); }
      if (d.vigencia_inicio !== iniCorp) { div.inicio++; dv.push(`início de vigência: Corp ${iniCorp} × ERP ${d.vigencia_inicio}`); }
      if (Math.abs((d.premio_total ?? 0) - totalCorp) > 0.01) { div.premioTotal++; dv.push(`prêmio total: Corp ${totalCorp} × ERP ${d.premio_total}`); }
      if (liqCorp != null && Math.abs((d.premio_liquido ?? 0) - liqCorp) > 0.01) { div.premioLiquido++; dv.push(`prêmio líquido: Corp ${liqCorp} × ERP ${d.premio_liquido}`); }
      if (Math.abs((d.comissao_pct ?? 0) - pctCorp) > 0.01) { div.pct++; dv.push(`% comissão: Corp ${pctCorp} × ERP ${d.comissao_pct}`); }
      if (apCorp && apCorp !== "0" && txt(d.numero_apolice) !== apCorp) { div.apolice++; dv.push(`Nº da apólice: Corp ${apCorp} × ERP ${d.numero_apolice}`); }
      if (seg && d.seguradora_id !== seg.id) dv.push("seguradora diferente no ERP");
      if (ramo && d.ramo_id !== ramo.id) dv.push("ramo diferente no ERP");
    }

    // ligação: cliente
    const k = cpfChave(cpf);
    const achadosLoc = cpf ? locPorCpf.get(k) ?? [] : [];
    let cliSt = "ok";
    if (!cpf || !k.replace(/0/g, "")) { cliSt = "Corp sem CPF/CNPJ"; lig.semCpfCorp++; }
    else if (!achadosLoc.length) { cliSt = "sem cadastro (CPF/CNPJ não está em locatarios)"; lig.semCliente++; }
    else if (achadosLoc.every((x) => x.cadastro_incompleto)) { cliSt = "cadastro incompleto"; lig.clienteIncompleto++; }
    if (d?.locatario_id && achadosLoc.length && !achadosLoc.some((x) => x.id === d.locatario_id)) { lig.clienteDiferente++; dv.push("cliente do ERP ≠ cliente com esse CPF/CNPJ"); }

    // ligação: imobiliária
    let imobSt = "";
    let imobBanco: string | null = null;
    if (esc.imob) {
      const ids = imobPorNome.get(norm(esc.imob));
      if (!ids) { imobSt = "nome do produtor não casa com nenhuma imobiliária"; lig.nomeNaoCasa++; }
      else if (ids.size > 1) { imobSt = "nome casa com mais de uma ficha"; lig.nomeAmbiguo++; imobBanco = [...ids].map((i) => imobPorId.get(i)?.nome).join(" / "); }
      else {
        const id = [...ids][0];
        imobBanco = imobPorId.get(id)?.nome ?? null;
        if (!d) imobSt = "ligada";
        else if (!d.imobiliaria_principal_id) { imobSt = "ficha existe, mas o documento no ERP está sem imobiliária"; lig.imobErpVazia++; }
        else if (d.imobiliaria_principal_id === id) { imobSt = "ligada"; lig.imobCasaErpIgual++; }
        else {
          const a = imobPorId.get(d.imobiliaria_principal_id), b = imobPorId.get(id);
          if (a?.grupo_id && a.grupo_id === b?.grupo_id) { imobSt = "ligada (outra ficha do mesmo grupo)"; lig.imobCasaErpIgual++; }
          else { imobSt = "imobiliária do ERP diferente do produtor do Corp"; lig.imobErpDiferente++; dv.push(`imobiliária: Corp "${esc.imob}" × ERP "${a?.nome}"`); }
        }
      }
    } else if (esc.vendaDireta) { imobSt = "venda direta O2 (sem imobiliária)"; lig.vendaDireta++; }
    else { imobSt = "sem imobiliária (só canal/marcador ou sem produtor)"; lig.soCanal++; }
    if (!esc.imob && !esc.vendaDireta) lig.semImob++;
    else if (!esc.imob && esc.vendaDireta) lig.semImob++;

    linhas.push({
      "Nosso nº do Corp": nosso, "Nº da apólice (Corp)": apCorp, "Seguradora": abSeg, "Ramo": abRamo, "Produto (ERP)": produto,
      "Cliente (Corp)": txt(r["Cliente"]), "CPF/CNPJ (Corp)": cpf, "Início vig. (Corp)": iniCorp, "Fim vig. (Corp)": fimCorp,
      "Prêmio total (Corp)": totalCorp, "Prêmio líquido (Corp)": liqCorp, "% comissão (Corp)": pctCorp, "Canal (Corp)": txt(r["Canal Vendas"]),
      "Produtor 1": prods[0] ?? "", "Produtor 2": prods[1] ?? "", "Produtor 3": prods[2] ?? "",
      "Canal na linha do produtor (Corp)": esc.canais.join(", "), "Canal de venda (ERP)": d?.canal_venda ?? "",
      "Cancelado (Corp)": cancelado ? "sim" : "não", "Sinistros (Corp)": num(r["Qtde. Sinistros"]),
      "Está no ERP": d ? "sim" : "NÃO", "Código O2 do documento": d?.nosso_numero ?? "", "Situação no ERP": d?.situacao ?? "", "Tipo no ERP": d ? `${d.tipo}/${d.tipo_corp ?? ""}` : "",
      "Fim vig. (ERP)": d?.vigencia_fim ?? "", "Prêmio total (ERP)": d?.premio_total ?? "", "Prêmio líquido (ERP)": d?.premio_liquido ?? "", "% comissão (ERP)": d?.comissao_pct ?? "",
      "Seguradora ligada": seg ? "sim" : "NÃO", "Ramo ligado": ramo ? "sim" : "NÃO", "Cliente (situação do cadastro)": cliSt,
      "Imobiliária escolhida (Corp)": esc.imob ?? (esc.vendaDireta ? "O2 CORRETORA (venda direta)" : ""), "Imobiliária na base única": imobBanco ?? "", "Imobiliária (situação)": imobSt,
      "Imobiliária atual no ERP": d?.imobiliaria_principal_id ? imobPorId.get(d.imobiliaria_principal_id)?.nome ?? "" : "",
      "Divergências": dv.join(" | "),
    });
  }

  // ERP a mais
  const vivos = (d: Doc) => ["vigente", "digitado"].includes(d.situacao) && !corpNossos.has(Number(d.nosso_numero_corp));
  const erpAMais = doMes.filter((d) => !ehEndosso(d) && !ehFatura(d) && d.tipo !== "X" && vivos(d));
  const endossosDoMes = doMes.filter((d) => ehEndosso(d) && vivos(d));
  const tiposErp: Record<string, number> = {};
  doMes.forEach((d) => cont(tiposErp, `${d.tipo}|${d.tipo_corp ?? ""}|${d.situacao}`));
  const aMaisDet: Linha[] = [];
  for (const d of erpAMais) {
    const ramo = ramos.find((x) => x.id === d.ramo_id), seg = segs.find((x) => x.id === d.seguradora_id);
    aMaisDet.push({ "Nosso nº do Corp": d.nosso_numero_corp, "Código O2 do documento": d.nosso_numero, "Nº da apólice": d.numero_apolice, "Seguradora": seg?.abreviacao ?? "", "Ramo": ramo?.abreviacao ?? "", "Produto": ramo?.produto ?? "", "Tipo": `${d.tipo}/${d.tipo_corp ?? ""}`, "Fim vig.": d.vigencia_fim, "Situação": d.situacao, "Prêmio total": d.premio_total, "Cliente": locs.get(d.locatario_id ?? "")?.nome ?? "" });
  }

  const resumo = { endossosVigentesNoMes: endossosDoMes.length, mes: MES, corpLinhas: corp.length, achadosNoErp: achados, naoNoErp: corp.length - achados, erpDoMesTotal: doMes.length, erpAMais: erpAMais.length, tiposErp, por, lig, div };
  fs.writeFileSync(path.join(SAIDA, `resumo-${MES}.json`), JSON.stringify(resumo, null, 2));
  fs.writeFileSync(path.join(SAIDA, `linhas-${MES}.json`), JSON.stringify({ linhas, aMaisDet }, null, 0));
  const csv = (rows: Linha[]) => {
    if (!rows.length) return "";
    const cols = Object.keys(rows[0]);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return "﻿" + [cols.join(";"), ...rows.map((r) => cols.map((c) => esc(r[c])).join(";"))].join("\r\n");
  };
  fs.writeFileSync(path.join(SAIDA, `levantamento-completo-${MES}.csv`), csv(linhas));
  fs.writeFileSync(path.join(SAIDA, `divergencias-${MES}.csv`), csv(linhas.filter((l) => l["Divergências"] || l["Cliente (situação do cadastro)"] !== "ok" || /não casa|mais de uma|sem imobiliária|sem imobiliária/.test(String(l["Imobiliária (situação)"])) || l["Seguradora ligada"] === "NÃO" || l["Ramo ligado"] === "NÃO")));
  fs.writeFileSync(path.join(SAIDA, `erp-a-mais-${MES}.csv`), csv(aMaisDet));
  console.log(JSON.stringify(resumo, null, 2));
}
main().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
