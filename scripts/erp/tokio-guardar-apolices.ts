// Guarda como ANEXO (bucket privado + erp_documento_anexos, origem 'api' = portal da Tokio) os PDFs de apólice baixados do portal da Tokio
// (%TEMP%\tokio\pdfs) nas propostas do ERP (situacao 'proposta', sem nº de apólice) que têm o CPF/CNPJ no PDF. NÃO altera a proposta.
// Confiança: confirmada = CPF no PDF + (início de vigência do ERP = portal OU endereço do item no PDF); provavel = CPF + apólice só desta
// proposta; conferir = CPF mas a apólice tem 2+ propostas candidatas sem desempate. Ensaio por padrão: [--gravar]
process.loadEnvFile(".env.local");
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { documentosNoTexto, guardarAnexo, textoDoPdf } from "@/lib/erp/anexosEmail";
const T = path.join(os.tmpdir(), "tokio"); const GRAVAR = process.argv.includes("--gravar"); const sb = createServiceClient();
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ");
(async () => {
  const cruz = JSON.parse(fs.readFileSync(path.join(T, "cruzamento.json"), "utf8")) as { id: string; codigo_o2: number; ramo: string; ap: { n: string; ramo: string; ini: string; fim: string; cpf: string; prod: string }[] }[];
  const erp = new Set<string>(JSON.parse(fs.readFileSync(path.join(T, "erp-numeros.json"), "utf8")));
  const ids = cruz.map((c) => c.id);
  const docs = new Map<string, { vigencia_inicio: string | null; itens: { logradouro: string | null; numero: string | null }[] }>();
  for (let i = 0; i < ids.length; i += 100) {
    const g = ids.slice(i, i + 100);
    const { data: d } = await sb.from("erp_documentos").select("id,vigencia_inicio").in("id", g);
    const { data: it } = await sb.from("erp_documento_itens").select("documento_id,logradouro,numero").in("documento_id", g);
    for (const x of d ?? []) docs.set(x.id, { vigencia_inicio: x.vigencia_inicio, itens: [] });
    for (const x of it ?? []) docs.get(x.documento_id)?.itens.push({ logradouro: x.logradouro, numero: x.numero });
  }
  const pares = new Map<string, { ap: (typeof cruz)[0]["ap"][0]; props: string[] }>();
  for (const c of cruz) for (const a of c.ap.filter((a) => !erp.has(a.n))) { const k = `${a.ramo}_${a.n}`; (pares.get(k) ?? pares.set(k, { ap: a, props: [] }).get(k)!).props.push(c.id); }
  const textos = new Map<string, { t: string; N: string; buf: Buffer }>();
  const r = { pdfs: pares.size, anexos: 0, confirmada: 0, provavel: 0, conferir: 0, semCpf: 0, erros: 0 };
  const quadro: Record<string, number> = {};
  for (const [k, { ap, props }] of pares) {
    const f = path.join(T, "pdfs", `${k}.pdf`); if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f); const { t } = await textoDoPdf(buf, []); if (!t) continue; const N = norm(t);
    textos.set(k, { t, N, buf });
    const cpfsPdf = documentosNoTexto(t);
    for (const id of props) {
      const cpfDoc = cruz.find((c) => c.id === id)!.ap.find((a) => a.n === ap.n)!.cpf;
      if (!cpfsPdf.has(cpfDoc)) { r.semCpf++; continue; }
      const d = docs.get(id)!;
      const vig = !!d.vigencia_inicio && d.vigencia_inicio === ap.ini;
      const end = d.itens.some((x) => { const lg = norm(x.logradouro ?? "").split(" ").filter((w) => w.length >= 4 && !/^(RUA|AVENIDA|ESTRADA|TRAVESSA|ALAMEDA|PRACA)$/.test(w)); const nu = String(x.numero ?? "").replace(/\D/g, ""); return lg.length > 0 && lg.some((w) => N.includes(w)) && nu.length > 0 && new RegExp(`\b${nu}\b`).test(N); });
      const sit = vig || end ? "confirmada" : props.length === 1 ? "provavel" : "conferir";
      r[sit]++; quadro[`${ap.prod}/${sit}`] = (quadro[`${ap.prod}/${sit}`] ?? 0) + 1;
      if (GRAVAR) {
        try { await guardarAnexo(sb, { doc: { id }, pdf: buf, nome: `apolice_${ap.ramo}_${ap.n}.pdf`, messageId: `portal-tokio:${ap.ramo}/${ap.n}`, tipo: "apolice", origem: "api", av: { situacao: sit, cpf: true, num: false, vig }, extra: { fonte: "portal Tokio (Visão Geral do Cliente)", apolice: ap.n, ramo: ap.ramo, inicio: ap.ini, fim: ap.fim, endereco_confere: end, propostas_candidatas: props.length } }); r.anexos++; } catch (e) { r.erros++; console.log("erro", id, (e as Error).message.slice(0, 80)); }
      }
    }
  }
  console.log(GRAVAR ? "GRAVADO" : "ENSAIO", JSON.stringify(r)); console.log(JSON.stringify(quadro));
})();
