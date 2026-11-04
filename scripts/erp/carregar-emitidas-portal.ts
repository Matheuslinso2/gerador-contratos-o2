process.loadEnvFile(".env.local");
// Carrega relatórios OFICIAIS de emissão/cobrança baixados dos portais das seguradoras (nível 1) em erp_seguradora_emitidas.
// Formatos reconhecidos pelo cabeçalho:
//   Pottencial "Exportação de apólices" (AcompanhamentoApolices*.xlsx): proposta, apólice, CPF, vigência, prêmio, comissão, parcelas pagas/pendentes
//   Porto "Apólices_<SUSEP>.xlsx": emissão, situação, CPF/CNPJ, ramo/sucursal/apólice, nº da proposta
//   Porto cobrança "Alug_Fianc_*.XLSX" / "RE_*.XLSX": proposta, apólice, parcela, vencimento, valor
// Cada linha guarda TODOS os campos em `linha` (jsonb). Mesmo arquivo (sha256) não é lido duas vezes. Só grava; o vínculo é feito por erp_emitidas_vincular().
// Uso: tsx --require ./scripts/erp/_sem-server-only.cjs scripts/erp/carregar-emitidas-portal.ts <arquivo> [...]
import * as XLSX from "xlsx";
import fs from "fs";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const s = (v: unknown) => (v == null ? "" : String(v).trim());
const dig = (v: unknown) => s(v).replace(/\D/g, "");
const LOTE = "portal_" + new Date().toISOString().slice(0, 10);

function dataBr(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = s(v); let m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const num = (v: unknown) => { if (typeof v === "number") return v; const t = s(v).replace(/[R$\s.]/g, "").replace(",", "."); return t && !isNaN(+t) ? +t : null; };

type Linha = Record<string, unknown>;
function linhas(ws: XLSX.WorkSheet, cab: string): Linha[] {
  // raw: números chegam como número (o texto formatado da planilha vem no padrão americano e quebrava o prêmio)
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", raw: true });
  const i = rows.findIndex((r) => (r as unknown[]).map(s).includes(cab)); if (i < 0) return [];
  const h = (rows[i] as unknown[]).map(s);
  return rows.slice(i + 1).filter((r) => (r as unknown[]).some((c) => s(c))).map((r) => Object.fromEntries(h.map((k, j) => [k || `col${j}`, (r as unknown[])[j]]).filter(([k, v]) => s(v) && !String(k).startsWith("col"))));
}

async function main() {
  for (const f of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
    const buf = fs.readFileSync(f); const sha = crypto.createHash("sha256").update(buf).digest("hex"); const nome = f.split(/[\\/]/).pop()!;
    const { count } = await sb.from("erp_seguradora_emitidas").select("id", { count: "exact", head: true }).eq("arquivo_sha256", sha);
    if (count && !process.argv.includes("--forcar")) { console.log(nome, "— já carregado, pulado"); continue; }
    const wb = XLSX.read(buf, { cellDates: true }); const ws = wb.Sheets[wb.SheetNames[0]];
    const out: Record<string, unknown>[] = [];
    let ls = linhas(ws, "Nº Documento");
    if (ls.length) { // Pottencial
      for (const l of ls) out.push({ seguradora: "POTT", formato: "pottencial_acompanhamento", numero_apolice: s(l["Nº Documento"]), endosso: "0", parcela: "0",
        numero_proposta: s(l["N º Proposta"]), produto: s(l["Produto"]), nome_segurado: s(l["Segurado"]), cpf_cnpj: dig(l["Documento Segurado"]) || null,
        premio: num(l["Total Prêmio"]), comissao: num(l["Comissão"]), vigencia_inicio: dataBr(l["Início Vigência"]),
        parcelas_pagas: num(l["Parcelas Pagas"]), parcelas_pendentes: num(l["Parcelas Pendentes"]), linha: l });
    } else if ((ls = linhas(ws, "dataEmissao")).length) { // Porto apólices
      for (const l of ls) {
        const ap = s(l["apolice"]) ? [s(l["ramo"]), s(l["sucursal"]), s(l["apolice"])].filter(Boolean).join(" ") : s(l["contrato"]);
        out.push({ seguradora: "PORT", formato: "porto_apolices", numero_apolice: ap, endosso: s(l["endosso"]) || "0", parcela: "0", susep: undefined,
          numero_proposta: [s(l["origemProposta"]), s(l["numeroProposta"])].filter(Boolean).join(" - ") || null, produto: s(l["nomeProduto"]), ramo: s(l["ramo"]) || null,
          nome_segurado: s(l["nomeRazaoSocial"]), cpf_cnpj: dig(l["cpfCnpj"]) || null, dt_emissao: dataBr(l["dataEmissao"]), vigencia_inicio: dataBr(l["dataInicioVigencia"]),
          situacao_portal: s(l["status"]), linha: l });
      }
    } else if ((ls = linhas(ws, "Preposto")).length) { // Porto cobrança
      for (const l of ls) { if (!dig(l["Apolice"])) continue;
        out.push({ seguradora: "PORT", formato: "porto_cobranca", numero_apolice: s(l["Apolice"]), endosso: s(l["Endosso"]) || "0", parcela: s(l["Parc."]) || "0",
          numero_proposta: s(l["Proposta"]) || null, produto: s(l["Produto"]), nome_segurado: s(l["Segurado"]), premio: num(l["Valor"]),
          vencimento: dataBr(l["Vencimento"]), vigencia_inicio: dataBr(l["Vigência Inicial"]), linha: l });
      }
    } else { console.log(nome, "— formato não reconhecido"); continue; }
    for (const o of out) { delete o.susep; Object.assign(o, { arquivo: nome, arquivo_sha256: sha, fonte: "portal_seguradora", nivel: 1, lote: LOTE, lido_em: new Date().toISOString() }); }
    // a mesma apólice aparece em vários arquivos (exportações sobrepostas): fica a linha mais recente
    const unicas = [...new Map(out.map((o) => [`${o.seguradora}|${o.numero_apolice}|${o.endosso}|${o.parcela}`, o])).values()];
    const { error } = await sb.from("erp_seguradora_emitidas").upsert(unicas, { onConflict: "seguradora,numero_apolice,endosso,parcela" });
    console.log(nome, error ? "ERRO " + error.message : `${unicas.length} linhas`);
  }
}
main().catch((e) => { console.error("ERRO", e); process.exit(1); });
