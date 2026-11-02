// Carrega a base de legislação (erp-o2/conhecimento-legislacao) em legislacao_normas + legislacao_trechos, para o Robô O2 do chat consultar.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-legislacao.ts [--gravar]
// Cada norma vira uma linha (metadados do cabeçalho + INDICE.csv) e vários trechos (um por artigo; súmula por súmula; texto sem artigos em blocos de ~1.500 caracteres).
// Reexecutar atualiza (por arquivo): apaga e regrava os trechos daquela norma. Sem --gravar é ensaio.
process.loadEnvFile(".env.local");
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as XLSX from "xlsx";
import { createServiceClient } from "@/lib/supabase/service";

const RAIZ = "erp-o2/conhecimento-legislacao";
const GRAVAR = process.argv.includes("--gravar");
const sb = createServiceClient();

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const arquivosTxt = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivosTxt(p) : n.toLowerCase().endsWith(".txt") ? [p] : [];
  });

type Indice = Record<string, string>;
function lerIndice(): Map<string, Indice> {
  const wb = XLSX.read(readFileSync(join(RAIZ, "INDICE.csv"), "utf8").replace(/^﻿/, ""), { type: "string" });
  const linhas = XLSX.utils.sheet_to_json<Indice>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const m = new Map<string, Indice>();
  // O índice repete a mesma norma como "referência" em outra pasta (ex.: Lei 8.245 também aparece na pasta 05): vale a linha da pasta onde o arquivo realmente está.
  for (const l of linhas) {
    if (!l.arquivo) continue;
    const chave = l.arquivo.replace(/\\/g, "/");
    const pastaDoArquivo = chave.split("/")[0];
    const atual = m.get(chave);
    if (atual && atual.pasta === pastaDoArquivo && l.pasta !== pastaDoArquivo) continue;
    m.set(chave, l);
  }
  return m;
}

type Trecho = { rotulo: string; artigo: string; texto: string };
function dividir(corpo: string): Trecho[] {
  const linhas = corpo.split(/\r?\n/);
  const trechos: Trecho[] = [];
  let atual: Trecho | null = null;
  const empurra = () => {
    if (atual && atual.texto.trim()) trechos.push({ ...atual, texto: atual.texto.trim() });
  };
  const reArt = /^\s*(Art\.?|Artigo)\s*(\d+(?:\.\d+)*)\s*(?:[ºo°])?\s*(?:-\s*([A-Z]{1,2}))?\b/i;
  const reSum = /^\s*(S[úu]mula)\s+(?:n[ºo°.]*\s*)?(\d+)\b/i;
  for (const l of linhas) {
    const a = l.match(reArt);
    const s = l.match(reSum);
    if (s) {
      empurra();
      atual = { rotulo: `Súmula ${s[2]}`, artigo: `S${s[2]}`, texto: l + "\n" };
    } else if (a) {
      empurra();
      const num = a[2].replace(/\./g, "") + (a[3] ? `-${a[3].toUpperCase()}` : "");
      atual = { rotulo: `Art. ${num}`, artigo: num, texto: l + "\n" };
    } else if (atual) {
      atual.texto += l + "\n";
    } else {
      atual = { rotulo: "Cabeçalho/preâmbulo", artigo: "0", texto: l + "\n" };
    }
  }
  empurra();
  // blocos muito longos (títulos de capítulos sem artigo, súmulas gigantes) são quebrados em partes de ~3.500 caracteres
  const MAX = 3500;
  const saida: Trecho[] = [];
  for (const t of trechos) {
    if (t.texto.length <= MAX) {
      saida.push(t);
      continue;
    }
    const paragrafos = t.texto.split(/\n(?=§|Parágrafo|[IVXL]+\s*-|[a-z]\)|\d+\s*\.)/);
    let buf = "";
    let parte = 1;
    for (const p of paragrafos) {
      if ((buf + "\n" + p).length > MAX && buf) {
        saida.push({ rotulo: parte === 1 ? t.rotulo : `${t.rotulo} (parte ${parte})`, artigo: t.artigo, texto: buf.trim() });
        buf = p;
        parte++;
      } else buf += (buf ? "\n" : "") + p;
    }
    if (buf.trim()) saida.push({ rotulo: parte === 1 ? t.rotulo : `${t.rotulo} (parte ${parte})`, artigo: t.artigo, texto: buf.trim() });
  }
  return saida;
}

function cabecalho(texto: string) {
  const [cab, ...resto] = texto.split(/\r?\n\s*\r?\n/);
  const campo = (rot: string) => (cab.match(new RegExp(`^${rot}:\\s*(.*)$`, "mi")) ?? [])[1]?.trim() ?? "";
  return { cab, corpo: resto.join("\n\n"), tipo: campo("TIPO"), numero: campo("NUMERO"), data: campo("DATA"), ementa: campo("EMENTA"), url: campo("URL OFICIAL"), coleta: campo("DATA DA COLETA"), situacao: campo("SITUACAO[^:]*") };
}

(async () => {
  const indice = lerIndice();
  const arquivos = arquivosTxt(RAIZ);
  let normas = 0;
  let trechosTotal = 0;
  for (const arq of arquivos) {
    const rel = relative(RAIZ, arq).replace(/\\/g, "/");
    const texto = readFileSync(arq, "utf8").replace(/^﻿/, "");
    const h = cabecalho(texto);
    const ix = indice.get(rel) ?? {};
    const corpo = h.corpo || texto;
    const trechos = [{ rotulo: "Cabeçalho", artigo: "0", texto: h.cab.trim() || rel }, ...dividir(corpo)];
    const anoNum = Number(ix.ano) || Number((h.numero.match(/\/(\d{4})/) ?? [])[1]) || null;
    const norma = {
      pasta: rel.split("/")[0],
      tipo: ix.tipo || h.tipo || null,
      numero: ix.numero || h.numero || null,
      ano: anoNum,
      titulo: ix.titulo || `${h.tipo} ${h.numero}`.trim() || rel,
      ementa: ix.ementa || h.ementa || null,
      url: ix.url || h.url || null,
      situacao: (ix.situacao || h.situacao || "").slice(0, 1500) || null,
      temas: ix.temas || null,
      arquivo: rel,
      coletado_em: /^\d{4}-\d{2}-\d{2}$/.test(h.coleta) ? h.coleta : "2026-11-02",
      observacoes: ix.observacoes || null,
      tamanho_texto: texto.length,
    };
    normas++;
    trechosTotal += trechos.length;
    if (!GRAVAR) {
      console.log(`${rel}: ${trechos.length} trechos (${norma.titulo})`);
      continue;
    }
    const { data: up, error } = await sb.from("legislacao_normas").upsert(norma, { onConflict: "arquivo" }).select("id").single();
    if (error || !up) {
      console.log(`ERRO norma ${rel}: ${error?.message}`);
      continue;
    }
    await sb.from("legislacao_trechos").delete().eq("norma_id", up.id);
    const linhas = trechos.map((t, i) => ({ norma_id: up.id, ordem: i, rotulo: t.rotulo, artigo: t.artigo, texto: t.texto, texto_busca: semAcento(`${norma.titulo} ${t.rotulo} ${t.texto}`) }));
    for (let i = 0; i < linhas.length; i += 200) {
      const { error: e2 } = await sb.from("legislacao_trechos").insert(linhas.slice(i, i + 200));
      if (e2) {
        console.log(`ERRO trechos ${rel}: ${e2.message}`);
        break;
      }
    }
  }
  console.log(`${GRAVAR ? "Gravado" : "Ensaio"}: ${normas} normas, ${trechosTotal} trechos.`);
})();
