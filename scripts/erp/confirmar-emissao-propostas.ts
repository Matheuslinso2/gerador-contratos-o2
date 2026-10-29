// Confirma a EMISSÃO das propostas que já têm o PDF da apólice (Matheus 29/10): "buscar a apólice, o arquivo, o nº da apólice e confirmar com o
// pré-cadastro as informações de segurado, inquilino, endereço, produto, seguradora e prêmio". Ensaio: mostra, por proposta, o nº da apólice e a
// vigência lidos no PDF e o resultado de cada conferência (✓ confere · ✗ diverge · ? não deu para conferir). NÃO promove nada sozinho:
// --promover grava nº da apólice + vigência e passa para vigente SÓ as propostas com TODAS as conferências ✓ (e depois do OK do Matheus).
// uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/confirmar-emissao-propostas.ts [--limite N] [--promover]
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
import { identificarSeguradora, lerApolice } from "../apolices/leitores";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const PROMOVER = process.argv.includes("--promover");
const LIMITE = Number(arg("limite") ?? 1e9);
const sb = createServiceClient();
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const dig = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
type R = "✓" | "✗" | "?";

const SEG_COD: Record<string, string[]> = { PORT: ["PORT"], PESS: ["PORT", "PESS"], POTT: ["POTT"], TOKI: ["TOKI"], YELU: ["YELU"], TOO: ["TOO"], ALLI: ["ALLI"], ALF: ["ALF", "ALFA"], ALFA: ["ALF", "ALFA"], BRAD: ["BRAD"], HDI: ["HDI"], ZURI: ["ZURI"], SUHA: ["SUHA"] };
const PRODUTO_TXT: Record<string, RegExp> = {
  fianca: /FIANCA LOCATICIA|FIANCA/, incendio: /INCENDIO|COMPREENSIVO|RESIDENCIAL|EMPRESARIAL|IMOBILIARIO|CONDOMINIO/, automovel: /AUTOMOVEL|VEICULO|AUTO /, condominio: /CONDOMINIO/,
};

function premiosDoTexto(t: string): number[] {
  const out: number[] = [];
  for (const l of t.split(/\r?\n/)) {
    if (!/PR[EÊ]MIO|PRE[CÇ]O/i.test(l)) continue;
    for (const m of l.matchAll(/(?<![\d.,])(\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/g)) out.push(Number(m[1].replace(/\./g, "").replace(",", ".")));
  }
  return out;
}
function numeroGenerico(t: string): string | null {
  const m = /AP[OÓ]LICE\s*(?:N[º°O.]*\s*)?[:\-]?\s*([0-9][0-9.\-/]{5,24})/i.exec(t);
  return m ? m[1] : null;
}
function vigenciaGenerica(t: string): { ini: string | null; fim: string | null } {
  const i = t.search(/VIG[EÊ]NCIA/i);
  const trecho = i >= 0 ? t.slice(i, i + 220) : t;
  const d = [...trecho.matchAll(/(\d{2})[/.](\d{2})[/.](\d{4})/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`);
  return { ini: d[0] ?? null, fim: d[1] ?? null };
}

(async () => {
  const { data: props } = await sb.from("erp_documentos")
    .select("id, nosso_numero, nosso_numero_corp, tipo_corp, premio_liquido, premio_total, vigencia_inicio, vigencia_fim, seguradora:erp_seguradoras(abreviacao), ramo:erp_ramos(produto), cliente:locatarios!erp_documentos_locatario_id_fkey(nome, cpf)")
    .eq("situacao", "proposta").neq("tipo", "F").is("numero_apolice", null).is("numero_endosso", null).limit(3000);
  const docs = (props ?? []) as unknown as { id: string; nosso_numero: number; nosso_numero_corp: number | null; tipo_corp: string | null; premio_liquido: number | null; premio_total: number | null; vigencia_inicio: string | null; vigencia_fim: string | null; seguradora: { abreviacao: string } | null; ramo: { produto: string } | null; cliente: { nome: string; cpf: string | null } | null }[];

  console.log(`${docs.length} propostas em Emissão (sem Nº da apólice) · ${PROMOVER ? "PROMOVENDO as 100% conferidas" : "ENSAIO"}\n`);
  let comPdf = 0, tudoOk = 0, promovidos = 0, n = 0;
  for (const d of docs) {
    if (n >= LIMITE) break;
    // PDF da apólice: anexo do ERP tipo apólice (e-mail/Drive) ou anexo do Corp marcado como apólice
    let pdf: { bucket: string; path: string } | null = null;
    const { data: ax } = await sb.from("erp_documento_anexos").select("storage_path").eq("documento_id", d.id).eq("tipo", "apolice").limit(1);
    if (ax?.[0]?.storage_path) pdf = { bucket: "anexos-documentos", path: ax[0].storage_path };
    if (!pdf && d.nosso_numero_corp) {
      const { data: ca } = await sb.from("corp_anexos").select("storage_path").eq("nosso_numero", d.nosso_numero_corp).eq("apolice", true).limit(1);
      if (ca?.[0]?.storage_path) pdf = { bucket: "corp-anexos", path: ca[0].storage_path };
    }
    if (!pdf) continue;
    const { data: blob } = await sb.storage.from(pdf.bucket).download(pdf.path);
    if (!blob) continue;
    const { t } = await textoDoPdf(Buffer.from(await blob.arrayBuffer()), d.cliente?.cpf ? [d.cliente.cpf] : []);
    if (!t) continue;
    comPdf++; n++;
    const T = sem(t);
    const lida = lerApolice(t);
    const numero = lida.numero ?? numeroGenerico(t);
    const vig = lida.vigencia_inicio && lida.vigencia_fim ? { ini: lida.vigencia_inicio, fim: lida.vigencia_fim } : vigenciaGenerica(t);

    // itens e partes do pré-cadastro
    const { data: itens } = await sb.from("erp_documento_itens").select("logradouro, numero, cep, partes:erp_item_partes(papel, nome, documento_numero)").eq("documento_id", d.id).limit(5);
    const partes = (itens ?? []).flatMap((i: { partes?: { papel: string; nome: string | null; documento_numero: string | null }[] }) => i.partes ?? []);

    const confere: Record<string, R> = {};
    // segurado = titular do documento (nome ou CPF no PDF)
    confere.segurado = !d.cliente?.nome ? "?" : (dig(d.cliente.cpf).length >= 11 && T.replace(/ /g, "").includes(dig(d.cliente.cpf))) || sem(d.cliente.nome).split(" ").filter((x) => x.length > 2).every((x) => T.includes(x)) ? "✓" : "✗";
    // inquilino = garantido/locatário (Fiança)
    const inq = partes.filter((p) => /locat|garant|inquil/i.test(p.papel));
    confere.inquilino = !inq.length ? "?" : inq.every((p) => (p.documento_numero && dig(t).includes(dig(p.documento_numero))) || (p.nome && sem(p.nome).split(" ").filter((x) => x.length > 2).slice(0, 3).every((x) => T.includes(x)))) ? "✓" : "✗";
    // endereço
    const it0 = (itens ?? [])[0] as { logradouro: string | null; numero: string | null; cep: string | null } | undefined;
    confere.endereco = !it0?.logradouro && !it0?.cep ? "?" : (it0?.cep && T.replace(/ /g, "").includes(dig(it0.cep))) || (it0?.logradouro && sem(it0.logradouro).split(" ").filter((x) => x.length > 3).slice(0, 2).every((x) => T.includes(x))) ? "✓" : "✗";
    // produto e seguradora
    const prod = d.ramo?.produto ?? "";
    confere.produto = !PRODUTO_TXT[prod] ? "?" : PRODUTO_TXT[prod].test(T) ? "✓" : "✗";
    const segPdf = identificarSeguradora(t);
    const segDoc = d.seguradora?.abreviacao ?? "";
    confere.seguradora = !segPdf || !segDoc ? "?" : (SEG_COD[segDoc] ?? [segDoc]).includes(segPdf) ? "✓" : "✗";
    // prêmio (líquido ou total, tolerância R$ 1,00)
    const pr = premiosDoTexto(t);
    const alvos = [d.premio_liquido, d.premio_total].filter((x): x is number => !!x && x > 0).map(Number);
    confere.premio = !pr.length || !alvos.length ? "?" : pr.some((v) => alvos.some((a) => Math.abs(v - a) <= 1)) ? "✓" : "✗";

    const todos = Object.values(confere);
    const ok = !!numero && !!vig.ini && !!vig.fim && todos.every((x) => x !== "✗") && todos.filter((x) => x === "✓").length >= 3;
    if (ok) tudoOk++;
    console.log(`${String(d.nosso_numero).padEnd(7)} ${String(d.tipo_corp ?? "").padEnd(4)} ${(d.seguradora?.abreviacao ?? "").padEnd(5)} ${prod.padEnd(10)} apólice ${numero ?? "—"} · vig ${vig.ini ?? "—"} a ${vig.fim ?? "—"} · ${Object.entries(confere).map(([k, v]) => `${k} ${v}`).join(" · ")}${ok ? "  ⇒ PODE PROMOVER" : ""}`);
    if (PROMOVER && ok) {
      const { error } = await sb.from("erp_documentos").update({ numero_apolice: numero, vigencia_inicio: vig.ini, vigencia_fim: vig.fim, situacao: "vigente" }).eq("id", d.id).eq("situacao", "proposta");
      if (error) console.log(`   erro: ${error.message}`); else promovidos++;
    }
  }
  console.log(`\n${comPdf} propostas com PDF de apólice lido · ${tudoOk} com tudo conferido (podem virar apólice)${PROMOVER ? ` · ${promovidos} promovidas` : " · (ensaio, nada gravado)"}`);
})();
