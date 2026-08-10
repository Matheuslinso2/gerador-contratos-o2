"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { importarGradeProducao } from "@/lib/producaoImportacao";
import { recalcularResumoProducao } from "@/lib/producaoResumo";
import { recalcularResumoBairro } from "@/lib/producaoResumoBairro";
import { recalcularResumoCruzamento } from "@/lib/producaoResumoCruzamento";
import { recalcularResumoDispersao } from "@/lib/producaoResumoDispersao";
import { extrairEnderecosRenovacoes } from "@/lib/producaoEnderecosParser";
import { extrairTextoPdf } from "@/lib/extrairTextoPdf";
import { ehRamoValido, rotuloRamo } from "@/lib/producaoRamos";

const BUCKET_TEMP = "producao-temp";
const TAMANHO_LOTE = 500;

// O upload do .xlsx em si vai direto do navegador pro bucket temporário (ver
// UploadProducaoForm.tsx) -- mesmo motivo de sempre: o corpo de uma Server
// Action na Vercel tem teto de ~4,5 MB, e a grade de Imobiliário sozinha
// passa de 20 mil linhas. Essa action só recebe o caminho do arquivo.
export async function processarUploadProducao(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const ramo = String(formData.get("ramo") ?? "").trim();
  const path = String(formData.get("arquivo_path") ?? "").trim();
  const nomeArquivo = String(formData.get("arquivo_nome") ?? "").trim();

  if (!ehRamoValido(ramo)) {
    redirect(`/producao/upload?erro=${encodeURIComponent("Selecione um ramo válido.")}`);
  }
  if (!path) {
    redirect(`/producao/upload?erro=${encodeURIComponent("Selecione o arquivo da grade de produção.")}`);
  }

  const { data: baixado, error: erroDownload } = await supabase.storage.from(BUCKET_TEMP).download(path);
  if (erroDownload || !baixado) {
    redirect(`/producao/upload?erro=${encodeURIComponent("Não foi possível recuperar o arquivo enviado. Tente novamente.")}`);
  }
  const buffer = Buffer.from(await baixado.arrayBuffer());
  void supabase.storage.from(BUCKET_TEMP).remove([path]);

  let linhas;
  try {
    linhas = importarGradeProducao(buffer, ramo, nomeArquivo);
  } catch (e) {
    redirect(
      `/producao/upload?erro=${encodeURIComponent(`Não foi possível ler "${nomeArquivo}" — confira se é o arquivo de grade de produção certo.`)}`
    );
  }

  if (!linhas.length) {
    redirect(
      `/producao/upload?erro=${encodeURIComponent(`Nenhuma linha aproveitável encontrada em "${nomeArquivo}" (só canceladas ou vazio?).`)}`
    );
  }

  for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
    const lote = linhas.slice(i, i + TAMANHO_LOTE);
    const { error } = await supabase.from("producao_erp").upsert(lote, { onConflict: "ramo,nosso_numero" });
    if (error) {
      redirect(`/producao/upload?erro=${encodeURIComponent(`Falha ao gravar: ${error.message}`)}`);
    }
  }

  await recalcularResumoProducao(supabase);
  await recalcularResumoCruzamento(supabase);
  await recalcularResumoDispersao(supabase);

  redirect(
    `/producao/upload?ok=${encodeURIComponent(`${linhas.length} linha(s) de ${rotuloRamo(ramo)} processada(s) com sucesso.`)}`
  );
}

// Endereços vêm de um relatório diferente ("Relatório de Renovações", PDF)
// -- camada opcional que enriquece a produção já carregada, ligada pelo
// mesmo `nosso_numero`. Mesmo caminho de upload via bucket temporário. O
// ramo de cada registro é identificado dentro do próprio PDF (um arquivo
// pode misturar vários ramos), não escolhido no formulário.
export async function processarUploadEnderecos(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const path = String(formData.get("arquivo_path") ?? "").trim();
  const nomeArquivo = String(formData.get("arquivo_nome") ?? "").trim();

  if (!path) {
    redirect(`/producao/upload?erro=${encodeURIComponent("Selecione o arquivo do relatório de renovações.")}`);
  }

  const { data: baixado, error: erroDownload } = await supabase.storage.from(BUCKET_TEMP).download(path);
  if (erroDownload || !baixado) {
    redirect(`/producao/upload?erro=${encodeURIComponent("Não foi possível recuperar o arquivo enviado. Tente novamente.")}`);
  }
  const buffer = Buffer.from(await baixado.arrayBuffer());
  void supabase.storage.from(BUCKET_TEMP).remove([path]);

  let registros, ramoNaoIdentificado;
  try {
    const texto = await extrairTextoPdf(buffer);
    ({ registros, ramoNaoIdentificado } = extrairEnderecosRenovacoes(texto, nomeArquivo));
  } catch (e) {
    redirect(
      `/producao/upload?erro=${encodeURIComponent(`Não foi possível ler "${nomeArquivo}" — confira se é um PDF de "Relatório de Renovações" do CORP.`)}`
    );
  }

  if (!registros.length) {
    redirect(`/producao/upload?erro=${encodeURIComponent(`Nenhum registro encontrado em "${nomeArquivo}".`)}`);
  }

  const linhas = registros.map((r) => ({
    ramo: r.ramo,
    nosso_numero: r.nossoNumero,
    fonte: r.fonte,
    logradouro: r.logradouro,
    numero: r.numero,
    complemento: r.complemento,
    bairro: r.bairro,
    cidade: r.cidade,
    uf: r.uf,
    cep: r.cep,
    valor_aluguel: r.valorAluguel,
    arquivo_origem: r.arquivoOrigem,
  }));

  for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
    const lote = linhas.slice(i, i + TAMANHO_LOTE);
    const { error } = await supabase.from("producao_enderecos").upsert(lote, { onConflict: "ramo,nosso_numero" });
    if (error) {
      redirect(`/producao/upload?erro=${encodeURIComponent(`Falha ao gravar: ${error.message}`)}`);
    }
  }

  await recalcularResumoBairro(supabase);

  const comBairro = registros.filter((r) => r.bairro).length;
  const comAluguel = registros.filter((r) => r.valorAluguel !== null).length;
  const avisoRamo = ramoNaoIdentificado ? ` (${ramoNaoIdentificado} com ramo não identificado, ignorados)` : "";
  redirect(
    `/producao/upload?ok=${encodeURIComponent(
      `${registros.length} registro(s) processado(s) — ${comBairro} com bairro identificado, ${comAluguel} com valor de aluguel${avisoRamo}.`
    )}`
  );
}
