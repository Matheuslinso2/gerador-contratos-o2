// Propostas pendentes de emissão que JÁ TÊM o PDF da apólice anexado no Corp (corp_anexos: apolice=true ou nome com "apólice") mas continuam sem nº de apólice no ERP.
// Lê o nº do TEXTO nativo do PDF (sem IA, sem custo; PDF imagem = "sem texto"), confere com o nome do titular/partes e a vigência do documento e, com número + nome batendo
// (e sem outro documento da mesma seguradora com o mesmo nº), grava numero_apolice (fonte pdf_corp_anexo, nível 1) — a proposta então sai da Emissão pela regra existente.
// Sem prova = fica pendente com o motivo registrado em erp_proposta_acompanhamento.detalhes. Ensaio por padrão; --gravar grava.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/propostas-apolice-do-pdf.ts [--gravar] [--todos]   (--todos: qualquer pendente com anexo, não só os que têm "apólice" no nome)
process.loadEnvFile(".env.local");
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
import { normNome } from "@/lib/erp/tarefaCadastro";

const GRAVAR = process.argv.includes("--gravar");
const TODOS = process.argv.includes("--todos");
const sb = createServiceClient();
const dig = (s: string) => s.replace(/\D/g, "");
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const em = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Candidatos a nº da apólice no texto: "Apólice nº X", "Nº da Apólice: X", "Apólice: X", "Certificado nº X"... (só números/letras com ≥ 5 caracteres úteis). */
function candidatos(t: string): string[] {
  const achados = new Set<string>();
  const re = /(?:n[ºo°.]?\s*d[ao]\s*)?(?:ap[oó]lice|certificado|bilhete)(?:\s+(?:individual|digital|de seguro))?\s*(?:n[ºo°.]{0,2}|:)?\s*[:#-]?\s*([0-9][0-9.\-\/ ]{4,28}[0-9])/gi;
  for (const m of t.matchAll(re)) {
    const v = m[1].replace(/\s+/g, "").replace(/[.\-\/]+$/g, "");
    if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(v)) continue; // data, não nº de apólice
    if (dig(v).length >= 5 && dig(v).length <= 20) achados.add(v);
  }
  return [...achados];
}

(async () => {
  const pend = await (async () => { const out: any[] = []; for (let de = 0; ; de += 1000) { const { data, error } = await sb.from("erp_emissao_fila_pronta").select("id,nosso_numero,nosso_numero_corp,seguradora,cliente,vigencia_inicio").order("id").range(de, de + 999); if (error) throw new Error(error.message); out.push(...(data ?? [])); if (!data || data.length < 1000) break; } return out; })();
  const alvo: any[] = [];
  for (const g of em(pend.filter((p) => p.nosso_numero_corp), 100)) {
    const { data } = await sb.from("corp_anexos").select("nosso_numero,ordem,nome,apolice,storage_path,mime,rotulo_id").in("nosso_numero", g.map((p) => String(p.nosso_numero_corp)));
    for (const p of g) {
      const ax = (data ?? []).filter((a) => a.nosso_numero === String(p.nosso_numero_corp) && /pdf/i.test(`${a.mime ?? ""} ${a.nome ?? ""}`) && (TODOS || a.apolice || /ap[oó]lice/i.test(a.nome ?? "")));
      if (ax.length) alvo.push({ ...p, anexos: ax });
    }
  }
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${pend.length} pendentes; ${alvo.length} com PDF de apólice anexado no Corp`);
  const res = { semTexto: 0, semNumero: 0, forte: 0, provavel: 0, duplicado: 0 }; const saida: any[] = []; const rel: any[] = [];
  const { data: docsAll } = await sb.from("erp_documentos").select("id,locatario_id,seguradora_id,vigencia_inicio,numero_apolice").in("id", alvo.map((a) => a.id));
  const docPor = new Map((docsAll ?? []).map((d) => [d.id, d]));
  const locIds = [...new Set((docsAll ?? []).map((d) => d.locatario_id).filter(Boolean))] as string[];
  const locNome = new Map<string, string>();
  for (const g of em(locIds, 200)) { const { data } = await sb.from("locatarios").select("id,nome").in("id", g); for (const l of data ?? []) locNome.set(l.id, l.nome); }

  for (const a of alvo) {
    const d = docPor.get(a.id);
    // nomes do documento: cliente + partes dos itens
    const nomes = new Set<string>(); const add = (n: unknown) => { const k = normNome(String(n ?? "")); if (k.split(" ").length >= 2) nomes.add(k); };
    add(a.cliente); add(locNome.get(d?.locatario_id));
    const { data: its } = await sb.from("erp_documento_itens").select("id").eq("documento_id", a.id);
    if (its?.length) { const { data: ps } = await sb.from("erp_item_partes").select("nome").in("item_id", its.map((i) => i.id)); for (const p of ps ?? []) add(p.nome); }
    // também o nome do arquivo costuma trazer o segurado: "APOLICE PAULA RABELO LIMA DOS SANTOS.P.pdf"
    let texto = ""; let temTexto = false; let arqUsado = "";
    for (const x of a.anexos) {
      const { data: blob } = await sb.storage.from("corp-anexos").download(x.storage_path);
      if (!blob) continue;
      const { t } = await textoDoPdf(Buffer.from(await blob.arrayBuffer()), []);
      if (t && t.trim().length > 80) { texto = t; temTexto = true; arqUsado = x.nome ?? ""; break; }
    }
    if (!temTexto) { res.semTexto++; rel.push({ nn: a.nosso_numero, seg: a.seguradora, situacao: "sem texto (PDF imagem?)" }); saida.push({ id: a.id, tipo: "sem_texto", arq: a.anexos[0]?.nome }); continue; }
    const cand = candidatos(texto);
    if (!cand.length) { res.semNumero++; rel.push({ nn: a.nosso_numero, seg: a.seguradora, situacao: "texto lido, nº da apólice não encontrado" }); saida.push({ id: a.id, tipo: "sem_numero", arq: arqUsado }); continue; }
    const tn = normNome(texto);
    const nomeBate = [...nomes].some((n) => tn.includes(n));
    const vig = d?.vigencia_inicio ? new Date(d.vigencia_inicio) : null;
    const datas = [...texto.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`);
    const vigBate = !!vig && datas.some((x) => Math.abs(Date.parse(x) - vig.getTime()) <= 5 * 864e5);
    // o mais provável: o primeiro candidato (o rótulo "Apólice" aparece antes de endossos/proposta)
    const numero = cand[0];
    const { data: dup } = await sb.from("erp_documentos").select("id").eq("seguradora_id", d?.seguradora_id ?? "").neq("id", a.id).like("numero_apolice", `%${dig(numero).replace(/^0+/, "")}`).limit(2);
    const forte = nomeBate && cand.length <= 2 && !(dup?.length);
    if (dup?.length) { res.duplicado++; rel.push({ nn: a.nosso_numero, seg: a.seguradora, situacao: "nº já existe em outro documento da seguradora", numero }); saida.push({ id: a.id, tipo: "duplicado", numero, arq: arqUsado, existente: dup[0].id, varios: dup.length > 1 }); continue; }
    if (forte) { res.forte++; saida.push({ id: a.id, tipo: "forte", numero, vigBate, arq: arqUsado, nn: a.nosso_numero, seg: a.seguradora }); rel.push({ nn: a.nosso_numero, seg: a.seguradora, situacao: `FORTE (nome${vigBate ? " + vigência" : ""} batem)`, numero: numero.slice(0, 4) + "…" }); }
    else { res.provavel++; saida.push({ id: a.id, tipo: "provavel", numero, vigBate, nomeBate, candidatos: cand, arq: arqUsado }); rel.push({ nn: a.nosso_numero, seg: a.seguradora, situacao: `provável (${nomeBate ? "nome ok" : "nome não confere"}${cand.length > 2 ? `, ${cand.length} candidatos` : ""})`, numero: numero.slice(0, 4) + "…" }); }
  }
  // o mesmo nº lido em mais de uma proposta da mesma seguradora (ex.: itens do mesmo lote): não grava, vira provável
  const cont = new Map<string, number>();
  for (const s of saida) if (s.tipo === "forte") cont.set(`${s.seg}|${dig(s.numero)}`, (cont.get(`${s.seg}|${dig(s.numero)}`) ?? 0) + 1);
  for (const s of saida) if (s.tipo === "forte" && (cont.get(`${s.seg}|${dig(s.numero)}`) ?? 0) > 1) { s.tipo = "provavel"; res.forte--; res.provavel++; }
  console.log(`resultado: forte ${res.forte} | provável ${res.provavel} | nº duplicado ${res.duplicado} | sem nº no texto ${res.semNumero} | sem texto ${res.semTexto}`);
  for (const r of rel.slice(0, 30)) console.log(`  ${r.nn} ${r.seg ?? ""} ${r.situacao}${r.numero ? " " + r.numero : ""}`);
  if (!GRAVAR) return;
  let gravados = 0;
  for (const s of saida) {
    if (s.tipo === "forte") {
      const { error } = await sb.from("erp_documentos").update({ numero_apolice: s.numero.replace(/\s+/g, "") }).eq("id", s.id).is("numero_apolice", null);
      if (error) { console.log(`falhou ${s.nn}: ${error.message}`); continue; }
      gravados++;
    }
    // registro do que foi visto, sem texto bruto
    await sb.from("erp_proposta_acompanhamento").upsert({ documento_id: s.id, motivo: s.tipo === "forte" ? "emitida_pela_seguradora" : "sem_informacao", evidencia_tipo: "corp_anexo", evidencia_ref: s.arq ?? null, evidencia_resumo: s.tipo === "forte" ? "Nº da apólice lido do PDF do Corp (nome confere): gravado" : `PDF de apólice no Corp: ${s.tipo}`, data_evidencia: new Date().toISOString(), confianca: s.tipo === "forte" ? "forte" : "provavel", detalhes: { resultado: s.tipo, vigencia_bate: s.vigBate ?? null, numero_candidato: s.tipo === "provavel" || s.tipo === "duplicado" ? s.numero : null, documento_existente_id: s.existente ?? null }, fonte: "pdf_corp_anexo", nivel: s.tipo === "forte" ? 1 : 8, lote: `PDF-APOLICE-${new Date().toISOString().slice(0, 10)}` }, { onConflict: "documento_id" });
  }
  console.log(`numero_apolice gravado em ${gravados} documentos`);
})();
