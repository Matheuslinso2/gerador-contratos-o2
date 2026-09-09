"use server";

import { redirect } from "next/navigation";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { enviarEmail, separarEmails, type AnexoEmail } from "@/lib/email";
import { montarEmailRepasse, type RepasseParaEmail } from "@/lib/repassesEmail";
import { valoresBatem } from "@/lib/repassesIdentificacao";

const BUCKET_FINAL = "repasses";

const EMAIL_MODO_TESTE = "matheus@o2seguros.com.br";
const EMAIL_FINANCEIRO_CC = "financeiro@o2seguros.com.br";

async function anexoLogoO2() {
  const conteudo = await fs.readFile(path.join(process.cwd(), "public", "marca-o2", "o2-logo-horizontal.png"));
  return { nome: "o2-logo.png", conteudo, tipo: "image/png", cid: "o2-logo" };
}

// Dispara de verdade -- 1 e-mail por imobiliária/produtor, com o relatório
// de repasse + o comprovante de pagamento anexados. Só permite mandar
// quando o par (1 relatório + 1 comprovante) está completo e os valores
// batem -- a mesma checagem que decide "pronto pra envio" na tela principal
// é reconferida aqui, pra nunca depender só do que a tela mostrou antes de
// alguém clicar em enviar.
export async function confirmarEnvioRepasse(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");

  const competencia = String(formData.get("competencia") ?? "").trim();
  const imobiliariaIds = formData.getAll("imob").map(String).filter(Boolean);
  const modoTeste = formData.get("modo_teste") === "1";
  if (!competencia || !imobiliariaIds.length) {
    redirect(`/repasses?erro=${encodeURIComponent("Seleção inválida.")}`);
  }

  let sucessos = 0;
  let falhas = 0;

  for (const imobiliariaId of imobiliariaIds) {
    try {
      const { data: imobiliaria } = await supabase
        .from("imobiliarias")
        .select("nome, email_repasses")
        .eq("id", imobiliariaId)
        .single();
      if (!imobiliaria) {
        falhas++;
        continue;
      }
      const destinatariosReais = separarEmails(imobiliaria.email_repasses);
      if (!destinatariosReais.length) {
        falhas++;
        continue;
      }
      const destinatarios = modoTeste ? [EMAIL_MODO_TESTE] : destinatariosReais;

      const { data: repasses } = await supabase
        .from("repasses")
        .select("id, arquivo_bucket_path, arquivo_nome, tipo_documento, valor")
        .eq("imobiliaria_id", imobiliariaId)
        .eq("competencia", competencia)
        .eq("status", "identificado");
      const relatorio = repasses?.find((r) => r.tipo_documento === "relatorio") ?? null;
      const comprovante = repasses?.find((r) => r.tipo_documento === "comprovante") ?? null;
      if (!relatorio || !comprovante || !valoresBatem(relatorio.valor, comprovante.valor)) {
        falhas++;
        continue;
      }
      const par = [relatorio, comprovante];

      const anexos: AnexoEmail[] = [await anexoLogoO2()];
      for (const r of par) {
        const { data: baixado, error } = await supabase.storage.from(BUCKET_FINAL).download(r.arquivo_bucket_path);
        if (error || !baixado) throw new Error(`Falha ao baixar ${r.arquivo_nome}: ${error?.message ?? "arquivo não encontrado"}`);
        anexos.push({
          nome: r.arquivo_nome,
          conteudo: Buffer.from(await baixado.arrayBuffer()),
          tipo: "application/pdf",
        });
      }

      const { assunto, html } = montarEmailRepasse({
        nomeImobiliaria: imobiliaria.nome,
        competencia,
        valorLiquido: relatorio.valor,
        repasses: par as RepasseParaEmail[],
      });

      await enviarEmail({
        para: destinatarios,
        cc: modoTeste ? undefined : [EMAIL_FINANCEIRO_CC],
        assunto,
        html,
        anexos,
        remetente: "O2 Seguros",
        throwSeFalhar: true,
      });

      const { data: envio, error: erroEnvio } = await supabase
        .from("repasses_envios")
        .insert({
          imobiliaria_id: imobiliariaId,
          competencia,
          repasses_ids: par.map((r) => r.id),
          destinatarios,
          cc: modoTeste ? [] : [EMAIL_FINANCEIRO_CC],
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
        .from("repasses")
        .update({ status: "enviada" })
        .in(
          "id",
          par.map((r) => r.id)
        );

      sucessos++;
    } catch (e) {
      console.error(`[repasses] erro ao enviar pra imobiliária ${imobiliariaId}:`, e);
      await supabase.from("repasses_envios").insert({
        imobiliaria_id: imobiliariaId,
        competencia,
        repasses_ids: [],
        destinatarios: [],
        assunto: `Repasse — ${competencia}`,
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
      ? `${sucessos} enviado(s), ${falhas} com erro -- confira e-mail cadastrado, par relatório+comprovante e valores dessas imobiliárias.`
      : `${sucessos} repasse(s) enviado(s) com sucesso.`;
  redirect(`/repasses?${falhas > 0 ? "aviso" : "ok"}=${encodeURIComponent(mensagem)}&competencia=${competencia}`);
}
