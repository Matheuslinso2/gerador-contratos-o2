// ERP O2 — Fase 2: carrega no ERP os relatórios de comissão exportados do Corp pelo robô
// (Consultas → Gerenciador de Relatórios → Comissões → Recebidas / Pendentes) e casa com documentos e parcelas.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-comissoes-corp.ts <pasta> [--gravar]
//   <pasta> com comissoes_recebidas_AAAA.xlsx (baixa por data de quitação, um arquivo por ano) e comissoes_pendentes.xlsx.
// Recebidas: substitui as linhas do mesmo ano (o Corp ainda mexe em baixas do ano). Pendentes: substitui tudo (retrato).
// Arquivo que não mudou (mesmo md5 da última carga) é pulado.
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as XLSX from "xlsx";
import { createServiceClient } from "@/lib/supabase/service";

const pasta = process.argv[2];
const gravar = process.argv.includes("--gravar");
if (!pasta || !fs.existsSync(pasta)) throw new Error("informe a pasta com os arquivos do robô");

const serial = (v: unknown): string | null => {
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  if (typeof v === "string") { const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`; }
  return null;
};
const n = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const t = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v).replace(/ /g, " ").trim(); return s || null; };
// O2 Cap: ramo começando com "2" (2FIA, 2IMO, 2POR), CAP2, e PREM (premiação: cai na conta da O2 Cap, como na planilha)
const corretoraDoRamo = (ramo: string | null) => (ramo && (/^2/.test(ramo) || /^(CAP2|PREM)$/i.test(ramo)) ? "O2 Capitalização" : "O2 Corretora");

function lerLinhas(arq: string, situacao: "recebida" | "pendente") {
  const wb = XLSX.read(fs.readFileSync(arq), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const H = (rows[0] ?? []).map((h) => t(h) ?? "");
  const col = (nome: string) => { const i = H.indexOf(nome); if (i < 0) throw new Error(`${path.basename(arq)}: coluna "${nome}" não encontrada`); return i; };
  const c = {
    seg: col("Seg."), ramo: col("Ramo"), data: col("Data"), nn: col("Nosso Nº"), cliente: col("Cliente"), cpf: col("CPF/CNPJ"), tipo: col("Tipo"),
    apolice: col("Apólice"), endosso: col("Endosso"), parc: col("Parc."), venc: col("Vencto Parc."), prop: col("Dt. Proposta"), ini: col("Início Vig."),
    fim: col("Fim Vig."), emis: col("Dt. Emissão"), tdoc: col("Tipo de Documento"), prod: col("Produtor"), agente: col("Agente"), part: col("% Part"),
    base: col("Base Com."), valor: col("Valor"), estim: col("% (Estim.)"), rec: col("% (Rec.)"), pdoc: col("% Com. Doc."), liq: col("Pr. Líquido"),
    canal: col("Canal de Vendas"), indireto: col("Prod. Indireto"), canc: col("Cancelado"), obs: col("Obs. Com."),
  };
  const saida = [];
  for (const r of rows.slice(1)) {
    const seg = t(r[c.seg]);
    if (!seg || r[c.nn] === null) continue;
    const parc = t(r[c.parc]);
    const [pn, pt] = (parc ?? "").split("/").map((x) => Number(x));
    const ramo = t(r[c.ramo]);
    saida.push({
      situacao, arquivo: path.basename(arq), corretora: corretoraDoRamo(ramo), seg_abrev: seg, ramo, data: serial(r[c.data]),
      nosso_numero_corp: n(r[c.nn]), cliente: t(r[c.cliente]), cpf_cnpj: t(r[c.cpf])?.replace(/\D/g, "") || null, tipo: t(r[c.tipo]),
      apolice: t(r[c.apolice]), endosso: t(r[c.endosso]), parcela_n: Number.isFinite(pn) ? pn : null, parcelas_total: Number.isFinite(pt) ? pt : null,
      parcela_texto: parc, venc_parcela: serial(r[c.venc]), dt_proposta: serial(r[c.prop]), inicio_vig: serial(r[c.ini]), fim_vig: serial(r[c.fim]),
      dt_emissao: serial(r[c.emis]), tipo_documento: t(r[c.tdoc]), produtor: t(r[c.prod]), agente: t(r[c.agente]), pct_part: n(r[c.part]),
      base_com: n(r[c.base]), valor: n(r[c.valor]), pct_estim: n(r[c.estim]), pct_rec: n(r[c.rec]), pct_com_doc: n(r[c.pdoc]), pr_liquido: n(r[c.liq]),
      canal: t(r[c.canal]), prod_indireto: t(r[c.indireto]), cancelado: t(r[c.canc]), obs: t(r[c.obs]),
    });
  }
  return saida;
}

// casamento em lotes (cada chamada cabe no tempo da API do banco)
async function casarEmLotes(sb: ReturnType<typeof createServiceClient>) {
  // criar_parcelas: documento do legado sem parcela no ERP ganha as parcelas do próprio relatório do Corp
  for (const [fn, lote] of [["erp_corp_casar_documentos", 3000], ["erp_corp_casar_parcelas", 5000], ["erp_corp_criar_parcelas", 1500], ["erp_corp_casar_parcelas", 5000], ["erp_corp_gravar_baixas", 5000]] as const) {
    let total = 0;
    for (;;) {
      const { data, error } = await sb.rpc(fn, fn === "erp_corp_criar_parcelas" ? { p_limite_docs: lote } : { p_limite: lote });
      if (error) { console.log(`${fn}: ${error.message}`); break; }
      total += Number(data ?? 0);
      if (!data) break;
    }
    console.log(`${fn}: ${total}`);
  }
  const { data, error } = await sb.rpc("erp_corp_quitar_parcelas");
  console.log("parcelas quitadas:", error ? error.message : data);
  const r2 = await sb.rpc("erp_atualizar_baixa_corp_mensal");
  console.log("baixa mensal (tela de conferência):", r2.error ? r2.error.message : r2.data);
}

async function main() {
  const sb = createServiceClient();
  const arquivos = fs.readdirSync(pasta).filter((f) => /^comissoes_(recebidas_\d{4}|pendentes)\.xlsx$/i.test(f)).sort();
  const estadoArq = path.join(pasta, ".comissoes-md5.json");
  const estado: Record<string, string> = fs.existsSync(estadoArq) ? JSON.parse(fs.readFileSync(estadoArq, "utf8")) : {};
  let mudou = false;
  if (process.argv.includes("--so-casar")) { await casarEmLotes(sb); return; }
  for (const f of arquivos) {
    const arq = path.join(pasta, f);
    const md5 = crypto.createHash("md5").update(fs.readFileSync(arq)).digest("hex");
    if (estado[f] === md5 && !process.argv.includes("--forcar")) { console.log(`${f}: sem mudança`); continue; }
    const pendente = /pendentes/i.test(f);
    const linhas = lerLinhas(arq, pendente ? "pendente" : "recebida");
    const soma = linhas.reduce((s, l) => s + (l.valor ?? 0), 0);
    console.log(`${f}: ${linhas.length} linhas, soma ${soma.toFixed(2)}`);
    if (!gravar) continue;
    // apaga o que este arquivo substitui
    if (pendente) {
      const { error } = await sb.from("erp_corp_comissoes").delete().eq("situacao", "pendente");
      if (error) throw new Error(error.message);
    } else {
      const ano = f.match(/(\d{4})/)![1];
      const { error } = await sb.from("erp_corp_comissoes").delete().eq("situacao", "recebida").gte("data", `${ano}-01-01`).lte("data", `${ano}-12-31`);
      if (error) throw new Error(error.message);
    }
    for (let i = 0; i < linhas.length; i += 1000) {
      const { error } = await sb.from("erp_corp_comissoes").insert(linhas.slice(i, i + 1000));
      if (error) throw new Error(`${f} lote ${i}: ${error.message}`);
    }
    estado[f] = md5;
    mudou = true;
  }
  if (gravar) {
    fs.writeFileSync(estadoArq, JSON.stringify(estado, null, 1));
    if (mudou || process.argv.includes("--casar")) await casarEmLotes(sb);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
