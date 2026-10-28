// Ensaio (SÓ LEITURA): o valor de prêmio que o documento/card tem corresponde a quê no PDF da proposta/apólice?
//   (a) líquido do PDF | (b) total do PDF sem adicional (líquido + IOF) | (c) total com adicional de fracionamento | (d) nenhum
// Lê o CSV da auditoria v2 (auditar-tarefas-pdf.ts), junta ramo e forma de pagamento do documento e agrupa por seguradora × produto.
// Não grava nada. uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/classificar-premio-pdf.ts [--csv caminho]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const CSV = arg("csv") ?? path.join(os.tmpdir(), "auditoria-tarefas-pdf.csv");
const sb = createServiceClient();
const num = (s: string | undefined) => (s === undefined || s === "" ? null : Number(s));
const perto = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 0.06;

(async () => {
  const linhas = fs.readFileSync(CSV, "utf8").replace(/^﻿/, "").split("\n");
  const parse = (l: string) => l.slice(1, -1).split('";"');
  const h = parse(linhas[0]);
  const c = (r: string[], n: string) => r[h.indexOf(n)];
  const rows = linhas.slice(1).map(parse).filter((r) => c(r, "papel") === "principal" && c(r, "codigo_o2") && num(c(r, "liquido_pdf")) != null);
  // ramo e forma de pagamento do documento (por Código O2)
  const codigos = [...new Set(rows.map((r) => Number(c(r, "codigo_o2"))))];
  const doc = new Map<number, { ramo: string; forma: string | null; parcelas: number | null }>();
  const { data: ramos } = await sb.from("erp_ramos").select("id,nome");
  const nRamo = new Map((ramos ?? []).map((x) => [x.id, x.nome]));
  for (let i = 0; i < codigos.length; i += 100) {
    const { data } = await sb.from("erp_documentos").select("nosso_numero,ramo_id,forma_pagamento,qtd_parcelas").in("nosso_numero", codigos.slice(i, i + 100));
    for (const d of data ?? []) doc.set(Number(d.nosso_numero), { ramo: nRamo.get(d.ramo_id) ?? "(sem ramo)", forma: d.forma_pagamento, parcelas: d.qtd_parcelas });
  }
  type Q = { n: number; a: number; b: number; c: number; d: number; comAdic: number; exemplosAdic: string[] };
  const quadro = new Map<string, Q>();
  const total: Q = { n: 0, a: 0, b: 0, c: 0, d: 0, comAdic: 0, exemplosAdic: [] };
  for (const r of rows) {
    const liq = num(c(r, "liquido_pdf")), iof = num(c(r, "iof_pdf")), adic = num(c(r, "adicional_pdf")) ?? 0, tot = num(c(r, "total_pdf"));
    const valorDoc = num(c(r, "doc_total")) ?? num(c(r, "doc_liquido"));
    if (valorDoc == null) continue;
    const info = doc.get(Number(c(r, "codigo_o2")));
    const chave = `${c(r, "seguradora_doc") || "(sem seguradora)"} / ${info?.ramo ?? "(sem ramo)"}`;
    const q = quadro.get(chave) ?? quadro.set(chave, { n: 0, a: 0, b: 0, c: 0, d: 0, comAdic: 0, exemplosAdic: [] }).get(chave)!;
    let classe: "a" | "b" | "c" | "d";
    if (perto(valorDoc, liq)) classe = "a";
    else if (adic > 0.005 && (perto(valorDoc, tot) || (iof != null && perto(valorDoc, (liq ?? 0) + iof + adic)))) classe = "c";
    else if (perto(valorDoc, tot) || (iof != null && perto(valorDoc, (liq ?? 0) + iof))) classe = "b";
    else classe = "d";
    for (const x of [q, total]) { x.n++; x[classe]++; if (adic > 0.005) x.comAdic++; }
    if (adic > 0.005 && q.exemplosAdic.length < 3) q.exemplosAdic.push(`${num(c(r, "parcelas_pdf")) ?? "?"}x, adicional ${((adic / (liq ?? 1)) * 100).toFixed(1)}% do líquido, forma ${info?.forma ?? "?"}`);
  }
  const pct = (x: number, n: number) => (n ? `${x} (${Math.round((x / n) * 100)}%)` : "0");
  console.log(`CLASSIFICAÇÃO DO VALOR DE PRÊMIO DO DOCUMENTO CONTRA O PDF — ${total.n} propostas/apólices ligadas com líquido no PDF`);
  console.log("  (a) = líquido do PDF | (b) = líquido + IOF | (c) = líquido + IOF + adicional de fracionamento | (d) = nenhum");
  console.log(`TOTAL: n ${total.n} | a ${pct(total.a, total.n)} | b ${pct(total.b, total.n)} | c ${pct(total.c, total.n)} | d ${pct(total.d, total.n)} | com adicional no PDF ${total.comAdic}`);
  console.log("\nPOR SEGURADORA / PRODUTO (n | a | b | c | d | com adicional):");
  for (const [k, q] of [...quadro].sort((x, y) => y[1].n - x[1].n)) {
    console.log(`  ${k.padEnd(52)} ${q.n} | ${q.a} | ${q.b} | ${q.c} | ${q.d} | ${q.comAdic}${q.exemplosAdic.length ? "  ex.: " + q.exemplosAdic.join("; ") : ""}`);
  }
})();
