// Cadastro em lote (AUTORIZADO pelo Matheus em 30/10/2026) das apólices da Tokio achadas no portal, a partir do PDF OFICIAL (%TEMP%\tokio\pdfs*).
// Só grava o que está no PDF: nº da apólice, proposta/negócio, vigência, emissão, prêmio (líquido, IOF, total), forma de cobrança, parcelas (se a soma bater
// com o prêmio total), segurado (CPF/CNPJ), local do risco e imobiliária (CNPJ -> tabela imobiliarias; nunca cria imobiliária). NÃO cria recebimento, baixa nem repasse.
// 1 documento por apólice (origem 'api', origem_ref 'lote:<LOTE>:<apólice>'), anexo = PDF oficial (origem 'api', tipo apólice, confirmada).
// Anti-duplicidade: se a apólice (exata ou 8 últimos dígitos) ou a proposta já existir em erp_documentos, NÃO cria: só anexa o PDF (--gravar) e lista.
// Ensaio por padrão (nada é gravado). uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/tokio-gravar-lote.ts [--gravar] [--limite 20] [--offset 0]
process.loadEnvFile(".env.local");
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf, guardarAnexo } from "@/lib/erp/anexosEmail";
import { garantirCliente, tipoDoDocumento } from "@/lib/erp/clientes";

const LOTE = "TOKIO-PORTAL-20261030";
const T = path.join(os.tmpdir(), "tokio");
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar"); const LIMITE = Number(arg("limite") ?? 100000); const OFFSET = Number(arg("offset") ?? 0);
const HOJE = "2026-10-30";
const sb = createServiceClient();
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const num = (s: string | undefined) => (s == null ? 0 : Number(s.replace(/\./g, "").replace(",", ".")));
const dmy = (s: string | undefined) => (s ? s.split("/").reverse().join("-") : null);
const em = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

type Parcela = { n: number; valor: number; venc: string };
type Lido = { ap: string; apOficial: string; negocio: string | null; proposta: string | null; tipoSeguro: string; vigIni: string | null; vigFim: string | null; emissao: string | null; liq: number; juros: number; iof: number; total: number; cobranca: string; modo: "fatura" | "debito" | "cartao" | "boleto" | "nao_informado"; parcelas: Parcela[]; parcelasOk: boolean; segNome: string | null; segDoc: string | null; imobNome: string | null; imobCnpj: string | null; imobCodigo: string | null; risco: { logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string } | null; produto: string; corretoraCod: string | null; pasta: string };

function ler(t: string, ap: string, pasta: string): Lido {
  const s = t.replace(/\s+/g, " ");
  const g = (re: RegExp) => re.exec(s);
  const apOficial = g(/Ap[óo]lice:\s*(\d+)/)?.[1] ?? ap;
  const vig = g(/Vig[êe]ncia:.*?dia (\d{2}\/\d{2}\/\d{4}) at[ée].*?dia (\d{2}\/\d{2}\/\d{4})/);
  const pr = g(/Pr[êe]mio L[íi]quido Total:\s*R\$\s*([\d.,]+)\s*Juros:\s*R\$\s*([\d.,]+)\s*I\.O\.F:\s*R\$\s*([\d.,]+)\s*Pr[êe]mio Total:\s*R\$\s*([\d.,]+)/);
  const cob = g(/Cobran[çc]a:\s*(Ficha Faturada|D[ée]bito[^\n]*?(?= Banco| Ag[êe]ncia| Parcela)|Cart[ãa]o de Cr[ée]dito|Boleto[^\n]*?(?= Parcela)|[A-Za-zÀ-ú/ ]{3,30}?(?= Parcela| Banco| CPF))/)?.[1]?.trim() ?? "";
  const modo = /Ficha Faturada/i.test(cob) ? "fatura" : /D[ée]bito/i.test(cob) ? "debito" : /Cart[ãa]o/i.test(cob) ? "cartao" : /Boleto/i.test(cob) ? "boleto" : "nao_informado";
  const iParc = s.search(/Parcela Valor \(R\$\) Vencimento/);
  const parcelas: Parcela[] = iParc < 0 ? [] : [...s.slice(iParc, iParc + 2500).matchAll(/\b(\d{2})ª\s+([\d.]+,\d{2})\s+(\d{2}\/\d{2}\/\d{4})/g)].map((m) => ({ n: Number(m[1]), valor: num(m[2]), venc: dmy(m[3])! }));
  const total = num(pr?.[4]); const soma = parcelas.reduce((a, p) => a + p.valor, 0);
  const imob = g(/Nome da Imobili[áa]ria:\s*(.+?)\s+CNPJ\/CPF:\s*([\d.\-/ ]+?)\s+C[óo]digo:\s*(\d+)/);
  const rk = g(/Local do Risco:\s*(.+?)\s+N[úu]mero Logradouro:\s*(\S+)\s+Complemento:\s*(.*?)\s+Bairro:\s*(.+?)\s+Cidade:\s*(.+?)\s+UF:\s*(\w{2})\s+CEP:\s*([\d-]+)/);
  const nome = g(/\d\/\d+\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9 .'&\-]+?)\s+Nome Social:/)?.[1] ?? g(/\d\/\d+\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9 .'&\-]+?)\s+(?:Tipo de Indeniza[çc][ãa]o\s+)?Tokio Marine [A-Za-zÀ-ú ]+ - Ap[óo]lice de Seguro/)?.[1] ?? null;
  const corr = g(/Nome\/Raz[ãa]o Social:\s*O2 [A-Z ]+?\s+C[óo]digo:\s*(\d{6})/)?.[1] ?? null;
  return {
    ap, apOficial, negocio: g(/Neg[óo]cio:\s*(\d+)/)?.[1] ?? null, proposta: g(/Proposta:\s*(\d+)/)?.[1] ?? null, tipoSeguro: g(/Tipo de Seguro:\s*(.+?)\s+(?:Classe|Data da Emiss)/)?.[1] ?? "",
    vigIni: dmy(vig?.[1]), vigFim: dmy(vig?.[2]), emissao: dmy(g(/Data da Emiss[ãa]o:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1]),
    liq: num(pr?.[1]), juros: num(pr?.[2]), iof: num(pr?.[3]), total, cobranca: cob, modo, parcelas, parcelasOk: parcelas.length > 0 && Math.abs(soma - total) <= 0.06,
    segNome: nome?.trim() ?? null, segDoc: g(/Segurado:\s*(?:CPF|CNPJ):\s*([\d.\-/]+)/)?.[1] ?? null,
    imobNome: imob?.[1]?.trim() ?? null, imobCnpj: dig(imob?.[2]) || null, imobCodigo: imob?.[3] ?? null,
    risco: rk ? { logradouro: rk[1].trim(), numero: rk[2], complemento: rk[3].trim(), bairro: rk[4].trim(), cidade: rk[5].trim(), uf: rk[6], cep: rk[7] } : null,
    produto: g(/Encaminhamos a sua Ap[óo]lice n[ºo°] \d+ - ([^,]+),/)?.[1]?.trim() ?? g(/Esta [ée] a sua Ap[óo]lice n[ºo°] \d+ - ([^.]+)\./)?.[1]?.trim() ?? "?",
    corretoraCod: corr, pasta,
  };
}

(async () => {
  // universo: PDFs das 3 pastas (141); a pasta pdfsilana (Residencial Premiado) fica de fora por enquanto
  const pastas = ["pdfs70145", "pdfs55002", "pdfs195354"]; const arqs: { ap: string; f: string; pasta: string }[] = [];
  for (const p of pastas) for (const f of fs.readdirSync(path.join(T, p)).filter((x) => x.endsWith(".pdf")).sort()) arqs.push({ ap: f.replace(".pdf", ""), f: path.join(T, p, f), pasta: p });
  const lote = arqs.slice(OFFSET, OFFSET + LIMITE);
  const [{ data: seg }, { data: corrs }, { data: ramos }] = await Promise.all([sb.from("erp_seguradoras").select("id,nome").ilike("nome", "%TOKIO%"), sb.from("erp_corretoras").select("id,apelido"), sb.from("erp_ramos").select("id,abreviacao,corretora_id")]);
  const segId = seg![0].id; const corrId = (cod: string | null) => corrs!.find((c) => (cod === "070145" ? /capitaliza/i : /corretora/i).test(c.apelido))!.id;
  const ramoId = (ab: string) => ramos!.find((r) => r.abreviacao === ab)!.id;
  const { data: imobs } = await sb.from("imobiliarias").select("id,nome,cnpj"); const imobPorCnpj = new Map((imobs ?? []).map((i) => [dig(i.cnpj), i]));
  // duplicidade: apólice (últimos 8 dígitos) e proposta já existentes
  const existentes = new Map<string, { id: string; situacao: string }>(); const propostas = new Map<string, string>();
  for (let de = 0; ; de += 1000) { const { data } = await sb.from("erp_documentos").select("id,numero_apolice,numero_proposta,situacao").not("numero_apolice", "is", null).order("id").range(de, de + 999); for (const d of data ?? []) { const k = dig(d.numero_apolice).slice(-8); if (k) existentes.set(k, { id: d.id, situacao: d.situacao }); } if ((data ?? []).length < 1000) break; }
  for (let de = 0; ; de += 1000) { const { data } = await sb.from("erp_documentos").select("id,numero_proposta").not("numero_proposta", "is", null).order("id").range(de, de + 999); for (const d of data ?? []) for (const p of String(d.numero_proposta).split(/[^0-9]+/).filter((x) => x.length >= 6)) propostas.set(p, d.id); if ((data ?? []).length < 1000) break; }

  const r = { lidos: 0, semLeitura: 0, duplicados: 0, criar: 0, criados: 0, anexosNovos: 0, clientesNovos: 0, clientesExistentes: 0, semCpf: 0, imobSemCasamento: 0, parcelasGravadas: 0, parcelasForaDaSoma: 0, erros: 0 };
  const log: string[] = ["lote;apolice;resultado;documento_id;nosso_numero;cliente_id;cliente_novo;imobiliaria;ramo;vigencia;situacao;premio_total;parcelas;obs"];
  const pend: Record<string, number> = {}; const imobsFalta = new Map<string, string>();
  for (const a of lote) {
    const { t } = await textoDoPdf(fs.readFileSync(a.f), []); if (!t) { r.semLeitura++; log.push([LOTE, a.ap, "SEM TEXTO", "", "", "", "", "", "", "", "", "", "", ""].join(";")); continue; }
    const x = ler(t, a.ap, a.pasta); r.lidos++;
    const apKey = dig(x.apOficial).slice(-8); const dup = existentes.get(apKey) ?? (x.proposta ? { id: propostas.get(x.proposta) ?? "", situacao: "" } : null);
    if (dup && dup.id) { r.duplicados++; const bytes = fs.readFileSync(a.f);
      if (GRAVAR) { try { await guardarAnexo(sb, { doc: { id: dup.id }, pdf: bytes, nome: `apolice_${x.apOficial}.pdf`, messageId: `portal-tokio:${a.ap}`, tipo: "apolice", origem: "api", av: { situacao: "confirmada", cpf: true, num: true, vig: true }, extra: { fonte: "portal Tokio", lote: LOTE } }); r.anexosNovos++; } catch (e) { r.erros++; } }
      log.push([LOTE, a.ap, "JÁ EXISTE (anexo apenas)", dup.id, "", "", "", "", "", "", dup.situacao, "", "", "duplicidade por apólice/proposta"].join(";")); continue; }
    const problemas: string[] = [];
    const falta = [!x.vigIni && "vigência", !x.total && "prêmio total", !x.segDoc && "CPF/CNPJ", !x.segNome && "nome do segurado"].filter(Boolean); if (falta.length) problemas.push("campo ausente no PDF: " + falta.join(", "));
    const docTipo = tipoDoDocumento(x.segDoc); if (!docTipo) { r.semCpf++; problemas.push("CPF/CNPJ do segurado inválido"); }
    if (problemas.length) { pend[problemas[0]] = (pend[problemas[0]] ?? 0) + 1; log.push([LOTE, a.ap, "PENDENTE: " + problemas.join(" / "), "", "", "", "", "", "", "", "", "", "", ""].join(";")); continue; }
    const imob = x.imobCnpj ? imobPorCnpj.get(x.imobCnpj) : undefined; if (x.imobNome && !imob) { r.imobSemCasamento++; imobsFalta.set(x.imobCnpj ?? x.imobNome, x.imobNome); }
    const imobiliario = /IMOBILIARIO/i.test(x.produto); const cap = x.corretoraCod === "070145";
    const ramo = imobiliario ? (cap ? "2IMO" : "IMOB") : "RESI";
    const formaCod = x.modo === "fatura" ? "cheque" : x.modo === "debito" ? "debito" : x.modo === "cartao" ? "cartao" : x.modo === "boleto" ? "boleto" : null; // erp_formas_pagamento: o Corp registra fatura como "cheque"
    const situacao = x.vigFim! >= HOJE ? "vigente" : "vencido"; const modo = x.modo === "fatura" && !imob ? "nao_informado" : x.modo;
    if (!x.parcelasOk && x.parcelas.length) r.parcelasForaDaSoma++;
    r.criar++;
    if (!GRAVAR) { log.push([LOTE, a.ap, "ENSAIO: criaria", "", "", "", "", imob?.nome ?? "(sem imobiliária)", ramo, `${x.vigIni}→${x.vigFim}`, situacao, x.total, x.parcelasOk ? x.parcelas.length : 0, ""].join(";")); continue; }
    try {
      const cli = await garantirCliente(sb, { documento: x.segDoc, nome: x.segNome, fonte: `lote:${LOTE}` }); if (!cli) throw new Error("cliente não criado/ligado");
      cli.criado ? r.clientesNovos++ : r.clientesExistentes++;
      const obs = [`Cadastrado do PDF oficial da apólice (portal Tokio) no lote ${LOTE}.`, `Nº oficial no PDF: ${x.apOficial}.`, x.negocio ? `Negócio: ${x.negocio}.` : null, x.cobranca ? `Cobrança no PDF: ${x.cobranca}.` : null, cap && !imobiliario ? "Atenção: corretor do PDF é O2 Capitalização (070145) em produto Residencial; conferir." : null, imob ? null : x.imobNome ? `Imobiliária do PDF sem casamento no banco único: ${x.imobNome} (${x.imobCnpj}).` : null].filter(Boolean).join(" ");
      const { data: doc, error } = await sb.from("erp_documentos").insert({
        corretora_id: corrId(x.corretoraCod), tipo: "A", tipo_corp: /Renov/i.test(x.tipoSeguro) ? "RENV" : "NOVO", seguradora_id: segId, ramo_id: ramoId(ramo), locatario_id: cli.id, imobiliaria_principal_id: imob?.id ?? null,
        tipo_contratacao: imob ? "indicacao_imobiliaria" : null, modo_cobranca: modo, numero_proposta: x.proposta ?? x.negocio, numero_apolice: String(Number(dig(x.apOficial))), dt_emissao: x.emissao, vigencia_inicio: x.vigIni, vigencia_fim: x.vigFim,
        forma_pagamento: formaCod, qtd_parcelas: x.parcelasOk ? x.parcelas.length : null, premio_liquido: x.liq, premio_adicional: x.juros, iof: x.iof, premio_total: x.total,
        situacao, competencia: x.vigIni!.slice(0, 7) + "-01", origem: "api", origem_ref: `lote:${LOTE}:${a.ap}`, observacoes: obs, criado_por_email: `sistema:${LOTE}`, revisao_pendente: cap && !imobiliario,
      }).select("id,nosso_numero").single();
      if (error) throw new Error("documento: " + error.message);
      if (x.risco) { const { error: ei } = await sb.from("erp_documento_itens").insert({ documento_id: doc.id, item_n: 1, tipo_imovel: /EMPRESARIAL/i.test(x.produto) ? "comercial" : "residencial", cep: x.risco.cep, logradouro: x.risco.logradouro, numero: x.risco.numero, complemento: x.risco.complemento || null, bairro: x.risco.bairro, cidade: x.risco.cidade, uf: x.risco.uf, contrato_inicio: null, contrato_fim: null }); if (ei) throw new Error("item: " + ei.message); }
      if (x.parcelasOk) { const { error: ep } = await sb.from("erp_parcelas").insert(x.parcelas.map((p) => ({ documento_id: doc.id, n: p.n, vencimento: p.venc, valor: p.valor, forma_pagamento: formaCod, origem: "api" }))); if (ep) throw new Error("parcelas: " + ep.message); r.parcelasGravadas += x.parcelas.length; }
      await guardarAnexo(sb, { doc: { id: doc.id }, pdf: fs.readFileSync(a.f), nome: `apolice_${x.apOficial}.pdf`, messageId: `portal-tokio:${a.ap}`, tipo: "apolice", origem: "api", av: { situacao: "confirmada", cpf: true, num: true, vig: true }, extra: { fonte: "portal Tokio (Visão Geral do Cliente)", lote: LOTE, apolice_oficial: x.apOficial, vigencia: `${x.vigIni}→${x.vigFim}` } }); r.anexosNovos++;
      r.criados++; log.push([LOTE, a.ap, "CRIADO", doc.id, doc.nosso_numero, cli.id, cli.criado ? "sim" : "não", imob?.nome ?? "", ramo, `${x.vigIni}→${x.vigFim}`, situacao, x.total, x.parcelasOk ? x.parcelas.length : 0, ""].join(";"));
    } catch (e) { r.erros++; log.push([LOTE, a.ap, "ERRO: " + (e as Error).message.slice(0, 120), "", "", "", "", "", "", "", "", "", "", ""].join(";")); }
  }
  const saida = path.join(T, `${GRAVAR ? "LOG" : "ensaio"}-${LOTE}-${OFFSET}.csv`); fs.writeFileSync(saida, "﻿" + log.join("\n"));
  console.log(GRAVAR ? "GRAVADO" : "ENSAIO", JSON.stringify(r)); console.log("pendências:", JSON.stringify(pend)); console.log("imobiliárias sem casamento:", JSON.stringify([...imobsFalta])); console.log("log:", saida);
})();
