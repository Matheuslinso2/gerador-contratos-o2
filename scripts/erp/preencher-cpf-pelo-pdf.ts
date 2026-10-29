// Preenche o CPF/CNPJ de cliente que não tem (ou tem inválido) lendo o PDF da apólice/proposta dele (Matheus 29/10: "se teve apólice
// vigente ou ainda tem, dá para pegar os dados dentro do PDF"). Regra de segurança (não inventa dado): só grava quando, no texto do PDF,
// UM único CPF/CNPJ com dígitos verificadores válidos aparece colado ao NOME do cliente (janela de 220 caracteres) e não pertence a outro
// cliente (CPF é único): duplicado só é listado para decidir a mescla. Ensaio por padrão.
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/preencher-cpf-pelo-pdf.ts [--limite N] [--so-vigentes] [--gravar]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf } from "@/lib/erp/anexosEmail";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const SO_VIGENTES = process.argv.includes("--so-vigentes");
const LIMITE = Number(arg("limite") ?? 1e9);
const sb = createServiceClient();

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
function cpfValido(d: string) {
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const n of [9, 10]) { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); if (((s * 10) % 11) % 10 !== Number(d[n])) return false; }
  return true;
}
function cnpjValido(d: string) {
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (n: number) => { const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * pesos[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}
/** CPF/CNPJ válidos que aparecem perto do nome do cliente no texto. */
function documentosPertoDoNome(texto: string, nome: string): string[] {
  const T = semAcento(texto), N = semAcento(nome);
  const pedacos = N.split(" ").filter((x) => x.length > 2);
  if (pedacos.length < 2) return [];
  const chaves = [N, pedacos.slice(0, 3).join(" "), `${pedacos[0]} ${pedacos[pedacos.length - 1]}`];
  const achados = new Set<string>();
  for (const chave of chaves) {
    let i = T.indexOf(chave);
    while (i >= 0) {
      const janela = texto.length === T.length ? texto.slice(Math.max(0, i - 40), i + chave.length + 220) : T.slice(Math.max(0, i - 40), i + chave.length + 220);
      for (const m of janela.matchAll(/(?<!\d)(\d{3}[ .\-]?\d{3}[ .\-]?\d{3}[ .\-]?\d{2}|\d{2}[ .\-]?\d{3}[ .\-]?\d{3}[ /\-]?\d{4}[ .\-]?\d{2})(?!\d)/g)) {
        const d = m[1].replace(/\D/g, "");
        if (cpfValido(d) || cnpjValido(d)) achados.add(d);
      }
      i = T.indexOf(chave, i + chave.length);
    }
    if (achados.size) break;
  }
  return [...achados];
}

(async () => {
  // clientes sem CPF/CNPJ válido
  const alvos: { id: string; nome: string; cpf: string | null }[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await sb.from("locatarios").select("id, nome, cpf").order("id").range(de, de + 999);
    for (const l of (data ?? []) as { id: string; nome: string; cpf: string | null }[]) { const n = (l.cpf ?? "").replace(/\D/g, "").length; if (n !== 11 && n !== 14) alvos.push(l); }
    if (!data || data.length < 1000) break;
  }
  console.log(`${alvos.length} clientes sem CPF/CNPJ válido (${GRAVAR ? "GRAVANDO" : "ENSAIO"}${SO_VIGENTES ? ", só com apólice vigente" : ""})`);
  let achou = 0, semPdf = 0, semNome = 0, ambiguo = 0, duplicado = 0, feito = 0, lidos = 0;
  const detalhes: string[] = [];
  for (const c of alvos) {
    if (lidos >= LIMITE) break;
    let q = sb.from("erp_documentos").select("id, nosso_numero_corp, situacao").eq("locatario_id", c.id).order("vigencia_fim", { ascending: false }).limit(4);
    if (SO_VIGENTES) q = q.eq("situacao", "vigente");
    const { data: docs } = await q;
    const pdfs: { bucket: string; path: string }[] = [];
    for (const d of docs ?? []) {
      const { data: ax } = await sb.from("erp_documento_anexos").select("storage_path").eq("documento_id", d.id).limit(2);
      for (const a of ax ?? []) if (a.storage_path) pdfs.push({ bucket: "anexos-documentos", path: a.storage_path });
      if (d.nosso_numero_corp) {
        const { data: ca } = await sb.from("corp_anexos").select("storage_path, nome").eq("nosso_numero", d.nosso_numero_corp).limit(6);
        for (const x of (ca ?? []).filter((y) => /\.pdf$/i.test(y.nome ?? ""))) if (x.storage_path) pdfs.push({ bucket: "corp-anexos", path: x.storage_path });
      }
    }
    if (!pdfs.length) { semPdf++; continue; }
    lidos++;
    const candidatos = new Set<string>();
    for (const pdf of pdfs.slice(0, 4)) {
      const { data: blob } = await sb.storage.from(pdf.bucket).download(pdf.path);
      if (!blob) continue;
      const { t } = await textoDoPdf(Buffer.from(await blob.arrayBuffer()), []);
      if (t) for (const d of documentosPertoDoNome(t, c.nome)) candidatos.add(d);
      if (candidatos.size) break;
    }
    if (candidatos.size === 0) { semNome++; continue; }
    if (candidatos.size > 1) { ambiguo++; detalhes.push(`AMBÍGUO ${c.nome}: ${[...candidatos].join(", ")}`); continue; }
    const doc = [...candidatos][0];
    achou++;
    const { data: outro } = await sb.from("locatarios").select("id, nome").eq("cpf", doc).neq("id", c.id).maybeSingle();
    if (outro) { duplicado++; detalhes.push(`DUPLICADO ${c.nome} (${doc}) já é o cliente "${outro.nome}" — decidir mescla`); continue; }
    detalhes.push(`OK ${c.nome} → ${doc.length === 11 ? "CPF" : "CNPJ"} ${doc}`);
    if (GRAVAR) {
      const { error } = await sb.from("locatarios").update({ cpf: doc, tipo_documento: doc.length === 11 ? "cpf" : "cnpj", identificacao: "documento" }).eq("id", c.id);
      if (error) detalhes.push(`  erro: ${error.message}`); else feito++;
    }
  }
  console.log(detalhes.slice(0, 60).join("\n"));
  console.log(`\nclientes com PDF lido: ${lidos} | CPF/CNPJ certo encontrado: ${achou} | sem nome no PDF: ${semNome} | ambíguos: ${ambiguo} | duplicados: ${duplicado} | sem PDF: ${semPdf}${GRAVAR ? ` | gravados: ${feito}` : " | (ensaio, nada gravado)"}`);
})();
