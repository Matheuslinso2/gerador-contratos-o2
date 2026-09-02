"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extrairTextoDocx } from "@/lib/extrairTextoDocx";
import { extrairTextoPdfComPaginas } from "@/lib/extrairTextoPdf";
import { auditarContrato, type DocumentoAuditoria, type FonteDocumento, type TipoDocumentoAuditoria } from "@/lib/auditorContrato";
import { buscarImobiliariaDoUsuario } from "@/lib/imobiliariaDoUsuario";

const BUCKET_TEMP = "auditoria-temp";

// maxDuration da página é 180s (ver page.tsx) -- corta a chamada à IA um
// pouco antes disso, com folga pra esse catch e o redirect ainda rodarem.
// Sem isso, um timeout de PLATAFORMA (Vercel matando a função) não passa
// por try/catch nenhum e o usuário só vê uma tela de erro genérica.
const LIMITE_TEMPO_ANALISE_MS = 165_000;

function comLimiteDeTempo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`A análise demorou mais que ${Math.round(ms / 1000)}s — provavelmente por causa do volume de documentos anexados. Tente reenviar com menos anexos, ou um de cada vez.`)),
      ms
    );
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer)) as Promise<T>;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// O arquivo já chega no servidor só como um caminho no Storage — o upload
// em si aconteceu direto do navegador (ver AuditorForm.tsx), porque o corpo
// de uma Server Action na Vercel tem um teto de ~4,5 MB, e contratos
// escaneados com laudo de vistoria passam disso fácil.
const EXTENSOES_IMAGEM: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

async function extrairDocumento(
  supabase: SupabaseServerClient,
  { texto0, path, nomeArquivo }: { texto0: string; path: string; nomeArquivo: string | null },
  // Fichas/formulários PDF preenchíveis (comum em documentos que passaram
  // por assinatura eletrônica) costumam ter os RÓTULOS como texto normal da
  // página, mas os VALORES digitados nos campos ficam como dado de
  // formulário (AcroForm) que a extração de texto simples não lê -- o
  // resultado parece "todo mundo em branco" mesmo com o PDF preenchido.
  // Quando true, ignora o texto extraído e sempre manda o PDF pra IA ler
  // direto da página (visualmente), onde os valores aparecem normalmente.
  sempreLerPdfVisualmente = false
): Promise<{
  texto: string;
  nomeArquivo: string | null;
  pdfBase64: string | null;
  imagemBase64: string | null;
  imagemMediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null;
}> {
  if (!path) {
    return { texto: texto0, nomeArquivo: null, pdfBase64: null, imagemBase64: null, imagemMediaType: null };
  }

  const nomeLower = (nomeArquivo ?? path).toLowerCase();
  const ehPdf = nomeLower.endsWith(".pdf");
  const extensaoImagem = Object.keys(EXTENSOES_IMAGEM).find((ext) => nomeLower.endsWith(ext));
  if (!nomeLower.endsWith(".docx") && !ehPdf && !extensaoImagem) {
    redirect(
      `/auditar-contrato?erro=${encodeURIComponent(
        "Envie um arquivo .docx, .pdf ou uma imagem (print de tela em .png/.jpg), ou cole o texto diretamente."
      )}`
    );
  }

  const { data, error } = await supabase.storage.from(BUCKET_TEMP).download(path);
  if (error || !data) {
    redirect(
      `/auditar-contrato?erro=${encodeURIComponent(
        "Não foi possível recuperar o arquivo enviado. Tente novamente."
      )}`
    );
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  void supabase.storage.from(BUCKET_TEMP).remove([path]);

  // Imagem/print de tela: não tem texto pra extrair, manda os bytes direto
  // pra IA "ver" o conteúdo, igual já fazíamos com PDF escaneado.
  if (extensaoImagem) {
    return {
      texto: "",
      nomeArquivo,
      pdfBase64: null,
      imagemBase64: buffer.toString("base64"),
      imagemMediaType: EXTENSOES_IMAGEM[extensaoImagem],
    };
  }

  let texto = "";
  let numPaginasPdf = 0;
  try {
    if (ehPdf) {
      ({ texto, numPaginas: numPaginasPdf } = await extrairTextoPdfComPaginas(buffer));
    } else {
      texto = await extrairTextoDocx(buffer);
    }
  } catch {
    redirect(
      `/auditar-contrato?erro=${encodeURIComponent(
        `Não foi possível ler o arquivo "${nomeArquivo}" — ele pode estar corrompido ou num formato inesperado.`
      )}`
    );
  }

  // Apps de scanner (CamScanner e similares) gravam um "carimbo" de
  // cabeçalho/rodapé (data, nome do app, link de compartilhamento) como
  // texto real em cada página, mesmo quando o conteúdo do contrato em si é
  // só a imagem escaneada, sem nenhum texto real por trás -- isso engana um
  // simples "texto vazio?" (o PDF não fica vazio, só sobra o carimbo) e faz
  // a IA analisar apenas esses links, achando que "o arquivo não tem
  // conteúdo". Um contrato de verdade tem centenas de caracteres por
  // página; um carimbo sozinho fica bem abaixo disso.
  const textoInsuficiente = ehPdf && numPaginasPdf > 0 && texto.length / numPaginasPdf < 200;

  // PDF escaneado (sem texto real ou com só o carimbo do scanner) OU
  // formulário preenchível cujos valores não vieram na extração (ver
  // comentário do parâmetro acima): nos três casos, guarda os bytes
  // originais pra IA ler direto das páginas.
  const pdfBase64 =
    ehPdf && (!texto.trim() || textoInsuficiente || sempreLerPdfVisualmente)
      ? buffer.toString("base64")
      : null;

  return { texto: pdfBase64 ? "" : texto, nomeArquivo, pdfBase64, imagemBase64: null, imagemMediaType: null };
}

export async function auditar(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const imobiliaria = await buscarImobiliariaDoUsuario(supabase, user);
  if (!imobiliaria) {
    redirect(`/auditar-contrato?erro=${encodeURIComponent("Cadastre sua imobiliária primeiro.")}`);
  }

  // Lista dinâmica de documentos (ver AuditorForm.tsx) -- cada item i manda
  // doc_{i}_tipo (obrigatório) e, ou doc_{i}_path + doc_{i}_nome (upload),
  // ou doc_{i}_texto (colado à mão). Ordem não importa, cada item carrega o
  // próprio papel na auditoria.
  const totalDocs = Number(formData.get("doc_count") ?? 0);
  const documentos: DocumentoAuditoria[] = [];
  const nomesPorTipo: Record<TipoDocumentoAuditoria, string[]> = { contrato: [], cotacao: [], certificado: [], outro: [] };
  const textosContrato: string[] = [];

  for (let i = 0; i < totalDocs; i++) {
    const tipoBruto = String(formData.get(`doc_${i}_tipo`) ?? "contrato");
    const tipo: TipoDocumentoAuditoria =
      tipoBruto === "cotacao" || tipoBruto === "certificado" || tipoBruto === "outro" ? tipoBruto : "contrato";
    const texto0 = String(formData.get(`doc_${i}_texto`) ?? "").trim();
    const path = String(formData.get(`doc_${i}_path`) ?? "").trim();
    const nomeArquivo = String(formData.get(`doc_${i}_nome`) ?? "").trim() || null;

    // Documento/fichas preenchíveis (comum em cotação e certificado) usam
    // leitura visual sempre, pra pegar valor de campo de formulário que a
    // extração de texto simples não vê -- ver comentário em extrairDocumento.
    const sempreLerPdfVisualmente = tipo === "cotacao" || tipo === "certificado";
    const { texto, pdfBase64, imagemBase64, imagemMediaType } = await extrairDocumento(
      supabase,
      { texto0, path, nomeArquivo },
      sempreLerPdfVisualmente
    );

    const fonte: FonteDocumento | null = texto
      ? { tipo: "texto", texto }
      : pdfBase64
        ? { tipo: "pdf", base64: pdfBase64 }
        : imagemBase64 && imagemMediaType
          ? { tipo: "imagem", base64: imagemBase64, mediaType: imagemMediaType }
          : null;

    if (!fonte) continue; // linha vazia (não deveria acontecer, mas não trava a auditoria por isso)

    documentos.push({ tipo, fonte, nomeArquivo });
    nomesPorTipo[tipo].push(nomeArquivo ?? "texto colado");
    if (tipo === "contrato" && texto) textosContrato.push(texto);
  }

  if (!documentos.some((d) => d.tipo === "contrato")) {
    redirect(
      `/auditar-contrato?erro=${encodeURIComponent(
        "Adicione ao menos um documento marcado como \"Contrato/Aditivo\" (arquivo ou texto colado)."
      )}`
    );
  }

  const nomeArquivo = nomesPorTipo.contrato.join(" + ") || null;

  const { data: produtosSeguro } = await supabase
    .from("produtos")
    .select("nome, clausula_base, seguradoras(nome)")
    .not("seguradora_id", "is", null);

  const bibliotecaClausulas = (produtosSeguro ?? []).map((p) => {
    const seguradora = Array.isArray(p.seguradoras) ? p.seguradoras[0] : p.seguradoras;
    return { seguradora: seguradora?.nome ?? "", produto: p.nome, clausulaBase: p.clausula_base };
  });

  let relatorio;
  try {
    relatorio = await comLimiteDeTempo(auditarContrato(documentos, bibliotecaClausulas), LIMITE_TEMPO_ANALISE_MS);
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "Falha ao analisar o contrato.";
    redirect(`/auditar-contrato?erro=${encodeURIComponent(mensagem)}`);
  }

  const naoVazio = (valor: string | undefined | null) =>
    valor && valor.trim() ? valor.trim() : "Não identificado";
  relatorio.locador_identificado = naoVazio(relatorio.locador_identificado);
  relatorio.locatario_identificado = naoVazio(relatorio.locatario_identificado);
  relatorio.endereco_identificado = naoVazio(relatorio.endereco_identificado);

  // Defesa extra: a IA às vezes deixa algum campo do checklist de fora da
  // resposta, mesmo sendo obrigatório no schema. Preenche com um valor
  // neutro em vez de deixar a tela quebrar ao exibir o relatório.
  relatorio.dados_cadastrais_status ??= "nao_avaliado";
  relatorio.dados_cadastrais_resumo ??= "Não avaliado nesta auditoria.";
  relatorio.dados_locacao_status ??= "nao_avaliado";
  relatorio.dados_locacao_resumo ??= "Não avaliado nesta auditoria.";
  relatorio.conferencia_cotacao_status ??= "nao_avaliado";
  relatorio.conferencia_cotacao_resumo ??= "Não avaliado nesta auditoria.";
  relatorio.clausulas_seguradora_status ??= "nao_avaliado";
  relatorio.clausulas_seguradora_resumo ??= "Não avaliado nesta auditoria.";
  relatorio.assinaturas_status ??= "nao_avaliado";
  relatorio.assinaturas_resumo ??= "Não avaliado nesta auditoria.";
  relatorio.pontos_criticos ??= [];

  const { data: auditoria, error } = await supabase
    .from("auditorias_contrato")
    .insert({
      imobiliaria_id: imobiliaria.id,
      nome_arquivo: nomeArquivo,
      status_geral: relatorio.status_geral,
      tipo_garantia_identificada: relatorio.tipo_garantia_identificada,
      locador_identificado: relatorio.locador_identificado,
      locatario_identificado: relatorio.locatario_identificado,
      endereco_identificado: relatorio.endereco_identificado,
      relatorio,
      texto_contrato:
        textosContrato.join("\n\n--- ADITIVO/PARTE SEGUINTE ---\n\n") ||
        "[Lido diretamente das páginas do PDF escaneado — sem texto extraído]",
    })
    .select("id")
    .single();
  if (error) redirect(`/auditar-contrato?erro=${encodeURIComponent(error.message)}`);

  redirect(`/auditar-contrato?ultimo=${auditoria.id}`);
}
