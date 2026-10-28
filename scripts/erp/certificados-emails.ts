// Certificados de Capitalização VIGENTES nas caixas da Natália (titular do produto) e da Patrícia (supervisora). SÓ LEITURA do Gmail e do banco;
// ensaio: nada é guardado nem gravado (PDFs só em memória). Em vez de varrer as caixas, busca o número de garantia de cada documento vigente
// (o Gmail indexa nome e texto do PDF) e só baixa o anexo quando acha. Ligação (certificadoCap.ts): número + início de vigência ou CPF/CNPJ =
// 'confirmada'; só o número = 'provavel'. Vigência = início + modo de reaplicação (12/15/30 meses) lido no certificado. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/certificados-emails.ts [--caixas natalia@o2seguros.com.br,patricia@o2seguros.com.br] [--limite-docs 5000]
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/lib/supabase/service";
import { CAIXAS_O2, lerAnexosPdf, lerCaixa } from "@/lib/erp/emails";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
import { carregarCapVigentes, ehCertificado, lerCertificado, ligarCertificado } from "./certificadoCap";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const caixas = (arg("caixas")?.split(",") ?? ["natalia@o2seguros.com.br", "patricia@o2seguros.com.br"]).filter((c) => CAIXAS_O2.includes(c));
const LIMITE = Number(arg("limite-docs") ?? 5000);
const ANT = arg("anteriores-csv"); // CSV dos documentos anteriores (vencidos) a procurar; Código O2 na 3ª coluna
const SAIDA = path.join(os.tmpdir(), ANT ? "certificados-emails-anteriores.json" : process.argv.includes("--restante") ? "certificados-emails-2.json" : "certificados-emails.json");
const sb = createServiceClient();
const dataGmail = (iso: string, diasAntes: number) => { const d = new Date(Date.parse(iso) - diasAntes * 864e5); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`; };

(async () => {
  const codigos = ANT ? fs.readFileSync(ANT, "utf8").split("\n").slice(1).map((l) => Number(l.split(";")[2]?.replace(/"/g, ""))).filter(Boolean) : undefined;
  const ind = await carregarCapVigentes(sb, true, codigos);
  const porSeg: Record<string, number> = {};
  for (const d of ind.vigentes) { const k = ind.nomeSeguradora.get(d.seguradora_id!) ?? "?"; porSeg[k] = (porSeg[k] ?? 0) + 1; }
  console.log(`Capitalização vigente no ERP: ${ind.vigentes.length} | ${JSON.stringify(porSeg)}`);
  const achados = new Map<string, { nosso_numero: number; situacao: string; caixa: string; mensagem: string; arquivo: string; inicio: string | null; meses: number | null; fim_calculado: string | null; fim_erp: string | null; fim_confere: boolean | null }>();
  const r = { buscas: 0, mensagensAchadas: 0, pdfs: 0, certificadosLidos: 0, erros: 0 };
  // --restante: só o que as passadas anteriores (e-mail e Bitrix) não acharam; busca o número nos dois formatos (puro e com pontos,
  // como a Icatu escreve "01.609.754-9") e também o CPF/CNPJ das partes do documento; liga por número ou por CPF + início de vigência.
  const RESTANTE = process.argv.includes("--restante") || !!ANT;
  const jaAchados = new Set<number>();
  if (RESTANTE && !ANT) for (const f of ["certificados-bitrix.json", "certificados-emails.json"]) { const p = path.join(os.tmpdir(), f); if (fs.existsSync(p)) for (const x of JSON.parse(fs.readFileSync(p, "utf8"))) jaAchados.add(x.nosso_numero); }
  const alvos = ind.vigentes.filter((d) => (RESTANTE ? !jaAchados.has(d.nosso_numero) : String(d.numero_apolice ?? "").replace(/\D/g, "").length >= 4)).slice(0, LIMITE);
  if (RESTANTE) console.log(`passada restante: ${alvos.length} documentos sem certificado nas passadas anteriores`);
  const pontuado = (n: string) => (n.length === 9 ? `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5, 8)}-${n.slice(8)}` : null);
  const fmtCpf = (c: string) => (c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : c);
  for (const caixa of caixas) {
    let feitos = 0;
    for (const d of alvos) {
      if (achados.get(d.id)?.situacao === "confirmada") continue; // já comprovado (na caixa anterior)
      const num = String(d.numero_apolice).replace(/\D/g, "").replace(/^0+/, "");
      const apos = d.vigencia_inicio ? dataGmail(d.vigencia_inicio, 45) : "2024/01/01";
      const termos = [`"${num}"`];
      if (RESTANTE) {
        const pt = pontuado(String(d.numero_apolice).replace(/\D/g, "").padStart(9, "0"));
        if (pt) termos.push(`"${pt}"`);
        for (const c of (ind.docsCpf.get(d.id)?.cpfs ?? []).slice(0, 3)) termos.push(`"${c}"`, `"${fmtCpf(c)}"`);
      }
      try {
        r.buscas++;
        const { mensagens } = await lerCaixa(caixa, `(${termos.join(" OR ")}) has:attachment filename:pdf after:${apos}`, 8);
        r.mensagensAchadas += mensagens.length;
        for (const m of mensagens) {
          const pdfs = await lerAnexosPdf(caixa, m.message_id);
          for (const a of pdfs) {
            r.pdfs++;
            const { t } = await textoDoPdf(a.buffer, []);
            if (!t || t.length < 40 || !ehCertificado(t)) continue;
            r.certificadosLidos++;
            const c = lerCertificado(t);
            for (const l of ligarCertificado(ind, t.replace(/\s+/g, " "), c)) {
              if (!RESTANTE && l.doc.id !== d.id) continue; // só o documento procurado nesta busca (na passada restante vale qualquer vigente)
              const antes = achados.get(l.doc.id);
              if (!antes || (antes.situacao === "provavel" && l.situacao === "confirmada"))
                achados.set(l.doc.id, { nosso_numero: l.doc.nosso_numero, situacao: l.situacao, caixa, mensagem: m.message_id, arquivo: a.nome, inicio: c.inicio, meses: c.meses, fim_calculado: c.fim, fim_erp: l.doc.vigencia_fim, fim_confere: l.fimConfere });
            }
          }
        }
      } catch (e) { r.erros++; if (r.erros <= 5) console.log(`erro ${caixa} ${num}: ${(e as Error).message.slice(0, 70)}`); }
      if (++feitos % 100 === 0) console.log(`  ${caixa}: ${feitos}/${alvos.length} números buscados, ${achados.size} documentos ligados (${[...achados.values()].filter((x) => x.situacao === "confirmada").length} confirmados)`);
    }
    console.log(`${caixa}: busca concluída, ${achados.size} documentos vigentes ligados até aqui`);
  }
  const lista = [...achados.values()];
  const conf = lista.filter((x) => x.situacao === "confirmada").length;
  const comFim = lista.filter((x) => x.fim_confere !== null);
  const modos: Record<string, number> = {};
  for (const x of lista) modos[String(x.meses ?? "?")] = (modos[String(x.meses ?? "?")] ?? 0) + 1;
  const quadro: Record<string, { vigentes: number; confirmada: number; provavel: number; sem: number }> = {};
  for (const d of ind.vigentes) { const k = ind.nomeSeguradora.get(d.seguradora_id!) ?? "?"; const q = (quadro[k] ??= { vigentes: 0, confirmada: 0, provavel: 0, sem: 0 }); q.vigentes++; const a = achados.get(d.id); if (!a) q.sem++; else if (a.situacao === "confirmada") q.confirmada++; else q.provavel++; }
  fs.writeFileSync(SAIDA, JSON.stringify(lista, null, 1));
  console.log(JSON.stringify(r));
  console.log(`LIGADOS: confirmada ${conf} | provável ${lista.length - conf} | sem certificado achado ${ind.vigentes.length - lista.length} de ${ind.vigentes.length} vigentes`);
  console.log("POR SEGURADORA:", JSON.stringify(quadro));
  console.log(`MODO DE REAPLICAÇÃO (meses): ${JSON.stringify(modos)} | fim calculado (início + meses) = fim do ERP em ${comFim.filter((x) => x.fim_confere).length} de ${comFim.length}`);
  console.log("arquivo:", SAIDA);
})();
