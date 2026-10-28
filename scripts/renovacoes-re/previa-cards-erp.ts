// PRÉVIA de cards de renovação por produto (base = relatório do Corp conferido com o ERP). NÃO cria nada no Bitrix
// (só lê os funis para achar duplicidade). Saída: renovacoes-re/cards/<mes>/previa-cards-<mes>.xlsx + .json
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/renovacoes-re/previa-cards-erp.ts --mes 2027-01
process.loadEnvFile(".env.local");
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { listarItensSpaCategoria } from "@/lib/bitrix/client";
import { nomeSeguradora } from "@/lib/renovacoesRe/planilhaLote";

const mes = process.argv[process.argv.indexOf("--mes") + 1];
const mesBr = `${mes.slice(5, 7)}.${mes.slice(0, 4)}`;
const RAIZ = path.resolve(process.cwd(), "..", "renovacoes-re");
const L: Record<string, any>[] = JSON.parse(fs.readFileSync(path.join(RAIZ, `corp-${mes}`, `linhas-${mes}.json`), "utf8")).linhas;

const chave = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const semPrefixo = (p: string) => p.replace(/^IMOB\s*-\s*/i, "").trim();
const NAO_IMOB = /^((O2 CORRETORA|O2 SEGUROS|SEGIMOB|BASE SOFTWARE|SUPERLOGICA|SOHTEC)\b|RETRANSMISS|TOMBAMENTO)/;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/^IMOB\s*-\s*/, "").replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const SEG_CAMPO: Record<string, string> = { YELUM: "YELLUM" };
const segNome = (cod: string) => { const n = nomeSeguradora(cod); return SEG_CAMPO[n] ?? n; };
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Funil = { entity: number; cat: number; nome: string };
const F_RE: Funil = { entity: 1046, cat: 34, nome: "Ramos Elementares · Renovações" };
const F_FIANCA: Funil = { entity: 1042, cat: 32, nome: "Seguro Fiança · Renovação" };
const F_CAP: Funil = { entity: 1048, cat: 38, nome: "Capitalização · Reaplicações" };
const F_AUTO: Funil = { entity: 1050, cat: 30, nome: "Automóvel · Pipeline padrão" };
const produtoDe = (l: Record<string, any>): { funil: Funil; produto: string } => {
  const p = l["Produto (ERP)"], r = l["Ramo"];
  if (p === "fianca") return { funil: F_FIANCA, produto: "Seguro Fiança" };
  if (p === "capitalizacao") return { funil: F_CAP, produto: "Capitalização" };
  if (p === "automovel") return { funil: F_AUTO, produto: "Automóvel" };
  const nome: Record<string, string> = { IMOB: "Incêndio Imobiliário", "2IMO": "Incêndio Imobiliário", RESI: "Incêndio Individual Residencial", EMPR: "Incêndio Individual Empresarial", COND: "Condomínio" };
  return { funil: F_RE, produto: nome[r] ?? "" };
};

type Card = { funil: string; entity: number; cat: number; chave: string; titulo: string; produto: string; ramos: string; seguradora: string; imobiliaria: string; origem: string; itens: number; fim: string; comissaoMin: number | null; premioAnterior: number; apolices: string[]; nossos: number[]; clientes: string[]; alertas: string[] };

function imobDe(l: Record<string, any>) {
  const prods = [l["Produtor 1"], l["Produtor 2"], l["Produtor 3"]].filter(Boolean) as string[];
  const imob = prods.find((p) => !NAO_IMOB.test(norm(p)));
  return { imob: imob ? semPrefixo(imob) : null, segimob: prods.some((p) => /^SEGIMOB/.test(norm(p))), superlogica: prods.some((p) => /^SUPERLOGICA/.test(norm(p))) };
}

async function main() {
  const cards = new Map<string, Card>();
  for (const l of L) {
    const { funil, produto } = produtoDe(l);
    const { imob, segimob, superlogica } = imobDe(l);
    const seg0 = segNome(l["Seguradora"]);
    const seg = segimob ? `SEG/${seg0}` : seg0;
    const ramo = l["Ramo"] as string;
    const venda = !imob;
    const premio = l["Prêmio total (Corp)"] as number;
    const apol = String(l["Nº da apólice (Corp)"]);
    const semNum = !/[1-9]/.test(apol);
    const alertas: string[] = [];
    if (l["Cliente (situação do cadastro)"] !== "ok") alertas.push(`cliente: ${l["Cliente (situação do cadastro)"]}`);
    if (semNum) alertas.push("apólice sem número no Corp");
    if (premio === 0) alertas.push("prêmio total zerado no Corp");
    if (l["Sinistros (Corp)"] > 0) alertas.push(`${l["Sinistros (Corp)"]} sinistro(s) no Corp`);
    if (/prêmio/.test(l["Divergências"] || "")) alertas.push("prêmio do ERP diferente do Corp");
    if (/cliente do ERP/.test(l["Divergências"] || "")) alertas.push("cliente do ERP ≠ dono do CPF/CNPJ");
    if (/mais de uma/.test(l["Imobiliária (situação)"] || "")) alertas.push("imobiliária casa com mais de uma ficha (grupo)");
    if (venda) alertas.push("venda direta O2 (sem imobiliária)");
    if (superlogica) alertas.push("via Superlógica");
    if (l["Situação no ERP"] === "digitado") alertas.push("proposta (ainda não virou apólice)");

    let k: string, titulo: string, origem = segimob ? "Segimob" : superlogica ? "Outro" : "Ficha", agrupa = false;
    if (funil === F_RE && (ramo === "IMOB" || ramo === "2IMO") && imob) { agrupa = true; k = `RE|${imob}|${seg}`; titulo = `RENOVAÇÃO - ${imob} - ${seg} - ${mesBr}`; }
    else if (funil === F_RE) {
      const r = ramo; const cli = l["Cliente (Corp)"] as string;
      titulo = !imob ? `RENOVAÇÃO - ${r} - ${cli} - ${mesBr}` : chave(cli).startsWith(chave(imob).slice(0, 12)) ? `RENOVAÇÃO - ${r} - ${imob} - ${mesBr}` : `RENOVAÇÃO - ${r} - ${cli} - ${imob} - ${mesBr}`;
      k = `RE1|${l["Nosso nº do Corp"]}`;
    } else if (funil === F_FIANCA) { titulo = `${l["Cliente (Corp)"]}${imob ? " - " + imob : ""}`; k = `FI|${l["Nosso nº do Corp"]}`; }
    else if (funil === F_CAP) { titulo = `VENCE ${dataBr(l["Fim vig. (Corp)"])} | ${l["Cliente (Corp)"]} | CORP ${l["Nosso nº do Corp"]}`; k = `CA|${l["Nosso nº do Corp"]}`; }
    else { titulo = `RENOVAÇÃO - ${l["Cliente (Corp)"]}`; k = `AU|${l["Nosso nº do Corp"]}`; }
    const c = cards.get(k) ?? { funil: funil.nome, entity: funil.entity, cat: funil.cat, chave: k, titulo, produto, ramos: "", seguradora: seg, imobiliaria: imob ?? "", origem, itens: 0, fim: l["Fim vig. (Corp)"], comissaoMin: null, premioAnterior: 0, apolices: [] as string[], nossos: [] as number[], clientes: [] as string[], alertas: [] as string[] };
    c.itens++;
    if (!c.ramos.split(", ").includes(ramo)) c.ramos = c.ramos ? `${c.ramos}, ${ramo}` : ramo;
    if (l["Fim vig. (Corp)"] < c.fim) c.fim = l["Fim vig. (Corp)"];
    const pct = l["% comissão (Corp)"] as number;
    if (pct > 0) c.comissaoMin = c.comissaoMin == null ? pct : Math.min(c.comissaoMin, pct);
    c.premioAnterior = Math.round((c.premioAnterior + premio) * 100) / 100;
    if (!semNum) c.apolices.push(apol);
    c.nossos.push(l["Nosso nº do Corp"]);
    c.clientes.push(l["Cliente (Corp)"]);
    for (const a of alertas) if (!c.alertas.includes(a)) c.alertas.push(a);
    void agrupa;
    cards.set(k, c);
  }

  // duplicidade: só leitura dos funis
  const existentes = new Map<string, any[]>();
  for (const f of [F_RE, F_FIANCA, F_CAP, F_AUTO]) existentes.set(`${f.entity}`, await listarItensSpaCategoria(f.entity, f.cat));
  for (const c of cards.values()) {
    const ex = existentes.get(`${c.entity}`) ?? [];
    const achou = ex.filter((i) => {
      const t = String(i.title ?? "").toUpperCase();
      if (c.entity === 1048) return c.nossos.some((n) => t.includes(`CORP ${n}`));
      if (c.entity === 1046) return t === c.titulo.toUpperCase() || (c.apolices.length > 0 && c.apolices.some((a) => String(i["ufCrm12NumApolice"] ?? "").includes(a)));
      return chave(t).includes(chave(c.clientes[0]).slice(0, 14));
    });
    if (achou.length) c.alertas.push(`JÁ HÁ card parecido no funil (${achou.length}): ${achou.slice(0, 2).map((i) => `#${i.id} "${String(i.title).slice(0, 50)}"`).join("; ")}`);
  }

  const lista = [...cards.values()].sort((a, b) => a.funil.localeCompare(b.funil) || a.titulo.localeCompare(b.titulo));
  const pasta = path.join(RAIZ, "cards", mes);
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, `previa-cards-${mes}.json`), JSON.stringify(lista, null, 1));
  const linhas = lista.map((c) => ({ Funil: c.funil, "Título do card": c.titulo, Produto: c.produto, Ramos: c.ramos, Seguradora: c.seguradora, Imobiliária: c.imobiliaria || "(venda direta O2)", Origem: c.origem, "Qtd. de itens": c.itens, "Fim de vigência (menor)": c.fim, "Comissão % (menor)": c.comissaoMin ?? "", "Prêmio total anterior": c.premioAnterior, "Nº das apólices": c.apolices.join("; "), "Nosso nº do Corp": c.nossos.join("; "), Alertas: c.alertas.join(" | ") }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), "Cards");
  const resumo: Record<string, { cards: number; itens: number; alerta: number }> = {};
  for (const c of lista) { const r = (resumo[c.funil] ??= { cards: 0, itens: 0, alerta: 0 }); r.cards++; r.itens += c.itens; if (c.alertas.some((a) => !/venda direta|via Superl/.test(a))) r.alerta++; }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.entries(resumo).map(([f, r]) => ({ Funil: f, Cards: r.cards, Documentos: r.itens, "Cards com alerta": r.alerta }))), "Resumo");
  XLSX.writeFile(wb, path.join(pasta, `previa-cards-${mes}.xlsx`));
  console.log(JSON.stringify({ total: lista.length, resumo }, null, 1));
  const dup = lista.filter((c) => c.alertas.some((a) => a.startsWith("JÁ HÁ"))); console.log("com card parecido já existente:", dup.length);
  const porTipo: Record<string, number> = {}; lista.forEach((c) => c.alertas.forEach((a) => { const k = a.replace(/\(\d+\)|: .*/g, "").slice(0, 60); porTipo[k] = (porTipo[k] ?? 0) + 1; })); console.log(porTipo);
  void reais;
}
main().catch((e) => { console.error("ERRO", e); process.exit(1); });
