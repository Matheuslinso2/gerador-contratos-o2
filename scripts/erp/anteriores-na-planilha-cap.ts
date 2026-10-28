// Ensaio (SÓ LEITURA): procura na planilha de controle "TÍTULOS NOVOS <ano>" (aba NOVOS, cópia baixada em %TEMP%\planilha-cap) os documentos
// ANTERIORES de Capitalização cuja vigência ficou sem continuidade com o renovado (lista anteriores-divergentes-vigencia.csv).
// Liga por nº da proposta/garantia (= numero_apolice do ERP) ou por CPF/CNPJ do titular + início do ERP; traz VIGÊNCIA (meses), STATUS e DATA PAGAMENTO.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/anteriores-na-planilha-cap.ts [--xlsm caminho ...]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { createServiceClient } from "@/lib/supabase/service";
import { carregarCapVigentes, somaMeses } from "./certificadoCap";

const sb = createServiceClient();
const arqs: string[] = []; process.argv.forEach((a, i) => { if (a === "--xlsm") arqs.push(process.argv[i + 1]); });
if (!arqs.length) arqs.push(path.join(os.tmpdir(), "planilha-cap", "titulos-novos-2026.xlsm"));
const dig = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const iso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

(async () => {
  const linhas = fs.readFileSync(path.join(os.tmpdir(), "anteriores-divergentes-vigencia.csv"), "utf8").split("\n").slice(1).filter(Boolean).map((l) => l.replace(/"/g, "").split(";"));
  const codigos = [...new Set(linhas.map((l) => Number(l[2])))];
  const ind = await carregarCapVigentes(sb, true, codigos);
  const inicioRenovado = new Map(linhas.map((l) => [Number(l[2]), l[1]]));
  type Reg = { arq: string; linha: number; proposta: string; cpf: string; meses: number | null; status: string; pagto: string | null; vencimento: string | null };
  const regs: Reg[] = [];
  for (const f of arqs) {
    const wb = XLSX.read(fs.readFileSync(f), { type: "buffer", cellDates: true });
    const r = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["NOVOS"], { header: 1, defval: null });
    const h = (r[0] as string[]).map((x) => String(x ?? "").replace(/\s+/g, " ").trim().toUpperCase());
    const c = (n: string) => h.findIndex((x) => x.startsWith(n));
    const [iP, iC, iV, iS, iPg, iVc] = [c("OBS / GARANTIA"), c("CPF"), c("VIGÊNCIA"), c("STATUS"), c("DATA PAGAMENTO"), c("VENCIMENTO")];
    r.slice(1).forEach((x, i) => regs.push({ arq: path.basename(f), linha: i + 2, proposta: dig(x[iP]), cpf: dig(x[iC]), meses: Number(x[iV]) || null, status: String(x[iS] ?? ""), pagto: iso(x[iPg]), vencimento: iso(x[iVc]) }));
  }
  console.log(`planilhas: ${arqs.map((a) => path.basename(a)).join(", ")} | linhas: ${regs.length} | documentos anteriores procurados: ${ind.vigentes.length}`);
  const r = { porProposta: 0, porCpfInicio: 0, semAchado: 0, fimConfereComRenovado: 0, fimDiverge: 0 };
  const saida = ["codigo_o2_anterior;situacao;inicio_erp;fim_erp;achou_por;linha;status_planilha;meses;fim_pelo_modo;inicio_do_renovado;dif_dias;pagamento_titulo"];
  for (const d of ind.vigentes) {
    const num = dig(d.numero_apolice).replace(/^0+/, "");
    const cpfs = ind.docsCpf.get(d.id)?.cpfs ?? [];
    let achou = regs.filter((x) => num.length >= 4 && x.proposta.replace(/^0+/, "") === num);
    let por = "proposta";
    if (!achou.length) { achou = regs.filter((x) => x.cpf && cpfs.includes(x.cpf) && x.pagto && d.vigencia_inicio && Math.abs(Date.parse(x.pagto) - Date.parse(d.vigencia_inicio)) <= 45 * 864e5); por = "cpf+data"; }
    if (!achou.length) { r.semAchado++; continue; }
    por === "proposta" ? r.porProposta++ : r.porCpfInicio++;
    const x = achou[0];
    const fimModo = d.vigencia_inicio && x.meses ? somaMeses(d.vigencia_inicio, x.meses) : null;
    const ini = inicioRenovado.get(d.nosso_numero) ?? null;
    const dif = fimModo && ini ? Math.round((Date.parse(ini) - Date.parse(fimModo)) / 864e5) : null;
    if (dif !== null) (Math.abs(dif) <= 1 ? r.fimConfereComRenovado++ : r.fimDiverge++);
    saida.push([d.nosso_numero, "", d.vigencia_inicio, d.vigencia_fim, por, `${x.arq}:${x.linha}`, x.status, x.meses, fimModo, ini, dif, x.pagto].join(";"));
  }
  const f = path.join(os.tmpdir(), "anteriores-na-planilha-cap.csv"); fs.writeFileSync(f, "﻿" + saida.join("\n"));
  console.log(JSON.stringify(r), "| lista:", f);
})();
