process.loadEnvFile(".env.local");
// ERP O2 — 02/11/2026: calibra os PESOS da métrica de confiança dos vínculos por REGRESSÃO LOGÍSTICA regularizada (Hastie/Tibshirani/Friedman, ESL cap. 4.4 e 3.4;
// validação cruzada e bootstrap, cap. 7). Sem Python: Newton/IRLS (ridge) e coordenada-descendente (lasso) em TypeScript. Linhas idênticas são agregadas (contagens), então é rápido.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/vinculo-regressao.ts <lote_treino> <versao> [--gravar]
import { createServiceClient } from "@/lib/supabase/service";

const FEATURES = ["premio_igual", "premio_sem_dado", "vigencia_igual", "cpf_igual", "cpf_diferente", "nome_igual", "seguradora_igual", "mesmo_locatario", "comissao_igual", "ramo_igual", "premio_na_faixa_reajuste"];
// pontos da métrica ATUAL (modo 0) para as mesmas evidências — só para comparar faixas
const PONTOS_ATUAIS: Record<string, number> = { premio_igual: 7.5, vigencia_igual: 13.5, cpf_igual: 12.5, cpf_diferente: -40, nome_igual: 5, seguradora_igual: 4.5 };
const PONTOS_BASE_IMOBILIARIA = 7.2; // imobiliaria_igual é sempre verdadeira nas candidatas

type Agg = { pat: number; y: number; n: number; grupo: string; fonte: string };
const sig = (z: number) => 1 / (1 + Math.exp(-z));

function solve(A: number[][], b: number[]): number[] {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let i = 0; i < n; i++) {
    let m = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[m][i])) m = r;
    [M[i], M[m]] = [M[m], M[i]];
    const d = M[i][i] || 1e-12;
    for (let r = i + 1; r < n; r++) { const f = M[r][i] / d; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c]; x[i] = s / (M[i][i] || 1e-12); }
  return x;
}

// linhas agregadas: P[pat] = vetor 0/1 ; w = contagem (já com peso de amostra)
function fitRidge(P: number[][], rows: { pat: number; y: number; w: number }[], lambda: number, maxIt = 60): number[] {
  const p = P[0].length; const beta = new Array(p + 1).fill(0);
  for (let it = 0; it < maxIt; it++) {
    const g = new Array(p + 1).fill(0); const H: number[][] = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0));
    for (const r of rows) {
      const x = P[r.pat]; let eta = beta[0]; for (let j = 0; j < p; j++) eta += beta[j + 1] * x[j];
      const mu = sig(eta); const wv = r.w * Math.max(mu * (1 - mu), 1e-9); const res = r.w * (r.y - mu);
      g[0] += res; H[0][0] += wv;
      for (let j = 0; j < p; j++) if (x[j]) { g[j + 1] += res; H[0][j + 1] += wv; H[j + 1][0] += wv; for (let k = 0; k < p; k++) if (x[k]) H[j + 1][k + 1] += wv; }
    }
    for (let j = 1; j <= p; j++) { g[j] -= lambda * beta[j]; H[j][j] += lambda; }
    const d = solve(H, g); let mx = 0;
    for (let j = 0; j <= p; j++) { const step = Math.max(-4, Math.min(4, d[j])); beta[j] += step; mx = Math.max(mx, Math.abs(step)); }
    if (mx < 1e-7) break;
  }
  return beta;
}

// lasso: IRLS + coordenada descendente (estilo glmnet)
function fitLasso(P: number[][], rows: { pat: number; y: number; w: number }[], lambda: number): number[] {
  const p = P[0].length; const beta = new Array(p + 1).fill(0);
  for (let it = 0; it < 40; it++) {
    const W: number[] = [], Z: number[] = []; const eta0: number[] = [];
    for (const r of rows) {
      const x = P[r.pat]; let eta = beta[0]; for (let j = 0; j < p; j++) eta += beta[j + 1] * x[j];
      const mu = Math.min(Math.max(sig(eta), 1e-9), 1 - 1e-9); const wv = r.w * mu * (1 - mu);
      W.push(Math.max(wv, 1e-12)); Z.push(eta + (r.y - mu) / (mu * (1 - mu))); eta0.push(eta);
    }
    const old = beta.slice();
    for (let sweep = 0; sweep < 100; sweep++) {
      let change = 0;
      // intercepto
      { let num = 0, den = 0; rows.forEach((r, i) => { const x = P[r.pat]; let f = 0; for (let j = 0; j < p; j++) f += beta[j + 1] * x[j]; num += W[i] * (Z[i] - f); den += W[i]; }); const nb = num / den; change = Math.max(change, Math.abs(nb - beta[0])); beta[0] = nb; }
      for (let j = 0; j < p; j++) {
        let num = 0, den = 0;
        rows.forEach((r, i) => { const x = P[r.pat]; if (!x[j]) return; let f = beta[0]; for (let k = 0; k < p; k++) if (k !== j) f += beta[k + 1] * x[k]; num += W[i] * (Z[i] - f); den += W[i]; });
        const nb = den > 0 ? Math.sign(num) * Math.max(Math.abs(num) - lambda, 0) / den : 0;
        change = Math.max(change, Math.abs(nb - beta[j + 1])); beta[j + 1] = nb;
      }
      if (change < 1e-8) break;
    }
    let md = 0; for (let j = 0; j <= p; j++) md = Math.max(md, Math.abs(beta[j] - old[j]));
    if (md < 1e-6) break;
  }
  return beta;
}

const predict = (P: number[][], beta: number[], pat: number) => { const x = P[pat]; let eta = beta[0]; for (let j = 0; j < x.length; j++) eta += beta[j + 1] * x[j]; return sig(eta); };
const logloss = (P: number[][], beta: number[], rows: { pat: number; y: number; w: number }[]) => { let s = 0, n = 0; for (const r of rows) { const q = Math.min(Math.max(predict(P, beta, r.pat), 1e-12), 1 - 1e-12); s -= r.w * (r.y ? Math.log(q) : Math.log(1 - q)); n += r.w; } return s / n; };

function auc(items: { p: number; y: number; w: number }[]) {
  const s = [...items].sort((a, b) => a.p - b.p); let negW = 0, acc = 0, posW = 0, i = 0;
  while (i < s.length) { let j = i; let gp = 0, gn = 0; while (j < s.length && s[j].p === s[i].p) { if (s[j].y) gp += s[j].w; else gn += s[j].w; j++; } acc += gp * (negW + gn / 2); negW += gn; posW += gp; i = j; }
  return posW && negW ? acc / (posW * negW) : NaN;
}

async function main() {
  const [lote, versao] = [process.argv[2], process.argv[3]]; const gravar = process.argv.includes("--gravar");
  if (!lote || !versao) throw new Error("uso: <lote_treino> <versao> [--gravar]");
  const sb = createServiceClient();
  const P: number[][] = []; const patIdx = new Map<string, number>(); const agg = new Map<string, Agg>();
  let total = 0;
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from("erp_vinculo_treino").select("grupo, rotulo, rotulo_fonte, f").eq("lote", lote).eq("tarefa", "renovacao_sucessora").order("id").range(de, de + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const vec = FEATURES.map((k) => Number((r.f as Record<string, number>)[k] ?? 0)); const key = vec.join("");
      let pi = patIdx.get(key); if (pi === undefined) { pi = P.length; patIdx.set(key, pi); P.push(vec); }
      const k2 = `${r.grupo}|${pi}|${r.rotulo}`; const a = agg.get(k2); if (a) a.n++; else agg.set(k2, { pat: pi, y: r.rotulo, n: 1, grupo: r.grupo, fonte: r.rotulo_fonte });
      total++;
    }
    if (!data || data.length < 1000) break;
  }
  const all = [...agg.values()];
  console.log(`linhas ${total} | padrões distintos ${P.length} | agregadas ${all.length}`);
  const grupos = [...new Set(all.map((a) => a.grupo))]; const fold = new Map<string, number>(); const K = 5;
  grupos.forEach((g, i) => fold.set(g, (i * 2654435761 >>> 0) % K));
  const rowsOf = (pred: (a: Agg) => boolean) => all.filter(pred).map((a) => ({ pat: a.pat, y: a.y, w: a.n }));
  const lambdas = [0.01, 0.1, 1, 3, 10, 30, 100];

  // ---- Protocolo A: treina no rótulo FRACO (Corp) e testa no FORTE (PDF) — verdade independente, grupos disjuntos
  const resA: Record<string, unknown>[] = []; let melhorLamA = 1; let melhorLL = Infinity;
  const teste = rowsOf((a) => a.fonte === "pdf");
  for (const lam of lambdas) { const b = fitRidge(P, rowsOf((a) => a.fonte === "corp"), lam); const ll = logloss(P, b, teste); resA.push({ lambda: lam, logloss_teste_pdf: +ll.toFixed(5) }); if (ll < melhorLL) { melhorLL = ll; melhorLamA = lam; } }
  console.log("A) treino=corp, teste=pdf:", JSON.stringify(resA), "melhor lambda", melhorLamA);

  // ---- Protocolo B: validação cruzada k-fold POR GRUPO sobre todos os rótulos (forte+fraco), lambda por log-loss
  let melhorLam = 1; let melhorCV = Infinity; const cvTab: Record<string, unknown>[] = [];
  for (const lam of lambdas) {
    let s = 0, n = 0;
    for (let f = 0; f < K; f++) { const tr = rowsOf((a) => fold.get(a.grupo) !== f); const te = rowsOf((a) => fold.get(a.grupo) === f); const b = fitRidge(P, tr, lam); const w = te.reduce((x, r) => x + r.w, 0); s += logloss(P, b, te) * w; n += w; }
    const ll = s / n; cvTab.push({ lambda: lam, logloss_cv: +ll.toFixed(5) }); if (ll < melhorCV) { melhorCV = ll; melhorLam = lam; }
  }
  console.log("B) CV por grupo (todos):", JSON.stringify(cvTab), "melhor lambda", melhorLam);

  // predições fora-da-amostra (OOF) para o conjunto FORTE, com o modelo treinado nos outros grupos (qualquer fonte)
  const oof: { p: number; y: number; w: number; pat: number }[] = [];
  for (let f = 0; f < K; f++) {
    const b = fitRidge(P, rowsOf((a) => fold.get(a.grupo) !== f), melhorLam);
    for (const a of all) if (a.fonte === "pdf" && fold.get(a.grupo) === f) oof.push({ p: predict(P, b, a.pat), y: a.y, w: a.n, pat: a.pat });
  }
  const aucOOF = auc(oof);
  const bins = [0, 0.01, 0.05, 0.2, 0.5, 0.8, 0.95, 0.99, 1.0001]; const calib = [];
  for (let i = 0; i < bins.length - 1; i++) { const it = oof.filter((o) => o.p >= bins[i] && o.p < bins[i + 1]); const w = it.reduce((x, o) => x + o.w, 0); if (!w) continue; calib.push({ faixa_prob: `${bins[i]}–${Math.min(bins[i + 1], 1)}`, pares: w, prob_media: +(it.reduce((x, o) => x + o.p * o.w, 0) / w).toFixed(4), taxa_real: +(it.reduce((x, o) => x + o.y * o.w, 0) / w).toFixed(4) }); }
  // corte: menor p (em fronteiras de empate) com precisão >= 0.99 nos OOF fortes
  const ord = [...oof].sort((a, b) => b.p - a.p); let tp = 0, fp = 0; let corte = 1; const posTot = oof.reduce((x, o) => x + (o.y ? o.w : 0), 0);
  for (let i = 0; i < ord.length; ) { let j = i; while (j < ord.length && ord[j].p === ord[i].p) { if (ord[j].y) tp += ord[j].w; else fp += ord[j].w; j++; } if (tp / (tp + fp) >= 0.99) corte = ord[i].p; i = j; }
  // nível de GRUPO (como o vínculo é decidido): a melhor candidata do grupo vincula se p1 >= corte E a 2ª candidata está bem abaixo (sem empate)
  const porGrupo = new Map<string, { p: number; y: number }[]>();
  for (let f = 0; f < K; f++) { /* reaproveita as predições OOF por grupo abaixo */ }
  const oofGrupo: { grupo: string; p: number; y: number; n: number }[] = [];
  for (let f = 0; f < K; f++) {
    const b = fitRidge(P, rowsOf((a) => fold.get(a.grupo) !== f), melhorLam);
    for (const a of all) if (a.fonte === "pdf" && fold.get(a.grupo) === f) oofGrupo.push({ grupo: a.grupo, p: predict(P, b, a.pat), y: a.y, n: a.n });
  }
  for (const o of oofGrupo) for (let i = 0; i < o.n; i++) { const l = porGrupo.get(o.grupo) ?? []; l.push({ p: o.p, y: o.y }); porGrupo.set(o.grupo, l); }
  const grupoTab = (c: number, margem: number) => { let vinc = 0, certos = 0, semDecisao = 0, positivos = 0, empate = 0; for (const l of porGrupo.values()) { l.sort((a, b) => b.p - a.p); const pos = l.some((x) => x.y); if (pos) positivos++; const t = l[0], s = l[1]?.p ?? 0; if (t.p >= c && t.p - s >= margem) { vinc++; if (t.y) certos++; } else if (t.p >= c) empate++; else semDecisao++; } return { corte: c, margem, grupos_com_positivo: positivos, vincula_sozinho: vinc, acertos: certos, precisao_grupo: +(certos / Math.max(vinc, 1)).toFixed(4), empatados_vao_p_provavel: empate, abaixo_do_corte: semDecisao }; };
  const gruposMetricas = [grupoTab(0.9, 0), grupoTab(0.9, 0.3), grupoTab(0.95, 0.3), grupoTab(0.97, 0.5)];
  const conf = (c: number) => { let TP = 0, FP = 0, FN = 0, TN = 0; for (const o of oof) { const pr = o.p >= c; if (pr && o.y) TP += o.w; else if (pr) FP += o.w; else if (o.y) FN += o.w; else TN += o.w; } return { corte: +c.toFixed(4), VP: TP, FP, FN, VN: TN, precisao: +(TP / Math.max(TP + FP, 1)).toFixed(4), cobertura: +(TP / Math.max(posTot, 1)).toFixed(4) }; };
  // comparação com os pontos atuais (>=70 provável)
  const pontos = (pat: number) => PONTOS_BASE_IMOBILIARIA + P[pat].reduce((s, v, j) => s + v * (PONTOS_ATUAIS[FEATURES[j]] ?? 0), 0);
  const mudam = { modelo_vincula_e_pontos_nao: 0, pontos_vincula_ou_provavel_e_modelo_nao: 0, ambos: 0 }; let positivosPontos70 = 0;
  for (const o of oof) { const pt = pontos(o.pat); const m = o.p >= corte; const pv = pt >= 70; if (m && !pv) mudam.modelo_vincula_e_pontos_nao += o.w; else if (!m && pv) mudam.pontos_vincula_ou_provavel_e_modelo_nao += o.w; else if (m && pv) mudam.ambos += o.w; if (o.y && pt >= 70) positivosPontos70 += o.w; }

  // ---- modelo final (todos os rótulos) + lasso + bootstrap por grupo
  const bFinal = fitRidge(P, rowsOf(() => true), melhorLam);
  const lasso = fitLasso(P, rowsOf(() => true), 0.5);
  const B = 200; const boot: number[][] = FEATURES.map(() => []); const byGroup = new Map<string, Agg[]>(); all.forEach((a) => { const l = byGroup.get(a.grupo) ?? []; l.push(a); byGroup.set(a.grupo, l); });
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let b = 0; b < B; b++) {
    const cnt = new Map<string, number>(); for (let i = 0; i < grupos.length; i++) { const g = grupos[Math.floor(rnd() * grupos.length)]; cnt.set(g, (cnt.get(g) ?? 0) + 1); }
    const rows: { pat: number; y: number; w: number }[] = []; for (const [g, m] of cnt) for (const a of byGroup.get(g)!) rows.push({ pat: a.pat, y: a.y, w: a.n * m });
    const be = fitRidge(P, rows, melhorLam, 30); FEATURES.forEach((_, j) => boot[j].push(be[j + 1]));
  }
  const q = (arr: number[], pr: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(pr * s.length)))]; };
  const pesos = FEATURES.map((nome, j) => ({ evidencia: nome, coef: +bFinal[j + 1].toFixed(4), ic95: [+q(boot[j], 0.025).toFixed(3), +q(boot[j], 0.975).toFixed(3)], razao_chances: +Math.exp(bFinal[j + 1]).toFixed(3), lasso_coef: +lasso[j + 1].toFixed(4), pontos_atuais: PONTOS_ATUAIS[nome] ?? 0 }));
  const relatorio = { lote, versao, linhas: total, grupos: grupos.length, positivos: all.filter((a) => a.y).reduce((s, a) => s + a.n, 0), negativos: all.filter((a) => !a.y).reduce((s, a) => s + a.n, 0),
    lambda_escolhido: melhorLam, intercepto: +bFinal[0].toFixed(4), auc_oof_pdf: +aucOOF.toFixed(4), calibracao_oof_pdf: calib, corte_precisao_99: conf(corte), no_corte_090: conf(0.9), por_grupo: gruposMetricas,
    comparacao_com_pontos_atuais: { ...mudam, positivos_com_pontos_ge_70: positivosPontos70, positivos_total: posTot }, pesos };
  console.log(JSON.stringify(relatorio, null, 1));
  if (gravar) {
    await sb.from("erp_vinculo_pesos_candidatos").delete().eq("versao", versao).eq("tarefa", "renovacao_sucessora");
    const { error } = await sb.from("erp_vinculo_pesos_candidatos").insert(pesos.map((p) => ({ versao, tarefa: "renovacao_sucessora", evidencia: p.evidencia, coef: p.coef, ic95_baixo: p.ic95[0], ic95_alto: p.ic95[1], razao_chances: p.razao_chances, selecionada_lasso: p.lasso_coef !== 0, pontos_equivalentes: null, ativo: false })));
    if (error) throw new Error(error.message);
    const { error: e2 } = await sb.from("erp_vinculo_modelo").upsert({ versao, tarefa: "renovacao_sucessora", intercepto: relatorio.intercepto, lambda: melhorLam, corte, metricas: relatorio, ativo: false }, { onConflict: "versao,tarefa" });
    if (e2) throw new Error(e2.message);
    console.log("gravado como CANDIDATO (inativo)");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
