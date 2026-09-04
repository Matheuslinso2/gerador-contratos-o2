import { textoCorresponde } from "@/lib/textoCorresponde";
import { apenasDigitos } from "@/lib/pdfComSenha";
import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type ImobiliariaBasica = { id: string; nome: string; cnpj: string | null };

// Lista única das seguradoras que o sistema reconhece de verdade — usada
// tanto pra normalizar o texto livre da IA quanto pras abas da tela
// principal e do formulário de edição, pra nunca ficarem fora de sincronia.
export const SEGURADORAS_CANONICAS = ["TOKIO", "PORTO FIANÇA", "PORTO RE", "TOO", "POTTENCIAL", "YELUM"];

// Cadastro único pra toda a plataforma -- `imobiliarias` é a mesma base
// usada por Faturas, Auditor de Contrato, Gerador de Contrato e Multa
// Rescisória (a antiga tabela separada `imobiliarias_conhecidas`, só de
// referência do CRM, foi incorporada aqui). Usado quando um CNPJ digitado
// à mão (cadastro manual pela tela de Faturas) ainda não tem registro --
// resolve pelo CNPJ se já existir, ou cria um novo "esqueleto" incompleto.
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

// Quando a imobiliária tem mais de 1 relação ativa com a MESMA seguradora
// (ex: Tokio via O2 Seguros e via SegImob, cada uma com vencimento
// próprio), não tem como saber pelo conteúdo do arquivo a qual das duas
// origens ele pertence -- precisa perguntar na Conferência. Retorna a
// lista de origens possíveis (vazio ou 1 item = não precisa perguntar).
export async function origensAtivasDaImobiliaria(
  supabase: SupabaseServerClient,
  imobiliariaId: string,
  seguradora: string
): Promise<string[]> {
  const { data } = await supabase
    .from("faturas_esperadas")
    .select("cnpj_o2")
    .eq("imobiliaria_id", imobiliariaId)
    .eq("seguradora", seguradora)
    .eq("ativo", true);
  const origens = Array.from(new Set((data ?? []).map((d) => d.cnpj_o2 ?? "").filter(Boolean)));
  return origens;
}

// IDs das imobiliárias que já têm vínculo ativo com essa seguradora
// (faturas_esperadas). Usado pra restringir a identificação por NOME/
// arquivo (a parte sujeita a ambiguidade -- duas empresas com nome
// parecido, ex: "Real Up" e "Real Imóveis") só a quem já é cliente
// conhecido dessa seguradora, em vez de comparar contra o cadastro
// inteiro (500+ imobiliárias de todas as seguradoras e módulos juntos).
// A identificação por CNPJ não usa esse filtro -- é exata, sem ambiguidade,
// e restringir por aqui impediria detectar sozinho quando uma imobiliária
// já cadastrada (por outra seguradora ou módulo) está tendo a primeira
// fatura dessa seguradora.
export async function idsImobiliariasComSeguradoraAtiva(
  supabase: SupabaseServerClient,
  seguradora: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from("faturas_esperadas")
    .select("imobiliaria_id")
    .eq("seguradora", seguradora)
    .eq("ativo", true)
    .not("imobiliaria_id", "is", null);
  return new Set((data ?? []).map((d) => d.imobiliaria_id as string));
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

const PREFIXOS_ARQUIVO_FATURA = /^(BOLETO|RELAT[ÓO]RIO|DEMONSTRATIVO)\s+/i;

// Fallback determinístico (não depende da IA acertar) pra quando nem CNPJ
// nem identificacao_texto do CONTEÚDO do documento bateram com nada -- é o
// caso real da TOKIO: o demonstrativo (CSV) não menciona a imobiliária em
// lugar nenhum do conteúdo, só o inquilino/segurado em cada linha. A O2
// salva esses arquivos já renomeados com o nome dela (ex: "RELATÓRIO NOME
// DA IMOBILIÁRIA.csv", às vezes com um "(1)" de redownload no final), então
// o nome do arquivo em si já é o sinal de identificação.
export function nomeCandidatoDoArquivo(nomeArquivo: string | null | undefined): string | null {
  if (!nomeArquivo) return null;
  const semExtensao = nomeArquivo.replace(/\.[a-z0-9]+$/i, "");
  const semDuplicata = semExtensao.replace(/\s*\(\d+\)\s*$/, "");
  const semPrefixo = semDuplicata.replace(PREFIXOS_ARQUIVO_FATURA, "").trim();
  return semPrefixo || null;
}
