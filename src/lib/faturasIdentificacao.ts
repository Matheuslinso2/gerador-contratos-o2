import { textoCorresponde } from "@/lib/googleSheetsProspeccao";

export type ImobiliariaBasica = { id: string; nome: string; cnpj: string | null };

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
