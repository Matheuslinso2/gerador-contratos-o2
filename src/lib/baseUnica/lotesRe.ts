import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { listarItensSpa } from "@/lib/bitrix/client";

// Base Única — itens dos lotes de Ramos Elementares: planilhas do campo "Planilha de itens" (ufCrm12PlanilhaItens) dos cards da SPA 1046.
// Roda de hora em hora (/api/cron/base-unica-lotes-re): só baixa o que ainda não foi guardado (card + arquivo), guarda o original no bucket
// privado lotes-re (inclusive PDF/imagem) e grava cada linha das planilhas em producao_itens com TODAS as colunas (extras) + campos estruturados.
// Mesma lógica do script scripts/base-unica/importar-lotes-re.mjs (carga inicial). Dados pessoais: uso interno O2.

type ArquivoBitrix = { id: number | string; urlMachine?: string; url?: string };

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const txt = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/R\$|\s/g, "");
  if (!/\d/.test(s)) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
};

const CONHECIDA = /CEP|ENDERE|LOGRAD|BAIRRO|LOCAT|LOCADOR|ALUGUEL|OCUPA|CIDADE|CPF/;
function acharCabecalho(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cels = (rows[i] || []).map(norm).filter(Boolean);
    if (cels.length >= 3 && cels.some((c) => CONHECIDA.test(c))) return i;
  }
  return -1;
}

function tipoDoArquivo(buf: Buffer): "pdf" | "xlsx" | "xls" | "jpg" | "png" | "csv" | "bin" {
  if (buf.subarray(0, 4).toString() === "%PDF") return "pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "xlsx";
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return "xls";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "png";
  const ini = buf.subarray(0, 500);
  if ([...ini].every((x) => x === 9 || x === 10 || x === 13 || (x >= 32 && x < 255)) && buf.subarray(0, 2000).toString("latin1").includes(";")) return "csv";
  return "bin";
}

function mapearLinhas(rows: unknown[][], ic: number) {
  const cab = (rows[ic] || []).map(norm);
  const acha = (...res: RegExp[]) => cab.findIndex((c) => res.some((r) => r.test(c)));
  const col = {
    cod: acha(/^COD/),
    locadorNome: acha(/NOME.*LOCADOR|^LOCADOR$|PROPRIETARIO/),
    locadorDoc: acha(/(CPF|CNPJ).*LOCADOR|LOCADOR.*(CPF|CNPJ)/),
    locatNome: acha(/NOME.*LOCAT|^LOCATARIO/),
    locatDoc: acha(/(CPF|CNPJ).*LOCAT|LOCAT.*(CPF|CNPJ)/),
    cep: acha(/^CEP/),
    logr: acha(/^LOGRAD/),
    end: acha(/^ENDERE/),
    compl: acha(/^COMPLEMENTO/),
    bairro: acha(/^BAIRRO/),
    cidade: acha(/^CIDADE/),
    ocup: acha(/^OCUPA/),
    ativ: acha(/^ATIVIDADE/),
    aluguel: acha(/ALUGUEL/),
    m2: acha(/^M[²2]|AREA/),
  };
  const itens: Record<string, unknown>[] = [];
  rows.slice(ic + 1).forEach((r, i) => {
    if (!r || !r.some((c) => txt(c))) return;
    const g = (ix: number) => (ix >= 0 ? r[ix] : null);
    const todos: Record<string, string> = {};
    (rows[ic] || []).forEach((h, j) => {
      const k = txt(h);
      const v = txt(r[j]);
      if (k && v) todos[todos[k] === undefined ? k : `${k} (${j})`] = v;
    });
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

export async function sincronizarLotesRe(sb: SupabaseClient, limiteArquivos = 40) {
  const itens = await listarItensSpa(1046);
  const resumo = { cardsComArquivo: 0, arquivosNovos: 0, planilhas: 0, outros: 0, linhas: 0, falhas: 0 };
  let restantes = limiteArquivos;
  for (const card of itens) {
    const campo = (card as Record<string, unknown>).ufCrm12PlanilhaItens;
    const arquivos = (Array.isArray(campo) ? campo : campo ? [campo] : []) as ArquivoBitrix[];
    if (!arquivos.length) continue;
    resumo.cardsComArquivo++;
    if (restantes <= 0) continue;
    const { data: guardados } = await sb.storage.from("lotes-re").list(String(card.id), { limit: 200 });
    const jaTem = new Set((guardados ?? []).map((f) => f.name.split(".")[0]));
    for (const a of arquivos) {
      if (restantes <= 0) break;
      if (jaTem.has(String(a.id)) || !a.urlMachine) continue;
      restantes--;
      try {
        const res = await fetch(a.urlMachine);
        if (!res.ok) throw new Error(String(res.status));
        const buf = Buffer.from(await res.arrayBuffer());
        const tipo = tipoDoArquivo(buf);
        const tipos: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", csv: "text/csv" };
        const { error: eUp } = await sb.storage.from("lotes-re").upload(`${card.id}/${a.id}.${tipo}`, buf, { upsert: true, contentType: tipos[tipo] ?? "application/octet-stream" });
        if (eUp) throw new Error(eUp.message);
        resumo.arquivosNovos++;
        if (!["xlsx", "xls", "csv"].includes(tipo)) { resumo.outros++; continue; }
        const wb = XLSX.read(buf, { cellDates: true });
        resumo.planilhas++;
        for (const aba of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[aba], { header: 1, defval: "", raw: true });
          const ic = acharCabecalho(rows);
          if (ic < 0) continue;
          const linhas = mapearLinhas(rows, ic).map((l) => ({ ...l, bitrix_item_id: String(card.id), arquivo_bitrix_id: String(a.id), arquivo_nome: `${a.id}.${tipo}`, aba: aba.slice(0, 60) }));
          for (let i = 0; i < linhas.length; i += 300) {
            const { error } = await sb.from("producao_itens").upsert(linhas.slice(i, i + 300), { onConflict: "bitrix_item_id,arquivo_bitrix_id,aba,linha" });
            if (error) throw new Error(error.message);
          }
          resumo.linhas += linhas.length;
        }
      } catch {
        resumo.falhas++;
      }
    }
  }
  return resumo;
}
