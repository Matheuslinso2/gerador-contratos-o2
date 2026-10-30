// Cadastro em lote (regra permanente do Matheus 30/10: apólice com PDF oficial que bate = cadastrar) das apólices da Porto (Porto Seguro Imobiliária / Porto Empresa)
// lidas do PDF OFICIAL. Só grava o que está no PDF: nº da apólice, proposta, vigência, emissão, prêmio (líquido [já com serviços emergenciais], custo, IOF, juros, total),
// forma de pagamento, parcelas (se somam o total), segurado (CPF/CNPJ), local do risco e imobiliária (CNPJ -> tabela imobiliarias; nunca cria imobiliária).
// NÃO cria recebimento, baixa nem repasse. 1 documento por apólice (origem 'api', origem_ref 'lote:<LOTE>:<apólice>'), anexo = PDF oficial.
// Anti-duplicidade: apólice (8 últimos dígitos) ou proposta já existente => só anexa o PDF (--gravar) e lista. Ensaio por padrão.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/porto-gravar-lote.ts [--gravar] [--lote PORTO-CAP-20261030]
process.loadEnvFile(".env.local");
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf, guardarAnexo } from "@/lib/erp/anexosEmail";
import { garantirCliente, tipoDoDocumento } from "@/lib/erp/clientes";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const LOTE = arg("lote") ?? "PORTO-CAP-20261030"; const GRAVAR = process.argv.includes("--gravar"); const HOJE = "2026-10-30";
const P = path.join(os.tmpdir(), "porto");
// PDFs oficiais já lidos e provados (nº + vigência + prêmio + CPF/CNPJ): Drive (ADJUVE) e portal (Apólices e Contratos, Susep G0852J)
const ARQUIVOS: { ap: string; f: string; origem: "drive" | "api" }[] = [
  { ap: "4115266", f: path.join(P, "cap", fs.readdirSync(path.join(P, "cap")).find((x) => x.startsWith("4115266_1eUPP"))!), origem: "drive" },
  { ap: "4291951", f: path.join(P, "cap", fs.readdirSync(path.join(P, "cap")).find((x) => x.startsWith("4291951_1il9"))!), origem: "drive" },
  ...["4107594", "4110311", "4292712", "4315346"].map((ap) => ({ ap, f: path.join(P, "cap3", `${ap}.pdf`), origem: "api" as const })),
];
const sb = createServiceClient();
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const num = (s: string | undefined) => (s == null ? 0 : Number(s.replace(/\./g, "").replace(",", ".")));
const dmy = (s: string | undefined) => (s ? s.split("/").reverse().join("-") : null);
const UFS = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));

function ler(t: string) {
  const s = t.replace(/\s+/g, " "); const g = (re: RegExp) => re.exec(s);
  const numero = g(/N[úu]mero da Ap[óo]lice:\s*(\d+) (\d+) (\d+)/); const vig = g(/dia (\d{2}\/\d{2}\/\d{4}) at[ée] as 24h do dia (\d{2}\/\d{2}\/\d{4}) (\d{2}) (\d{6,9}) (\d{2}\/\d{2}\/\d{4})/);
  const liq = g(/Pr[êe]mio liquido R\$\s*([\d.,]+)/i); const tarif = g(/Pr[êe]mio tarif[áa]rio R\$\s*([\d.,]+)/i); const desc = g(/Desconto R\$\s*([\d.,]+)/i); const serv = g(/Servi[çc]os emergenciais R\$\s*([\d.,]+)/i);
  const custo = g(/Custo de emiss[ãa]o R\$\s*([\d.,]+)/i); const iof = g(/IOF R\$\s*([\d.,]+)/); const juros = g(/Taxa de juros ao m[êe]s % R\$\s*([\d.,]+)/i); const total = g(/VALOR TOTAL SEGURO R\$\s*([\d.,]+)/i);
  const forma = g(/FORMA DE PAGAMENTO (.+?) PARCELAMENTO DO SEGURO/i)?.[1]?.trim() ?? "";
  const iP = s.search(/Parcela Valor \(R\$\) Vencimento/); const parcelas = iP < 0 ? [] : [...s.slice(iP, iP + 2000).matchAll(/\b(\d{2}) R\$\s*([\d.]+,\d{2}) (\d{2}\/\d{2}\/\d{4})/g)].map((m) => ({ n: Number(m[1]), valor: num(m[2]), venc: dmy(m[3])! }));
  const imob = g(/DADOS DA IMOBILI[ÁA]RIA Nome: Telefone: CNPJ: .*? Estado: (.+?) (\d{2}) (\d{6,9}) (\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/); const seg = g(/DADOS CADASTRAIS Segurado:.*?Cidade:\s*(.+?)\s+\S+@\S+/); const segDoc = g(/CPF\/CNPJ:\s*([\d.\-/]+)\s+Celular/)?.[1];
  const rk = g(/LOCAL DE RISCO - OBJETO SEGURADO Endereço: Tipo de Im[óo]vel: (\S+) Bairro: Estado: Cidade: (.+?),\s*(\S+) (.+?) CEP: ([\d-]+)\s*(.*?)\s*Complemento:/);
  let risco: { tipo: string; logradouro: string; numero: string; bairro: string; cidade: string; uf: string; cep: string; complemento: string } | null = null;
  if (rk) { const toks = rk[4].trim().split(" "); const iu = toks.findIndex((x) => UFS.has(x)); risco = { tipo: rk[1], logradouro: rk[2], numero: rk[3], bairro: iu > 0 ? toks.slice(0, iu).join(" ") : "", uf: iu >= 0 ? toks[iu] : "", cidade: iu >= 0 ? toks.slice(iu + 1).join(" ") : rk[4], cep: rk[5], complemento: rk[6] }; }
  const parcelasSoma = parcelas.reduce((a, p) => a + p.valor, 0);
  return {
    ramoSuc: numero ? `${numero[1]} ${numero[2]}` : "", apOficial: numero ? `${numero[1]} ${numero[2]} ${numero[3]}` : "", ap: numero?.[3] ?? "", tipoApolice: g(/Ap[óo]lice:\s*(NOVO|RENOVA[^N]*?)\s+N[úu]mero da Ap/)?.[1] ?? "NOVO",
    proposta: vig ? `${vig[3]} ${vig[4]}` : null, vigIni: dmy(vig?.[1]), vigFim: dmy(vig?.[2]), emissao: dmy(vig?.[5]), tarifario: num(tarif?.[1]), desconto: num(desc?.[1]), servicos: num(serv?.[1]), liquido: num(liq?.[1]), custo: num(custo?.[1]), iof: num(iof?.[1]), juros: num(juros?.[1]), total: num(total?.[1]),
    forma, parcelas, parcelasOk: parcelas.length > 0 && Math.abs(parcelasSoma - num(total?.[1])) <= 0.06, imobNome: imob?.[1]?.trim() ?? null, imobCnpj: imob?.[4] ? imob[4].replace(/\D/g, "") : null, segNome: seg?.[1]?.trim() ?? null, segDoc: segDoc ?? null, risco,
    susep: g(/\b(G0852J|LI7PMJ)\b/)?.[1] ?? null,
  };
}

(async () => {
  const { data: seg } = await sb.from("erp_seguradoras").select("id").eq("nome", "PORTO SEGURO").single(); const { data: corrs } = await sb.from("erp_corretoras").select("id,apelido"); const { data: ramos } = await sb.from("erp_ramos").select("id,abreviacao");
  const corrId = (susep: string | null) => corrs!.find((c) => (susep === "G0852J" ? /capitaliza/i : /corretora/i).test(c.apelido))!.id; const ramoId = (ab: string) => ramos!.find((r) => r.abreviacao === ab)!.id;
  const { data: imobs } = await sb.from("imobiliarias").select("id,nome,cnpj"); const imobPorCnpj = new Map((imobs ?? []).map((i) => [dig(i.cnpj), i]));
  const existentes = new Map<string, string>(); const propostas = new Map<string, string>();
  for (let de = 0; ; de += 1000) { const { data } = await sb.from("erp_documentos").select("id,numero_apolice,numero_proposta").order("id").range(de, de + 999); for (const d of data ?? []) { const k = dig(d.numero_apolice).slice(-8); if (k) existentes.set(k, d.id); for (const p of String(d.numero_proposta ?? "").split(/[^0-9]+/).filter((x) => x.length >= 6)) propostas.set(p, d.id); } if ((data ?? []).length < 1000) break; }
  const log: string[] = ["lote;apolice;resultado;documento_id;nosso_numero;cliente;cliente_novo;imobiliaria;vigencia;premio_total;parcelas"]; const r = { lidos: 0, duplicados: 0, criados: 0, anexos: 0, clientesNovos: 0, clientesExistentes: 0, parcelas: 0, erros: 0 };
  for (const a of ARQUIVOS) {
    const buf = fs.readFileSync(a.f); const { t } = await textoDoPdf(buf, []); if (!t) { r.erros++; log.push([LOTE, a.ap, "SEM TEXTO"].join(";")); continue; } const x = ler(t); r.lidos++;
    const apKey = dig(x.ap).slice(-8); const dupId = existentes.get(apKey) ?? (x.proposta ? x.proposta.split(" ").map((p) => propostas.get(p)).find((v) => v && p0(x.proposta!)) : undefined);
    function p0(_: string) { return true; }
    if (dupId) { r.duplicados++; if (GRAVAR) { try { await guardarAnexo(sb, { doc: { id: dupId }, pdf: buf, nome: `apolice_${x.ap}.pdf`, messageId: `porto-cap:${a.ap}`, tipo: "apolice", origem: a.origem, av: { situacao: "confirmada", cpf: true, num: true, vig: true }, extra: { fonte: "Porto (PDF oficial)", lote: LOTE } }); r.anexos++; } catch { r.erros++; } } log.push([LOTE, a.ap, "JÁ EXISTE (anexo apenas)", dupId].join(";")); continue; }
    if (!x.ap || !x.vigIni || !x.vigFim || !x.total || !x.segNome || !x.segDoc || !tipoDoDocumento(x.segDoc)) { r.erros++; log.push([LOTE, a.ap, "PENDENTE: campo ausente no PDF"].join(";")); continue; }
    const imob = x.imobCnpj ? imobPorCnpj.get(x.imobCnpj) : undefined; const modo = /FATURA/i.test(x.forma) ? (imob ? "fatura" : "nao_informado") : /D[ÉE]BITO/i.test(x.forma) ? "debito" : /CART/i.test(x.forma) ? "cartao" : /BOLETO/i.test(x.forma) ? "boleto" : "nao_informado";
    const formaCod = /FATURA/i.test(x.forma) ? "cheque" : /D[ÉE]BITO/i.test(x.forma) ? "debito" : /CART/i.test(x.forma) ? "cartao" : /BOLETO/i.test(x.forma) ? "boleto" : null; const situacao = x.vigFim >= HOJE ? "vigente" : "vencido";
    if (!GRAVAR) { log.push([LOTE, a.ap, "ENSAIO: criaria", "", "", x.segNome, "", imob?.nome ?? `(sem casamento: ${x.imobNome})`, `${x.vigIni}→${x.vigFim}`, x.total, x.parcelasOk ? x.parcelas.length : 0].join(";")); r.criados++; continue; }
    try {
      const cli = await garantirCliente(sb, { documento: x.segDoc, nome: x.segNome, fonte: `lote:${LOTE}` }); if (!cli) throw new Error("cliente não criado/ligado"); cli.criado ? r.clientesNovos++ : r.clientesExistentes++;
      const obs = [`Cadastrado do PDF oficial da apólice (Porto) no lote ${LOTE}.`, `Nº oficial no PDF: ${x.apOficial}.`, x.servicos ? `Prêmio líquido inclui serviços emergenciais de R$ ${x.servicos.toFixed(2)} (conforme PDF; prêmio tarifário R$ ${x.tarifario.toFixed(2)}).` : null, x.forma ? `Forma de pagamento no PDF: ${x.forma}.` : null, x.imobNome && !imob ? `Imobiliária do PDF sem casamento no banco único: ${x.imobNome} (${x.imobCnpj}).` : null].filter(Boolean).join(" ");
      const { data: doc, error } = await sb.from("erp_documentos").insert({ corretora_id: corrId(x.susep), tipo: "A", tipo_corp: /RENOVA/i.test(x.tipoApolice) ? "RENV" : "NOVO", seguradora_id: seg!.id, ramo_id: ramoId("2IMO"), locatario_id: cli.id, imobiliaria_principal_id: imob?.id ?? null, tipo_contratacao: imob ? "indicacao_imobiliaria" : null, modo_cobranca: modo, numero_proposta: x.proposta, numero_apolice: String(Number(x.ap)), dt_emissao: x.emissao, vigencia_inicio: x.vigIni, vigencia_fim: x.vigFim, forma_pagamento: formaCod, qtd_parcelas: x.parcelasOk ? x.parcelas.length : null, premio_liquido: x.liquido, desconto: x.desconto, custo_apolice: x.custo, premio_adicional: x.juros, iof: x.iof, premio_total: x.total, situacao, competencia: x.vigIni.slice(0, 7) + "-01", origem: "api", origem_ref: `lote:${LOTE}:${a.ap}`, observacoes: obs, criado_por_email: `sistema:${LOTE}` }).select("id,nosso_numero").single();
      if (error) throw new Error("documento: " + error.message);
      if (x.risco) { const { error: ei } = await sb.from("erp_documento_itens").insert({ documento_id: doc.id, item_n: 1, tipo_imovel: /RESID/i.test(x.risco.tipo) ? "residencial" : "comercial", cep: x.risco.cep, logradouro: x.risco.logradouro, numero: x.risco.numero, complemento: x.risco.complemento || null, bairro: x.risco.bairro || null, cidade: x.risco.cidade || null, uf: x.risco.uf || null }); if (ei) throw new Error("item: " + ei.message); }
      if (x.parcelasOk) { const { error: ep } = await sb.from("erp_parcelas").insert(x.parcelas.map((p) => ({ documento_id: doc.id, n: p.n, vencimento: p.venc, valor: p.valor, forma_pagamento: formaCod, origem: "api" }))); if (ep) throw new Error("parcelas: " + ep.message); r.parcelas += x.parcelas.length; }
      await guardarAnexo(sb, { doc: { id: doc.id }, pdf: buf, nome: `apolice_${x.ap}.pdf`, messageId: `porto-cap:${a.ap}`, tipo: "apolice", origem: a.origem, av: { situacao: "confirmada", cpf: true, num: true, vig: true }, extra: { fonte: a.origem === "drive" ? "Drive ADJUVE (PDF oficial)" : "portal Porto (Apólices e Contratos, Susep G0852J)", lote: LOTE, apolice_oficial: x.apOficial, vigencia: `${x.vigIni}→${x.vigFim}` } }); r.anexos++; r.criados++;
      log.push([LOTE, a.ap, "CRIADO", doc.id, doc.nosso_numero, x.segNome, cli.criado ? "sim" : "não", imob?.nome ?? "", `${x.vigIni}→${x.vigFim}`, x.total, x.parcelasOk ? x.parcelas.length : 0].join(";"));
    } catch (e) { r.erros++; log.push([LOTE, a.ap, "ERRO: " + (e as Error).message.slice(0, 120)].join(";")); }
  }
  const saida = path.join(os.tmpdir(), "tokio", `${GRAVAR ? "LOG" : "ensaio"}-${LOTE}.csv`); fs.writeFileSync(saida, "﻿" + log.join("\n")); console.log(GRAVAR ? "GRAVADO" : "ENSAIO", JSON.stringify(r)); console.log(log.slice(1).join("\n")); console.log("log:", saida);
})();
