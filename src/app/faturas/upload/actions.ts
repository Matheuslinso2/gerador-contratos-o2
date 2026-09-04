"use server";

import { redirect } from "next/navigation";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { abrirTextoPdfComSenha, candidatosSenhaO2 } from "@/lib/pdfComSenha";
import { extrairTextoPlanilha, extrairTextoCsv, ehArquivoPlanilha, ehArquivoCsv } from "@/lib/planilhaFatura";
import { extrairDadosFatura } from "@/lib/faturasIA";
import {
  buscarImobiliariaPorCnpjNoTexto,
  sugerirImobiliariaPorTexto,
  resolverOuCriarImobiliaria,
  origensAtivasDaImobiliaria,
  nomeCandidatoDoArquivo,
  SEGURADORAS_CANONICAS,
  type ImobiliariaBasica,
} from "@/lib/faturasIdentificacao";

const BUCKET_TEMP = "faturas-temp";

// maxDuration da página é 60s (ver page.tsx) -- corta a chamada à IA um
// pouco antes disso, com folga pro catch abaixo ainda rodar e devolver um
// resultado tratado pro arquivo, em vez de deixar a Vercel matar a função
// "na marra" (sem passar por try/catch nenhum). Mesmo padrão já usado em
// auditar-contrato/actions.ts pro mesmo tipo de problema (lá com IA
// analisando um contrato inteiro, aqui só o texto já extraído de 1
// boleto/fatura -- risco bem menor, mas não zero).
const LIMITE_TEMPO_IA_MS = 50_000;

function comLimiteDeTempo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`A identificação demorou mais que ${Math.round(ms / 1000)}s.`)), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer)) as Promise<T>;
}
const BUCKET_FINAL = "faturas";

// Status que ainda representam uma fatura "viva" pra fins de checar
// duplicidade de conteúdo -- uma fatura já duplicada ou cancelada não
// conta como a "original" pra comparar contra.
const STATUS_ATIVOS = ["aguardando_identificacao", "aguardando_conferencia", "fatura_carregada", "pronta_para_envio", "enviada"];

export type ResultadoProcessamento = {
  ok: boolean;
  nomeArquivo: string;
  mensagem: string;
  status?: string;
};

// O upload do PDF em si acontece direto do navegador pro bucket temporário
// (ver UploadFaturaForm.tsx) — mesmo motivo do Auditor de Contrato: o corpo
// de uma Server Action na Vercel tem teto de ~4,5 MB. Essa action só recebe
// o caminho do arquivo.
//
// Não usa redirect() em caso de sucesso/erro de arquivo individual — devolve
// um resultado, porque o formulário chama essa action várias vezes em
// sequência (um upload em lote), e um redirect no meio do lote interromperia
// os arquivos seguintes.
export async function processarFaturaUpload(formData: FormData): Promise<ResultadoProcessamento> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const competencia = String(formData.get("competencia") ?? "").trim();
  const seguradora = String(formData.get("seguradora") ?? "").trim();
  const path = String(formData.get("arquivo_path") ?? "").trim();
  const nomeArquivo = String(formData.get("arquivo_nome") ?? "").trim();

  if (!competencia || !path) {
    return { ok: false, nomeArquivo, mensagem: "Faltou a competência ou o arquivo." };
  }
  // A seguradora agora é escolhida pelo usuário antes do lote inteiro (não
  // mais adivinhada pela IA a partir do conteúdo do documento) -- alguns
  // demonstrativos (ex: relatório CSV da Pottencial) nunca mencionam o nome
  // da seguradora em lugar nenhum do texto, o que tornava a extração por IA
  // impossível pra esses casos e deixava a fatura sem seguradora pra sempre.
  if (!SEGURADORAS_CANONICAS.includes(seguradora)) {
    return { ok: false, nomeArquivo, mensagem: "Faltou selecionar a seguradora desse lote." };
  }

  const { data: baixado, error: erroDownload } = await supabase.storage.from(BUCKET_TEMP).download(path);
  if (erroDownload || !baixado) {
    return { ok: false, nomeArquivo, mensagem: "Não foi possível recuperar o arquivo enviado." };
  }
  const buffer = Buffer.from(await baixado.arrayBuffer());
  void supabase.storage.from(BUCKET_TEMP).remove([path]);

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const { data: duplicata } = await supabase
    .from("faturas")
    .select("id")
    .eq("arquivo_hash", hash)
    .maybeSingle();

  // Algumas seguradoras (Pottencial) mandam o demonstrativo em planilha ou
  // CSV em vez de PDF -- não tem senha, então pula direto pra leitura.
  const ehPlanilha = ehArquivoPlanilha(nomeArquivo);
  const ehCsv = ehArquivoCsv(nomeArquivo);
  const extensao = ehCsv ? "csv" : ehPlanilha ? (nomeArquivo.toLowerCase().endsWith(".xlsx") ? "xlsx" : "xls") : "pdf";
  const contentType = ehCsv
    ? "text/csv"
    : ehPlanilha
      ? extensao === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/vnd.ms-excel"
      : "application/pdf";

  let texto: string | null = null;
  let senhaPdf: string | null = null;
  if (ehPlanilha) {
    try {
      texto = ehCsv ? extrairTextoCsv(buffer) : extrairTextoPlanilha(buffer);
    } catch (e) {
      console.error("[faturas] erro ao ler planilha:", e);
    }
  } else {
    // A senha (quando o PDF tem uma, ex: Porto) é sempre derivada do CNPJ da
    // própria O2 — não identifica a imobiliária. Só destrava a leitura do
    // conteúdo, que é de onde vem a identificação de verdade. Guarda qual
    // senha exatamente abriu (chaveCorreta) pra poder avisar no e-mail de
    // envio -- sem isso a imobiliária recebe o PDF e não consegue abrir.
    const resultado = await abrirTextoPdfComSenha(buffer, candidatosSenhaO2());
    texto = resultado?.texto ?? null;
    senhaPdf = resultado?.chaveCorreta ?? null;
  }

  const pathFinal = `${competencia}/${crypto.randomUUID()}.${extensao}`;
  const { error: erroUpload } = await supabase.storage
    .from(BUCKET_FINAL)
    .upload(pathFinal, buffer, { contentType });
  if (erroUpload) {
    return { ok: false, nomeArquivo, mensagem: `Falha ao salvar o arquivo: ${erroUpload.message}` };
  }

  const historico = [{ usuario: user.email, data: new Date().toISOString(), acao: "upload", detalhe: nomeArquivo }];

  if (!texto) {
    // PDF nunca abriu com os CNPJs da O2 (ou a planilha veio corrompida) —
    // fica pra conferência manual investigar.
    const { error } = await supabase.from("faturas").insert({
      competencia,
      arquivo_bucket_path: pathFinal,
      arquivo_nome: nomeArquivo,
      arquivo_hash: hash,
      status: duplicata ? "duplicada" : "aguardando_conferencia",
      possivel_duplicidade_de: duplicata?.id ?? null,
      confianca: null,
      historico_identificacao: historico,
      criado_por: user.id,
      criado_por_email: user.email,
    });
    if (error) return { ok: false, nomeArquivo, mensagem: error.message };
    return {
      ok: true,
      nomeArquivo,
      status: duplicata ? "duplicada" : "aguardando_conferencia",
      mensagem: ehPlanilha
        ? "Não conseguimos ler essa planilha — precisa de conferência manual."
        : "Não conseguimos abrir esse PDF — precisa de conferência manual.",
    };
  }

  let dadosIA = null;
  try {
    dadosIA = await comLimiteDeTempo(
      extrairDadosFatura(texto, { seguradora, nomeArquivo }),
      LIMITE_TEMPO_IA_MS
    );
  } catch (e) {
    // dadosIA fica null (seja por erro da IA ou por estourar o prazo) --
    // o fluxo abaixo já trata isso como "não identificado" e manda pra
    // conferência manual, em vez de falhar o upload inteiro.
    console.error("[faturas] erro ao extrair dados por IA:", e);
  }

  // Fonte da verdade é o que o usuário escolheu no upload, não mais o que a
  // IA leu do documento (dadosIA?.seguradora fica sem uso pra esse campo).
  const seguradoraNormalizada = seguradora;
  const tipoDocumento = dadosIA?.tipo_documento ?? null;

  const { data: conhecidasData } = await supabase.from("imobiliarias_conhecidas").select("id, nome, cnpj");
  const conhecidas = (conhecidasData ?? []) as ImobiliariaBasica[];

  // Prioridade: CNPJ lido no documento (mais confiável) > nome/razão social.
  let resultadoIdent = buscarImobiliariaPorCnpjNoTexto(dadosIA?.cnpj_tomador ?? null, conhecidas);
  if (!resultadoIdent.imobiliaria_id && dadosIA?.identificacao_texto) {
    resultadoIdent = sugerirImobiliariaPorTexto(dadosIA.identificacao_texto, conhecidas);
  }
  // Último recurso: nem CNPJ nem texto do CONTEÚDO bateram -- tenta o nome
  // do arquivo (a O2 costuma salvar já renomeado com o nome da imobiliária,
  // sinal que existe independente do que a IA conseguiu ler do documento).
  if (!resultadoIdent.imobiliaria_id) {
    const candidatoArquivo = nomeCandidatoDoArquivo(nomeArquivo);
    if (candidatoArquivo) resultadoIdent = sugerirImobiliariaPorTexto(candidatoArquivo, conhecidas);
  }

  const conhecidaEscolhida = resultadoIdent.imobiliaria_id
    ? conhecidas.find((c) => c.id === resultadoIdent.imobiliaria_id)
    : null;
  const nomeIdentificado = conhecidaEscolhida?.nome ?? null;

  let imobiliariaId: string | null = null;
  if (conhecidaEscolhida?.cnpj) {
    try {
      imobiliariaId = await resolverOuCriarImobiliaria(supabase, conhecidaEscolhida.nome, conhecidaEscolhida.cnpj);
    } catch (e) {
      console.error("[faturas] erro ao resolver/criar imobiliária:", e);
    }
  }

  // Se a imobiliária tem mais de 1 relação ativa com essa seguradora (ex:
  // Tokio via O2 Seguros e via SegImob, cada uma com vencimento próprio),
  // não tem como saber pelo conteúdo do arquivo a qual origem ele pertence
  // -- precisa perguntar na Conferência antes de decidir status/duplicidade.
  let origensPossiveis: string[] = [];
  if (imobiliariaId && seguradoraNormalizada) {
    origensPossiveis = await origensAtivasDaImobiliaria(supabase, imobiliariaId, seguradoraNormalizada);
  }
  const precisaEscolherOrigem = origensPossiveis.length > 1;

  // Duplicidade também por conteúdo, não só por arquivo idêntico -- pega o
  // caso de reemissão/redownload do mesmo boleto (bytes diferentes, mesma
  // imobiliária+seguradora+competência já com uma fatura viva carregada).
  // Sempre filtrado também por tipo_documento: boleto e demonstrativo da
  // mesma competência são um PAR legítimo (ex: Pottencial/Too/Tokio), não
  // uma duplicata um do outro. Pulado quando ainda não se sabe a origem --
  // a comparação certa só é possível depois que a origem for escolhida.
  let duplicataConteudo: { id: string } | null = null;
  if (!duplicata && imobiliariaId && seguradoraNormalizada && !precisaEscolherOrigem) {
    let consulta = supabase
      .from("faturas")
      .select("id")
      .eq("imobiliaria_id", imobiliariaId)
      .eq("seguradora", seguradoraNormalizada)
      .eq("competencia", competencia)
      .in("status", STATUS_ATIVOS);
    consulta = tipoDocumento ? consulta.eq("tipo_documento", tipoDocumento) : consulta.is("tipo_documento", null);
    const { data } = await consulta.maybeSingle();
    duplicataConteudo = data;
  }
  const duplicataFinal = duplicata ?? duplicataConteudo;

  // Mesma lógica pro tipo de documento -- se a IA não conseguiu dizer se é
  // boleto ou demonstrativo, alguém precisa olhar antes de confiar no
  // vencimento/valor extraído.
  const tipoDocumentoReconhecido = tipoDocumento === "boleto" || tipoDocumento === "demonstrativo";

  const confianca = imobiliariaId ? resultadoIdent.confianca : null;
  // "media" = 1 único match por nome/razão social (não por CNPJ) -- não é
  // ambíguo, só um sinal mais fraco. Só "baixa" (mais de uma imobiliária
  // parecida) é ambiguidade de verdade e precisa de olho humano.
  const confiancaSuficiente = confianca === "alta" || confianca === "media";
  const status = duplicataFinal
    ? "duplicada"
    : !imobiliariaId
      ? "aguardando_identificacao"
      : precisaEscolherOrigem
        ? "aguardando_origem"
        : confiancaSuficiente && tipoDocumentoReconhecido
          ? "fatura_carregada"
          : "aguardando_conferencia";
  // Quando só existe 1 origem possível, já preenche sozinho -- a pergunta
  // só aparece quando existe ambiguidade de verdade.
  const origemFatura = origensPossiveis.length === 1 ? origensPossiveis[0] : null;

  const { error } = await supabase.from("faturas").insert({
    competencia,
    arquivo_bucket_path: pathFinal,
    arquivo_nome: nomeArquivo,
    arquivo_hash: hash,
    imobiliaria_id: imobiliariaId,
    seguradora: seguradoraNormalizada,
    origem: origemFatura,
    tipo_documento: tipoDocumento,
    senha_pdf: senhaPdf,
    codigo_produtor: dadosIA?.codigo_produtor ?? null,
    vencimento: dadosIA?.vencimento ?? null,
    valor: dadosIA?.valor ?? null,
    numero_documento: dadosIA?.numero_documento ?? null,
    confianca,
    status,
    possivel_duplicidade_de: duplicataFinal?.id ?? null,
    texto_bruto_extraido: texto || null,
    historico_identificacao: historico,
    criado_por: user.id,
    criado_por_email: user.email,
  });
  if (error) return { ok: false, nomeArquivo, mensagem: error.message };

  const seguradoraTexto = seguradoraNormalizada ? ` (${seguradoraNormalizada})` : "";
  const tipoDocumentoTexto = tipoDocumento ? `, ${tipoDocumento}` : "";
  const mensagens: Record<string, string> = {
    duplicada: duplicataConteudo
      ? `Já existe uma fatura viva dessa imobiliária${seguradoraTexto} nessa competência — marcada como duplicata pra conferência.`
      : "Parece duplicada de uma fatura já enviada.",
    aguardando_identificacao: `Aberta${seguradoraTexto}, mas não identificamos a imobiliária — precisa de conferência.`,
    aguardando_origem: `Identificada: ${nomeIdentificado}${seguradoraTexto}, mas essa imobiliária tem mais de uma origem nessa seguradora — confirme qual na conferência.`,
    aguardando_conferencia: !tipoDocumentoReconhecido && imobiliariaId && confiancaSuficiente
      ? `Identificada: ${nomeIdentificado}${seguradoraTexto}, mas não identificamos se é boleto ou demonstrativo — confirme na conferência.`
      : `Aberta${seguradoraTexto}, sugestão: ${nomeIdentificado ?? "?"} — confirme na conferência.`,
    fatura_carregada: `Identificada: ${nomeIdentificado}${seguradoraTexto}${tipoDocumentoTexto}.`,
  };

  return { ok: true, nomeArquivo, status, mensagem: mensagens[status] ?? "Processada." };
}
