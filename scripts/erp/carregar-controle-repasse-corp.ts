// Carrega a planilha "Controle_repasse" exportada do Corp (repasse por parcela, com Dt. Previsão e Dt. Repasse) para erp_repasse_cargas + erp_repasse_corp_controle.
// Fonte 'corp_export', nível 8 do guia (comparação, nunca âncora). Guarda TODOS os campos estruturados; NÃO grava "Observações Doc." (texto livre, pode ter dado sensível) — só se havia.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/carregar-controle-repasse-corp.ts "<caminho.xlsx>" [--gravar]
// Sem --gravar é ensaio. Cada arquivo é uma carga (hash único) que pode ser desfeita por erp_repasse_desfazer_carga.
process.loadEnvFile(".env.local");
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import * as XLSX from "xlsx";
import { createServiceClient } from "@/lib/supabase/service";

const arquivo = process.argv[2];
const GRAVAR = process.argv.includes("--gravar");
const sb = createServiceClient();

const dec = (s: string | null | undefined) => (s === null || s === undefined || s === "" ? null : Number(s));
// datas do arquivo vêm como m/d/aa (11/15/25); se o 1º número passar de 12, é d/m/aa
function data(s: string | null | undefined): { iso: string | null; texto: string | null } {
  if (!s) return { iso: null, texto: null };
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return { iso: null, texto: s };
  let [a, b] = [Number(m[1]), Number(m[2])];
  let ano = Number(m[3]);
  if (ano < 100) ano += 2000;
  let mes = a, dia = b;
  if (a > 12) { mes = b; dia = a; }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return { iso: null, texto: s };
  const iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  if (ano < 2023 || ano > 2027) return { iso: null, texto: s }; // data fora do período do controle: guarda só o texto
  return { iso, texto: null };
}

(async () => {
  const buf = readFileSync(arquivo);
  const hash = createHash("sha256").update(buf).digest("hex");
  const { data: ja } = await sb.from("erp_repasse_cargas").select("id").eq("arquivo_hash", hash).maybeSingle();
  if (ja) { console.log("arquivo já carregado (carga", ja.id, ")"); return; }
  const wb = XLSX.read(buf);
  const linhasBrutas = XLSX.utils.sheet_to_json<Record<string, string | null>>(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: false });
  const linhas = linhasBrutas.map((r, i) => {
    const parc = (r["Parc."] ?? "").match(/(\d+)\s+de\s+(\d+)/);
    const prev = data(r["Dt. Previsão"]);
    const rep = data(r["Dt. Repasse"]);
    return {
      linha: i + 2, agente: r["Agente"], produtor_codigo: dec(r["Cód. Prod."]), produtor_nome: r["Produtor"], indireto: r["Ind."] === "•", pct_part: dec(r["% Partic."]),
      parcela_n: parc ? Number(parc[1]) : null, parcela_total: parc ? Number(parc[2]) : null, tipo: r["Tipo"],
      nosso_numero_corp: dec(r["Nosso Nº"]), seg_abrev: r["Seg."], ramo: r["Ramo"], segurado: r["Segurado"], apolice: r["Apólice"], endosso: r["Endosso"],
      vl_base: dec(r["Vl. Base"]), vl_comissao_doc: dec(r["Vlr. Com. Doc."]), pct_comissao_doc: dec(r["% Com. Doc."]), vl_comissao_corretora: dec(r["Vlr. Com. Cor."]),
      pct_rep: dec(r["% Rep."]), dt_previsao: prev.iso, dt_repasse: rep.iso, dt_repasse_texto: rep.texto ?? prev.texto, vl_repasse: dec(r["Vl. Repasse"]), rest_repasse: dec(r["Rest. Repasse"]),
      apto: r["Apto"] === "•", tem_observacao: !!r["Observações Doc."],
    };
  });
  const pagos = linhas.filter((l) => l.dt_repasse).length;
  const soma = (f: (l: (typeof linhas)[number]) => boolean) => Math.round(linhas.filter(f).reduce((s, l) => s + (l.vl_repasse ?? 0), 0) * 100) / 100;
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${linhas.length} linhas | com data de repasse pago ${pagos} (R$ ${soma((l) => !!l.dt_repasse)}) | sem data (R$ ${soma((l) => !l.dt_repasse)}) | datas estranhas ${linhas.filter((l) => l.dt_repasse_texto).length}`);
  if (!GRAVAR) return;
  const { data: carga, error } = await sb.from("erp_repasse_cargas").insert({ fonte: "corp_export", nivel_guia: 8, arquivo: basename(arquivo), arquivo_hash: hash, lido_por: "sessão Repasses ERP (arquivo enviado pelo Matheus)", linhas: linhas.length, observacao: "Controle de repasse por parcela exportado do Corp (com Dt. Previsão e Dt. Repasse). Comparação, nunca âncora. Observações do documento não gravadas." }).select("id").single();
  if (error || !carga) { console.log("erro na carga:", error?.message); return; }
  for (let i = 0; i < linhas.length; i += 1000) {
    const { error: e } = await sb.from("erp_repasse_corp_controle").insert(linhas.slice(i, i + 1000).map((l) => ({ carga_id: carga.id, ...l })));
    if (e) { console.log("erro no lote", i, e.message); return; }
  }
  const { data: v } = await sb.rpc("erp_repasse_vincular_controle_corp", { p_carga: carga.id });
  console.log("carga", carga.id, JSON.stringify(v));
})();
