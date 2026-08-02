import { textoCorresponde } from "@/lib/googleSheetsProspeccao";
import { apenasDigitos } from "@/lib/pdfComSenha";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type ImobiliariaBasica = { id: string; nome: string; cnpj: string | null };

// A senha do PDF é validada contra a base grande (imobiliarias_conhecidas,
// ~445 registros vindos do CRM/Produtores), não contra a tabela de contas
// com login — a maioria das imobiliárias reais ainda não tem conta aqui.
// Depois de identificar por lá, resolve (ou cria) o registro correspondente
// em `imobiliarias`, que é quem a fatura referencia de verdade (é lá que vai
// morar o e-mail de destino do envio, na Fase 2).
export async function resolverOuCriarImobiliaria(
  supabase: SupabaseServerClient,
  nome: string,
  cnpj: string
): Promise<string> {
  const cnpjDigits = apenasDigitos(cnpj);

  const { data: todas } = await supabase.from("imobiliarias").select("id, cnpj");
  const existente = todas?.find((i) => i.cnpj && apenasDigitos(i.cnpj) === cnpjDigits);
  if (existente) return existente.id;

  const { data: nova, error } = await supabase
    .from("imobiliarias")
    .insert({
      nome,
      cnpj: cnpjDigits,
      texto_base_contrato: "",
      indice_reajuste: "",
      percentual_multa_atraso: 0,
      percentual_juros_mora: 0,
      percentual_honorarios_advocaticios: 0,
      dia_vencimento_aluguel: 1,
    })
    .select("id")
    .single();
  if (error || !nova) throw new Error(`Não foi possível registrar a imobiliária "${nome}": ${error?.message}`);
  return nova.id;
}

export type ResultadoIdentificacao = {
  imobiliaria_id: string | null;
  confianca: "alta" | "media" | "baixa" | null;
};

// Usado só quando o arquivo foi aberto (senha certa) mas o CNPJ não bate
// com nenhuma imobiliária já cadastrada (ex: imobiliária nova) — tenta
// sugerir por razão social/nome fantasia extraídos do texto pela IA.
// Nunca confirma sozinho: confiança fica em "media" (um único palpite
// razoável) ou "baixa" (mais de uma correspondência possível).
export function sugerirImobiliariaPorTexto(
  identificacaoTexto: string | null,
  imobiliarias: ImobiliariaBasica[]
): ResultadoIdentificacao {
  if (!identificacaoTexto?.trim()) return { imobiliaria_id: null, confianca: null };

  const correspondencias = imobiliarias.filter((i) => textoCorresponde(i.nome, identificacaoTexto));
  if (correspondencias.length === 1) {
    return { imobiliaria_id: correspondencias[0].id, confianca: "media" };
  }
  if (correspondencias.length > 1) {
    return { imobiliaria_id: correspondencias[0].id, confianca: "baixa" };
  }
  return { imobiliaria_id: null, confianca: null };
}
