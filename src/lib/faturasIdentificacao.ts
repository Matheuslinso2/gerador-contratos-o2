import { textoCorresponde } from "@/lib/googleSheetsProspeccao";
import { apenasDigitos } from "@/lib/pdfComSenha";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type ImobiliariaBasica = { id: string; nome: string; cnpj: string | null };

// Lista única das seguradoras que o sistema reconhece de verdade — usada
// tanto pra normalizar o texto livre da IA quanto pras abas da tela
// principal e do formulário de edição, pra nunca ficarem fora de sincronia.
export const SEGURADORAS_CANONICAS = ["TOKIO", "PORTO FIANÇA", "PORTO RE", "TOO", "POTTENCIAL", "YELUM"];

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
      cadastro_incompleto: true,
    })
    .select("id")
    .single();
  if (error || !nova) throw new Error(`Não foi possível registrar a imobiliária "${nome}": ${error?.message}`);
  return nova.id;
}

// Nomes exatos das abas/seguradoras usadas na planilha de controle — a IA
// lê o nome livre que aparece no PDF (ex: "Porto Seguro"), que quase nunca
// bate exatamente com isso. Sem normalizar, a fatura fica presa numa
// seguradora "fantasma" que nunca casa com faturas_esperadas (chegou a
// criar uma aba nova errada na tela, ao confirmar uma identificação
// incerta na Conferência). "Porto Seguro" sozinho vira PORTO FIANÇA por
// padrão (é o produto de longe mais comum das duas linhas da Porto) — se
// for PORTO RE, corrige manualmente depois pela tela.
export function normalizarSeguradora(nomeExtraido: string | null): string | null {
  if (!nomeExtraido) return null;
  const alvo = nomeExtraido
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  if (alvo.includes("tokio")) return "TOKIO";
  if (alvo.includes("pottencial") || alvo.includes("potencial")) return "POTTENCIAL";
  if (alvo.includes("yelum")) return "YELUM";
  if (alvo.includes("porto")) return alvo.includes(" re") || alvo.includes("resseguro") ? "PORTO RE" : "PORTO FIANÇA";
  if (/\btoo\b/.test(alvo)) return "TOO";

  return nomeExtraido; // desconhecida — mantém como veio, fica como "extra" pra conferência
}

export type ResultadoIdentificacao = {
  imobiliaria_id: string | null;
  confianca: "alta" | "media" | "baixa" | null;
};

// CNPJ é o sinal mais forte de identificação (depois do código de
// produtor já confirmado antes, tratado em faturas_esperadas) — usado
// quando a IA conseguiu ler um CNPJ de tomador no texto do documento.
export function buscarImobiliariaPorCnpjNoTexto(
  cnpjTexto: string | null,
  imobiliarias: ImobiliariaBasica[]
): ResultadoIdentificacao {
  const alvo = apenasDigitos(cnpjTexto ?? "");
  if (!alvo) return { imobiliaria_id: null, confianca: null };
  const encontrada = imobiliarias.find((i) => i.cnpj && apenasDigitos(i.cnpj) === alvo);
  return encontrada ? { imobiliaria_id: encontrada.id, confianca: "alta" } : { imobiliaria_id: null, confianca: null };
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
