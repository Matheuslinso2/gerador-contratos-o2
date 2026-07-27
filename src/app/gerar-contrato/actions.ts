"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { substituirPlaceholders, calcularDataTermino } from "@/lib/placeholdersContrato";

function qualificarPessoas(formData: FormData, prefixo: string): string {
  const nomes = formData.getAll(`${prefixo}_nome`).map(String);
  const nacionalidades = formData.getAll(`${prefixo}_nacionalidade`).map(String);
  const estadosCivis = formData.getAll(`${prefixo}_estado_civil`).map(String);
  const profissoes = formData.getAll(`${prefixo}_profissao`).map(String);
  const cpfs = formData.getAll(`${prefixo}_cpf`).map(String);
  const rgs = formData.getAll(`${prefixo}_rg`).map(String);
  const rgOrgaos = formData.getAll(`${prefixo}_rg_orgao`).map(String);
  const enderecos = formData.getAll(`${prefixo}_endereco`).map(String);

  return nomes
    .map((nome, i) => {
      nome = nome.trim();
      if (!nome) return "";

      const segmentos = [nome];

      const qualificacao = [nacionalidades[i], estadosCivis[i], profissoes[i]]
        .map((v) => v?.trim())
        .filter(Boolean)
        .join(", ");
      if (qualificacao) segmentos.push(qualificacao);

      const rg = rgs[i]?.trim();
      if (rg) {
        const orgao = rgOrgaos[i]?.trim();
        segmentos.push(`portador(a) do RG nº ${rg}${orgao ? ` - ${orgao}` : ""}`);
      }

      const cpf = cpfs[i]?.trim();
      if (cpf) segmentos.push(`inscrito(a) no CPF sob o nº ${cpf}`);

      const endereco = enderecos[i]?.trim();
      if (endereco) segmentos.push(`residente e domiciliado(a) em ${endereco}`);

      return segmentos.join(", ");
    })
    .filter(Boolean)
    .join("; ");
}

export async function gerarContrato(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: minhaImobiliaria } = await supabase
    .from("imobiliarias")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!minhaImobiliaria) {
    redirect(`/gerar-contrato?erro=${encodeURIComponent("Cadastre sua imobiliária primeiro.")}`);
  }
  const imobiliaria_id = minhaImobiliaria.id;

  const tipo_garantia_id = String(formData.get("tipo_garantia_id") ?? "");
  const produto_id = String(formData.get("produto_id") ?? "") || null;
  const seguro_incendio_produto_id = String(formData.get("seguro_incendio_produto_id") ?? "") || null;
  const locador = qualificarPessoas(formData, "locador");
  const locador_procurador = formData.get("locador_procurador") === "on";
  const locatario = qualificarPessoas(formData, "locatario");
  const ocupantes_adicionais = String(formData.get("ocupantes_adicionais") ?? "").trim();
  const endereco_imovel = String(formData.get("endereco_imovel") ?? "").trim();
  const finalidade = String(formData.get("finalidade") ?? "");
  const valor_aluguel = Number(formData.get("valor_aluguel"));
  const data_inicio = String(formData.get("data_inicio") ?? "");
  const prazo_meses = Number(formData.get("prazo_meses"));
  const dia_vencimento_aluguel = Number(formData.get("dia_vencimento_aluguel"));
  const laudo_modo = String(formData.get("laudo_modo") ?? "nenhum");
  const laudo_vistoria_url =
    laudo_modo === "link" ? String(formData.get("laudo_vistoria_url") ?? "").trim() : "";
  const fiador = qualificarPessoas(formData, "fiador");
  const valor_caucao_raw = String(formData.get("valor_caucao") ?? "").trim();
  const valor_caucao = valor_caucao_raw ? Number(valor_caucao_raw) : null;

  if (
    !tipo_garantia_id ||
    !locador ||
    !locatario ||
    !endereco_imovel ||
    !finalidade ||
    !valor_aluguel ||
    !data_inicio ||
    !prazo_meses ||
    !dia_vencimento_aluguel
  ) {
    redirect(`/gerar-contrato?erro=${encodeURIComponent("Preencha todos os campos obrigatórios.")}`);
  }

  let laudo_arquivo_path: string | null = null;
  let laudo_arquivo_nome: string | null = null;

  if (laudo_modo === "arquivo_separado" || laudo_modo === "arquivo_embutido") {
    const laudoArquivo = formData.get("laudo_arquivo") as File | null;
    if (laudoArquivo && laudoArquivo.size > 0) {
      if (laudo_modo === "arquivo_embutido" && !laudoArquivo.name.toLowerCase().endsWith(".pdf")) {
        redirect(
          `/gerar-contrato?erro=${encodeURIComponent(
            "Para incluir o laudo como páginas do contrato, o arquivo precisa estar em PDF."
          )}`
        );
      }
      const ext = laudoArquivo.name.split(".").pop() || "pdf";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("laudos")
        .upload(path, laudoArquivo, { contentType: laudoArquivo.type });
      if (uploadError) redirect(`/gerar-contrato?erro=${encodeURIComponent(uploadError.message)}`);
      laudo_arquivo_path = path;
      laudo_arquivo_nome = laudoArquivo.name;
    }
  }

  const [{ data: imobiliaria }, { data: tipoGarantia }, { data: produto }, { data: produtoIncendio }] =
    await Promise.all([
      supabase.from("imobiliarias").select("*").eq("id", imobiliaria_id).single(),
      supabase.from("tipos_garantia").select("nome").eq("id", tipo_garantia_id).single(),
      produto_id
        ? supabase
            .from("produtos")
            .select("nome, clausula_base, seguradoras(nome)")
            .eq("id", produto_id)
            .single()
        : Promise.resolve({ data: null }),
      seguro_incendio_produto_id
        ? supabase
            .from("produtos")
            .select("nome, clausula_base, seguradoras(nome)")
            .eq("id", seguro_incendio_produto_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);

  if (!imobiliaria || !tipoGarantia) {
    redirect(`/gerar-contrato?erro=${encodeURIComponent("Imobiliária ou tipo de garantia não encontrado.")}`);
  }

  const ehFiador = tipoGarantia.nome === "Fiador";
  const ehCaucao = tipoGarantia.nome === "Caução";

  let produtoNome: string | null = null;
  let seguradoraNome: string | null = null;
  let clausulaGarantiaBase = "";

  if (ehFiador || ehCaucao) {
    clausulaGarantiaBase = (ehFiador ? imobiliaria.clausula_fiador : imobiliaria.clausula_caucao) ?? "";
    if (!clausulaGarantiaBase) {
      redirect(
        `/gerar-contrato?erro=${encodeURIComponent(
          `Cadastre a cláusula de ${tipoGarantia.nome} no cadastro da imobiliária antes de gerar este contrato.`
        )}`
      );
    }
  } else {
    if (!produto) {
      redirect(`/gerar-contrato?erro=${encodeURIComponent("Produto não encontrado.")}`);
    }
    const seguradora = Array.isArray(produto.seguradoras) ? produto.seguradoras[0] : produto.seguradoras;
    produtoNome = produto.nome;
    seguradoraNome = seguradora?.nome ?? null;
    clausulaGarantiaBase = produto.clausula_base;
  }

  const seguradoraIncendio = produtoIncendio
    ? Array.isArray(produtoIncendio.seguradoras)
      ? produtoIncendio.seguradoras[0]
      : produtoIncendio.seguradoras
    : null;

  const partes = [
    `LOCADOR(ES): ${locador}${locador_procurador ? " (representado por procurador/administradora)" : ""}`,
    `LOCATÁRIO(S): ${locatario}`,
    ocupantes_adicionais && `OCUPANTES ADICIONAIS AUTORIZADOS: ${ocupantes_adicionais}`,
    `IMÓVEL: ${endereco_imovel}`,
    `FINALIDADE: ${finalidade === "residencial" ? "Residencial" : "Não residencial"}`,
    `VALOR DO ALUGUEL: R$ ${valor_aluguel.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    `DATA DE INÍCIO: ${data_inicio}`,
    `PRAZO: ${prazo_meses} meses`,
    `DATA DE TÉRMINO: ${calcularDataTermino(data_inicio, prazo_meses)}`,
    `DIA DE VENCIMENTO DO ALUGUEL: ${dia_vencimento_aluguel}`,
    fiador && `FIADOR(ES): ${fiador}`,
    valor_caucao && `VALOR DA CAUÇÃO: R$ ${valor_caucao.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
    laudo_modo === "link" &&
      laudo_vistoria_url &&
      `LAUDO DE VISTORIA INICIAL: ${laudo_vistoria_url}`,
    laudo_modo === "arquivo_separado" &&
      laudo_arquivo_nome &&
      `LAUDO DE VISTORIA INICIAL: documento anexo (${laudo_arquivo_nome}), entregue separadamente, parte integrante deste contrato.`,
    laudo_modo === "arquivo_embutido" &&
      laudo_arquivo_nome &&
      `LAUDO DE VISTORIA INICIAL: apresentado nas páginas seguintes deste contrato (disponível na versão em PDF completo), das quais é parte integrante.`,
  ]
    .filter(Boolean)
    .join("\n");

  const clausulasGarantia = [
    produtoNome
      ? `CLÁUSULA DE GARANTIA — ${tipoGarantia.nome} (${seguradoraNome ? `${seguradoraNome} — ` : ""}${produtoNome})`
      : `CLÁUSULA DE GARANTIA — ${tipoGarantia.nome}`,
    clausulaGarantiaBase,
  ].join("\n\n");

  const clausulaIncendio = produtoIncendio
    ? [
        `SEGURO INCÊNDIO (item obrigatório à parte — ${seguradoraIncendio?.nome} — ${produtoIncendio.nome})`,
        produtoIncendio.clausula_base,
      ].join("\n\n")
    : "";

  const textoBaseContrato = substituirPlaceholders(imobiliaria.texto_base_contrato, {
    diaVencimentoAluguel: dia_vencimento_aluguel,
    dataTermino: calcularDataTermino(data_inicio, prazo_meses),
  });

  const textoGerado = [
    "DADOS DA LOCAÇÃO",
    partes,
    "",
    "TEXTO-BASE DO CONTRATO (" + imobiliaria.nome + ")",
    textoBaseContrato,
    "",
    clausulasGarantia,
    "",
    clausulaIncendio,
    "",
    imobiliaria.plataforma_assinatura
      ? `Assinatura eletrônica via ${imobiliaria.plataforma_assinatura}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { data: contrato, error } = await supabase
    .from("contratos")
    .insert({
      imobiliaria_id,
      tipo_garantia_id,
      produto_id,
      seguro_incendio_produto_id,
      locador,
      locador_procurador,
      locatario,
      ocupantes_adicionais: ocupantes_adicionais || null,
      endereco_imovel,
      finalidade,
      valor_aluguel,
      data_inicio,
      prazo_meses,
      dia_vencimento_aluguel,
      fiador: fiador || null,
      valor_caucao,
      laudo_modo,
      laudo_vistoria_url: laudo_vistoria_url || null,
      laudo_arquivo_path,
      laudo_arquivo_nome,
      texto_gerado: textoGerado,
    })
    .select("id")
    .single();
  if (error) redirect(`/gerar-contrato?erro=${encodeURIComponent(error.message)}`);

  redirect(`/gerar-contrato?sucesso=${contrato.id}`);
}
