// Conferência (SÓ LEITURA, não altera nenhum documento nem card): para cada documento de Capitalização cuja vigência foi corrigida pelo certificado
// (lista nos backups backup-vigencias-*.csv, pasta temporária), olha os documentos SUCESSORES ligados (documento_renovado_id = este documento:
// reaplicação / renovação) e compara o início do sucessor com o fim NOVO do documento anterior. Deve coincidir (±1 dia); lista só as divergências.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/conferir-sucessores-vigencia.ts
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const dias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const em = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

(async () => {
  const alterados = new Map<string, { codigo: number; fimAntes: string; fimDepois: string }>();
  for (const f of fs.readdirSync(os.tmpdir()).filter((x) => /^backup-vigencias-.*\.csv$/.test(x))) {
    const linhas = fs.readFileSync(path.join(os.tmpdir(), f), "utf8").replace(/^﻿/, "").split("\n");
    const h = linhas[0].split(";").map((x) => x.replace(/"/g, ""));
    for (const l of linhas.slice(1)) {
      const r = l.slice(1, -1).split('";"');
      alterados.set(r[h.indexOf("id")], { codigo: Number(r[h.indexOf("codigo_o2")]), fimAntes: r[h.indexOf("fim_antes")], fimDepois: r[h.indexOf("fim_depois")] });
    }
  }
  console.log(`documentos com vigência corrigida hoje (todos os backups): ${alterados.size}`);
  const ids = [...alterados.keys()];
  const atual = new Map<string, { fim: string | null }>();
  for (const g of em(ids)) { const { data } = await sb.from("erp_documentos").select("id,vigencia_fim").in("id", g); for (const d of data ?? []) atual.set(d.id, { fim: d.vigencia_fim }); }
  const sucessores: { pai: string; id: string; nosso_numero: number; situacao: string; inicio: string | null; fim: string | null }[] = [];
  for (const g of em(ids)) {
    const { data } = await sb.from("erp_documentos").select("id,nosso_numero,situacao,vigencia_inicio,vigencia_fim,documento_renovado_id").in("documento_renovado_id", g);
    for (const s of data ?? []) sucessores.push({ pai: s.documento_renovado_id!, id: s.id, nosso_numero: s.nosso_numero, situacao: s.situacao, inicio: s.vigencia_inicio, fim: s.vigencia_fim });
  }
  const comSucessor = new Set(sucessores.map((s) => s.pai));
  const r = { corrigidos: alterados.size, comSucessorLigado: comSucessor.size, sucessores: sucessores.length, coincidem: 0, divergem: 0, semInicio: 0 };
  const faixas: Record<string, number> = {};
  const porSituacao: Record<string, { n: number; divergem: number }> = {};
  const linhasCsv = ["codigo_o2_anterior;fim_novo_anterior;fim_antigo_anterior;codigo_o2_sucessor;situacao_sucessor;inicio_sucessor;dif_dias_inicio_sucessor_menos_fim_novo;dif_com_fim_antigo"];
  for (const s of sucessores) {
    const a = alterados.get(s.pai)!; const novoFim = atual.get(s.pai)?.fim ?? a.fimDepois;
    const ps = (porSituacao[s.situacao] ??= { n: 0, divergem: 0 }); ps.n++;
    if (!s.inicio) { r.semInicio++; continue; }
    const d = dias(novoFim, s.inicio);
    if (Math.abs(d) <= 1) { r.coincidem++; continue; }
    r.divergem++; ps.divergem++;
    const k = Math.abs(d) <= 3 ? "1–3 dias" : Math.abs(d) <= 31 ? "4–31 dias" : "mais de 31 dias"; faixas[k] = (faixas[k] ?? 0) + 1;
    linhasCsv.push([a.codigo, novoFim, a.fimAntes, s.nosso_numero, s.situacao, s.inicio, d, dias(a.fimAntes, s.inicio)].map(csv).join(";"));
  }
  // lado inverso: o documento corrigido é renovação de um documento ANTERIOR (documento_renovado_id): o fim do anterior deve coincidir com o início NOVO
  const preds: { id: string; nosso_numero: number; situacao: string; fim: string | null; paraDoc: string }[] = [];
  const filhos = new Map<string, { codigo: number; inicio: string | null; renovado: string | null }>();
  for (const g of em(ids)) {
    const { data } = await sb.from("erp_documentos").select("id,nosso_numero,vigencia_inicio,documento_renovado_id").in("id", g);
    for (const d of data ?? []) filhos.set(d.id, { codigo: d.nosso_numero, inicio: d.vigencia_inicio, renovado: d.documento_renovado_id });
  }
  const idsPred = [...new Set([...filhos.values()].map((f) => f.renovado).filter((x): x is string => !!x))];
  const dadosPred = new Map<string, { nosso_numero: number; situacao: string; fim: string | null }>();
  for (const g of em(idsPred)) { const { data } = await sb.from("erp_documentos").select("id,nosso_numero,situacao,vigencia_fim").in("id", g); for (const d of data ?? []) dadosPred.set(d.id, { nosso_numero: d.nosso_numero, situacao: d.situacao, fim: d.vigencia_fim }); }
  const rp = { corrigidosQueRenovamOutro: 0, coincidem: 0, divergem: 0 };
  const faixasP: Record<string, number> = {};
  const linhasP = ["codigo_o2_corrigido;inicio_novo;codigo_o2_anterior;situacao_anterior;fim_do_anterior;dif_dias(inicio_novo - fim_anterior)"];
  for (const [id, f] of filhos) {
    if (!f.renovado || !dadosPred.has(f.renovado)) continue;
    rp.corrigidosQueRenovamOutro++;
    const p = dadosPred.get(f.renovado)!;
    if (!f.inicio || !p.fim) continue;
    const d = dias(p.fim, f.inicio);
    if (Math.abs(d) <= 1) { rp.coincidem++; continue; }
    rp.divergem++;
    const k = Math.abs(d) <= 3 ? "1–3 dias" : Math.abs(d) <= 31 ? "4–31 dias" : "mais de 31 dias"; faixasP[k] = (faixasP[k] ?? 0) + 1;
    linhasP.push([f.codigo, f.inicio, p.nosso_numero, p.situacao, p.fim, d].map(csv).join(";"));
  }
  const saidaP = path.join(os.tmpdir(), "anteriores-divergentes-vigencia.csv");
  fs.writeFileSync(saidaP, "﻿" + linhasP.join("\n"));
  console.log("CONFERÊNCIA DOS ANTERIORES (o corrigido é renovação de outro; nada alterado):", JSON.stringify(rp));
  console.log("divergências por tamanho:", JSON.stringify(faixasP), "| lista:", saidaP);
  const saida = path.join(os.tmpdir(), "sucessores-divergentes-vigencia.csv");
  fs.writeFileSync(saida, "﻿" + linhasCsv.join("\n"));
  console.log("CONFERÊNCIA DOS SUCESSORES (nada alterado):", JSON.stringify(r));
  console.log("divergências por tamanho:", JSON.stringify(faixas));
  console.log("por situação do sucessor:", JSON.stringify(porSituacao));
  console.log("lista das divergências (Código O2):", saida);
})();
