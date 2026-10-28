// Ensaio (SÓ LEITURA, nada gravado): para as propostas em emissão (situacao proposta, sem nº de apólice, sem anexo em
// erp_documento_anexos), mostra de que FONTE já existe o PDF/e-mail da proposta, por seguradora e produto:
//   corp  = corp_anexos pelo nosso nº do Corp (chave oficial; já aparece na aba de anexos do Corp, então NÃO se copia)
//   tarefa = PDF anexado nas tarefas CADASTRO … CORP do Bitrix, ligado por CPF+vigência (lê o CSV de auditoria-tarefas-pdf)
//   email = há e-mail indexado ligado ao documento (nº da apólice/proposta no texto ou prova de emissão)
// Prioridade: os documentos com personagem de card sem CPF/CNPJ válido em erp_item_partes. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/ensaio-propostas-sem-anexo.ts [--csv caminho]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const CSV = arg("csv") ?? path.join(os.tmpdir(), "auditoria-tarefas-pdf.csv");
const sb = createServiceClient();

async function todos<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const o: T[] = [];
  for (let de = 0; ; de += 1000) { const { data, error } = await q(de, de + 999); if (error) throw new Error(error.message); o.push(...(data ?? [])); if ((data ?? []).length < 1000) return o; }
}
const em = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

(async () => {
  const docs = [
    ...(await todos((a, b) => sb.from("erp_documentos").select("id,nosso_numero,nosso_numero_corp,situacao,origem,seguradora_id,ramo_id").eq("situacao", "proposta").is("numero_apolice", null).order("id").range(a, b))),
    ...(await todos((a, b) => sb.from("erp_documentos").select("id,nosso_numero,nosso_numero_corp,situacao,origem,seguradora_id,ramo_id").eq("situacao", "proposta").is("numero_apolice", null).order("id").range(a, b))),
  ];
  const comAnexo = new Set<string>();
  for (const g of em(docs.map((d) => d.id))) { const { data } = await sb.from("erp_documento_anexos").select("documento_id").in("documento_id", g); for (const x of data ?? []) comAnexo.add(x.documento_id); }
  const alvo = docs.filter((d) => !comAnexo.has(d.id));
  const ids = alvo.map((d) => d.id);

  // prioridade: personagem de card sem CPF/CNPJ válido
  const semCpf = new Set<string>();
  for (const g of em(ids, 80)) {
    const { data: its } = await sb.from("erp_documento_itens").select("id,documento_id").in("documento_id", g);
    const porItem = new Map((its ?? []).map((i) => [i.id, i.documento_id]));
    for (const g2 of em([...porItem.keys()], 100)) {
      const { data: ps } = await sb.from("erp_item_partes").select("item_id,documento_numero").in("item_id", g2);
      for (const p of ps ?? []) { const n = String(p.documento_numero ?? "").replace(/\D/g, ""); if (n.length !== 11 && n.length !== 14) semCpf.add(porItem.get(p.item_id)!); }
    }
  }

  // fonte corp
  const nnCorp = alvo.map((d) => d.nosso_numero_corp).filter((x) => x != null).map(String);
  const corpComAnexo = new Set<string>();
  for (const g of em(nnCorp, 100)) { const { data } = await sb.from("corp_anexos").select("nosso_numero").in("nosso_numero", g); for (const x of data ?? []) corpComAnexo.add(String(x.nosso_numero)); }

  // fonte tarefa (CSV da auditoria)
  const tarefa = new Set<string>();
  if (fs.existsSync(CSV)) {
    const linhas = fs.readFileSync(CSV, "utf8").replace(/^﻿/, "").split("\n");
    const parse = (l: string) => l.slice(1, -1).split('";"');
    const h = parse(linhas[0]);
    for (const l of linhas.slice(1)) { const r = parse(l); const cod = r[h.indexOf("codigo_o2")]; if (cod) tarefa.add(cod); }
  }

  // fonte e-mail
  const comEmail = new Set<string>();
  for (const g of em(ids, 100)) {
    const { data: a } = await sb.from("erp_emails").select("documento_id").in("documento_id", g);
    for (const x of a ?? []) comEmail.add(x.documento_id!);
    const { data: b } = await sb.from("erp_emails_evidencia_emissao").select("documento_id").in("documento_id", g);
    for (const x of b ?? []) comEmail.add(x.documento_id);
  }

  const { data: segs } = await sb.from("erp_seguradoras").select("id,nome");
  const { data: ramos } = await sb.from("erp_ramos").select("id,nome");
  const nSeg = new Map((segs ?? []).map((s) => [s.id, s.nome]));
  const nRamo = new Map((ramos ?? []).map((s) => [s.id, s.nome]));

  type Cont = { alvos: number; corp: number; tarefa: number; email: number; nenhuma: number; prioridade: number; prioridadeSemFonte: number };
  const novo = (): Cont => ({ alvos: 0, corp: 0, tarefa: 0, email: 0, nenhuma: 0, prioridade: 0, prioridadeSemFonte: 0 });
  const total = novo();
  const por = new Map<string, Cont>();
  for (const d of alvo) {
    const fCorp = d.nosso_numero_corp != null && corpComAnexo.has(String(d.nosso_numero_corp));
    const fTar = tarefa.has(String(d.nosso_numero));
    const fEm = comEmail.has(d.id);
    const alguma = fCorp || fTar || fEm;
    const pri = semCpf.has(d.id);
    for (const c of [total, por.get(`${nSeg.get(d.seguradora_id) ?? "(sem seguradora)"} / ${nRamo.get(d.ramo_id) ?? "(sem ramo)"}`) ?? por.set(`${nSeg.get(d.seguradora_id) ?? "(sem seguradora)"} / ${nRamo.get(d.ramo_id) ?? "(sem ramo)"}`, novo()).get(`${nSeg.get(d.seguradora_id) ?? "(sem seguradora)"} / ${nRamo.get(d.ramo_id) ?? "(sem ramo)"}`)!]) {
      c.alvos++; if (fCorp) c.corp++; if (fTar) c.tarefa++; if (fEm) c.email++; if (!alguma) c.nenhuma++;
      if (pri) { c.prioridade++; if (!alguma) c.prioridadeSemFonte++; }
    }
  }
  console.log(`ENSAIO — ${alvo.length} propostas em emissão sem anexo ligado (digitado/proposta, sem apólice)`);
  console.log("TOTAL:", JSON.stringify(total));
  console.log("origem:", JSON.stringify(alvo.reduce((o: Record<string, number>, d) => ((o[d.origem] = (o[d.origem] ?? 0) + 1), o), {})));
  console.log("\nPOR SEGURADORA / PRODUTO (alvos | corp | tarefa | email | sem fonte | prioridade | prioridade sem fonte):");
  for (const [k, c] of [...por].sort((a, b) => b[1].alvos - a[1].alvos).slice(0, 18)) console.log(`  ${k.padEnd(44)} ${c.alvos} | ${c.corp} | ${c.tarefa} | ${c.email} | ${c.nenhuma} | ${c.prioridade} | ${c.prioridadeSemFonte}`);
})();
