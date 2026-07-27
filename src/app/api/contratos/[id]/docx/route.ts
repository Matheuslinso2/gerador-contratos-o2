import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gerarContratoDocx } from "@/lib/gerarContratoDocx";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { data: contrato, error } = await supabase
    .from("contratos")
    .select("*, imobiliarias(*)")
    .eq("id", id)
    .single();

  if (error || !contrato) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }

  const imobiliaria = Array.isArray(contrato.imobiliarias) ? contrato.imobiliarias[0] : contrato.imobiliarias;

  if (imobiliaria.user_id !== user.id) {
    return NextResponse.json({ error: "Sem permissão para este contrato" }, { status: 403 });
  }

  const [{ data: tipoGarantiaDireto }, { data: produto }, { data: produtoIncendio }, { data: coberturasVinculadas }] =
    await Promise.all([
      contrato.tipo_garantia_id
        ? supabase.from("tipos_garantia").select("nome").eq("id", contrato.tipo_garantia_id).single()
        : Promise.resolve({ data: null }),
      contrato.produto_id
        ? supabase
            .from("produtos")
            .select("nome, clausula_base, seguradoras(nome), tipos_garantia(nome)")
            .eq("id", contrato.produto_id)
            .single()
        : Promise.resolve({ data: null }),
      contrato.seguro_incendio_produto_id
        ? supabase
            .from("produtos")
            .select("nome, clausula_base, seguradoras(nome)")
            .eq("id", contrato.seguro_incendio_produto_id)
            .single()
        : Promise.resolve({ data: null }),
      supabase
        .from("contratos_coberturas")
        .select("coberturas_adicionais(nome, texto, produto_id)")
        .eq("contrato_id", id),
    ]);

  if (!produto && !tipoGarantiaDireto) {
    return NextResponse.json({ error: "Garantia do contrato não encontrada" }, { status: 404 });
  }

  const todasCoberturas = (coberturasVinculadas ?? []).map((c) => {
    const cob = Array.isArray(c.coberturas_adicionais) ? c.coberturas_adicionais[0] : c.coberturas_adicionais;
    return cob!;
  });

  const coberturas = contrato.produto_id
    ? todasCoberturas
        .filter((c) => c.produto_id === contrato.produto_id)
        .map((c) => ({ nome: c.nome, texto: c.texto }))
    : [];
  const coberturasIncendio = todasCoberturas
    .filter((c) => c.produto_id === contrato.seguro_incendio_produto_id)
    .map((c) => ({ nome: c.nome, texto: c.texto }));

  const seguradora = produto ? (Array.isArray(produto.seguradoras) ? produto.seguradoras[0] : produto.seguradoras) : null;
  const tipoGarantiaDoProduto = produto
    ? Array.isArray(produto.tipos_garantia)
      ? produto.tipos_garantia[0]
      : produto.tipos_garantia
    : null;
  const tipoGarantiaNome = tipoGarantiaDireto?.nome ?? tipoGarantiaDoProduto?.nome ?? "";

  const ehFiador = tipoGarantiaNome === "Fiador";
  const ehCaucao = tipoGarantiaNome === "Caução";
  const clausulaBase = produto
    ? produto.clausula_base
    : ehFiador
      ? imobiliaria.clausula_fiador ?? ""
      : ehCaucao
        ? imobiliaria.clausula_caucao ?? ""
        : "";

  const seguradoraIncendio = produtoIncendio
    ? Array.isArray(produtoIncendio.seguradoras)
      ? produtoIncendio.seguradoras[0]
      : produtoIncendio.seguradoras
    : null;

  const buffer = await gerarContratoDocx({
    imobiliaria,
    tipoGarantiaNome,
    seguradoraNome: seguradora?.nome ?? null,
    produtoNome: produto?.nome ?? null,
    clausulaBase,
    coberturas,
    seguroIncendio: produtoIncendio
      ? {
          seguradoraNome: seguradoraIncendio!.nome,
          produtoNome: produtoIncendio.nome,
          clausulaBase: produtoIncendio.clausula_base,
          coberturas: coberturasIncendio,
        }
      : null,
    locador: contrato.locador,
    locadorProcurador: contrato.locador_procurador,
    locatario: contrato.locatario,
    ocupantesAdicionais: contrato.ocupantes_adicionais,
    enderecoImovel: contrato.endereco_imovel,
    finalidade: contrato.finalidade,
    valorAluguel: contrato.valor_aluguel,
    dataInicio: contrato.data_inicio,
    prazoMeses: contrato.prazo_meses,
    fiador: contrato.fiador,
    valorCaucao: contrato.valor_caucao,
    laudoModo: contrato.laudo_modo ?? "nenhum",
    laudoVistoriaUrl: contrato.laudo_vistoria_url,
    laudoArquivoNome: contrato.laudo_arquivo_nome,
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="contrato-${contrato.locatario.replace(/\s+/g, "-")}.docx"`,
    },
  });
}
