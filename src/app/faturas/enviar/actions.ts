"use server";

import { redirect } from "next/navigation";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { enviarEmail, separarEmails, type AnexoEmail } from "@/lib/email";
import { montarEmailFatura, type FaturaParaEmail } from "@/lib/faturasEmail";

const BUCKET_FINAL = "faturas";
const STATUS_PRONTO_PARA_ENVIO = ["fatura_carregada", "pronta_para_envio"];

// "Modo teste" (checkbox na tela de envio): manda pro e-mail do Matheus em
// vez do e-mail real da imobiliária -- pra revisar layout/conteúdo com
// anexo e dados reais sem arriscar mandar pra um cliente de verdade. Não
// precisa de nenhum passo de "reset" depois: é só não marcar a caixinha
// no próximo envio real, o comportamento normal volta sozinho.
const EMAIL_MODO_TESTE = "matheus@o2seguros.com.br";

// Mesmo logo horizontal usado no topo das landing pages públicas (Ficha
// Fiança, RC Obras) -- O2 laranja + "Seguros" navy, feito pra fundo claro
// (a variante "navy" usada antes tinha o texto branco, certa só pra fundo
// escuro, que não é mais o caso aqui). Embutida via CID em vez de link
// externo (não depende do cliente de e-mail carregar imagem de fora).
async function anexoLogoO2() {
  const conteudo = await fs.readFile(path.join(process.cwd(), "public", "marca-o2", "o2-logo-horizontal.png"));
  return { nome: "o2-logo.png", conteudo, tipo: "image/png", cid: "o2-logo" };
}

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
  const modoTeste = formData.get("modo_teste") === "1";
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
      if (!imobiliaria) {
        falhas++;
        continue;
      }
      const destinatariosReais = separarEmails(imobiliaria.email_faturas);
      if (!destinatariosReais.length) {
        falhas++;
        continue;
      }
      const destinatarios = modoTeste ? [EMAIL_MODO_TESTE] : destinatariosReais;

      const { data: faturasSemOrdem } = await supabase
        .from("faturas")
        .select("id, arquivo_bucket_path, arquivo_nome, tipo_documento, vencimento, valor, numero_documento, senha_pdf")
        .eq("imobiliaria_id", imobiliariaId)
        .eq("seguradora", seguradora)
        .eq("competencia", competencia)
        .in("status", STATUS_PRONTO_PARA_ENVIO);
      if (!faturasSemOrdem?.length) {
        falhas++;
        continue;
      }
      // Sem isso a ordem dos anexos (na lista do e-mail e na ordem em que
      // vão anexados) depende de como o Postgres devolveu as linhas --
      // sem ORDER BY isso não é garantido nem estável entre execuções
      // (confirmado: 2 envios de teste da mesma fatura saíram com a lista
      // em ordem trocada). Boleto sempre primeiro, é o documento pagável.
      const ORDEM_TIPO: Record<string, number> = { boleto: 0, demonstrativo: 1 };
      const faturas = [...faturasSemOrdem].sort(
        (a, b) => (ORDEM_TIPO[a.tipo_documento ?? ""] ?? 2) - (ORDEM_TIPO[b.tipo_documento ?? ""] ?? 2)
      );

      const anexos: AnexoEmail[] = [await anexoLogoO2()];
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
        para: destinatarios,
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
          destinatarios,
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
