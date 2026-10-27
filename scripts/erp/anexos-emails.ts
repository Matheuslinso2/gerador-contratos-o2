// Anexos PDF dos e-mails (apólice, cotação, endosso...) -> bucket privado "anexos-documentos" + erp_documento_anexos,
// ligados ao documento do ERP (mostrado pelo Código O2 = nosso_numero). SÓ LEITURA do Gmail. uso:
//   npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/erp/anexos-emails.ts [--limite 40] [--gravar]
// Sem --gravar é ensaio: lê, confere e mostra o que ligaria, sem guardar arquivo nem escrever no banco.
// Só liga quando o PDF confirma o documento: CPF/CNPJ de uma parte do documento + (nº da apólice/proposta ou início da vigência)
// = 'confirmada'; só nº (≥ 6 dígitos) OU só CPF = 'provavel'. Sem nenhum dos dois, não liga (e conta como "sem vínculo").
process.loadEnvFile(".env.local");
import { createHash } from "node:crypto";
import { getDocumentProxy, extractText } from "unpdf";
import { createServiceClient } from "@/lib/supabase/service";
import { lerAnexosPdf } from "@/lib/erp/emails";
import { lerApolice } from "../apolices/leitores";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const GRAVAR = process.argv.includes("--gravar");
const LIMITE = Number(arg("limite") ?? 40);
const sb = createServiceClient();
const dig = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
const dmy = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : null);

const FORMATOS_SENHA: ((d: string) => string)[] = [(d) => d.slice(0, 4), (d) => d, (d) => d.slice(0, 5), (d) => d.slice(0, 6), (d) => d.slice(0, 8), (d) => d.slice(0, 3)];

async function texto(pdf: Buffer, docs: string[]): Promise<{ t: string | null; protegido: boolean }> {
  const tentar = async (senha?: string) => {
    const doc = await getDocumentProxy(new Uint8Array(pdf), senha ? { password: senha } : {});
    return (await extractText(doc, { mergePages: true })).text.trim();
  };
  try {
    return { t: await tentar(), protegido: false };
  } catch (e) {
    if (!/password/i.test((e as Error).name + (e as Error).message)) return { t: null, protegido: false };
  }
  for (const f of FORMATOS_SENHA) for (const d of docs) {
    try { return { t: await tentar(f(d)), protegido: true }; } catch (e) { if (!/password/i.test((e as Error).name + (e as Error).message)) return { t: null, protegido: true }; }
  }
  return { t: null, protegido: true };
}

type Doc = { id: string; nosso_numero: number | null; numero_apolice: string | null; numero_proposta: string | null; vigencia_inicio: string | null; cpfs: string[] };

async function carregarDocs(ids: string[]): Promise<Map<string, Doc>> {
  const mapa = new Map<string, Doc>();
  for (let i = 0; i < ids.length; i += 100) {
    const grupo = ids.slice(i, i + 100);
    const { data: docs } = await sb.from("erp_documentos").select("id,nosso_numero,numero_apolice,numero_proposta,vigencia_inicio,locatario_id").in("id", grupo);
    const { data: partes } = await sb.from("erp_doc_partes_acervo").select("documento_id,locatario:locatarios(cpf)").in("documento_id", grupo);
    const locIds = [...new Set((docs ?? []).map((d) => d.locatario_id).filter(Boolean))];
    const { data: locs } = locIds.length ? await sb.from("locatarios").select("id,cpf").in("id", locIds) : { data: [] };
    const cpfLoc = new Map((locs ?? []).map((l) => [l.id, dig(l.cpf)]));
    for (const d of docs ?? []) mapa.set(d.id, { id: d.id, nosso_numero: d.nosso_numero, numero_apolice: d.numero_apolice, numero_proposta: d.numero_proposta, vigencia_inicio: d.vigencia_inicio, cpfs: [cpfLoc.get(d.locatario_id)].filter((x): x is string => !!x) });
    for (const p of (partes ?? []) as unknown as { documento_id: string; locatario: { cpf: string | null } | null }[]) {
      const c = dig(p.locatario?.cpf);
      if (c) mapa.get(p.documento_id)?.cpfs.push(c);
    }
  }
  return mapa;
}

(async () => {
  // mensagens com anexo que já têm candidato a documento (nº da apólice no texto ou prova de emissão por nome/proposta)
  const { data: porDoc } = await sb.from("erp_emails").select("message_id,caixas,assunto,documento_id").eq("tem_anexo", true).not("documento_id", "is", null).order("data", { ascending: false }).limit(LIMITE * 3);
  const { data: porEv } = await sb.from("erp_emails_evidencia_emissao").select("message_id,documento_id");
  const evPorMsg = new Map<string, Set<string>>();
  for (const e of porEv ?? []) (evPorMsg.get(e.message_id) ?? evPorMsg.set(e.message_id, new Set()).get(e.message_id)!).add(e.documento_id);
  const msgs = new Map<string, { message_id: string; caixa: string; assunto: string; docs: Set<string> }>();
  for (const m of porDoc ?? []) msgs.set(m.message_id, { message_id: m.message_id, caixa: m.caixas[0], assunto: m.assunto, docs: new Set([m.documento_id]) });
  if (evPorMsg.size) {
    const ids = [...evPorMsg.keys()];
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await sb.from("erp_emails").select("message_id,caixas,assunto,tem_anexo").in("message_id", ids.slice(i, i + 100)).eq("tem_anexo", true);
      for (const m of data ?? []) {
        const ja = msgs.get(m.message_id);
        if (ja) evPorMsg.get(m.message_id)!.forEach((d) => ja.docs.add(d));
        else msgs.set(m.message_id, { message_id: m.message_id, caixa: m.caixas[0], assunto: m.assunto, docs: new Set(evPorMsg.get(m.message_id)) });
      }
    }
  }
  const lista = [...msgs.values()].slice(0, LIMITE);
  const docs = await carregarDocs([...new Set(lista.flatMap((m) => [...m.docs]))]);
  console.log(`${GRAVAR ? "GRAVANDO" : "ENSAIO"}: ${lista.length} mensagens com anexo e candidato a documento`);
  const r = { pdfs: 0, ligados: 0, confirmada: 0, provavel: 0, semVinculo: 0, protegidoNaoAbriu: 0, semTexto: 0, semPdf: 0, erros: 0 };
  const amostra: string[] = [];
  for (const m of lista) {
    try {
      const pdfs = await lerAnexosPdf(m.caixa, m.message_id);
      if (!pdfs.length) { r.semPdf++; continue; }
      const cands = [...m.docs].map((id) => docs.get(id)).filter((d): d is Doc => !!d);
      for (const p of pdfs) {
        r.pdfs++;
        const sha = createHash("sha256").update(p.buffer).digest("hex");
        const { t, protegido } = await texto(p.buffer, [...new Set(cands.flatMap((c) => c.cpfs))]);
        if (t === null) { r.protegidoNaoAbriu += protegido ? 1 : 0; r.semVinculo++; continue; }
        if (t.length < 50) { r.semTexto++; r.semVinculo++; continue; }
        const td = dig(t);
        const T = t.toUpperCase();
        const cab = T.slice(0, 3000);
        const tipo = /ENDOSSO/.test(T.slice(0, 600)) || /ENDOSSO/i.test(p.nome) ? "endosso" : /COTA[ÇC][ÃA]O/.test(cab) && !/AP[ÓO]LICE N/.test(T.slice(0, 6000)) ? "cotacao" : /N[ºO°] DA AP[ÓO]LICE|AP[ÓO]LICE N[ºO°]|BILHETE DE SEGURO|CONDI[ÇC][ÕO]ES PARTICULARES/.test(T.slice(0, 6000)) ? "apolice" : /PROPOSTA D[EO] SEGURO|N[ºO°] DA PROPOSTA|PROPOSTA N[ºO°]/.test(cab) ? "proposta" : /CERTIFICADO/.test(cab) ? "certificado" : "outro";
        let leitura: ReturnType<typeof lerApolice> | null = null;
        try { leitura = lerApolice(t); } catch { /* modelo desconhecido */ }
        let ligou = false;
        for (const c of cands) {
          const cpf = c.cpfs.some((x) => x.length >= 11 && td.includes(x));
          const num = [c.numero_apolice, c.numero_proposta].some((n) => dig(n).length >= 6 && td.includes(dig(n)));
          const vig = !!c.vigencia_inicio && t.includes(dmy(c.vigencia_inicio)!);
          const situacao = cpf && (num || vig) ? "confirmada" : num || cpf ? "provavel" : null;
          if (!situacao) continue;
          ligou = true;
          r.ligados++;
          r[situacao]++;
          if (amostra.length < 15) amostra.push(`${situacao.padEnd(10)} ${tipo.padEnd(8)} cod.O2 ${c.nosso_numero}  ${p.nome.slice(0, 40)}  [cpf:${cpf ? "s" : "n"} nº:${num ? "s" : "n"} vig:${vig ? "s" : "n"}]  ${m.assunto.slice(0, 50)}`);
          if (!GRAVAR) continue;
          const caminho = `${sha}.pdf`;
          const { error: eu } = await sb.storage.from("anexos-documentos").upload(caminho, p.buffer, { contentType: "application/pdf", upsert: false });
          if (eu && !/exist|duplicate/i.test(eu.message)) throw new Error(`upload: ${eu.message}`);
          const { error } = await sb.from("erp_documento_anexos").upsert(
            { documento_id: c.id, tipo, origem: "email", storage_path: caminho, nome_arquivo: p.nome, sha256: sha, message_id: m.message_id, tamanho: p.buffer.length, situacao,
              lido: { cpf_confere: cpf, numero_confere: num, vigencia_confere: vig, seguradora: leitura?.seguradora ?? null, numero_pdf: leitura?.numero ?? null, vigencia_inicio: leitura?.vigencia_inicio ?? null, vigencia_fim: leitura?.vigencia_fim ?? null } },
            { onConflict: "documento_id,sha256" }
          );
          if (error) throw new Error(`anexo: ${error.message}`);
        }
        if (!ligou) r.semVinculo++;
      }
    } catch (e) { r.erros++; console.log("erro:", (e as Error).message.slice(0, 120)); }
  }
  console.log(JSON.stringify(r));
  console.log(amostra.join("\n"));
})();
