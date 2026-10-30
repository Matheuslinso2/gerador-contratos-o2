// Ensaio de cadastro (SÓ LEITURA): junta os PDFs lidos da Tokio (%TEMP%\tokio\todas-tokio-141.json) com as linhas do extrato ainda sem identificação
// (erp_baixa_linha_estado + erp_extrato_linhas) e gera %TEMP%\tokio\ensaio-cadastro-tokio.csv com comissão × prêmio por apólice.
process.loadEnvFile(".env.local");
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
const sb = createServiceClient(); const T = path.join(os.tmpdir(), "tokio");
const num = (s: unknown) => Number(String(s ?? "").replace(/\./g, "").replace(",", "."));
(async () => {
  const pdfs = JSON.parse(fs.readFileSync(path.join(T, "todas-tokio-141.json"), "utf8")) as { f: string; ap: string; prop: string; ini: string; fim: string; emi: string; imob: string; doc: string; prem: string; ramo: string }[];
  const emp: Record<string, string> = { pdfs70145: "O2 Capitalização (70145)", pdfs55002: "O2 Corretora (55002)", pdfs195354: "O2 Corretora (195354)" };
  const est: any[] = []; for (let de = 0; ; de += 1000) { const { data } = await sb.from("erp_baixa_linha_estado").select("linha_id,apolice,corretora,pago_em,valor_comissao").eq("estado", "pendente_identificacao").eq("seguradora_abrev", "TOKI").gt("valor_comissao", 0).range(de, de + 999); est.push(...(data ?? [])); if ((data ?? []).length < 1000) break; }
  const ids = est.map((e) => e.linha_id); const lin = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 100) { const { data } = await sb.from("erp_extrato_linhas").select("id,apolice,proposta,cliente,produto,premio,pct_comissao,valor_comissao,parcela").in("id", ids.slice(i, i + 100)); for (const l of data ?? []) lin.set(l.id, l); }
  const LISTA = new Set(fs.readFileSync(path.join(T, "152.txt"), "utf8").trim().split(",").map((x) => x.replace(/^0+/, "")));
  const k8 = (s: string) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const por = new Map<string, { linhas: number; comissao: number; premioExtrato: number; produto: string; cliente: string; proposta: string; pagos: string[]; pct: Set<string> }>();
  for (const e of est) { const l = lin.get(e.linha_id); const k = k8(e.apolice); const a = por.get(k) ?? por.set(k, { linhas: 0, comissao: 0, premioExtrato: 0, produto: l?.produto ?? "", cliente: l?.cliente ?? "", proposta: l?.proposta ?? "", pagos: [], pct: new Set() }).get(k)!; a.linhas++; a.comissao += Number(e.valor_comissao); a.premioExtrato += Number(l?.premio ?? 0); a.pagos.push(String(e.pago_em).slice(0, 10)); if (l?.pct_comissao != null) a.pct.add(String(l.pct_comissao)); }
  const saida = ["situacao;empresa;apolice;proposta_pdf;proposta_extrato;cliente_extrato;produto_extrato;segurado_cpf_pdf;imobiliaria_pdf;vig_ini;vig_fim;emissao;premio_pdf;linhas_extrato;comissao_extrato;premio_extrato;pct_comissao_extrato;comissao_sobre_premio_linha_extrato_pct;fora_55_70"];
  let fora = 0, dentro = 0, achados = new Set<string>(); const resumo: Record<string, number> = {};
  for (const p of pdfs) { const k = k8(p.ap); achados.add(k); const a = por.get(k); const prem = num(p.prem); const pct = a && a.premioExtrato ? (a.comissao / a.premioExtrato) * 100 : NaN; const f = !isNaN(pct) && (pct < 54.5 || pct > 70.5) ? "SIM" : "não"; if (!isNaN(pct)) (f === "SIM" ? fora++ : dentro++);
    saida.push(["achada com PDF oficial", emp[p.f], p.ap, p.prop, a?.proposta ?? "", a?.cliente ?? "", a?.produto ?? "", p.doc, p.imob, p.ini, p.fim, p.emi, p.prem, a?.linhas ?? "", a ? a.comissao.toFixed(2) : "", a ? a.premioExtrato.toFixed(2) : "", [...(a?.pct ?? [])].join("/"), isNaN(pct) ? "" : pct.toFixed(1), f].join(";")); }
  for (const [k, a] of por) if (LISTA.has(k) && !achados.has(k)) { saida.push(["NÃO achada no portal", "", k, "", a.proposta, a.cliente, a.produto, "", "", "", "", "", "", a.linhas, a.comissao.toFixed(2), a.premioExtrato.toFixed(2), [...a.pct].join("/"), "", ""].join(";")); resumo[a.cliente || "?"] = (resumo[a.cliente || "?"] ?? 0) + 1; }
  fs.writeFileSync(path.join(T, "ensaio-cadastro-tokio.csv"), "﻿" + saida.join("\n"));
  console.log("linhas do extrato pendentes", est.length, "apólices distintas no extrato", por.size, "| com PDF", pdfs.length, "| dentro 55-70%:", dentro, "fora:", fora);
  console.log("não achadas:", JSON.stringify(resumo));
  const foraLista = saida.filter((l) => l.endsWith(";SIM")).slice(0, 12).map((l) => l.split(";").filter((_, i) => [2, 5, 12, 14, 17].includes(i)).join(" | ")); console.log("fora do padrão (amostra):\n" + foraLista.join("\n"));
})();
