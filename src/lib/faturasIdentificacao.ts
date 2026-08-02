import { textoCorresponde } from "@/lib/googleSheetsProspeccao";
import { apenasDigitos } from "@/lib/pdfComSenha";

export type ImobiliariaBasica = { id: string; nome: string; cnpj: string | null };

export type ResultadoIdentificacao = {
  imobiliaria_id: string | null;
  confianca: "alta" | "media" | "baixa" | null;
};

// A senha que abriu o PDF É o CNPJ da imobiliária — então achar quem tem
// esse CNPJ cadastrado é uma identificação de confiança alta (praticamente
// uma prova, não um palpite).
export function buscarImobiliariaPorCnpj(
  cnpjDigits: string,
  imobiliarias: ImobiliariaBasica[]
): ResultadoIdentificacao | null {
  const alvo = apenasDigitos(cnpjDigits);
  if (!alvo) return null;
  const encontrada = imobiliarias.find((i) => i.cnpj && apenasDigitos(i.cnpj) === alvo);
  return encontrada ? { imobiliaria_id: encontrada.id, confianca: "alta" } : null;
}

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
