// Guarda como ANEXO do documento (bucket privado anexos-documentos + erp_documento_anexos) as apólices em PDF do ACERVO (apolice_documentos,
// situacao 'certa' = nº da apólice + vigência ±1 dia + CPF/CNPJ do segurado conferidos com o Corp) que ainda não têm anexo no ERP.
// Fontes: 'drive' (pasta IMOBILIARIAS, baixa pelo Drive) e 'email' (caixa do Matheus, baixa pelo Gmail; só leitura). 'corp' já está na aba de anexos
// do Corp (corp_anexos) e NÃO é copiado de novo. Prioridade: documentos vigentes que vencem em janeiro/2027, depois os demais vigentes.
// Ensaio por padrão. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/guardar-acervo-apolices.ts [--gravar] [--fonte drive,email]
//     [--prioridade jan2027|vigentes] [--limite 500]
process.loadEnvFile(".env.local");
import { createRequire } from "node:module";
import { createServiceClient } from "@/lib/supabase/service";
import { lerAnexosPdf } from "@/lib/erp/emails";
import { guardarAnexo } from "@/lib/erp/anexosEmail";

const require = createRequire(import.meta.url);
const { cliente } = require("../base-unica/_google.cjs");

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const FONTES = new Set((arg("fonte") ?? "drive,email").split(","));
const PRIORIDADE = arg("prioridade") ?? "jan2027";
const LIMITE = Number(arg("limite") ?? 100000);
const sb = createServiceClient();
const em = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function comRetry<T>(fn: () => Promise<T>): Promise<T> { for (let t = 0; ; t++) { try { return await fn(); } catch (e) { if (t >= 4) throw e; await pausa(2000 * (t + 1)); } } }

type Ap = { id: string; fonte: string; arquivo_id: string; arquivo_nome: string | null; nosso_numero: string };
type Doc = { id: string; nosso_numero: number; nosso_numero_corp: number | null; vigencia_fim: string | null; seguradora_id: string | null; ramo_id: string | null };

(async () => {
  const aps: Ap[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await sb.from("apolice_documentos").select("id,fonte,arquivo_id,arquivo_nome,nosso_numero").eq("situacao", "certa").in("fonte", [...FONTES]).not("nosso_numero", "is", null).order("id").range(de, de + 999);
    aps.push(...((data ?? []) as Ap[])); if ((data ?? []).length < 1000) break;
  }
  const docs = new Map<string, Doc>();
  for (const g of em([...new Set(aps.map((a) => a.nosso_numero))])) {
    const { data } = await sb.from("erp_documentos").select("id,nosso_numero,nosso_numero_corp,vigencia_fim,seguradora_id,ramo_id,situacao").eq("situacao", "vigente").in("nosso_numero_corp", g);
    for (const d of (data ?? []) as Doc[]) docs.set(String(d.nosso_numero_corp), d);
  }
  const comAnexo = new Set<string>();
  const idsDocs = [...docs.values()].map((d) => d.id);
  for (const g of em(idsDocs)) { const { data } = await sb.from("erp_documento_anexos").select("documento_id").in("documento_id", g); for (const x of data ?? []) comAnexo.add(x.documento_id); }
  const corpAnexo = new Set<string>();
  for (const g of em([...docs.keys()])) { const { data } = await sb.from("corp_anexos").select("nosso_numero").in("nosso_numero", g); for (const x of data ?? []) corpAnexo.add(String(x.nosso_numero)); }

  // um PDF por documento (o primeiro 'certo'), só documentos vigentes sem anexo no ERP nem no Corp
  const escolhido = new Map<string, Ap>();
  for (const a of aps) { const d = docs.get(a.nosso_numero); if (!d || comAnexo.has(d.id) || corpAnexo.has(a.nosso_numero) || escolhido.has(d.id)) continue; escolhido.set(d.id, a); }
  const lista = [...escolhido.entries()].map(([id, a]) => ({ a, d: [...docs.values()].find((x) => x.id === id)! }));
  const jan = (d: Doc) => !!d.vigencia_fim && d.vigencia_fim >= "2027-01-01" && d.vigencia_fim <= "2027-01-31";
  const alvo = (PRIORIDADE === "jan2027" ? lista.filter((x) => jan(x.d)) : lista).slice(0, LIMITE);
  const { data: segs } = await sb.from("erp_seguradoras").select("id,nome"); const { data: ramos } = await sb.from("erp_ramos").select("id,nome");
  const nSeg = new Map((segs ?? []).map((s) => [s.id, s.nome])); const nRamo = new Map((ramos ?? []).map((s) => [s.id, s.nome]));
  const porProduto: Record<string, number> = {};
  for (const x of alvo) { const k = `${nSeg.get(x.d.seguradora_id!) ?? "?"} / ${nRamo.get(x.d.ramo_id!) ?? "?"}`; porProduto[k] = (porProduto[k] ?? 0) + 1; }
  console.log(`${GRAVAR ? "GUARDANDO" : "ENSAIO"}: ${aps.length} apólices certas nas fontes ${[...FONTES].join("+")}; vigentes sem anexo (ERP e Corp): ${lista.length} (vencem em jan/2027: ${lista.filter((x) => jan(x.d)).length}); alvo desta rodada (${PRIORIDADE}): ${alvo.length}`);
  for (const [k, v] of Object.entries(porProduto).sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${k.padEnd(48)} ${v}`);
  if (!GRAVAR) return;

  const { drive } = cliente("GERAL");
  const r = { guardados: 0, naoBaixou: 0, erros: 0 };
  let feito = 0;
  for (const x of alvo) {
    try {
      let buf: Buffer | null = null;
      if (x.a.fonte === "drive") {
        const resp = await comRetry(() => drive.files.get({ fileId: x.a.arquivo_id, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" }));
        buf = Buffer.from((resp as { data: ArrayBuffer }).data);
      } else {
        const msgId = /^gmail:([^:]+):/.exec(x.a.arquivo_id)?.[1];
        if (msgId) { const pdfs = await comRetry(() => lerAnexosPdf("matheus@o2seguros.com.br", `gmail:x:${msgId}`)); buf = (pdfs.find((p) => p.nome === x.a.arquivo_nome) ?? pdfs[0])?.buffer ?? null; }
      }
      if (!buf || buf.subarray(0, 4).toString() !== "%PDF") { r.naoBaixou++; continue; }
      await comRetry(() => guardarAnexo(sb, { doc: { id: x.d.id }, pdf: buf!, nome: x.a.arquivo_nome ?? "apolice.pdf", messageId: x.a.arquivo_id, tipo: "apolice", origem: x.a.fonte === "drive" ? "drive" : "email", av: { situacao: "confirmada", cpf: true, num: true, vig: true }, extra: { fonte: "acervo " + x.a.fonte, regra: "apolice_documentos certa (nº + vigência + CPF/CNPJ)" } }));
      r.guardados++;
    } catch (e) { r.erros++; if (r.erros <= 5) console.log("erro:", (e as Error).message.slice(0, 90)); }
    if (++feito % 50 === 0) console.log(`  ${feito}/${alvo.length} | ${JSON.stringify(r)}`);
  }
  console.log(JSON.stringify(r));
})();
