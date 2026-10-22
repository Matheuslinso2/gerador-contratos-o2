import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnexoEmail } from "@/lib/email";

// Anexos das fichas públicas (Seguro Auto, Celular, Condomínio): o navegador
// sobe o arquivo direto pro Storage e a ficha guarda só o caminho. Aqui o
// servidor baixa o arquivo UMA vez e ele serve pros dois destinos -- campo de
// arquivo do card no Bitrix e anexo do e-mail de aviso. Antes cada ficha tinha
// a sua cópia desta rotina e uma falha de download era engolida (console.error
// e o card saía sem arquivo, sem ninguém saber) -- mesmo problema do Seguro
// Incêndio, corrigido em 22/10/2026.

export type AnexoBaixado = {
  /** Como o arquivo é chamado na ficha ("CNH", "Nota fiscal"...). */
  rotulo: string;
  /** Nome com extensão, usado no e-mail. */
  nome: string;
  /** Nome para o Bitrix (mesmo formato que já funcionava: [nome, base64]). */
  paraBitrix: [string, string];
  conteudo: Buffer;
  tipo: string;
};

export type AnexoFalha = { rotulo: string; motivo: string };

const TIPO_POR_EXTENSAO: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

// undefined = a ficha não trouxe esse arquivo (nada a fazer).
export async function baixarAnexoFormulario(
  supabase: SupabaseClient,
  bucket: string,
  caminho: string,
  rotulo: string,
  nomeBase: string
): Promise<{ anexo: AnexoBaixado } | { falha: AnexoFalha } | undefined> {
  if (!caminho) return undefined;
  const { data, error } = await supabase.storage.from(bucket).download(caminho);
  if (error || !data) {
    return { falha: { rotulo, motivo: `não consegui baixar do Storage (${caminho}): ${error?.message ?? "arquivo vazio"}` } };
  }
  const conteudo = Buffer.from(await data.arrayBuffer());
  const extensao = (caminho.split(".").pop() || "bin").toLowerCase();
  const nome = `${nomeBase}.${extensao}`;
  return {
    anexo: { rotulo, nome, paraBitrix: [nome, conteudo.toString("base64")], conteudo, tipo: TIPO_POR_EXTENSAO[extensao] ?? "application/octet-stream" },
  };
}

export type ResultadoAnexos = { anexos: AnexoBaixado[]; falhas: AnexoFalha[] };

export function separarResultados(resultados: Array<{ anexo: AnexoBaixado } | { falha: AnexoFalha } | undefined>): ResultadoAnexos {
  const anexos: AnexoBaixado[] = [];
  const falhas: AnexoFalha[] = [];
  for (const r of resultados) {
    if (!r) continue;
    if ("anexo" in r) anexos.push(r.anexo);
    else falhas.push(r.falha);
  }
  return { anexos, falhas };
}

export const anexosParaEmail = (anexos: AnexoBaixado[] | undefined): AnexoEmail[] | undefined =>
  anexos?.length ? anexos.map((a) => ({ nome: a.nome, conteudo: a.conteudo, tipo: a.tipo })) : undefined;

// Texto pro campo "erro" do log de auditoria (vazio = tudo certo).
export const resumoFalhasAnexo = (falhas: AnexoFalha[] | undefined): string | undefined =>
  falhas?.length ? `Anexo não entrou no card: ${falhas.map((f) => `${f.rotulo} — ${f.motivo}`).join("; ")}` : undefined;
