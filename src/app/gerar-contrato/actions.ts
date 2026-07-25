"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function gerarContrato(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");

  const { data: minhaImobiliaria } = await supabase
    .from("imobiliarias")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!minhaImobiliaria) throw new Error("Cadastre sua imobiliária primeiro.");
  const imobiliaria_id = minhaImobiliaria.id;

  const produto_id = String(formData.get("produto_id") ?? "");
  const seguro_incendio_produto_id = String(formData.get("seguro_incendio_produto_id") ?? "") || null;
  const locador = formData
    .getAll("locador_nomes")
    .map((v) => String(v).trim())
    .filter(Boolean)
    .join("; ");
  const locador_procurador = formData.get("locador_procurador") === "on";
  const locatario = formData
    .getAll("locatario_nomes")
    .map((v) => String(v).trim())
    .filter(Boolean)
    .join("; ");
  const ocupantes_adicionais = String(formData.get("ocupantes_adicionais") ?? "").trim();
  const endereco_imovel = String(formData.get("endereco_imovel") ?? "").trim();
  const finalidade = String(formData.get("finalidade") ?? "");
  const valor_aluguel = Number(formData.get("valor_aluguel"));
  const data_inicio = String(formData.get("data_inicio") ?? "");
  const prazo_meses = Number(formData.get("prazo_meses"));
  const laudo_vistoria_url = String(formData.get("laudo_vistoria_url") ?? "").trim();
  const cobertura_ids = formData.getAll("cobertura_ids").map(String);
  const cobertura_ids_incendio = formData.getAll("cobertura_ids_incendio").map(String);

  if (
    !produto_id ||
    !locador ||
    !locatario ||
    !endereco_imovel ||
    !finalidade ||
    !valor_aluguel ||
    !data_inicio ||
    !prazo_meses
  ) {
    return;
  }

  const todosCoberturaIds = [...cobertura_ids, ...cobertura_ids_incendio];

  const [{ data: imobiliaria }, { data: produto }, { data: produtoIncendio }, { data: coberturasTodas }] =
    await Promise.all([
      supabase.from("imobiliarias").select("*").eq("id", imobiliaria_id).single(),
      supabase
        .from("produtos")
        .select("nome, clausula_base, seguradoras(nome), tipos_garantia(nome)")
        .eq("id", produto_id)
        .single(),
      seguro_incendio_produto_id
        ? supabase
            .from("produtos")
            .select("nome, clausula_base, seguradoras(nome)")
            .eq("id", seguro_incendio_produto_id)
            .single()
        : Promise.resolve({ data: null }),
      todosCoberturaIds.length
        ? supabase.from("coberturas_adicionais").select("id, nome, texto").in("id", todosCoberturaIds)
        : Promise.resolve({ data: [] as { id: string; nome: string; texto: string }[] }),
    ]);

  if (!imobiliaria || !produto) throw new Error("Imobiliária ou produto não encontrado");

  const coberturasPorId = new Map((coberturasTodas ?? []).map((c) => [c.id, c]));
  const coberturasGarantia = cobertura_ids.map((id) => coberturasPorId.get(id)!).filter(Boolean);
  const coberturasIncendio = cobertura_ids_incendio.map((id) => coberturasPorId.get(id)!).filter(Boolean);

  const seguradora = Array.isArray(produto.seguradoras) ? produto.seguradoras[0] : produto.seguradoras;
  const tipoGarantia = Array.isArray(produto.tipos_garantia)
    ? produto.tipos_garantia[0]
    : produto.tipos_garantia;

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
    laudo_vistoria_url && `LAUDO DE VISTORIA INICIAL: ${laudo_vistoria_url}`,
  ]
    .filter(Boolean)
    .join("\n");

  const clausulasGarantia = [
    `CLÁUSULA DE GARANTIA — ${tipoGarantia?.nome} (${seguradora?.nome} — ${produto.nome})`,
    produto.clausula_base,
    ...coberturasGarantia.map((c) => `Cobertura adicional: ${c.nome}\n${c.texto}`),
  ].join("\n\n");

  const clausulaIncendio = produtoIncendio
    ? [
        `SEGURO INCÊNDIO (item obrigatório à parte — ${seguradoraIncendio?.nome} — ${produtoIncendio.nome})`,
        produtoIncendio.clausula_base,
        ...coberturasIncendio.map((c) => `Cobertura adicional: ${c.nome}\n${c.texto}`),
      ].join("\n\n")
    : "";

  const textoGerado = [
    "DADOS DA LOCAÇÃO",
    partes,
    "",
    "TEXTO-BASE DO CONTRATO (" + imobiliaria.nome + ")",
    imobiliaria.texto_base_contrato,
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
      laudo_vistoria_url: laudo_vistoria_url || null,
      texto_gerado: textoGerado,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (todosCoberturaIds.length) {
    const { error: covError } = await supabase
      .from("contratos_coberturas")
      .insert(todosCoberturaIds.map((cobertura_id) => ({ contrato_id: contrato.id, cobertura_id })));
    if (covError) throw new Error(covError.message);
  }

  revalidatePath("/gerar-contrato");
}
