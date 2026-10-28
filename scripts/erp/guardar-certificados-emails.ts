// Guarda como ANEXO do documento (bucket privado anexos-documentos + erp_documento_anexos, origem email) os certificados de Capitalização achados
// nas caixas da Natália e da Patrícia, SÓ com vínculo CONFIRMADO. Parte da lista de documentos confirmados (certificados-emails.json e
// certificados-emails-2.json, pasta temporária), refaz a busca do documento na caixa que o achou (só leitura do Gmail), confere o vínculo com a
// mesma regra (certificadoCap.ts) e guarda o PDF. Arquivo guardado uma vez por hash. Ensaio por padrão. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/guardar-certificados-emails.ts [--gravar]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { lerAnexosPdf, lerCaixa } from "@/lib/erp/emails";
import { guardarAnexo, textoDoPdf } from "@/lib/erp/anexosEmail";
import { carregarCapVigentes, ehCertificado, lerCertificado, ligarCertificado } from "./certificadoCap";

const GRAVAR = process.argv.includes("--gravar");
const sb = createServiceClient();
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function comRetry<T>(fn: () => Promise<T>): Promise<T> { for (let t = 0; ; t++) { try { return await fn(); } catch (e) { if (t >= 4) throw e; await pausa(2000 * (t + 1)); } } }
const dataGmail = (iso: string, d: number) => { const x = new Date(Date.parse(iso) - d * 864e5); return `${x.getUTCFullYear()}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${String(x.getUTCDate()).padStart(2, "0")}`; };
const pontuado = (n: string) => (n.length === 9 ? `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}-${n.slice(8)}` : null);
const fmtCpf = (c: string) => (c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c);

(async () => {
  const lista: { nosso_numero: number; situacao: string; caixa: string; arquivo: string }[] = [];
  for (const f of ["certificados-emails.json", "certificados-emails-2.json"]) {
    const p = path.join(os.tmpdir(), f);
    if (fs.existsSync(p)) lista.push(...JSON.parse(fs.readFileSync(p, "utf8")));
  }
  const confirmados = lista.filter((x) => x.situacao === "confirmada");
  console.log(`${GRAVAR ? "GUARDANDO" : "ENSAIO"}: ${confirmados.length} documentos com certificado confirmado nas caixas (de ${lista.length} achados)`);
  const ind = await carregarCapVigentes(sb);
  const porCodigo = new Map(ind.vigentes.map((d) => [d.nosso_numero, d]));
  const porSeg: Record<string, number> = {};
  const r = { guardados: 0, jaGuardados: 0, naoReachado: 0, erros: 0 };
  const jaTem = new Set<string>();
  for (let de = 0; ; de += 1000) {
    const { data } = await sb.from("erp_documento_anexos").select("documento_id").eq("tipo", "certificado").in("origem", ["email", "bitrix"]).order("id").range(de, de + 999);
    for (const x of data ?? []) jaTem.add(x.documento_id);
    if ((data ?? []).length < 1000) break;
  }
  let feito = 0;
  for (const x of confirmados) {
    const doc = porCodigo.get(x.nosso_numero);
    if (!doc) continue;
    if (jaTem.has(doc.id)) { r.jaGuardados++; continue; }
    const num = String(doc.numero_apolice).replace(/\D/g, "").replace(/^0+/, "");
    const termos = [`"${num}"`];
    const pt = pontuado(String(doc.numero_apolice).replace(/\D/g, "").padStart(9, "0"));
    if (pt) termos.push(`"${pt}"`);
    for (const c of (ind.docsCpf.get(doc.id)?.cpfs ?? []).slice(0, 3)) termos.push(`"${c}"`, `"${fmtCpf(c)}"`);
    try {
      let guardou = false;
      const { mensagens } = await comRetry(() => lerCaixa(x.caixa, `(${termos.join(" OR ")}) has:attachment filename:pdf after:${doc.vigencia_inicio ? dataGmail(doc.vigencia_inicio, 45) : "2024/01/01"}`, 8));
      for (const m of mensagens) {
        if (guardou) break;
        for (const a of await comRetry(() => lerAnexosPdf(x.caixa, m.message_id))) {
          const { t } = await textoDoPdf(a.buffer, []);
          if (!t || t.length < 40 || !ehCertificado(t)) continue;
          const c = lerCertificado(t);
          const l = ligarCertificado(ind, t.replace(/\s+/g, " "), c).find((y) => y.doc.id === doc.id && y.situacao === "confirmada");
          if (!l) continue;
          if (GRAVAR) await comRetry(() => guardarAnexo(sb, { doc: { id: doc.id }, pdf: a.buffer, nome: a.nome, messageId: m.message_id, tipo: "certificado", origem: "email", av: { situacao: "confirmada", cpf: l.porCpf, num: l.via === "numero", vig: l.porData }, extra: { fonte: "caixa " + x.caixa, inicio: c.inicio, meses: c.meses } }));
          const seg = ind.nomeSeguradora.get(doc.seguradora_id!) ?? "?";
          porSeg[seg] = (porSeg[seg] ?? 0) + 1;
          r.guardados++; guardou = true; break;
        }
      }
      if (!guardou) r.naoReachado++;
    } catch (e) { r.erros++; if (r.erros <= 5) console.log("erro:", (e as Error).message.slice(0, 90)); }
    if (++feito % 50 === 0) console.log(`  ${feito}/${confirmados.length} | ${JSON.stringify(r)}`);
  }
  console.log(JSON.stringify(r));
  console.log(`${GRAVAR ? "GUARDADOS" : "GUARDARIA"} por seguradora:`, JSON.stringify(porSeg));
})();
