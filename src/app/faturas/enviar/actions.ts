"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { enviarEmail } from "@/lib/email";
import { montarEmailFatura, type FaturaParaEmail } from "@/lib/faturasEmail";

const BUCKET_FINAL = "faturas";
const STATUS_PRONTO_PARA_ENVIO = ["fatura_carregada", "pronta_para_envio"];

function tipoMime(nomeArquivo: string): string {
  const ext = nomeArquivo.toLowerCase().split(".").pop();
  if (ext === "pdf") return "application/pdf";
  if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === "xls") return "application/vnd.ms-excel";
  return "application/octet-stream";
}

// Dispara de verdade -- 1 e-mail por imobiliária, com todos os
// boletos/demonstrativos prontos daquela seguradora/competência anexados.
// Cada imobiliária é tratada de forma independente (uma falha não trava as
// outras); qualquer erro fica registrado em faturas_envios pra auditoria.
export async function confirmarEnvio(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const seguradora = String(formData.get("seguradora") ?? "").trim();
  const competencia = String(formData.get("competencia") ?? "").trim();
  const imobiliariaIds = formData.getAll("imob").map(String).filter(Boolean);
  if (!seguradora || !competencia || !imobiliariaIds.length) {
    redirect(`/faturas?erro=${encodeURIComponent("Seleção inválida.")}`);
  }

  let sucessos = 0;
  let falhas = 0;

  for (const imobiliariaId of imobiliariaIds) {
    try {
      const { data: imobiliaria } = await supabase
        .from("imobiliarias")
        .select("nome, email_faturas")
        .eq("id", imobiliariaId)
        .single();
      if (!imobiliaria?.email_faturas) {
        falhas++;
        continue;
      }

      const { data: faturas } = await supabase
        .from("faturas")
        .select("id, arquivo_bucket_path, arquivo_nome, tipo_documento, vencimento, valor, numero_documento, senha_pdf")
        .eq("imobiliaria_id", imobiliariaId)
        .eq("seguradora", seguradora)
        .eq("competencia", competencia)
        .in("status", STATUS_PRONTO_PARA_ENVIO);
      if (!faturas?.length) {
        falhas++;
        continue;
      }

      const anexos = [];
      for (const f of faturas) {
        const { data: baixado, error } = await supabase.storage.from(BUCKET_FINAL).download(f.arquivo_bucket_path);
        if (error || !baixado) throw new Error(`Falha ao baixar ${f.arquivo_nome}: ${error?.message ?? "arquivo não encontrado"}`);
        anexos.push({
          nome: f.arquivo_nome,
          conteudo: Buffer.from(await baixado.arrayBuffer()),
          tipo: tipoMime(f.arquivo_nome),
        });
      }

      const { assunto, html } = montarEmailFatura({
        nomeImobiliaria: imobiliaria.nome,
        seguradora,
        competencia,
        faturas: faturas as FaturaParaEmail[],
      });

      await enviarEmail({
        para: imobiliaria.email_faturas,
        assunto,
        html,
        anexos,
        remetente: "O2 Seguros",
        throwSeFalhar: true,
      });

      const { data: envio, error: erroEnvio } = await supabase
        .from("faturas_envios")
        .insert({
          imobiliaria_id: imobiliariaId,
          competencia,
          seguradora,
          faturas_ids: faturas.map((f) => f.id),
          envio_parcial: false,
          autorizado_por_email: user.email,
          destinatarios: [imobiliaria.email_faturas],
          assunto,
          corpo: html,
          resultado: "sucesso",
          enviado_por: user.id,
          enviado_por_email: user.email,
        })
        .select("id")
        .single();
      if (erroEnvio || !envio) throw new Error(erroEnvio?.message ?? "Falha ao registrar o envio.");

      await supabase
        .from("faturas")
        .update({ status: "enviada", envio_id: envio.id })
        .in(
          "id",
          faturas.map((f) => f.id)
        );

      sucessos++;
    } catch (e) {
      console.error(`[faturas] erro ao enviar pra imobiliária ${imobiliariaId}:`, e);
      await supabase.from("faturas_envios").insert({
        imobiliaria_id: imobiliariaId,
        competencia,
        seguradora,
        faturas_ids: [],
        envio_parcial: false,
        autorizado_por_email: user.email,
        destinatarios: [],
        assunto: `Fatura ${seguradora} — ${competencia}`,
        corpo: "",
        resultado: "erro",
        erro_detalhe: e instanceof Error ? e.message : String(e),
        enviado_por: user.id,
        enviado_por_email: user.email,
      });
      falhas++;
    }
  }

  const mensagem =
    falhas > 0
      ? `${sucessos} enviada(s), ${falhas} com erro -- confira e-mail cadastrado e status dessas imobiliárias.`
      : `${sucessos} fatura(s) enviada(s) com sucesso.`;
  redirect(
    `/faturas?${falhas > 0 ? "aviso" : "ok"}=${encodeURIComponent(mensagem)}&seguradora=${encodeURIComponent(seguradora)}&competencia=${competencia}`
  );
}
