// Base Única — itens dos lotes de Ramos Elementares (campo "Planilha de itens", ufCrm12PlanilhaItens, dos cards da SPA 1046 do Bitrix).
// Guarda TUDO: o arquivo original (bucket privado lotes-re, inclusive PDFs) e cada linha das planilhas em producao_itens, com todas as colunas
// (extras = {cabeçalho: valor}) além das colunas estruturadas (nomes, CPF/CNPJ, CEP, endereço, bairro, cidade, ocupação, aluguel, m²).
// Uso interno O2 (tem CPF/CNPJ e nomes). Idempotente: reexecutar atualiza as mesmas linhas.
// uso: node scripts/base-unica/importar-lotes-re.mjs [--gravar]
import fs from "node:fs";
import XLSX from "xlsx";
import { supabase } from "./_comum.mjs";

const gravar = process.argv.includes("--gravar");
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }));
const base = env.BITRIX_WEBHOOK_URL.replace(/\/?$/, "/");

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const txt = (v) => (v == null || v instanceof Date ? (v instanceof Date ? v.toISOString().slice(0, 10) : "") : String(v).replace(/\s+/g, " ").trim());
const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/R\$|\s/g, "");
  if (!/\d/.test(s)) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
};

// Cabeçalho = primeira linha (nas 15 primeiras) com 3+ células de texto e alguma coluna conhecida.
const CONHECIDA = /CEP|ENDERE|LOGRAD|BAIRRO|LOCAT|LOCADOR|ALUGUEL|OCUPA|CIDADE|CPF/;
function acharCab(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cels = (rows[i] || []).map(norm).filter(Boolean);
    if (cels.length >= 3 && cels.some((c) => CONHECIDA.test(c))) return i;
  }
  return -1;
}
const acha = (cab, ...res) => cab.findIndex((c) => res.some((r) => r.test(c)));

function mapear(rows, ic) {
  const cab = rows[ic].map(norm);
  const col = {
    cod: acha(cab, /^COD/),
    locadorNome: acha(cab, /NOME.*LOCADOR|^LOCADOR$|PROPRIETARIO/),
    locadorDoc: acha(cab, /(CPF|CNPJ).*LOCADOR|LOCADOR.*(CPF|CNPJ)/),
    locatNome: acha(cab, /NOME.*LOCAT|^LOCATARIO/),
    locatDoc: acha(cab, /(CPF|CNPJ).*LOCAT|LOCAT.*(CPF|CNPJ)/),
    cep: acha(cab, /^CEP/),
    logr: acha(cab, /^LOGRAD/),
    end: acha(cab, /^ENDERE/),
    compl: acha(cab, /^COMPLEMENTO/),
    bairro: acha(cab, /^BAIRRO/),
    cidade: acha(cab, /^CIDADE/),
    ocup: acha(cab, /^OCUPA/),
    ativ: acha(cab, /^ATIVIDADE/),
    aluguel: acha(cab, /ALUGUEL/),
    m2: acha(cab, /^M[²2]|AREA/),
  };
  const itens = [];
  rows.slice(ic + 1).forEach((r, i) => {
    if (!r || !r.some((c) => txt(c))) return;
    const g = (ix) => (ix >= 0 ? r[ix] : null);
    const todos = {};
    (rows[ic] || []).forEach((h, j) => { const k = txt(h); const v = txt(r[j]); if (k && v) todos[todos[k] === undefined ? k : `${k} (${j})`] = v; });
    const endereco = col.end >= 0 ? txt(g(col.end)) : txt(g(col.logr));
    itens.push({
      linha: ic + 2 + i,
      codigo_imobiliaria: txt(g(col.cod)) || null,
      locador_nome: txt(g(col.locadorNome)) || null,
      locador_documento: txt(g(col.locadorDoc)) || null,
      locatario_nome: txt(g(col.locatNome)) || null,
      locatario_documento: txt(g(col.locatDoc)) || null,
      cep: txt(g(col.cep)).replace(/\D/g, "") || null,
      endereco: [col.logr >= 0 && col.end >= 0 ? txt(g(col.logr)) : "", endereco].filter(Boolean).join(" ") || null,
      complemento: txt(g(col.compl)) || null,
      bairro: txt(g(col.bairro)).toUpperCase() || null,
      cidade: txt(g(col.cidade)).toUpperCase() || null,
      ocupacao: txt(g(col.ocup)) || null,
      atividade: txt(g(col.ativ)) || null,
      aluguel: num(g(col.aluguel)),
      m2: num(g(col.m2)),
      extras: todos,
    });
  });
  return itens;
}

// ---- Bitrix: todos os cards com arquivo ----
const cards = [];
for (let start = 0; start !== undefined; ) {
  const r = await (await fetch(base + "crm.item.list.json", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entityTypeId: 1046, select: ["id", "title", "ufCrm12PlanilhaItens"], order: { id: "DESC" }, start }) })).json();
  for (const c of r.result?.items ?? []) { const f = c.ufCrm12PlanilhaItens; const l = Array.isArray(f) ? f : f ? [f] : []; if (l.length) cards.push({ id: c.id, titulo: c.title, arquivos: l }); }
  start = r.next;
}
console.log(`${gravar ? "GRAVANDO" : "SIMULAÇÃO"} · cards com arquivo: ${cards.length} · arquivos: ${cards.reduce((s, c) => s + c.arquivos.length, 0)}`);

let planilhas = 0, outros = 0, linhasTotal = 0, semCab = 0, falhas = 0;
for (const c of cards) {
  for (const a of c.arquivos) {
    let buf;
    try {
      const res = await fetch(a.urlMachine);
      if (!res.ok) throw new Error(String(res.status));
      buf = Buffer.from(await res.arrayBuffer());
    } catch (e) { falhas++; console.log(`  card ${c.id} arquivo ${a.id}: falha ao baixar (${e.message})`); continue; }
    const h = buf.slice(0, 8);
    const tipo = h.slice(0, 4).toString() === "%PDF" ? "pdf" : h[0] === 0x50 && h[1] === 0x4b ? "xlsx" : h[0] === 0xd0 && h[1] === 0xcf ? "xls" : h[0] === 0xff && h[1] === 0xd8 ? "jpg" : h[0] === 0x89 && h[1] === 0x50 ? "png" : [...buf.slice(0, 500)].every((x) => x === 9 || x === 10 || x === 13 || (x >= 32 && x < 255)) && buf.slice(0, 2000).toString("latin1").includes(";") ? "csv" : "bin";
    const nome = `${a.id}.${tipo}`;
    if (gravar) {
      const tipos = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", csv: "text/csv" };
      const { error } = await supabase.storage.from("lotes-re").upload(`${c.id}/${nome}`, buf, { upsert: true, contentType: tipos[tipo] ?? "application/octet-stream" });
      if (error) console.log(`  card ${c.id}: erro ao guardar o original: ${error.message}`);
      else if (tipo !== "xlsx" && tipo !== "xls") await supabase.storage.from("lotes-re").remove([`${c.id}/${a.id}.xlsx`, `${c.id}/${a.id}.pdf`].filter((x) => !x.endsWith(nome)));
    }
    if (!["xlsx", "xls", "csv"].includes(tipo)) { outros++; continue; }
    let wb;
    try { wb = XLSX.read(buf, { cellDates: true }); } catch { outros++; console.log(`  card ${c.id} arquivo ${a.id}: formato não lido (guardado só o original)`); continue; }
    planilhas++;
    for (const nomeAba of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[nomeAba], { header: 1, defval: "", raw: true });
      const ic = acharCab(rows);
      if (ic < 0) { if (rows.length > 1) semCab++; continue; }
      const itens = mapear(rows, ic).map((i) => ({ ...i, bitrix_item_id: String(c.id), arquivo_bitrix_id: String(a.id), arquivo_nome: nome, aba: nomeAba.slice(0, 60) }));
      linhasTotal += itens.length;
      if (gravar && itens.length) {
        for (let i = 0; i < itens.length; i += 300) {
          const { error } = await supabase.from("producao_itens").upsert(itens.slice(i, i + 300), { onConflict: "bitrix_item_id,arquivo_bitrix_id,aba,linha" });
          if (error) throw new Error(error.message);
        }
      }
    }
  }
}
console.log({ planilhas, pdfsOuOutros: outros, linhasDeItens: linhasTotal, abasSemCabecalho: semCab, falhas });
