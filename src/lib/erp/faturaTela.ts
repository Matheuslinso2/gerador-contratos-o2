import type { SupabaseClient } from "@supabase/supabase-js";

// ERP O2 — dados da tela de uma fatura (fase B, Matheus 26/10): movimento mês a mês (entradas e saídas explicadas
// sozinhas quando o ERP sabe o motivo) e as linhas com o valor cobrado pela seguradora e a comissão do extrato.
// Tolerância de conferência: R$ 0,05 por linha e R$ 1,00 por fatura (decisão do Matheus).
export const TOLERANCIA_ITEM = 0.05;
export const TOLERANCIA_FATURA = 1;

export type LinhaFatura = {
  id: number;
  ramo: string | null;
  apolice: string;
  endosso: string | null;
  parcela_n: number | null;
  parcelas_total: number | null;
  valor: number;
  documento_id: string | null;
  codigo_o2: number | null;
  cliente: string | null;
  situacao_doc: string | null;
  comissao_extrato: number | null;
};
export type Saida = { apolice: string; documento_id: string | null; codigo_o2: number | null; cliente: string | null; valor_anterior: number; explicacao: string | null; registrado?: { motivo: string; observacao: string | null; referencia: string | null; usuario_email: string | null; criado_em: string } };
export type MesFatura = { id: string; competencia: string; vencimento: string | null; valor_boleto: number | null; valor_itens: number; qtd_itens: number };

export async function fichaFatura(sb: SupabaseClient, faturaId: string, competencia?: string) {
  const { data: fatura } = await sb
    .from("erp_faturas")
    .select("id, seguradora, chave, ramo, corretora, codigo_corretor, imobiliaria_id, imobiliaria:imobiliarias(nome)")
    .eq("id", faturaId)
    .maybeSingle();
  if (!fatura) return null;
  const { data: mesesBrutos } = await sb.from("erp_fatura_meses").select("id, competencia, vencimento, valor_boleto, valor_itens, qtd_itens").eq("fatura_id", faturaId).order("competencia");
  const meses = ((mesesBrutos ?? []) as MesFatura[]).map((m) => ({ ...m, valor_boleto: m.valor_boleto === null ? null : Number(m.valor_boleto), valor_itens: Number(m.valor_itens) }));
  if (!meses.length) return { fatura, meses, mes: null, anterior: null, linhas: [], entradas: [], saidas: [] };
  const idx = competencia ? Math.max(0, meses.findIndex((m) => m.competencia === competencia)) : meses.length - 1;
  const mes = meses[idx];
  const anterior = idx > 0 ? meses[idx - 1] : null;

  const carregar = async (mesId: string) => {
    const { data } = await sb
      .from("erp_fatura_itens")
      .select("id, ramo, apolice, endosso, parcela_n, parcelas_total, valor, documento_id, doc:erp_documentos!erp_fatura_itens_documento_id_fkey(nosso_numero, situacao, vigencia_fim, modo_cobranca, cliente:locatarios!erp_documentos_locatario_id_fkey(nome))")
      .eq("fatura_mes_id", mesId)
      .order("apolice");
    type Bruta = Omit<LinhaFatura, "codigo_o2" | "cliente" | "situacao_doc" | "comissao_extrato"> & {
      doc: { nosso_numero: number; situacao: string; vigencia_fim: string | null; modo_cobranca: string | null; cliente: { nome: string } | null } | null;
    };
    return (data ?? []) as unknown as Bruta[];
  };
  const [atual, ant] = await Promise.all([carregar(mes.id), anterior ? carregar(anterior.id) : Promise.resolve([])]);

  // comissão no extrato das apólices desta fatura (linhas do extrato ligadas ao mesmo documento e parcela)
  const docs = [...new Set(atual.map((l) => l.documento_id).filter(Boolean))] as string[];
  const comissao = new Map<string, number>();
  for (let i = 0; i < docs.length; i += 150) {
    const { data } = await sb.from("erp_extrato_linhas").select("documento_id, parcela, valor_comissao").in("documento_id", docs.slice(i, i + 150));
    for (const e of (data ?? []) as { documento_id: string; parcela: string | null; valor_comissao: number }[]) {
      const n = Number(String(e.parcela ?? "").split("/")[0]) || 0;
      const k = `${e.documento_id}|${n}`;
      comissao.set(k, (comissao.get(k) ?? 0) + Number(e.valor_comissao));
    }
  }
  const linhas: LinhaFatura[] = atual.map((l) => ({
    id: l.id,
    ramo: l.ramo,
    apolice: l.apolice,
    endosso: l.endosso,
    parcela_n: l.parcela_n,
    parcelas_total: l.parcelas_total,
    valor: Number(l.valor),
    documento_id: l.documento_id,
    codigo_o2: l.doc?.nosso_numero ?? null,
    cliente: l.doc?.cliente?.nome ?? null,
    situacao_doc: l.doc?.situacao ?? null,
    comissao_extrato: l.documento_id ? comissao.get(`${l.documento_id}|${l.parcela_n ?? 0}`) ?? null : null,
  }));

  const noAtual = new Set(atual.map((l) => l.apolice));
  const noAnterior = new Set(ant.map((l) => l.apolice));
  const entradas = linhas.filter((l) => !noAnterior.has(l.apolice));
  // saídas: a explicação vem do que o ERP já sabe (última parcela, endosso de cancelamento, apólice encerrada, outra
  // forma de pagamento); o resto fica "sem explicação" — a tratativa por e-mail da imobiliária, o card de renovação ou o
  // endosso precisam dizer (decisão do Matheus 26/10)
  const saidasBrutas = anterior ? ant.filter((l) => !noAtual.has(l.apolice)) : [];
  const idsSaida = [...new Set(saidasBrutas.map((l) => l.documento_id).filter(Boolean))] as string[];
  const cancelados = new Set<string>();
  if (idsSaida.length) {
    const { data } = await sb.from("erp_documentos").select("documento_pai_id").in("documento_pai_id", idsSaida).in("tipo", ["X", "I"]);
    for (const e of (data ?? []) as { documento_pai_id: string }[]) cancelados.add(e.documento_pai_id);
  }
  // motivos registrados pela equipe para este mês (tratativa por e-mail, card de renovação, endosso)
  const { data: movs } = await sb.from("erp_fatura_movimentacoes").select("apolice, motivo, observacao, referencia, usuario_email, criado_em").eq("fatura_id", faturaId).eq("competencia", mes.competencia).eq("movimento", "saida");
  const registrados = new Map(((movs ?? []) as NonNullable<Saida["registrado"]>[] & { apolice: string }[]).map((m) => [(m as unknown as { apolice: string }).apolice, m]));
  const vistos = new Set<string>();
  const saidas: Saida[] = [];
  for (const l of saidasBrutas) {
    if (vistos.has(l.apolice)) continue;
    vistos.add(l.apolice);
    let explicacao: string | null = null;
    if (l.parcela_n && l.parcelas_total && l.parcela_n >= l.parcelas_total) explicacao = "última parcela cobrada no mês anterior";
    else if (l.documento_id && cancelados.has(l.documento_id)) explicacao = "endosso de cancelamento";
    else if (l.doc?.situacao === "cancelado") explicacao = "apólice cancelada";
    else if (l.doc?.vigencia_fim && mes.vencimento && l.doc.vigencia_fim < mes.vencimento) explicacao = "vigência encerrada";
    else if (l.doc?.modo_cobranca && !["fatura", "nao_informado", "individual"].includes(l.doc.modo_cobranca)) explicacao = `passou para ${l.doc.modo_cobranca}`;
    const reg = registrados.get(l.apolice);
    saidas.push({ apolice: l.apolice, documento_id: l.documento_id, codigo_o2: l.doc?.nosso_numero ?? null, cliente: l.doc?.cliente?.nome ?? null, valor_anterior: Number(l.valor), explicacao: explicacao ?? (reg ? reg.motivo : null), registrado: reg });
  }
  return { fatura, meses, mes, anterior, linhas, entradas, saidas };
}

/** Lista de faturas com o último mês (para a etapa Faturas). */
export async function listarFaturas(sb: SupabaseClient, f: { seguradora?: string; imobiliaria?: string; mes?: string }) {
  let q = sb
    .from("erp_fatura_meses")
    .select("id, competencia, vencimento, valor_boleto, valor_itens, qtd_itens, fatura:erp_faturas!inner(id, seguradora, chave, corretora, imobiliaria:imobiliarias!inner(nome))")
    .order("competencia", { ascending: false });
  if (f.seguradora) q = q.eq("fatura.seguradora", ({ TOKI: "TOKIO", PORT: "PORTO", POTT: "POTTENCIAL", TOO: "TOO", YELU: "YELUM" } as Record<string, string>)[f.seguradora] ?? "—");
  if (f.imobiliaria) q = q.ilike("fatura.imobiliaria.nome", `%${f.imobiliaria.replace(/[%_,()]/g, "")}%`);
  if (f.mes) q = q.eq("competencia", f.mes);
  const { data } = await q.limit(2000);
  type Linha = { id: string; competencia: string; vencimento: string | null; valor_boleto: number | null; valor_itens: number; qtd_itens: number; fatura: { id: string; seguradora: string; chave: string; corretora: string | null; imobiliaria: { nome: string } } };
  const ultimo = new Map<string, Linha & { anterior_itens: number | null }>();
  const porFatura = new Map<string, Linha[]>();
  for (const l of (data ?? []) as unknown as Linha[]) porFatura.set(l.fatura.id, [...(porFatura.get(l.fatura.id) ?? []), l]);
  for (const [id, ls] of porFatura) ultimo.set(id, { ...ls[0], anterior_itens: ls[1]?.qtd_itens ?? null });
  return [...ultimo.values()].sort((a, b) => a.fatura.imobiliaria.nome.localeCompare(b.fatura.imobiliaria.nome) || a.fatura.seguradora.localeCompare(b.fatura.seguradora));
}
