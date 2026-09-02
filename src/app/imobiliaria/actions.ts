"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { extrairTextoDocx } from "@/lib/extrairTextoDocx";
import { extrairTextoPdf } from "@/lib/extrairTextoPdf";
import { enviarEmail } from "@/lib/email";
import { prepararTextoBase } from "@/lib/limparTextoBase";
import { validarCNPJ } from "@/lib/validacoesBr";

export async function salvarImobiliaria(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nome = String(formData.get("nome") ?? "").trim();
  const cnpj = String(formData.get("cnpj") ?? "").trim();
  // O front-end já bloqueia isso com setCustomValidity, mas nunca dá pra
  // confiar só no navegador (JS desabilitado, requisição direta etc.) --
  // sem isso, um CNPJ com dígito verificador errado passava direto pro banco.
  if (cnpj && !validarCNPJ(cnpj)) {
    redirect(`/imobiliaria?erro=${encodeURIComponent("CNPJ inválido — confira os números digitados.")}`);
  }
  const creci = String(formData.get("creci") ?? "").trim();
  const telefone = String(formData.get("telefone") ?? "").trim();
  const endereco = String(formData.get("endereco") ?? "").trim();
  const indice_reajuste = String(formData.get("indice_reajuste") ?? "").trim();
  const clausula_fiador = String(formData.get("clausula_fiador") ?? "").trim();
  const clausula_caucao = String(formData.get("clausula_caucao") ?? "").trim();
  const percentual_multa_atraso = Number(formData.get("percentual_multa_atraso"));
  const percentual_juros_mora = Number(formData.get("percentual_juros_mora"));
  const percentual_honorarios_advocaticios = Number(
    formData.get("percentual_honorarios_advocaticios")
  );
  const plataforma_assinatura = String(formData.get("plataforma_assinatura") ?? "").trim();
  const logo = formData.get("logo") as File | null;
  const contratoArquivo = formData.get("contrato_arquivo") as File | null;

  let texto_base_contrato = String(formData.get("texto_base_contrato") ?? "").trim();

  if (contratoArquivo && contratoArquivo.size > 0) {
    const nomeArquivo = contratoArquivo.name.toLowerCase();
    const ehDocx = nomeArquivo.endsWith(".docx");
    const ehPdf = nomeArquivo.endsWith(".pdf");
    if (!ehDocx && !ehPdf) {
      redirect(
        `/imobiliaria?erro=${encodeURIComponent("O arquivo do contrato precisa estar em Word (.docx) ou PDF (.pdf).")}`
      );
    }
    const buffer = Buffer.from(await contratoArquivo.arrayBuffer());
    try {
      texto_base_contrato = ehPdf ? await extrairTextoPdf(buffer) : await extrairTextoDocx(buffer);
    } catch {
      redirect(
        `/imobiliaria?erro=${encodeURIComponent(
          `Não foi possível ler o arquivo "${contratoArquivo.name}" — ele pode estar corrompido ou num formato inesperado.`
        )}`
      );
    }
    // PDF escaneado (sem texto real, só imagem) extrai uma string vazia --
    // ao contrário do Auditor, aqui não tem leitura visual pela IA como
    // alternativa, então precisa avisar em vez de salvar um texto-base vazio.
    if (ehPdf && !texto_base_contrato.trim()) {
      redirect(
        `/imobiliaria?erro=${encodeURIComponent(
          `O PDF "${contratoArquivo.name}" parece ser escaneado (sem texto real, só imagem) — não consigo extrair o texto dele. Tente um PDF com texto selecionável, ou envie em Word (.docx).`
        )}`
      );
    }
  }

  // Antes, quando faltava algum obrigatório, a função só dava "return" --
  // sem erro nenhum, a página recarregava em branco (formulário não
  // controlado, os campos voltam ao valor salvo/vazio) e a pessoa ficava
  // presa sem entender por quê (achado real: cliente relatou "preencho e
  // não salva"). Agora sempre redireciona com o motivo exato.
  const faltando: string[] = [];
  if (!nome) faltando.push("Nome da imobiliária");
  if (!cnpj) faltando.push("CNPJ");
  if (!texto_base_contrato) faltando.push("Contrato-base (envie um arquivo ou cole o texto)");
  if (!indice_reajuste) faltando.push("Índice de reajuste padrão");
  if (faltando.length > 0) {
    redirect(`/imobiliaria?erro=${encodeURIComponent(`Preencha os campos obrigatórios: ${faltando.join(", ")}.`)}`);
  }

  const { data: porUserId } = await supabase
    .from("imobiliarias")
    .select("id, texto_base_contrato, user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Além da conta do usuário, o Faturas cria sozinho um registro
  // "cadastro_incompleto" (sem user_id) quando identifica uma fatura de
  // uma imobiliária que ainda não tem conta aqui (ver
  // resolverOuCriarImobiliaria em faturasIdentificacao.ts). Sem checar por
  // CNPJ aqui, o primeiro cadastro dela criava uma SEGUNDA linha (duplicada
  // pro mesmo CNPJ) em vez de completar essa -- a antiga ficava presa como
  // "incompleta" pra sempre, com as faturas_esperadas já vinculadas a ela,
  // e o cadastro de verdade ia parar numa linha órfã que nada referencia.
  let imobiliariaExistente = porUserId;
  if (!imobiliariaExistente && cnpj) {
    const { data: porCnpj } = await supabase
      .from("imobiliarias")
      .select("id, texto_base_contrato, user_id")
      .eq("cnpj", cnpj)
      .maybeSingle();
    if (porCnpj?.user_id && porCnpj.user_id !== user.id) {
      redirect(
        `/imobiliaria?erro=${encodeURIComponent(
          "Esse CNPJ já está cadastrado em outra conta. Fale com o suporte da O2 se isso não deveria acontecer."
        )}`
      );
    }
    if (porCnpj) imobiliariaExistente = porCnpj;
  }
  const primeiroCadastro = !imobiliariaExistente;

  // Só roda a limpeza (via IA) quando o texto-base é novo/mudou — evita
  // reprocessar à toa a cada salvamento do cadastro (custo de API e risco
  // de reprocessar um texto que já passou por essa limpeza antes).
  // garantiaPosicao fica "undefined" (não mexe na coluna) quando o texto
  // não mudou, pra não apagar a posição já salva de antes.
  let garantiaPosicao: number | null | undefined;
  if (texto_base_contrato !== imobiliariaExistente?.texto_base_contrato) {
    try {
      const resultado = await prepararTextoBase(texto_base_contrato);
      texto_base_contrato = resultado.texto_preparado;
      garantiaPosicao = resultado.clausulas_antes_da_garantia_removida;
    } catch {
      // Se o preparo automático falhar, segue com o texto como veio —
      // melhor salvar o cadastro do que travar por causa disso.
    }
  }

  let logo_url: string | null = null;
  if (logo && logo.size > 0) {
    const ext = logo.name.split(".").pop() || "png";
    const path = `${user.id}-${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("logos").upload(path, logo, {
      contentType: logo.type,
    });
    if (uploadError) redirect(`/imobiliaria?erro=${encodeURIComponent(uploadError.message)}`);
    logo_url = supabase.storage.from("logos").getPublicUrl(path).data.publicUrl;
  }

  const dados: Record<string, unknown> = {
    user_id: user.id,
    email: user.email,
    nome,
    cnpj,
    creci: creci || null,
    telefone: telefone || null,
    endereco: endereco || null,
    texto_base_contrato,
    indice_reajuste,
    clausula_fiador: clausula_fiador || null,
    clausula_caucao: clausula_caucao || null,
    percentual_multa_atraso,
    percentual_juros_mora,
    percentual_honorarios_advocaticios,
    plataforma_assinatura: plataforma_assinatura || null,
  };
  if (logo_url) dados.logo_url = logo_url;
  if (garantiaPosicao !== undefined) dados.garantia_posicao_apos_clausula = garantiaPosicao;

  const { error } = imobiliariaExistente
    ? await supabase
        .from("imobiliarias")
        .update({ ...dados, cadastro_incompleto: false })
        .eq("id", imobiliariaExistente.id)
    : await supabase.from("imobiliarias").insert(dados);
  if (error) redirect(`/imobiliaria?erro=${encodeURIComponent(error.message)}`);

  if (primeiroCadastro) {
    await enviarEmail({
      para: "comercial@o2seguros.com.br",
      assunto: `Nova imobiliária cadastrada: ${nome}`,
      html: `
        <h2>Nova imobiliária cadastrada no Workspace O2</h2>
        <p><strong>Nome:</strong> ${nome}</p>
        <p><strong>CNPJ:</strong> ${cnpj}</p>
        <p><strong>CRECI:</strong> ${creci || "não informado"}</p>
        <p><strong>Telefone:</strong> ${telefone || "não informado"}</p>
        <p><strong>Endereço:</strong> ${endereco || "não informado"}</p>
        <p><strong>E-mail de login:</strong> ${user.email}</p>
        <p><strong>Índice de reajuste:</strong> ${indice_reajuste}</p>
        <p><strong>Plataforma de assinatura:</strong> ${plataforma_assinatura || "não informado"}</p>
      `,
    });
  }

  revalidatePath("/imobiliaria");
  redirect("/imobiliaria?sucesso=1");
}
