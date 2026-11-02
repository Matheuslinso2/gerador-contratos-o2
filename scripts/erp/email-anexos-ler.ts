// FASES 3 e 4 dos anexos de e-mail (erp_email_anexos):
//  (3) LER: extrai o texto NATIVO do PDF (OCR do Windows só nos escaneados, depois), classifica pelo CONTEÚDO (apólice, proposta, endosso, certificado, cotação, boleto, outro) e guarda campos
//      estruturados (seguradora, nºs, CPF/CNPJ, datas, prêmio) sem texto bruto. Cada PDF distinto (sha256) é lido uma vez e vale para todas as mensagens em que aparece.
//  (4) --ligar: liga ao documento do ERP SÓ pela evidência do conteúdo: nº da apólice/proposta + CPF/CNPJ de parte do documento (+ vigência) = confirmada (vira anexo do documento);
//      só nº ou só CPF = provável (não liga); resto = sugestão. O vínculo do e-mail com o documento NÃO conta como prova.
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/email-anexos-ler.ts [--limite N] [--paralelo 3]            (fase 3)
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/email-anexos-ler.ts --ligar [--gravar] [--limite N]       (fase 4; ensaio sem --gravar)
process.loadEnvFile(".env.local");
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createServiceClient } from "@/lib/supabase/service";
import { textoDoPdf } from "@/lib/erp/anexosEmail";
import { extrair, VERSAO_LEITOR_EMAIL } from "@/lib/erp/emailAnexoConteudo";

const arg = (n: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined);
const LIMITE = Number(arg("limite") ?? Infinity), PARALELO = Number(arg("paralelo") ?? 3);
const OCR = process.argv.includes("--ocr"), LIGAR = process.argv.includes("--ligar"), GRAVAR = process.argv.includes("--gravar");
const sb = createServiceClient();
const log = (m: string) => console.log(`${new Date().toLocaleTimeString("pt-BR")}  ${m}`);
const em = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "");

async function ler() {
  const shas: string[] = [];
  for (let de = 0; shas.length < LIMITE; de += 1000) {
    const { data, error } = await sb.from("erp_email_anexos").select("sha256").eq("classe", "nao_lido").order("sha256").range(de, de + 999); if (error) throw new Error(error.message);
    for (const r of data ?? []) if (!shas.includes(r.sha256)) shas.push(r.sha256);
    if (!data || data.length < 1000) break;
  }
  const alvo = [...new Set(shas)].slice(0, LIMITE);
  log(`FASE 3: ${alvo.length} PDFs distintos a ler (paralelo ${PARALELO})`);
  const cont: Record<string, number> = {}; let i = 0, feitos = 0;
  const trabalhar = async (sha: string) => {
    const { data: blob } = await sb.storage.from("anexos-documentos").download(`${sha}.pdf`);
    let upd: Record<string, unknown>;
    if (!blob) upd = { classe: "outro", classe_fonte: "nenhuma", texto_status: "erro", lido_em: new Date().toISOString(), versao_leitor: VERSAO_LEITOR_EMAIL };
    else {
      const r = await textoDoPdf(Buffer.from(await blob.arrayBuffer()), []);
      if (r.t === null) upd = { classe: "outro", classe_fonte: "nenhuma", texto_status: r.protegido ? "protegido" : "erro" };
      else if (r.t.trim().length < 80) upd = { classe: "outro", classe_fonte: "nenhuma", texto_status: "ocr_pendente" };
      else { const c = extrair(r.t); upd = { classe: c.classe, classe_fonte: "conteudo", texto_status: "lido", seguradora: c.seguradora, numeros: c.numeros, cpf_cnpj: c.cpf_cnpj, datas: c.datas, campos: { numero_apolice: c.numero_apolice, numero_proposta: c.numero_proposta, premio_total: c.premio_total, premio_liquido: c.premio_liquido } }; }
      upd = { ...upd, lido_em: new Date().toISOString(), versao_leitor: VERSAO_LEITOR_EMAIL };
    }
    const { error } = await sb.from("erp_email_anexos").update(upd).eq("sha256", sha).eq("classe", "nao_lido"); if (error) throw new Error(error.message);
    const k = `${upd.texto_status}/${upd.classe}`; cont[k] = (cont[k] ?? 0) + 1;
    if (++feitos % 100 === 0) log(`  ${feitos}/${alvo.length} ${JSON.stringify(cont)}`);
  };
  await Promise.all(Array.from({ length: PARALELO }, async () => { while (i < alvo.length) { try { await trabalhar(alvo[i++]); } catch (e) { cont.erro = (cont.erro ?? 0) + 1; console.log("erro:", (e as Error).message.slice(0, 100)); } } }));
  log(`fim da fase 3: ${JSON.stringify(cont)}`);
}

/** PDFs escaneados (texto_status ocr_pendente): OCR LOCAL e GRATUITO do Windows (scripts/erp/ocr-pdf-win.ps1), sem IA. Lido por OCR = ocr_lido (números podem ter dígito errado: só confirma com CPF + vigência). */
async function ocr() {
  const shas: string[] = [];
  for (let de = 0; shas.length < LIMITE; de += 1000) {
    const { data, error } = await sb.from("erp_email_anexos").select("sha256").eq("texto_status", "ocr_pendente").order("sha256").range(de, de + 999); if (error) throw new Error(error.message);
    for (const r of data ?? []) if (!shas.includes(r.sha256)) shas.push(r.sha256);
    if (!data || data.length < 1000) break;
  }
  const alvo = shas.slice(0, LIMITE); log(`OCR: ${alvo.length} PDFs escaneados`);
  const dir = path.join(os.tmpdir(), "o2-email-ocr"); fs.mkdirSync(dir, { recursive: true });
  const cont: Record<string, number> = {};
  for (const grupo of em(alvo, 30)) {
    const lista: string[] = [];
    for (const sha of grupo) { const { data: blob } = await sb.storage.from("anexos-documentos").download(`${sha}.pdf`); if (!blob) continue; const f = path.join(dir, `${sha}.pdf`); fs.writeFileSync(f, Buffer.from(await blob.arrayBuffer())); lista.push(f); }
    const arqLista = path.join(dir, "lista.txt"), saida = path.join(dir, "ocr.jsonl"); fs.writeFileSync(arqLista, lista.join("\n")); if (fs.existsSync(saida)) fs.unlinkSync(saida);
    spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(process.cwd(), "scripts", "erp", "ocr-pdf-win.ps1"), "-Lista", arqLista, "-Saida", saida, "-MaxPaginas", "4"], { stdio: "ignore" });
    const textos = new Map<string, string>();
    if (fs.existsSync(saida)) for (const l of fs.readFileSync(saida, "utf8").split("\n")) { if (!l.trim()) continue; const j = JSON.parse(l) as { arq: string; paginas?: { texto: string }[] }; const m = /([0-9a-f]{64})\.pdf/.exec(j.arq); if (m && j.paginas) textos.set(m[1], j.paginas.map((x) => x.texto).join(" ")); }
    for (const sha of grupo) {
      const t = textos.get(sha); let upd: Record<string, unknown>;
      if (!t || t.trim().length < 80) upd = { texto_status: "sem_texto" };
      else { const c = extrair(t); upd = { classe: c.classe, classe_fonte: "conteudo", texto_status: "ocr_lido", seguradora: c.seguradora, numeros: c.numeros, cpf_cnpj: c.cpf_cnpj, datas: c.datas, campos: { numero_apolice: c.numero_apolice, numero_proposta: c.numero_proposta, premio_total: c.premio_total, premio_liquido: c.premio_liquido, lido_por: "ocr_windows" } }; }
      await sb.from("erp_email_anexos").update({ ...upd, lido_em: new Date().toISOString(), versao_leitor: VERSAO_LEITOR_EMAIL }).eq("sha256", sha).eq("texto_status", "ocr_pendente");
      const k = String(upd.texto_status) + "/" + String(upd.classe ?? "-"); cont[k] = (cont[k] ?? 0) + 1;
    }
    for (const f of lista) fs.unlinkSync(f); // só os PDFs temporários desta pasta própria
    log(`  ${Object.values(cont).reduce((a, b) => a + b, 0)}/${alvo.length} ${JSON.stringify(cont)}`);
  }
}

const TIPO: Record<string, string> = { apolice: "apolice", proposta: "proposta", endosso: "endosso", certificado: "certificado", cotacao: "cotacao" };

async function ligar() {
  const rows: any[] = [];
  for (let de = 0; rows.length < LIMITE; de += 1000) {
    const { data, error } = await sb.from("erp_email_anexos").select("id,message_id,nome,bytes,sha256,classe,seguradora,numeros,cpf_cnpj,datas,campos,storage_path").in("texto_status", ["lido", "ocr_lido"]).in("classe", Object.keys(TIPO)).is("ligacao", null).order("id").range(de, de + 999);
    if (error) throw new Error(error.message); rows.push(...(data ?? [])); if (!data || data.length < 1000) break;
  }
  const alvo = rows.slice(0, LIMITE);
  log(`FASE 4 (${GRAVAR ? "gravando" : "ensaio"}): ${alvo.length} anexos lidos a ligar pelo conteúdo`);
  const porSha = new Map<string, any[]>(); for (const r of alvo) (porSha.get(r.sha256) ?? porSha.set(r.sha256, []).get(r.sha256)!).push(r);
  const cont: Record<string, number> = {}; const c = (k: string) => (cont[k] = (cont[k] ?? 0) + 1);
  const cacheCpf = new Map<string, Set<string>>();
  const cpfsDoDoc = async (d: { id: string; locatario_id: string | null }) => {
    if (cacheCpf.has(d.id)) return cacheCpf.get(d.id)!;
    const s = new Set<string>();
    if (d.locatario_id) { const { data } = await sb.from("locatarios").select("cpf").eq("id", d.locatario_id).maybeSingle(); if (data?.cpf) s.add(dig(data.cpf)); }
    const { data: pa } = await sb.from("erp_doc_partes_acervo").select("locatario:locatarios(cpf)").eq("documento_id", d.id);
    for (const p of (pa ?? []) as unknown as { locatario: { cpf: string | null } | null }[]) if (p.locatario?.cpf) s.add(dig(p.locatario.cpf));
    cacheCpf.set(d.id, s); return s;
  };
  for (const [sha, linhas] of porSha) {
    const r0 = linhas[0]; const nums: string[] = [...new Set([...(r0.campos?.numero_apolice ?? []), ...(r0.campos?.numero_proposta ?? []), ...(r0.numeros ?? [])])].slice(0, 80);
    let cands: any[] = []; if (nums.length) { const { data } = await sb.rpc("erp_docs_por_numeros", { nums }); cands = data ?? []; }
    const rot = new Set<string>([...(r0.campos?.numero_apolice ?? []), ...(r0.campos?.numero_proposta ?? [])]);
    const avaliados: { doc: any; nivel: "confirmada" | "provavel" | "sugestao"; ev: Record<string, unknown>; score: number }[] = [];
    for (const d of cands) {
      const nApol = dig(d.numero_apolice).replace(/^0+/, ""), nProp = dig(d.numero_proposta).replace(/^0+/, "");
      const numForte = (nApol.length >= 5 && rot.has(nApol)) || (nProp.length >= 5 && rot.has(nProp));
      const vigOk = !!d.vigencia_inicio && (r0.datas ?? []).includes(d.vigencia_inicio);
      // número "solto" (não rotulado como apólice/proposta) sem vigência batendo é coincidência (telefone, código...): descarta sem nem buscar CPF
      if (!numForte && !vigOk) continue;
      const cpfs = await cpfsDoDoc(d); const cpfOk = (r0.cpf_cnpj ?? []).some((x: string) => cpfs.has(x));
      const segConflita = !!r0.seguradora && !!d.seguradora && r0.seguradora !== d.seguradora && !(r0.seguradora === "ALF" && /ALF/.test(d.seguradora));
      let nivel: "confirmada" | "provavel" | "sugestao" = "sugestao";
      if (!segConflita && cpfOk && (numForte || vigOk)) nivel = "confirmada"; else if (!segConflita && (numForte || cpfOk)) nivel = "provavel";
      avaliados.push({ doc: d, nivel, score: (numForte ? 4 : 1) + (cpfOk ? 3 : 0) + (vigOk ? 2 : 0), ev: { numero_forte: numForte, cpf: cpfOk, vigencia: vigOk, seguradora_confere: !segConflita, achado_em: d.achado_em, nosso_numero_corp: d.nosso_numero_corp } });
    }
    avaliados.sort((a, b) => b.score - a.score);
    const conf = avaliados.filter((a) => a.nivel === "confirmada");
    let decisao: { ligacao: string; documento_id: string | null; ev: Record<string, unknown> };
    if (conf.length === 1 || (conf.length > 1 && conf[0].score > conf[1].score)) decisao = { ligacao: "confirmada", documento_id: conf[0].doc.id, ev: conf[0].ev };
    else if (conf.length > 1) decisao = { ligacao: "provavel", documento_id: null, ev: { motivo: "mais de um documento com a mesma evidência", candidatos: conf.slice(0, 5).map((x) => x.doc.nosso_numero_corp) } };
    else if (avaliados.some((a) => a.nivel === "provavel")) { const p = avaliados.find((a) => a.nivel === "provavel")!; decisao = { ligacao: "provavel", documento_id: null, ev: { ...p.ev, candidato: p.doc.nosso_numero_corp } }; }
    else decisao = { ligacao: avaliados.length ? "sugestao" : "nenhuma", documento_id: null, ev: avaliados.length ? { candidato: avaliados[0].doc.nosso_numero_corp, ...avaliados[0].ev } : {} };
    for (const _ of linhas) c(decisao.ligacao);
    if (!GRAVAR && process.argv.includes("--detalhe")) { const e = decisao.ev as { numero_forte?: boolean; cpf?: boolean; vigencia?: boolean; seguradora_confere?: boolean }; c(`ev[${cands.length ? `n${e.numero_forte ? "+" : "-"} cpf${e.cpf ? "+" : "-"} vig${e.vigencia ? "+" : "-"} seg${e.seguradora_confere ? "+" : "-"}` : "sem_candidato"}] ${decisao.ligacao}`); }
    if (!GRAVAR) continue;
    for (const l of linhas) {
      await sb.from("erp_email_anexos").update({ ligacao: decisao.ligacao, documento_id: decisao.documento_id, ligacao_evidencia: decisao.ev }).eq("id", l.id);
      if (decisao.documento_id) {
        const { error } = await sb.from("erp_documento_anexos").upsert({ documento_id: decisao.documento_id, tipo: TIPO[l.classe], origem: "email", storage_path: l.storage_path, nome_arquivo: l.nome, sha256: l.sha256, message_id: l.message_id, tamanho: l.bytes, situacao: "confirmada", lido: { ...decisao.ev, fonte: "email_anexo_conteudo" } }, { onConflict: "documento_id,sha256" });
        if (error) console.log("anexo:", error.message);
      }
    }
  }
  log(`fim da fase 4: ${JSON.stringify(cont)}`);
}

(OCR ? ocr() : LIGAR ? ligar() : ler()).catch((e) => { console.error("ERRO:", e.message ?? e); process.exit(1); });
