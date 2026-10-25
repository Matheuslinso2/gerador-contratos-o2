import type { SupabaseClient } from "@supabase/supabase-js";

// ERP O2 — Fase 0: consulta de documentos (só leitura). Espelha a "Consulta de
// Documentos" do Corp: busca por Nosso Nº, nº da apólice, cliente ou imobiliária.
// Os dados vêm de erp_documentos (carregados do espelho do Corp pela
// erp_importar_corp; ver supabase/schema_erp_fase0_carga.sql).

export type DocumentoLista = {
  id: string;
  nosso_numero: number;
  nosso_numero_corp: number | null;
  tipo: string;
  tipo_corp: string | null;
  numero_apolice: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  premio_liquido: number;
  premio_total: number;
  comissao_valor: number;
  situacao: string;
  canal_venda: string | null;
  seguradora: string | null;
  ramo: string | null;
  cliente: string | null;
  imobiliaria: string | null;
  imobiliaria_id: string | null;
};

export const SITUACOES: Record<string, string> = {
  cotacao: "Cotação",
  proposta: "Proposta",
  recusado: "Recusado (cotação)",
  perdido: "Perdido (negociação)",
  digitado: "Efetivada · em emissão",
  emitido: "Emitido",
  vigente: "Vigente",
  vencido: "Vencido",
  cancelado: "Cancelado",
  devolvido: "Devolvido",
};

export const TIPOS_DOCUMENTO: Record<string, string> = {
  A: "Apólice",
  C: "Endosso de cobrança",
  D: "Devolução de documento",
  F: "Fatura",
  I: "End. cancelamento de item",
  M: "Endosso sem prêmio",
  R: "Endosso de restituição",
  X: "End. cancelamento de apólice",
};

export const TIPO_CORP: Record<string, string> = { NOVO: "Novo", RENV: "Renovação", END: "Endosso", FAT: "Fatura", CANC: "Cancelamento" };

// Decisão 3 do Matheus (25/10): nem todo produto tem imobiliária; só o modo fatura exige produtor.
export const TIPO_CONTRATACAO: Record<string, string> = {
  indicacao_imobiliaria: "Indicação de imobiliária",
  venda_direta: "Venda direta O2",
  frota: "Frota",
  canal: "Canal (Superlógica/Base/Segimob)",
};
export const MODO_COBRANCA: Record<string, string> = {
  nao_informado: "Não informada",
  fatura: "Fatura da imobiliária",
  boleto: "Boleto (cliente paga)",
  cartao: "Cartão (cliente paga)",
  debito: "Débito (cliente paga)",
  individual: "Individual (legado, sem detalhe)",
};

const SELECT_LISTA =
  "id, nosso_numero, nosso_numero_corp, tipo, tipo_corp, numero_apolice, vigencia_inicio, vigencia_fim, premio_liquido, premio_total, comissao_valor, situacao, canal_venda, imobiliaria_principal_id, seguradora:erp_seguradoras(abreviacao), ramo:erp_ramos(abreviacao), cliente:locatarios(nome), imobiliaria:imobiliarias!erp_documentos_imobiliaria_principal_id_fkey(nome)";

type LinhaBruta = {
  id: string;
  nosso_numero: number;
  nosso_numero_corp: number | null;
  tipo: string;
  tipo_corp: string | null;
  numero_apolice: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  premio_liquido: number;
  premio_total: number;
  comissao_valor: number;
  situacao: string;
  canal_venda: string | null;
  imobiliaria_principal_id: string | null;
  seguradora: { abreviacao: string } | null;
  ramo: { abreviacao: string } | null;
  cliente: { nome: string } | null;
  imobiliaria: { nome: string } | null;
};

function mapear(r: LinhaBruta): DocumentoLista {
  return {
    id: r.id,
    nosso_numero: r.nosso_numero,
    nosso_numero_corp: r.nosso_numero_corp,
    tipo: r.tipo,
    tipo_corp: r.tipo_corp,
    numero_apolice: r.numero_apolice,
    vigencia_inicio: r.vigencia_inicio,
    vigencia_fim: r.vigencia_fim,
    premio_liquido: Number(r.premio_liquido),
    premio_total: Number(r.premio_total),
    comissao_valor: Number(r.comissao_valor),
    situacao: r.situacao,
    canal_venda: r.canal_venda,
    seguradora: r.seguradora?.abreviacao ?? null,
    ramo: r.ramo?.abreviacao ?? null,
    cliente: r.cliente?.nome ?? null,
    imobiliaria: r.imobiliaria?.nome ?? null,
    imobiliaria_id: r.imobiliaria_principal_id,
  };
}

export type FiltrosBusca = { busca: string; situacao?: string; limite?: number };

/**
 * Busca de documentos. Número puro = Nosso Nº ou nº da apólice; texto = nome do
 * cliente (cofre) ou da imobiliária. Sem busca, mostra os mais recentes por início
 * de vigência.
 */
export async function buscarDocumentos(sb: SupabaseClient, f: FiltrosBusca): Promise<{ linhas: DocumentoLista[]; total: number | null }> {
  const limite = Math.min(Math.max(f.limite ?? 50, 10), 200);
  const termo = f.busca.trim();
  // premissa de desempenho do ERP: contagem só quando há filtro (contar/estimar os 120 mil com os vínculos custava 2–8 s);
  // sem filtro a tela mostra os mais recentes e total = null
  let q = sb.from("erp_documentos").select(SELECT_LISTA, termo || f.situacao ? { count: "exact" } : undefined);
  if (f.situacao) q = q.eq("situacao", f.situacao);

  if (termo && /^\d+$/.test(termo)) {
    q = q.or(`nosso_numero.eq.${termo},nosso_numero_corp.eq.${termo},numero_apolice.eq.${termo}`);
  } else if (termo) {
    // nomes: até 300 ids de clientes + imobiliárias que casam com o termo
    const like = `%${termo.replace(/[%_]/g, "")}%`;
    const [{ data: cli }, { data: imobs }] = await Promise.all([
      sb.from("locatarios").select("id").ilike("nome", like).limit(300),
      sb.from("imobiliarias").select("id").or(`nome.ilike.${like},apelido.ilike.${like}`).limit(50),
    ]);
    const idsCli = (cli ?? []).map((c) => c.id);
    const idsImob = (imobs ?? []).map((i) => i.id);
    if (!idsCli.length && !idsImob.length) return { linhas: [], total: 0 };
    const partes: string[] = [];
    if (idsCli.length) partes.push(`locatario_id.in.(${idsCli.join(",")})`);
    if (idsImob.length) partes.push(`imobiliaria_principal_id.in.(${idsImob.join(",")})`);
    q = q.or(partes.join(","));
  }

  const { data, count, error } = await q.order("vigencia_inicio", { ascending: false }).order("nosso_numero", { ascending: false }).limit(limite);
  if (error) throw new Error(`erp_documentos: ${error.message}`);
  return { linhas: ((data ?? []) as unknown as LinhaBruta[]).map(mapear), total: count };
}

export type DocumentoFicha = DocumentoLista & {
  corretora: string | null;
  tipo_contratacao: string | null;
  modo_cobranca: string;
  locatario_id: string | null;
  numero_proposta: string | null;
  numero_endosso: string | null;
  dt_proposta: string | null;
  dt_emissao: string | null;
  qtd_parcelas: number | null;
  forma_pagamento: string | null;
  premio_adicional: number;
  iof: number;
  comissao_pct: number;
  comissao_base: string;
  premiacao_valor: number;
  cancelado_em: string | null;
  competencia: string;
  congelado: boolean;
  fora_regra_pbi: boolean;
  origem: string;
  observacoes: string | null;
  digitado_em: string | null;
  produtores: ProdutorDoc[];
  parcelas: ParcelaDoc[];
  anexos: AnexoDoc[];
  eventos: EventoDoc[];
  renovacao_de: { id: string; nosso_numero: number } | null;
  renovado_por: { id: string; nosso_numero: number }[];
  revisao_pendente: boolean;
  revisado_por_email: string | null;
  itens: ItemDoc[];
  origens: OrigemDoc[];
  familia: FamiliaDoc[];
  cadeia: { canal: string | null; imobiliaria: string | null; grupo: string | null; cliente: string | null };
};
/** Corrente de renovações (como a coluna esquerda do Controle de Documentos do Corp). */
export type FamiliaDoc = {
  id: string;
  nosso_numero: number;
  nosso_numero_corp: number | null;
  tipo_corp: string | null;
  situacao: string;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  numero_apolice: string | null;
  nivel: number;
};
export type ItemDoc = {
  id: string;
  item_n: number;
  administrado: boolean | null;
  tipo_imovel: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  valor_aluguel: number | null;
  plano: string | null;
  observacoes: string | null;
  partes: { papel: string; nome: string | null; documento_numero: string | null; ordem: number }[];
  coberturas: { nome: string; importancia_segurada: number | null }[];
};
export type OrigemDoc = {
  id: string;
  sistema: string;
  entity_type_id: number | null;
  item_id: number;
  titulo: string | null;
  url: string | null;
  etapa_id: string | null;
  dados_legiveis: Record<string, unknown>;
  historico_etapas: { quando: string; categoria: number; etapa: string; semantica: string | null }[];
  comentarios: { quando: string; autor: number | null; texto: string }[];
  comentarios_capturados_em: string | null;
  card_criado_em: string | null;
  card_atualizado_em: string | null;
  capturado_em: string;
};
export type ProdutorDoc = {
  id: string;
  imobiliaria_id: string | null;
  imobiliaria: string | null;
  produtor_corp_codigo: number | null;
  produtor_corp_nome: string | null;
  agente: string;
  principal: boolean;
  pct_participacao: number;
  repasse_pct: number;
  repasse_valor_previsto: number;
  repasse_pct_esperado: number | null;
  motivo_diferenca: string | null;
  forma_repasse: string;
};
export type ParcelaDoc = {
  id: string;
  n: number;
  vencimento: string;
  valor: number;
  quitada_em: string | null;
  valor_quitado: number | null;
  origem: string;
  comissao_prevista: number;
  comissao_status: string | null;
  comissao_previsao: string | null;
};
export type AnexoDoc = { id: string; tipo: string; arquivo_nome: string | null; fonte: string | null; numero_apolice: string | null };
export type EventoDoc = { id: string; tipo: string; data: string; canal: string | null; destinatario: string | null; usuario_email: string | null };

export async function buscarFichaDocumento(sb: SupabaseClient, id: string): Promise<DocumentoFicha | null> {
  const { data, error } = await sb
    .from("erp_documentos")
    .select(
      SELECT_LISTA +
        ", corretora:erp_corretoras(apelido), canal:erp_canais(nome), imob_grupo:imobiliarias!erp_documentos_imobiliaria_principal_id_fkey(grupo:imobiliaria_grupos(nome)), tipo_contratacao, modo_cobranca, revisao_pendente, revisado_por_email, locatario_id, numero_proposta, numero_endosso, dt_proposta, dt_emissao, qtd_parcelas, forma_pagamento, premio_adicional, iof, comissao_pct, comissao_base, premiacao_valor, cancelado_em, competencia, congelado, fora_regra_pbi, origem, observacoes, digitado_em, documento_renovado_id"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`erp_documentos: ${error.message}`);
  if (!data) return null;
  const d = data as unknown as LinhaBruta & {
    corretora: { apelido: string } | null;
    canal: { nome: string } | null;
    imob_grupo: { grupo: { nome: string } | null } | null;
    tipo_contratacao: string | null;
    modo_cobranca: string;
    revisao_pendente: boolean;
    revisado_por_email: string | null;
    locatario_id: string | null;
    numero_proposta: string | null;
    numero_endosso: string | null;
    dt_proposta: string | null;
    dt_emissao: string | null;
    qtd_parcelas: number | null;
    forma_pagamento: string | null;
    premio_adicional: number;
    iof: number;
    comissao_pct: number;
    comissao_base: string;
    premiacao_valor: number;
    cancelado_em: string | null;
    competencia: string;
    congelado: boolean;
    fora_regra_pbi: boolean;
    origem: string;
    observacoes: string | null;
    digitado_em: string | null;
    documento_renovado_id: string | null;
  };

  const [{ data: prods }, { data: parcs }, { data: anexos }, { data: eventos }, { data: renovadoDe }, { data: renovadoPor }, { data: itens }, { data: origens }, { data: familia }] = await Promise.all([
    sb
      .from("erp_documento_produtores")
      .select("id, imobiliaria_id, produtor_corp_codigo, produtor_corp_nome, agente, principal, pct_participacao, repasse_pct, repasse_valor_previsto, repasse_pct_esperado, motivo_diferenca, forma_repasse, imobiliaria:imobiliarias(nome)")
      .eq("documento_id", id)
      .order("principal", { ascending: false }),
    sb
      .from("erp_parcelas")
      .select("id, n, vencimento, valor, quitada_em, valor_quitado, origem, comissoes:erp_comissoes(valor_previsto, status, previsao_recebimento)")
      .eq("documento_id", id)
      .order("n"),
    // acervo de PDFs (apolice_documentos) ligado pelo Nosso Nº do Corp — o ERP ainda não grava erp_documento_anexos na carga
    d.nosso_numero_corp
      ? sb.from("apolice_documentos").select("id, arquivo_nome, fonte, numero_apolice, produto").eq("nosso_numero", String(d.nosso_numero_corp)).limit(10)
      : Promise.resolve({ data: [] as { id: string; arquivo_nome: string | null; fonte: string | null; numero_apolice: string | null; produto: string | null }[] }),
    sb.from("erp_documento_eventos").select("id, tipo, data, canal, destinatario, usuario_email").eq("documento_id", id).order("data", { ascending: false }).limit(50),
    d.documento_renovado_id ? sb.from("erp_documentos").select("id, nosso_numero").eq("id", d.documento_renovado_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("erp_documentos").select("id, nosso_numero").eq("documento_renovado_id", id).limit(10),
    sb
      .from("erp_documento_itens")
      .select("id, item_n, administrado, tipo_imovel, logradouro, numero, complemento, cidade, uf, cep, valor_aluguel, plano, observacoes, partes:erp_item_partes(papel, nome, documento_numero, ordem), coberturas:erp_item_coberturas(nome, importancia_segurada)")
      .eq("documento_id", id)
      .order("item_n"),
    sb
      .from("erp_origens")
      .select("id, sistema, entity_type_id, item_id, titulo, url, etapa_id, dados_legiveis, historico_etapas, comentarios, comentarios_capturados_em, card_criado_em, card_atualizado_em, capturado_em")
      .eq("documento_id", id)
      .order("capturado_em", { ascending: false }),
    sb.rpc("erp_familia_documento", { p_id: id }),
  ]);

  type ProdBruto = Omit<ProdutorDoc, "imobiliaria"> & { imobiliaria: { nome: string } | null };
  type ParcBruta = Omit<ParcelaDoc, "comissao_prevista" | "comissao_status" | "comissao_previsao"> & {
    comissoes: { valor_previsto: number; status: string; previsao_recebimento: string | null }[] | null;
  };

  return {
    ...mapear(d),
    corretora: d.corretora?.apelido ?? null,
    tipo_contratacao: d.tipo_contratacao,
    modo_cobranca: d.modo_cobranca,
    locatario_id: d.locatario_id,
    numero_proposta: d.numero_proposta,
    numero_endosso: d.numero_endosso,
    dt_proposta: d.dt_proposta,
    dt_emissao: d.dt_emissao,
    qtd_parcelas: d.qtd_parcelas,
    forma_pagamento: d.forma_pagamento,
    premio_adicional: Number(d.premio_adicional),
    iof: Number(d.iof),
    comissao_pct: Number(d.comissao_pct),
    comissao_base: d.comissao_base,
    premiacao_valor: Number(d.premiacao_valor),
    cancelado_em: d.cancelado_em,
    competencia: d.competencia,
    congelado: d.congelado,
    fora_regra_pbi: d.fora_regra_pbi,
    origem: d.origem,
    observacoes: d.observacoes,
    digitado_em: d.digitado_em,
    produtores: ((prods ?? []) as unknown as ProdBruto[]).map((p) => ({
      ...p,
      pct_participacao: Number(p.pct_participacao),
      repasse_pct: Number(p.repasse_pct),
      repasse_valor_previsto: Number(p.repasse_valor_previsto),
      repasse_pct_esperado: p.repasse_pct_esperado === null ? null : Number(p.repasse_pct_esperado),
      imobiliaria: p.imobiliaria?.nome ?? null,
    })),
    parcelas: ((parcs ?? []) as unknown as ParcBruta[]).map((p) => {
      const c = p.comissoes?.[0];
      return {
        id: p.id,
        n: p.n,
        vencimento: p.vencimento,
        valor: Number(p.valor),
        quitada_em: p.quitada_em,
        valor_quitado: p.valor_quitado === null ? null : Number(p.valor_quitado),
        origem: p.origem,
        comissao_prevista: c ? Number(c.valor_previsto) : 0,
        comissao_status: c?.status ?? null,
        comissao_previsao: c?.previsao_recebimento ?? null,
      };
    }),
    anexos: ((anexos ?? []) as { id: string; arquivo_nome: string | null; fonte: string | null; numero_apolice: string | null; produto: string | null }[]).map((a) => ({
      id: a.id,
      tipo: "apolice",
      arquivo_nome: a.arquivo_nome,
      fonte: a.fonte,
      numero_apolice: a.numero_apolice,
    })),
    eventos: (eventos ?? []) as EventoDoc[],
    renovacao_de: (renovadoDe as { id: string; nosso_numero: number } | null) ?? null,
    renovado_por: (renovadoPor ?? []) as { id: string; nosso_numero: number }[],
    revisao_pendente: !!d.revisao_pendente,
    revisado_por_email: d.revisado_por_email,
    itens: ((itens ?? []) as unknown as (Omit<ItemDoc, "valor_aluguel" | "partes" | "coberturas"> & { valor_aluguel: number | string | null; partes: ItemDoc["partes"] | null; coberturas: { nome: string; importancia_segurada: number | string | null }[] | null })[]).map((i) => ({
      ...i,
      valor_aluguel: i.valor_aluguel === null ? null : Number(i.valor_aluguel),
      partes: [...(i.partes ?? [])].sort((a, b) => a.ordem - b.ordem),
      coberturas: (i.coberturas ?? []).map((c) => ({ nome: c.nome, importancia_segurada: c.importancia_segurada === null ? null : Number(c.importancia_segurada) })),
    })),
    origens: (origens ?? []) as unknown as OrigemDoc[],
    cadeia: { canal: d.canal?.nome ?? null, imobiliaria: d.imobiliaria?.nome ?? null, grupo: d.imob_grupo?.grupo?.nome ?? null, cliente: d.cliente?.nome ?? null },
    familia: ((familia ?? []) as FamiliaDoc[]).map((f) => ({ ...f, nosso_numero: Number(f.nosso_numero), nosso_numero_corp: f.nosso_numero_corp === null ? null : Number(f.nosso_numero_corp) })),
  };
}

export type RegraRepasse = {
  id: string;
  seguradora: string | null;
  ramo: string | null;
  base_calculo: string;
  pct_novo: number;
  pct_renovado: number;
  valor_fixo: number | null;
  forma_repasse: string;
  pct_retencao_imposto: number | null;
  origem: string;
  observacao: string | null;
  vigente_de: string;
  vigente_ate: string | null;
};

/** Regras ESPERADAS de repasse de uma imobiliária (ficha). */
export async function buscarRegrasRepasse(sb: SupabaseClient, imobiliariaId: string): Promise<RegraRepasse[]> {
  const { data, error } = await sb
    .from("erp_repasse_regras")
    .select("id, base_calculo, pct_novo, pct_renovado, valor_fixo, forma_repasse, pct_retencao_imposto, origem, observacao, vigente_de, vigente_ate, seguradora:erp_seguradoras(abreviacao), ramo:erp_ramos(abreviacao)")
    .eq("imobiliaria_id", imobiliariaId)
    .is("vigente_ate", null)
    .order("vigente_de");
  if (error) throw new Error(`erp_repasse_regras: ${error.message}`);
  type Bruta = Omit<RegraRepasse, "seguradora" | "ramo"> & { seguradora: { abreviacao: string } | null; ramo: { abreviacao: string } | null };
  return ((data ?? []) as unknown as Bruta[]).map((r) => ({
    ...r,
    pct_novo: Number(r.pct_novo),
    pct_renovado: Number(r.pct_renovado),
    valor_fixo: r.valor_fixo === null ? null : Number(r.valor_fixo),
    pct_retencao_imposto: r.pct_retencao_imposto === null ? null : Number(r.pct_retencao_imposto),
    seguradora: r.seguradora?.abreviacao ?? null,
    ramo: r.ramo?.abreviacao ?? null,
  }));
}
