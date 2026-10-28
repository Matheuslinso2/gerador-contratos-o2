// Grava a VIGÊNCIA correta (início e fim) nos documentos do ERP a partir do documento oficial da seguradora (regra do Matheus, 28/10: o PDF da
// seguradora é a verdade). Só vigencia_inicio e vigencia_fim: nunca prêmio, comissão, situação nem outro campo.
// Fontes (todas com vínculo CONFIRMADO):
//   cap     = certificados de Capitalização (início do certificado + modo de reaplicação 12/15/30 meses; Icatu: vigência escrita)
//             lidos em certificados-bitrix.json / certificados-emails.json / certificados-emails-2.json (pasta temporária)
//   acervo  = apolice_documentos situacao 'certa' (nº + vigência ±1 dia + CPF/CNPJ do segurado conferidos) ligado ao Nosso nº do Corp
//   tarefas = PDFs de proposta/apólice das tarefas CADASTRO … CORP (auditoria-tarefas-pdf.csv) ligados por CPF+vigência
// Travas (NÃO grava, só lista): documento congelado; renovação ligada (é renovação de outro ou foi renovado); diferença > 31 dias em início
// ou fim (provável outro período/reaplicação); fim não calculável; fontes em conflito; vínculo só 'provável'.
// Antes de gravar: backup em CSV (pasta temporária); o gatilho erp_documentos_aud grava antes/depois em erp_auditoria. Ensaio por padrão. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/gravar-vigencias.ts [--gravar] [--fontes cap,acervo,tarefas]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const GRAVAR = process.argv.includes("--gravar");
const CONGELADOS_SEM_MUDAR_MES = process.argv.includes("--congelados-sem-mudar-mes");
const iFontes = process.argv.indexOf("--fontes");
const FONTES = new Set((iFontes >= 0 ? process.argv[iFontes + 1] : "cap,acervo,tarefas").split(","));
const LIMITE_DIAS = 31;
const sb = createServiceClient();
const tmp = os.tmpdir();
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const em = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

type Prop = { fonte: string; ini: string; fim: string | null; ref: string };
type Doc = { id: string; nosso_numero: number; nosso_numero_corp: number | null; vigencia_inicio: string | null; vigencia_fim: string | null; congelado: boolean; documento_renovado_id: string | null; seguradora_id: string | null; ramo_id: string | null };

(async () => {
  const propostas = new Map<number, Prop[]>(); // por Código O2 (nosso_numero)
  const add = (cod: number, p: Prop) => (propostas.get(cod) ?? propostas.set(cod, []).get(cod)!).push(p);
  const duvidosos: { cod: number | string; motivo: string; detalhe: string }[] = [];

  // --- fonte cap
  if (FONTES.has("cap")) {
    for (const f of ["certificados-bitrix.json", "certificados-emails.json", "certificados-emails-2.json"]) {
      const p = path.join(tmp, f);
      if (!fs.existsSync(p)) continue;
      for (const x of JSON.parse(fs.readFileSync(p, "utf8"))) {
        if (x.situacao !== "confirmada") { duvidosos.push({ cod: x.nosso_numero, motivo: "vínculo só provável (Capitalização)", detalhe: x.arquivo }); continue; }
        if (!x.inicio) continue;
        if (!x.fim_calculado) { duvidosos.push({ cod: x.nosso_numero, motivo: "Capitalização: modo de reaplicação não lido, fim não calculável", detalhe: x.arquivo }); continue; }
        add(x.nosso_numero, { fonte: "cap", ini: x.inicio, fim: x.fim_calculado, ref: x.arquivo });
      }
    }
  }
  // --- fonte acervo (Nosso nº do Corp -> Código O2)
  const porCorp = new Map<number, Prop[]>();
  if (FONTES.has("acervo")) {
    for (let de = 0; ; de += 1000) {
      const { data } = await sb.from("apolice_documentos").select("nosso_numero,vigencia_inicio,vigencia_fim,arquivo_nome").eq("situacao", "certa").not("nosso_numero", "is", null).not("vigencia_inicio", "is", null).not("vigencia_fim", "is", null).order("id").range(de, de + 999);
      for (const a of data ?? []) (porCorp.get(Number(a.nosso_numero)) ?? porCorp.set(Number(a.nosso_numero), []).get(Number(a.nosso_numero))!).push({ fonte: "acervo", ini: a.vigencia_inicio, fim: a.vigencia_fim, ref: String(a.arquivo_nome ?? "") });
      if ((data ?? []).length < 1000) break;
    }
  }
  // --- fonte tarefas
  if (FONTES.has("tarefas")) {
    const f = path.join(tmp, "auditoria-tarefas-pdf.csv");
    if (fs.existsSync(f)) {
      const linhas = fs.readFileSync(f, "utf8").replace(/^﻿/, "").split("\n");
      const parse = (l: string) => l.slice(1, -1).split('";"');
      const h = parse(linhas[0]);
      const c = (r: string[], n: string) => r[h.indexOf(n)];
      for (const l of linhas.slice(1)) {
        const r = parse(l);
        if (c(r, "papel") !== "principal" || !["proposta", "apolice"].includes(c(r, "tipo_pdf"))) continue; // endosso/certificado têm outra vigência
        if (!["cpf+vigência", "apólice citada"].includes(c(r, "ligacao")) || !c(r, "codigo_o2")) continue;
        const v = c(r, "vigencia_pdf").split("→");
        if (!v[0] || !v[1]) continue;
        add(Number(c(r, "codigo_o2")), { fonte: "tarefas", ini: v[0], fim: v[1], ref: c(r, "arquivo") });
      }
    }
  }

  // --- documentos do ERP
  const codsO2 = [...propostas.keys()];
  const docs = new Map<number, Doc>();
  const COLS = "id,nosso_numero,nosso_numero_corp,vigencia_inicio,vigencia_fim,congelado,documento_renovado_id,seguradora_id,ramo_id";
  for (const g of em(codsO2)) { const { data } = await sb.from("erp_documentos").select(COLS).in("nosso_numero", g); for (const d of (data ?? []) as Doc[]) docs.set(d.nosso_numero, d); }
  const corpCods = [...porCorp.keys()];
  for (const g of em(corpCods)) {
    const { data } = await sb.from("erp_documentos").select(COLS).in("nosso_numero_corp", g);
    for (const d of (data ?? []) as Doc[]) { docs.set(d.nosso_numero, d); for (const p of porCorp.get(Number(d.nosso_numero_corp)) ?? []) add(d.nosso_numero, p); }
  }
  // renovação ligada: o documento foi renovado por outro
  const idsDocs = [...docs.values()].map((d) => d.id);
  const renovados = new Set<string>();
  for (const g of em(idsDocs)) { const { data } = await sb.from("erp_documentos").select("documento_renovado_id").in("documento_renovado_id", g); for (const x of data ?? []) renovados.add(x.documento_renovado_id!); }

  const { data: segs } = await sb.from("erp_seguradoras").select("id,nome");
  const { data: ramos } = await sb.from("erp_ramos").select("id,nome");
  const nSeg = new Map((segs ?? []).map((s) => [s.id, s.nome])); const nRamo = new Map((ramos ?? []).map((s) => [s.id, s.nome]));

  const congelados: { produto: string; dIni: number; dFim: number; mudaMesInicio: boolean; mudaMesFim: boolean; fonte: string }[] = [];
  type Mud = { doc: Doc; ini: string; fim: string; dIni: number; dFim: number; fonte: string; ref: string };
  const mudar: Mud[] = [];
  const r = { documentosComFonte: propostas.size, semDiferenca: 0, gravar: 0 } as Record<string, number>;
  const bump = (k: string) => (r[k] = (r[k] ?? 0) + 1);
  for (const [cod, props] of propostas) {
    const d = docs.get(cod);
    if (!d) { bump("documento não encontrado"); continue; }
    if (!d.vigencia_inicio || !d.vigencia_fim) { duvidosos.push({ cod, motivo: "documento sem vigência no ERP", detalhe: props[0].fonte }); bump("sem vigência no ERP (listado)"); continue; }
    const distintas = new Map(props.filter((p) => p.fim).map((p) => [`${p.ini}|${p.fim}`, p]));
    if (distintas.size > 1) { duvidosos.push({ cod, motivo: "fontes em conflito", detalhe: [...distintas.keys()].join(" ; ") }); bump("fontes em conflito"); continue; }
    const p = [...distintas.values()][0];
    if (!p) continue;
    const dIni = dias(p.ini, d.vigencia_inicio), dFim = dias(p.fim!, d.vigencia_fim);
    if (dIni === 0 && dFim === 0) { r.semDiferenca++; continue; }
    const mudaMesInicio = d.vigencia_inicio.slice(0, 7) !== p.ini.slice(0, 7), mudaMesFim = d.vigencia_fim.slice(0, 7) !== p.fim!.slice(0, 7);
    if (d.congelado) {
      // --congelados-sem-mudar-mes (autorizado pelo Matheus em 28/10): congelado só entra se início e fim ficam no MESMO mês de competência;
      // renovação ligada e diferença > 31 dias continuam sendo checadas logo abaixo.
      if (!CONGELADOS_SEM_MUDAR_MES || mudaMesInicio || mudaMesFim) {
        duvidosos.push({ cod, motivo: CONGELADOS_SEM_MUDAR_MES ? "congelado e a correção muda o mês" : "documento congelado", detalhe: `ini ${dIni} d, fim ${dFim} d` });
        bump(CONGELADOS_SEM_MUDAR_MES ? "congelado que muda de mês (listado)" : "congelado (listado)");
        congelados.push({ produto: `${nSeg.get(d.seguradora_id!) ?? "?"} / ${nRamo.get(d.ramo_id!) ?? "?"}`, dIni, dFim, mudaMesInicio, mudaMesFim, fonte: p.fonte });
        continue;
      }
    }
    if (d.documento_renovado_id || renovados.has(d.id)) { duvidosos.push({ cod, motivo: "renovação ligada", detalhe: `ini ${dIni} d, fim ${dFim} d` }); bump("renovação ligada (listado)"); continue; }
    if (Math.abs(dIni) > LIMITE_DIAS || Math.abs(dFim) > LIMITE_DIAS) { duvidosos.push({ cod, motivo: `diferença maior que ${LIMITE_DIAS} dias`, detalhe: `ini ${dIni} d, fim ${dFim} d (${p.fonte})` }); bump("diferença grande (listado)"); continue; }
    mudar.push({ doc: d, ini: p.ini, fim: p.fim!, dIni, dFim, fonte: p.fonte, ref: p.ref });
    r.gravar++;
  }

  // resumo por fonte e por seguradora/produto
  const porFonte: Record<string, { n: number; dias: number[] }> = {};
  const porProduto: Record<string, { n: number; somaAbsIni: number; maxAbs: number }> = {};
  for (const m of mudar) {
    const pf = (porFonte[m.fonte] ??= { n: 0, dias: [] }); pf.n++; pf.dias.push(Math.abs(m.dIni), Math.abs(m.dFim));
    const k = `${nSeg.get(m.doc.seguradora_id!) ?? "?"} / ${nRamo.get(m.doc.ramo_id!) ?? "?"}`;
    const pp = (porProduto[k] ??= { n: 0, somaAbsIni: 0, maxAbs: 0 }); pp.n++; pp.somaAbsIni += Math.abs(m.dIni); pp.maxAbs = Math.max(pp.maxAbs, Math.abs(m.dIni), Math.abs(m.dFim));
  }
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"} — vigências pelo documento da seguradora | fontes: ${[...FONTES].join(",")}`);
  console.log(JSON.stringify(r));
  console.log("POR FONTE (documentos a gravar):", JSON.stringify(Object.fromEntries(Object.entries(porFonte).map(([k, v]) => [k, { n: v.n, mediaDias: +(v.dias.reduce((a, b) => a + b, 0) / v.dias.length).toFixed(1) }]))));
  console.log("POR SEGURADORA / PRODUTO (a gravar | média |Δ início| em dias | maior diferença):");
  for (const [k, v] of Object.entries(porProduto).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(48)} ${v.n} | ${(v.somaAbsIni / v.n).toFixed(1)} | ${v.maxAbs}`);
  const faixas: Record<string, number> = {};
  for (const m of mudar) { const k = m.dIni === 0 ? "só o fim muda" : Math.abs(m.dIni) <= 3 ? "início 1–3 dias" : "início 4–31 dias"; faixas[k] = (faixas[k] ?? 0) + 1; }
  console.log("TAMANHO DA CORREÇÃO:", JSON.stringify(faixas));
  const motivos: Record<string, number> = {};
  for (const d of duvidosos) motivos[d.motivo] = (motivos[d.motivo] ?? 0) + 1;
  console.log("NÃO GRAVADOS (motivo):", JSON.stringify(motivos));

  if (congelados.length) {
    const pc: Record<string, { n: number; mudaMes: number; maxAbs: number }> = {};
    for (const c of congelados) { const x = (pc[c.produto] ??= { n: 0, mudaMes: 0, maxAbs: 0 }); x.n++; if (c.mudaMesInicio || c.mudaMesFim) x.mudaMes++; x.maxAbs = Math.max(x.maxAbs, Math.abs(c.dIni), Math.abs(c.dFim)); }
    console.log(`CONGELADOS COM DIFERENÇA (não gravados): ${congelados.length} | mudariam de mês (início ou fim): ${congelados.filter((c) => c.mudaMesInicio || c.mudaMesFim).length} | mudariam o mês do INÍCIO: ${congelados.filter((c) => c.mudaMesInicio).length}`);
    for (const [k, v] of Object.entries(pc).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(48)} ${v.n} | mudam de mês: ${v.mudaMes} | maior diferença: ${v.maxAbs} dias`);
    const tam: Record<string, number> = {};
    for (const c of congelados) { const k = c.dIni === 0 ? "só o fim" : Math.abs(c.dIni) <= 3 ? "início 1–3 dias" : "início 4–31 dias"; tam[k] = (tam[k] ?? 0) + 1; }
    console.log("  tamanho do início nos congelados:", JSON.stringify(tam));
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const fDub = path.join(tmp, `vigencias-nao-gravadas-${stamp}.csv`);
  fs.writeFileSync(fDub, "﻿" + ["codigo_o2;motivo;detalhe", ...duvidosos.map((d) => [d.cod, d.motivo, d.detalhe].map(csv).join(";"))].join("\n"));
  console.log("lista dos não gravados:", fDub);

  if (!GRAVAR) { console.log("(ensaio: nada foi gravado)"); return; }
  const fBak = path.join(tmp, `backup-vigencias-${stamp}.csv`);
  fs.writeFileSync(fBak, "﻿" + ["id;codigo_o2;fonte;ini_antes;fim_antes;ini_depois;fim_depois;dif_ini_dias;dif_fim_dias;arquivo", ...mudar.map((m) => [m.doc.id, m.doc.nosso_numero, m.fonte, m.doc.vigencia_inicio, m.doc.vigencia_fim, m.ini, m.fim, m.dIni, m.dFim, m.ref].map(csv).join(";"))].join("\n"));
  console.log("backup dos valores antigos:", fBak);
  let ok = 0, falhas = 0;
  for (const m of mudar) {
    const { error, count } = await sb.from("erp_documentos").update({ vigencia_inicio: m.ini, vigencia_fim: m.fim }, { count: "exact" }).eq("id", m.doc.id).eq("vigencia_inicio", m.doc.vigencia_inicio!).eq("vigencia_fim", m.doc.vigencia_fim!).eq("congelado", m.doc.congelado);
    if (error || !count) { falhas++; if (falhas <= 5) console.log("falha:", m.doc.nosso_numero, error?.message ?? "nenhuma linha (mudou no meio?)"); } else ok++;
  }
  console.log(`GRAVADOS: ${ok} documentos | falhas: ${falhas}`);
})();
