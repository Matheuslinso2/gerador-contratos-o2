// Lê as telas do Corp CAMPO A CAMPO (recorte justo de cada campo, OCR local e gratuito do Windows, votação entre tratamentos de imagem). Sem IA, sem custo.
// Etapa 1: variantes a (ampliada 5×) e c (normalizada 6× + nitidez) de cada campo NÃO em branco; etapa 2: só os campos em que a e c não concordaram ganham mais duas leituras (d e e).
// Resultado por campo em ocr-campos/campos-<fatia>.jsonl: {nn, tela, campo, estado: lido | unico | conflito | ilegivel | em_branco | sem_imagem, valor, votos, brutos}
//   lido = ≥2 leituras iguais e válidas; unico = só 1 leitura válida (precisa de regra de consistência); conflito = leituras válidas diferentes; ilegivel = tem tinta no campo e nada válido; em_branco = campo vazio no Corp.
// Imagens: do disco ou, se já liberadas, do bucket corp-telas. Retomável por documento. Fatias em paralelo: --fatia 0/4 ... 3/4.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/ocr-campos.ts [--fatia i/n] [--so NN,NN] [--limite N]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { createServiceClient } from "@/lib/supabase/service";
import { CAMPOS, TELAS_COM_CAMPOS, type Campo, type Tipo } from "@/lib/erp/camposTelasCorp";
import { data as parseData, dinheiro, percentual } from "@/lib/erp/leitorTelasCorp";
import { imagemDaTela, PASTA } from "./_telas-util";

const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : null);
const [FATIA, FATIAS] = (arg("--fatia") ?? "0/1").split("/").map(Number);
const so = arg("--so") ? new Set(arg("--so")!.split(",")) : null;
const limite = arg("--limite") ? Number(arg("--limite")) : Infinity;
const DIR = path.join(PASTA, "ocr-campos"); const TMP = path.join(DIR, `tmp-${FATIA}`);
const SAIDA = path.join(DIR, `campos-${FATIA}.jsonl`); const FEITOS = path.join(DIR, `docs-${FATIA}.txt`);
const LOTE_DOCS = 15;
const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  ${m}`);

// ---- interpretação por tipo ----
const apenasDig = (s: string) => s.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/\D/g, "");
function parse(tipo: Tipo, bruto: string): string | number | null {
  const t = bruto.replace(/\s+/g, " ").trim();
  if (!t) return null;
  switch (tipo) {
    case "data": return parseData(t);
    case "dinheiro": return dinheiro(t.replace(/[^\d.,\-_—–•~OoQlI|S ]/g, ""));
    case "pct": return percentual(t);
    case "int": { const m = /\d+/.exec(t.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1")); return m && m[0].length <= 4 ? Number(m[0]) : null; }
    case "digitos": { const d = apenasDig(t); return d.length >= 3 ? d : null; }
    case "codigo": { const d = apenasDig(t); return d.length >= 1 && d.length <= 7 ? d : null; }
    case "texto": return t.length >= 2 ? t : null;
  }
}
const chave = (tipo: Tipo, v: string | number) => (tipo === "texto" ? String(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "") : String(v));

function votar(tipo: Tipo, brutos: (string | null)[]) {
  const vals = brutos.map((b) => (b == null ? null : parse(tipo, b)));
  const validos = vals.filter((v): v is string | number => v !== null);
  const cont = new Map<string, { n: number; v: string | number }>();
  for (const v of validos) { const k = chave(tipo, v); const e = cont.get(k); if (e) e.n++; else cont.set(k, { n: 1, v }); }
  const ord = [...cont.values()].sort((a, b) => b.n - a.n);
  if (!ord.length) return { estado: "ilegivel" as const, valor: null, votos: 0 };
  if (ord[0].n >= 2 && (ord.length === 1 || ord[0].n > ord[1].n)) return { estado: "lido" as const, valor: ord[0].v, votos: ord[0].n };
  if (ord.length === 1) return { estado: "unico" as const, valor: ord[0].v, votos: 1 };
  return { estado: "conflito" as const, valor: null, votos: ord[0].n, candidatos: ord.map((o) => o.v) };
}

// ---- imagem -> variantes ----
type Raw = { buf: Buffer; w: number; h: number };
async function decodificar(img: Buffer): Promise<Raw> { const { data, info } = await sharp(img).greyscale().raw().toBuffer({ resolveWithObject: true }); return { buf: data, w: info.width, h: info.height }; }
const ret = (r: Campo["rect"]) => ({ left: Math.round(r[0]), top: Math.round(r[1]), width: Math.max(8, Math.round(r[2] - r[0])), height: Math.max(8, Math.round(r[3] - r[1])) });
function emBranco(raw: Raw, r: Campo["rect"]): boolean {
  const q = ret(r); let escuros = 0;
  for (let y = q.top; y < q.top + q.height && y < raw.h; y++) for (let x = q.left; x < q.left + q.width && x < raw.w; x++) if (raw.buf[y * raw.w + x] < 150) escuros++;
  return escuros < 6; // quase nenhum pixel escuro: campo vazio no Corp (texto cinza de campo desabilitado tem mínimo ~120-140 e conta como tinta)
}
function variante(raw: Raw, r: Campo["rect"], v: "a" | "c" | "d" | "e") {
  const q = ret(r); const base = sharp(raw.buf, { raw: { width: raw.w, height: raw.h, channels: 1 } }).extract(q);
  let img;
  if (v === "a") img = base.resize({ width: q.width * 5, kernel: "lanczos3" });
  else if (v === "c") img = base.normalise().resize({ width: q.width * 6, kernel: "lanczos3" }).sharpen();
  else if (v === "d") img = base.resize({ width: q.width * 4, kernel: "cubic" }).linear(1.5, -60);
  else img = base.resize({ width: q.width * 4, kernel: "lanczos3" }).threshold(140);
  return img.extend({ top: 25, bottom: 25, left: 25, right: 25, background: "#ffffff" }).png();
}

function ocrLista(arquivos: string[], tag: string): Map<string, string> {
  const lista = path.join(TMP, `${tag}.txt`), out = path.join(TMP, `${tag}.jsonl`);
  fs.writeFileSync(lista, arquivos.join("\n"));
  if (fs.existsSync(out)) fs.unlinkSync(out);
  spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(process.cwd(), "scripts", "robo-corp", "ocr-win.ps1"), "-Lista", lista, "-Saida", out, "-Escala", "1"], { stdio: "ignore" });
  const res = new Map<string, string>();
  if (fs.existsSync(out)) for (const l of fs.readFileSync(out, "utf8").split("\n")) {
    if (!l.trim()) continue; const j = JSON.parse(l);
    res.set(path.basename(j.arq), j.erro ? "" : (j.linhas ?? []).map((x: { texto: string }) => x.texto).join(" "));
  }
  return res;
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const sb = createServiceClient();
  const docs: number[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await sb.from("erp_corp_telas_documento").select("nosso_numero_corp").eq("tela", "documento").in("status", ["lida", "capturada"]).order("nosso_numero_corp").range(de, de + 999);
    if (error) throw new Error(error.message); docs.push(...(data ?? []).map((d) => Number(d.nosso_numero_corp))); if (!data || data.length < 1000) break;
  }
  const feitos = new Set(fs.existsSync(FEITOS) ? fs.readFileSync(FEITOS, "utf8").split("\n").filter(Boolean) : []);
  const alvo = docs.filter((n, i) => i % FATIAS === FATIA && !feitos.has(String(n)) && (!so || so.has(String(n)))).slice(0, limite);
  log(`fatia ${FATIA}/${FATIAS}: ${alvo.length} documentos a ler (${feitos.size} já feitos)`);
  const t0 = Date.now(); let n = 0;
  for (let i = 0; i < alvo.length; i += LOTE_DOCS) {
    const lote = alvo.slice(i, i + LOTE_DOCS);
    const itens: { nn: number; tela: string; campo: Campo; raw: Raw }[] = [];
    const saida: Record<string, unknown>[] = [];
    for (const nn of lote) {
      for (const tela of TELAS_COM_CAMPOS) {
        const img = await imagemDaTela(nn, tela);
        if (!img) { saida.push({ nn, tela, campo: "*", estado: "sem_imagem" }); continue; }
        const raw = await decodificar(img);
        for (const campo of CAMPOS.filter((c) => c.tela === tela)) {
          if (emBranco(raw, campo.rect)) saida.push({ nn, tela, campo: campo.campo, estado: "em_branco", valor: null, votos: 0 });
          else itens.push({ nn, tela, campo, raw });
        }
      }
    }
    // etapa 1: a e c
    const arq1: string[] = []; const idx = new Map<string, number>();
    for (let k = 0; k < itens.length; k++) for (const v of ["a", "c"] as const) { const f = path.join(TMP, `${k}_${v}.png`); await variante(itens[k].raw, itens[k].campo.rect, v).toFile(f); arq1.push(f); idx.set(path.basename(f), k); }
    const r1 = ocrLista(arq1, "e1");
    const brutos = itens.map((_, k) => [r1.get(`${k}_a.png`) ?? null, r1.get(`${k}_c.png`) ?? null]);
    // etapa 2: só onde a e c não concordaram em um valor válido
    const dif: number[] = [];
    for (let k = 0; k < itens.length; k++) { const v = votar(itens[k].campo.tipo, brutos[k]); if (v.estado !== "lido") dif.push(k); }
    if (dif.length) {
      const arq2: string[] = [];
      for (const k of dif) for (const v of ["d", "e"] as const) { const f = path.join(TMP, `${k}_${v}.png`); await variante(itens[k].raw, itens[k].campo.rect, v).toFile(f); arq2.push(f); }
      const r2 = ocrLista(arq2, "e2");
      for (const k of dif) brutos[k].push(r2.get(`${k}_d.png`) ?? null, r2.get(`${k}_e.png`) ?? null);
    }
    for (let k = 0; k < itens.length; k++) { const it = itens[k]; const v = votar(it.campo.tipo, brutos[k]); saida.push({ nn: it.nn, tela: it.tela, campo: it.campo.campo, tipo: it.campo.tipo, ...v, brutos: v.estado === "lido" ? undefined : brutos[k] }); }
    fs.appendFileSync(SAIDA, saida.map((s) => JSON.stringify(s)).join("\n") + "\n");
    fs.appendFileSync(FEITOS, lote.join("\n") + "\n");
    for (const f of fs.readdirSync(TMP)) fs.unlinkSync(path.join(TMP, f)); // só os PNGs/listas temporários desta fatia
    n += lote.length;
    log(`  ${n}/${alvo.length} documentos (${Math.round((Date.now() - t0) / 1000)} s; ${itens.length} campos com tinta, ${dif.length} precisaram de leitura extra)`);
  }
  log("fim");
})().catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
