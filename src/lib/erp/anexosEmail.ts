import "server-only";

import { createHash } from "node:crypto";
import { getDocumentProxy, extractText } from "unpdf";
import type { SupabaseClient } from "@supabase/supabase-js";

// ERP O2 — anexos PDF de e-mail ligados ao documento (27/10/2026). Regra única para todos os modos de carga:
// o PDF só é ligado quando confirma o documento. CPF/CNPJ de uma parte do documento + (nº da apólice/proposta OU início
// da vigência) = 'confirmada'; só o nº (≥ 6 dígitos) OU só o CPF = 'provavel'. Arquivo guardado uma vez só (hash) em
// anexos-documentos; o vínculo vai em erp_documento_anexos. Nada é escrito em erp_documentos.

export type DocAlvo = { id: string; nosso_numero: number | null; numero_apolice: string | null; numero_proposta: string | null; vigencia_inicio: string | null; cpfs: string[] };

export const dig = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");
const dmy = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : null);

const FORMATOS_SENHA: ((d: string) => string)[] = [(d) => d.slice(0, 4), (d) => d, (d) => d.slice(0, 5), (d) => d.slice(0, 6), (d) => d.slice(0, 8), (d) => d.slice(0, 3)];

/** Texto do PDF; se estiver protegido tenta como senha o começo/inteiro do CPF/CNPJ das partes (Porto: 4 primeiros). */
export async function textoDoPdf(pdf: Buffer, cpfsParaSenha: string[], formatos: ((d: string) => string)[] = FORMATOS_SENHA): Promise<{ t: string | null; protegido: boolean }> {
  const tentar = async (senha?: string) => {
    const doc = await getDocumentProxy(new Uint8Array(pdf), senha ? { password: senha } : {});
    return (await extractText(doc, { mergePages: true })).text.trim();
  };
  try {
    return { t: await tentar(), protegido: false };
  } catch (e) {
    if (!/password/i.test((e as Error).name + (e as Error).message)) return { t: null, protegido: false };
  }
  for (const f of formatos) for (const d of cpfsParaSenha) {
    try { return { t: await tentar(f(d)), protegido: true }; } catch (e) { if (!/password/i.test((e as Error).name + (e as Error).message)) return { t: null, protegido: true }; }
  }
  return { t: null, protegido: true };
}

export function tipoDoPdf(t: string, nomeArquivo: string): "apolice" | "endosso" | "cotacao" | "proposta" | "certificado" | "outro" {
  const T = t.toUpperCase();
  const cab = T.slice(0, 3000);
  if (/ENDOSSO/.test(T.slice(0, 600)) || /ENDOSSO/i.test(nomeArquivo)) return "endosso";
  if (/COTA[ÇC][ÃA]O/.test(cab) && !/AP[ÓO]LICE N/.test(T.slice(0, 6000))) return "cotacao";
  if (/N[ºO°] DA AP[ÓO]LICE|AP[ÓO]LICE N[ºO°]|BILHETE DE SEGURO|CONDI[ÇC][ÕO]ES PARTICULARES/.test(T.slice(0, 6000))) return "apolice";
  if (/PROPOSTA D[EO] SEGURO|N[ºO°] DA PROPOSTA|PROPOSTA N[ºO°]/.test(cab)) return "proposta";
  if (/CERTIFICADO/.test(cab)) return "certificado";
  return "outro";
}

export async function carregarDocs(sb: SupabaseClient, ids: string[]): Promise<Map<string, DocAlvo>> {
  const mapa = new Map<string, DocAlvo>();
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

/** CPFs/CNPJs que aparecem no texto (com ou sem pontuação). */
export const documentosNoTexto = (t: string): Set<string> =>
  new Set([...t.matchAll(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)].map((m) => dig(m[0])));

export type Avaliacao = { situacao: "confirmada" | "provavel"; cpf: boolean; num: boolean; vig: boolean };

export function avaliar(t: string, c: DocAlvo, soConfirmada = false): Avaliacao | null {
  const td = dig(t);
  const cpf = c.cpfs.some((x) => x.length >= 11 && td.includes(x));
  const num = [c.numero_apolice, c.numero_proposta].some((n) => dig(n).length >= 6 && td.includes(dig(n)));
  const vig = !!c.vigencia_inicio && t.includes(dmy(c.vigencia_inicio)!);
  if (cpf && (num || vig)) return { situacao: "confirmada", cpf, num, vig };
  if (!soConfirmada && (num || cpf)) return { situacao: "provavel", cpf, num, vig };
  return null;
}

export async function guardarAnexo(
  sb: SupabaseClient,
  o: { doc: Pick<DocAlvo, "id">; pdf: Buffer; nome: string; messageId: string; tipo: string; av: Avaliacao; extra?: Record<string, unknown>; origem?: "email" | "bitrix" }
): Promise<void> {
  const sha = createHash("sha256").update(o.pdf).digest("hex");
  const caminho = `${sha}.pdf`;
  const { error: eu } = await sb.storage.from("anexos-documentos").upload(caminho, o.pdf, { contentType: "application/pdf", upsert: false });
  if (eu && !/exist|duplicate/i.test(eu.message)) throw new Error(`upload: ${eu.message}`);
  const { error } = await sb.from("erp_documento_anexos").upsert(
    {
      documento_id: o.doc.id, tipo: o.tipo, origem: o.origem ?? "email", storage_path: caminho, nome_arquivo: o.nome, sha256: sha, message_id: o.messageId,
      tamanho: o.pdf.length, situacao: o.av.situacao,
      lido: { cpf_confere: o.av.cpf, numero_confere: o.av.num, vigencia_confere: o.av.vig, ...(o.extra ?? {}) },
    },
    { onConflict: "documento_id,sha256" }
  );
  if (error) throw new Error(`anexo: ${error.message}`);
}
