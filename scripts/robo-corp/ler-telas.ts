// Transforma o OCR local (ocr/ocr.jsonl, feito por ocr-telas.ts) em CAMPOS por tela e grava em erp_corp_telas_documento.dados (status 'lida', nível 8, versão do leitor).
// Só campos estruturados: nada de texto bruto do OCR; Observações passam pela máscara de segredos. Ensaio por padrão; --gravar grava; --so NN[,NN] limita aos documentos.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/ler-telas.ts [--gravar] [--so 101336,109839]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { lerTela, palavrasDaTela, VERSAO_LEITOR, type Leitura } from "@/lib/erp/leitorTelasCorp";

const PASTA = process.env.APOLICES_CORP || path.join(os.tmpdir(), "o2-apolices-corp");
const RECORTE = { left: 213, top: 105 };
const GRAVAR = process.argv.includes("--gravar");
const so = process.argv.includes("--so") ? new Set(process.argv[process.argv.indexOf("--so") + 1].split(",")) : null;

export type LeituraDoc = { nn: string; telas: Record<string, Leitura> };
/** Combina os dois passes de OCR (a = cor 2,5×; b = preto e branco 3×) e lê os campos de cada tela. */
export function lerOcrJsonl(): Map<string, LeituraDoc> {
  const porTela = new Map<string, Map<string, { palavras: any[]; erro?: string }[]>>();
  for (const [passe, escala] of [["a", 2.5], ["b", 3]] as const) {
    const arq = path.join(PASTA, "ocr", `ocr-${passe}.jsonl`);
    if (!fs.existsSync(arq)) continue;
    for (const linha of fs.readFileSync(arq, "utf8").split("\n")) {
      if (!linha.trim()) continue;
      let j: { arq: string; linhas?: { palavras: any }[]; erro?: string };
      try { j = JSON.parse(linha); } catch { continue; }
      const m = /(\d+)_([a-z]+)\.png$/.exec(j.arq);
      if (!m || (so && !so.has(m[1]))) continue;
      const lj = (j.linhas ?? []).map((l) => ({ palavras: Array.isArray(l.palavras) ? l.palavras : [l.palavras].filter(Boolean) }));
      const d = porTela.get(m[1]) ?? new Map(); porTela.set(m[1], d);
      const lista = d.get(m[2]) ?? []; d.set(m[2], lista);
      lista.push({ palavras: j.erro ? [] : palavrasDaTela(lj as any, { left: RECORTE.left, top: RECORTE.top, escala }), erro: j.erro });
    }
  }
  const docs = new Map<string, LeituraDoc>();
  for (const [nn, telas] of porTela) {
    const d: LeituraDoc = { nn, telas: {} }; docs.set(nn, d);
    for (const [tela, passes] of telas) {
      const ok = passes.filter((x) => !x.erro);
      d.telas[tela] = ok.length ? lerTela(tela, ok.map((x) => x.palavras)) : { tela, campos: {}, avisos: [`OCR falhou: ${passes[0]?.erro}`] };
    }
  }
  return docs;
}

(async () => {
  const docs = lerOcrJsonl();
  let telas = 0, comAviso = 0, nnErrado = 0;
  const contagemCampos: Record<string, number> = {}; let camposLidos = 0;
  for (const d of docs.values()) {
    for (const l of Object.values(d.telas)) {
      telas++;
      const cab = l.campos.cabecalho as { nosso_numero: number | null } | undefined;
      if (cab?.nosso_numero != null && String(cab.nosso_numero) !== d.nn) { l.avisos.push(`cabeçalho lido ${cab.nosso_numero} ≠ ${d.nn}`); nnErrado++; }
      if (l.avisos.length) comAviso++;
      const n = Object.values(l.campos).filter((v) => v !== null && v !== "" && !(Array.isArray(v) && !v.length)).length;
      contagemCampos[l.tela] = (contagemCampos[l.tela] ?? 0) + n; camposLidos += n;
    }
  }
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${docs.size} documentos, ${telas} telas lidas do OCR; com aviso ${comAviso} (cabeçalho ≠ documento ${nnErrado}); campos preenchidos ${camposLidos}`);
  console.log("campos por tela:", JSON.stringify(contagemCampos));
  if (process.argv.includes("--avisos")) { let n = 0; for (const d of docs.values()) for (const l of Object.values(d.telas)) if (l.avisos.length && n++ < 25) console.log(`  aviso ${d.nn} ${l.tela}: ${l.avisos.join("; ")}`); }
  if (so) for (const d of docs.values()) for (const [t, l] of Object.entries(d.telas)) { const { cabecalho, ...resto } = l.campos as any; console.log(`${d.nn} ${t}: ${JSON.stringify(resto)} ${l.avisos.length ? "AVISOS " + l.avisos.join("; ") : ""}`); }
  // Documento errado: a busca do robô às vezes devolve várias linhas (documentos associados) e ele abre a 1ª, que pode ser OUTRO documento. O cabeçalho da janela diz qual foi aberto.
  // telas-doc-errado.json = { nn buscado: nn que a janela mostrou }; o envio dos anexos retém esses arquivos (não grava PDF no Nosso Nº errado).
  const errados: Record<string, number> = {};
  for (const d of docs.values()) { const vistos = Object.values(d.telas).map((l) => (l.campos.cabecalho as { nosso_numero: number | null } | undefined)?.nosso_numero).filter((n): n is number => n != null); const maisComum = vistos.sort((a, b) => vistos.filter((x) => x === b).length - vistos.filter((x) => x === a).length)[0]; if (maisComum != null && String(maisComum) !== d.nn && vistos.filter((x) => x === maisComum).length >= 3) errados[d.nn] = maisComum; }
  if (!so) { const arqErr = path.join(PASTA, "telas-doc-errado.json"); const antes = fs.existsSync(arqErr) ? JSON.parse(fs.readFileSync(arqErr, "utf8")) : {}; fs.writeFileSync(arqErr, JSON.stringify({ ...antes, ...errados })); }
  console.log(`documentos em que a janela aberta era OUTRO documento: ${Object.keys(errados).length} de ${docs.size}`);
  if (!GRAVAR) return;
  const sb = createServiceClient();
  const agora = new Date().toISOString();
  let gravadas = 0;
  for (const d of docs.values()) {
    for (const l of Object.values(d.telas)) {
      const { error } = await sb.from("erp_corp_telas_documento").update({ status: "lida", dados: { campos: l.campos, avisos: l.avisos, leitor: "ocr_windows_ptbr", lido_ocr_em: agora }, versao_leitor: VERSAO_LEITOR })
        .eq("nosso_numero_corp", Number(d.nn)).eq("tela", l.tela);
      if (error) throw new Error(`${d.nn}/${l.tela}: ${error.message}`);
      gravadas++;
    }
  }
  console.log(`telas gravadas com os campos lidos: ${gravadas}`);
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
