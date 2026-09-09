"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";

async function checarAcesso() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/");
  return { supabase, user };
}

// Confirmação manual de quem apareceu em "Precisa de conferência" -- vincula
// à imobiliária escolhida e, se o tipo de documento não tiver sido
// reconhecido no upload, pede pra escolher aqui também.
export async function confirmarIdentificacaoRepasse(formData: FormData) {
  const { supabase, user } = await checarAcesso();

  const repasseId = String(formData.get("repasse_id") ?? "");
  const imobiliariaId = String(formData.get("imobiliaria_id") ?? "");
  const tipoDocumentoForm = String(formData.get("tipo_documento") ?? "").trim();
  if (!repasseId || !imobiliariaId) {
    redirect(`/repasses?erro=${encodeURIComponent("Selecione uma imobiliária.")}`);
  }

  const { data: repasse } = await supabase
    .from("repasses")
    .select("historico_identificacao, tipo_documento, codigo_produtor_corp")
    .eq("id", repasseId)
    .single();

  const tipoDocumento = repasse?.tipo_documento || tipoDocumentoForm || null;
  if (tipoDocumento !== "relatorio" && tipoDocumento !== "comprovante") {
    redirect(`/repasses?erro=${encodeURIComponent("Esse documento não teve o tipo (relatório/comprovante) identificado — selecione antes de confirmar.")}`);
  }

  const historico = [
    ...(repasse?.historico_identificacao ?? []),
    { usuario: user.email, data: new Date().toISOString(), acao: "confirmacao_manual", detalhe: imobiliariaId },
  ];

  const { error } = await supabase
    .from("repasses")
    .update({
      imobiliaria_id: imobiliariaId,
      tipo_documento: tipoDocumento,
      confianca: "alta",
      status: "identificado",
      historico_identificacao: historico,
    })
    .eq("id", repasseId);
  if (error) redirect(`/repasses?erro=${encodeURIComponent(error.message)}`);

  // Aprende o código do produtor pra próxima vez casar sozinho, sem
  // sobrescrever se a imobiliária já tinha um código diferente cadastrado
  // (evita corrigir errado por cima de um valor que já foi confirmado antes).
  if (repasse?.codigo_produtor_corp) {
    const { data: imob } = await supabase
      .from("imobiliarias")
      .select("codigo_produtor_corp")
      .eq("id", imobiliariaId)
      .single();
    if (imob && !imob.codigo_produtor_corp) {
      await supabase
        .from("imobiliarias")
        .update({ codigo_produtor_corp: repasse.codigo_produtor_corp })
        .eq("id", imobiliariaId);
    }
  }

  redirect(`/repasses?ok=${encodeURIComponent("Identificação confirmada.")}`);
}

// Exclui (arquiva) um arquivo de repasse carregado errado -- mesmo padrão
// de excluirArquivoFatura.
export async function excluirArquivoRepasse(repasseId: string, voltarPara: string) {
  const { supabase, user } = await checarAcesso();

  if (!repasseId) redirect(`/repasses?erro=${encodeURIComponent("Arquivo inválido.")}${voltarPara}`);

  const { data: repasse } = await supabase
    .from("repasses")
    .select("historico_identificacao, status")
    .eq("id", repasseId)
    .single();
  if (!repasse) redirect(`/repasses?erro=${encodeURIComponent("Arquivo não encontrado.")}${voltarPara}`);
  if (repasse!.status === "enviada") {
    redirect(`/repasses?erro=${encodeURIComponent("Esse repasse já foi enviado -- não dá pra excluir.")}${voltarPara}`);
  }

  const historico = [
    ...(repasse!.historico_identificacao ?? []),
    { usuario: user.email ?? "", data: new Date().toISOString(), acao: "excluido_manualmente", detalhe: "" },
  ];
  const { error } = await supabase
    .from("repasses")
    .update({ status: "cancelada", historico_identificacao: historico })
    .eq("id", repasseId);
  if (error) redirect(`/repasses?erro=${encodeURIComponent(error.message)}${voltarPara}`);

  redirect(`/repasses?ok=${encodeURIComponent("Arquivo excluído.")}${voltarPara}`);
}
