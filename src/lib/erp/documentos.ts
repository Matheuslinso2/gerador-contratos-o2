import { idsImobiliarias } from "@/lib/erp/filtros";
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
  /** cabeçalho padrão (Matheus 28/10): nomes comerciais */
  seguradora_nome: string | null;
  produto_nome: string | null;
  produto: string | null;
  documento_pai_id: string | null;
  modo_cobranca: string | null;
  /** titular do seguro: Fiança = proprietário (segurado/locador); demais produtos = segurado/cliente do documento */
  titular: string | null;
  /** Fiança: inquilino (garantido); demais produtos: null */
  inquilino: string | null;
};

export const SITUACOES: Record<string, string> = {
  cotacao: "Cotação (em negociação)",
  proposta: "Proposta (em emissão)",
  recusado: "Recusado (cotação)",
  perdido: "Perdido (negociação)",
  vigente: "Apólice vigente",
  vencido: "Vencido",
  cancelado: "Cancelado",
  duplicado: "Duplicado (juntado ao documento do Corp)",
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

/** Nome por extenso do tipo do documento (Matheus 25/10: deixar explícito se é apólice nova, renovada, endosso…). */
export function nomeTipoDocumento(tipo: string, tipoCorp: string | null): { nome: string; cor: string } {
  if (tipo === "A") return tipoCorp === "RENV" ? { nome: "Apólice renovada", cor: "bg-indigo-100 text-indigo-800" } : { nome: "Apólice nova", cor: "bg-green-100 text-green-800" };
  if (tipo === "F") return { nome: "Fatura", cor: "bg-sky-100 text-sky-800" };
  const nomes: Record<string, string> = {
    C: "Endosso de cobrança",
    D: "Devolução de documento",
    I: "Endosso de cancelamento de item",
    M: "Endosso sem prêmio",
    R: "Endosso de restituição",
    X: "Endosso de cancelamento da apólice",
  };
  return { nome: nomes[tipo] ?? tipo, cor: tipo === "X" || tipo === "I" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800" };
}

/** Tipo de documento do cabeçalho (Matheus 28/10): Proposta · Apólice · Apólice na Fatura · Endosso · Fatura. */
export function tipoDoCabecalho(d: { tipo: string; tipo_corp: string | null; situacao: string; modo_cobranca: string | null }): { nome: string; detalhe: string | null; cor: string } {
  if (d.situacao === "cotacao") return { nome: "Cotação", detalhe: null, cor: "bg-orange-100 text-orange-800" };
  if (d.situacao === "proposta" && d.tipo === "A") return { nome: "Proposta", detalhe: d.tipo_corp === "RENV" ? "renovação" : "nova", cor: "bg-yellow-100 text-yellow-800" };
  if (d.tipo === "F") return { nome: "Fatura", detalhe: null, cor: "bg-sky-100 text-sky-800" };
  if (d.tipo === "A") return { nome: d.modo_cobranca === "fatura" ? "Apólice na Fatura" : "Apólice", detalhe: d.tipo_corp === "RENV" ? "renovação" : "nova", cor: "bg-green-100 text-green-800" };
  const nomes: Record<string, string> = { C: "cobrança", D: "devolução", I: "cancelamento de item", M: "sem prêmio", R: "restituição", X: "cancelamento da apólice" };
  return { nome: "Endosso", detalhe: nomes[d.tipo] ?? null, cor: d.tipo === "X" || d.tipo === "I" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800" };
}

const SEGURADORA_COMERCIAL: Record<string, string> = {
  PORT: "Porto Seguro", PESS: "Porto Essencial", POTT: "Pottencial", YELU: "Yelum", BRAS: "Brasilcap", TOKI: "Tokio Marine", TOO: "Too Seguros",
  ICAT: "Icatu", ALLI: "Allianz", ALFA: "Alfa", ALF: "Alfa", BRAD: "Bradesco Seguros", HDI: "HDI", MAPF: "Mapfre", SUHA: "Suhai", AZUL: "Azul",
  SULA: "SulAmérica", ZURI: "Zurich", MARI: "Sompo", MITS: "Mitsui Sumitomo", ITAU: "Itaú Seguros",
};
const titulo = (s: string) => s.toLowerCase().replace(/(^|[\s(])([a-zà-ú])/g, (_m, a, b) => a + b.toUpperCase());
/** Nome comercial da seguradora (Pottencial, Porto Seguro, Yelum, Brasilcap…). */
export function nomeSeguradora(abreviacao: string | null, nome: string | null): string | null {
  if (abreviacao && SEGURADORA_COMERCIAL[abreviacao]) return SEGURADORA_COMERCIAL[abreviacao];
  return nome ? titulo(nome) : abreviacao;
}

const PRODUTO_POR_RAMO: Record<string, string> = {
  "IMOBILIARIO": "Incêndio Imobiliário", "2 IMOBILIARIO": "Incêndio Imobiliário", "RESIDENCIAL": "Incêndio Residencial Individual", "EMPRESARIAL": "Incêndio Empresarial Individual",
  "CONTEÚDO RESIDENCIAL": "Conteúdo Residencial", "CONTEÚDO COMERCIAL": "Conteúdo Comercial", "CONDOMINIO": "Condomínio", "BIKE": "Seguro Bike",
  "FIANCA LOCATICIA": "Seguro Fiança", "2 FIANÇA": "Seguro Fiança", "CAPITALIZAÇÃO": "Título de Capitalização", "2 CAPITALIZAÇÃO": "Título de Capitalização",
  "AUTOMOVEL": "Automóvel", "RC PROFISSIONAL": "RC Profissional", "RESPONSABILIDADE CIV": "RC (Responsabilidade Civil)", "SEGURO VIAGEM": "Seguro Viagem",
  "EQUIP. PORTÁTEIS": "Equipamentos Portáteis", "2 EQUIP. PORTÁTEIS": "Equipamentos Portáteis", "VIDA INDIVIDUAL": "Vida Individual", "VIDA GRUPO": "Vida em Grupo",
  "VIDA CONVENÇAO": "Vida Convenção", "API": "Acidentes Pessoais", "PRESTAMISTA": "Prestamista", "PREVIDÊNCIA": "Previdência", "SAÚDE": "Saúde", "ODONTO": "Odontológico",
  "PET": "Seguro Pet", "ADESÃO": "Saúde (adesão)",
};
/** Nome do produto no cabeçalho: só o produto (Automóvel, Seguro Fiança, Título de Capitalização, Incêndio Imobiliário…). */
export function nomeProduto(ramoNome: string | null, produto: string | null): string | null {
  if (ramoNome && PRODUTO_POR_RAMO[ramoNome.toUpperCase()]) return PRODUTO_POR_RAMO[ramoNome.toUpperCase()];
  return ramoNome ? titulo(ramoNome) : produto;
}

export const TIPO_CORP: Record<string, string> ={ NOVO: "Novo", RENV: "Renovação", END: "Endosso", FAT: "Fatura", CANC: "Cancelamento" };

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
  "id, nosso_numero, nosso_numero_corp, tipo, tipo_corp, numero_apolice, vigencia_inicio, vigencia_fim, premio_liquido, premio_total, comissao_valor, situacao, canal_venda, imobiliaria_principal_id, modo_cobranca, documento_pai_id, seguradora:erp_seguradoras(abreviacao, nome), ramo:erp_ramos(abreviacao, nome, produto), cliente:locatarios!erp_documentos_locatario_id_fkey(nome), imobiliaria:imobiliarias!erp_documentos_imobiliaria_principal_id_fkey(nome)";

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
  modo_cobranca: string | null;
  documento_pai_id: string | null;
  seguradora: { abreviacao: string; nome: string } | null;
  ramo: { abreviacao: string; nome: string; produto: string } | null;
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
    seguradora_nome: nomeSeguradora(r.seguradora?.abreviacao ?? null, r.seguradora?.nome ?? null),
    produto_nome: nomeProduto(r.ramo?.nome ?? null, r.ramo?.produto ?? null),
    modo_cobranca: r.modo_cobranca,
    titular: r.cliente?.nome ?? null,
    inquilino: null,
    produto: r.ramo?.produto ?? null,
    documento_pai_id: r.documento_pai_id ?? null,
  };
}

/** Titular da lista (Matheus 28/10): Fiança = proprietário (segurado/locador) e inquilino = garantido; demais produtos = cliente do documento. */
async function completarTitulares(sb: SupabaseClient, linhas: DocumentoLista[]) {
  const fianca = linhas.filter((l) => l.produto === "fianca");
  const semTitular = linhas.filter((l) => l.produto !== "fianca" && !l.titular);
  if (!fianca.length && !semTitular.length) return;
  const idsPai = fianca.map((l) => l.documento_pai_id).filter((x): x is string => !!x);
  const idsFianca = [...new Set([...fianca.map((l) => l.id), ...idsPai])];
  const ids = [...new Set([...idsFianca, ...semTitular.map((l) => l.id)])];
  const [{ data: acervo }, { data: itens }] = await Promise.all([
    idsFianca.length ? sb.from("erp_doc_partes_acervo").select("documento_id, papel, locatario:locatarios(nome)").in("documento_id", idsFianca) : Promise.resolve({ data: [] }),
    sb.from("erp_documento_itens").select("documento_id, partes:erp_item_partes(papel, nome, ordem)").in("documento_id", ids),
  ]);
  const seg = new Map<string, string>(), gar = new Map<string, string>();
  for (const a of (acervo ?? []) as unknown as { documento_id: string; papel: string; locatario: { nome: string | null } | null }[]) {
    if (!a.locatario?.nome) continue;
    (a.papel === "segurado" ? seg : gar).set(a.documento_id, a.locatario.nome);
  }
  const prop = new Map<string, string>(), loc = new Map<string, string>(), first = new Map<string, string>();
  for (const it of (itens ?? []) as unknown as { documento_id: string; partes: { papel: string; nome: string | null; ordem: number }[] | null }[]) {
    for (const p of [...(it.partes ?? [])].sort((x, y) => x.ordem - y.ordem)) {
      if (!p.nome) continue;
      if (!first.has(it.documento_id)) first.set(it.documento_id, p.nome);
      if (p.papel === "proprietario" && !prop.has(it.documento_id)) prop.set(it.documento_id, p.nome);
      if ((p.papel === "locatario" || p.papel === "garantido") && !loc.has(it.documento_id)) loc.set(it.documento_id, p.nome);
    }
  }
  for (const l of fianca) {
    // endosso: herda o titular e o inquilino da apólice-mãe quando o próprio endosso não os traz
    const pai = l.documento_pai_id;
    l.titular = seg.get(l.id) ?? prop.get(l.id) ?? (pai ? seg.get(pai) ?? prop.get(pai) ?? null : null);
    l.inquilino = gar.get(l.id) ?? loc.get(l.id) ?? (pai ? gar.get(pai) ?? loc.get(pai) ?? null : null) ?? l.cliente;
  }
  // card ainda sem cliente cadastrado (sem CPF): mostra a pessoa informada no card
  // (o nome do card às vezes vem com o prefixo "NOVO - " / "RENOVAÇÃO - ")
  const limpo = (n: string | undefined) => (n ? n.replace(/^s*(novo|renova[cç][aã]o)s*-s*/i, "").trim() || null : null);
  for (const l of semTitular) l.titular = limpo(prop.get(l.id) ?? loc.get(l.id) ?? first.get(l.id));
}

/** Dados do cabeçalho padrão (tipo, titular, produto, seguradora, vigência) para qualquer tela que já tenha os ids dos documentos. */
export async function dadosDeCabecalhoPorId(sb: SupabaseClient, ids: string[]): Promise<Map<string, DocumentoLista>> {
  const mapa = new Map<string, DocumentoLista>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 120) {
    const { data } = await sb.from("erp_documentos").select(SELECT_LISTA).in("id", unicos.slice(i, i + 120));
    const linhas = ((data ?? []) as unknown as LinhaBruta[]).map(mapear);
    await completarTitulares(sb, linhas);
    for (const l of linhas) mapa.set(l.id, l);
  }
  return mapa;
}

export type FiltrosBusca = {
  busca: string;
  /** tela Apólices: vigentes | inicio | faturas | endossos — cruza o período (de/ate) com o tipo de documento; nunca cotação/proposta */
  visao?: string;
  situacao?: string;
  limite?: number;
  // filtros padronizados do ERP (src/lib/erp/filtros.ts)
  seguradora?: string; // abreviação
  produto?: string; // erp_ramos.produto
  tipo?: string; // A, F, C…
  imobiliaria?: string; // nome ou parte (base única)
  forma?: string; // modo_cobranca
  canal?: string; // erp_canais.id
  de?: string; // início de vigência a partir de
  ate?: string; // início de vigência até
  inquilino?: string; // nome ou CPF/CNPJ do locatário
  proprietario?: string; // nome ou CPF/CNPJ do proprietário/locador
  imovel?: string; // endereço ou CEP do imóvel
};

/**
 * Busca de documentos. Número puro = Código O2 do documento, Nosso nº do Corp ou Nº da apólice; texto, CPF/CNPJ ou CLI-000123 = TITULAR
 * (cliente do documento, segurado/garantido da apólice, partes do card) e, se ninguém casar, nome da imobiliária. Sem busca, mostra os mais recentes por início
 * de vigência. Os demais filtros recortam pelos níveis da tela (seguradora, produto,
 * situação, tipo, imobiliária, forma de pagamento, canal, período de vigência).
 */
export async function buscarDocumentos(sb: SupabaseClient, f: FiltrosBusca): Promise<{ linhas: DocumentoLista[]; total: number | null }> {
  const limite = Math.min(Math.max(f.limite ?? 50, 10), 200);
  const termo = f.busca.trim();
  const filtrado = !!(termo || f.visao || f.situacao || f.seguradora || f.produto || f.tipo || f.imobiliaria || f.forma || f.canal || f.de || f.ate || f.inquilino || f.proprietario || f.imovel);
  // premissa de desempenho do ERP: contagem só quando há filtro (contar/estimar os 120 mil com os vínculos custava 2–8 s);
  // sem filtro a tela mostra os mais recentes e total = null
  let q = sb.from("erp_documentos").select(SELECT_LISTA, filtrado ? { count: "exact" } : undefined);
  const visao = f.visao;
  if (visao) {
    // só o que já é documento oficial: fora cotação, proposta (vive em Emissão até virar apólice) e o que não entra no ERP
    q = q.not("situacao", "in", "(cotacao,proposta,duplicado,perdido,recusado)");
    // com busca por nome/código vale o histórico todo; sem busca, a visão cruza período × tipo (como no Corp)
    if (!termo) {
      const tipos = visao === "faturas" ? ["F"] : visao === "endossos" ? ["C", "D", "I", "M", "R", "X"] : ["A"];
      q = q.in("tipo", tipos);
      if (visao === "vigentes") {
        if (f.de || f.ate) {
          // vigente em algum dia do período escolhido
          q = q.in("situacao", ["vigente", "vencido"]);
          if (f.ate) q = q.lte("vigencia_inicio", f.ate);
          if (f.de) q = q.gte("vigencia_fim", f.de);
        } else q = q.eq("situacao", "vigente");
      } else {
        if (f.de) q = q.gte("vigencia_inicio", f.de);
        if (f.ate) q = q.lte("vigencia_inicio", f.ate);
      }
    }
  } else if (f.situacao) q = q.eq("situacao", f.situacao);
  else {
    q = q.neq("situacao", "duplicado"); // card do Bitrix já juntado ao documento do Corp: só aparece se pedirem a situação
  }
  if (f.tipo && !visao) q = q.eq("tipo", f.tipo);
  if (f.forma) q = q.eq("modo_cobranca", f.forma);
  if (f.canal) q = q.eq("canal_id", f.canal);
  if (f.de && !visao) q = q.gte("vigencia_inicio", f.de);
  if (f.ate && !visao) q = q.lte("vigencia_inicio", f.ate);
  if (f.seguradora) {
    const { data: s } = await sb.from("erp_seguradoras").select("id").eq("abreviacao", f.seguradora).maybeSingle();
    if (!s) return { linhas: [], total: 0 };
    q = q.eq("seguradora_id", s.id);
  }
  if (f.produto) {
    const { data: ramos } = await sb.from("erp_ramos").select("id").eq("produto", f.produto);
    const ids = (ramos ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return { linhas: [], total: 0 };
    q = q.in("ramo_id", ids);
  }
  if (f.imobiliaria) {
    const ids = await idsImobiliarias(sb, f.imobiliaria);
    if (!ids.length) return { linhas: [], total: 0 };
    q = q.in("imobiliaria_principal_id", ids);
  }
  // setor imobiliário (Matheus 25/10): inquilino = garantido da apólice (cliente do documento, parte "locatário"/"garantido"
  // ou garantido do acervo), proprietário = segurado/locador (parte "proprietário" ou segurado do acervo) e imóvel (endereço/CEP). Resolvido no banco
  // (erp_docs_por_partes, até 400 documentos mais recentes) para não montar listas enormes de ids na URL.
  if (f.inquilino || f.proprietario || f.imovel) {
    const { data: ids, error: e } = await sb.rpc("erp_docs_por_partes", {
      p_inquilino: f.inquilino ?? null,
      p_proprietario: f.proprietario ?? null,
      p_imovel: f.imovel ?? null,
    });
    if (e) throw new Error(`erp_docs_por_partes: ${e.message}`);
    const lista = ((ids ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : (Object.values(x as object)[0] as string)));
    if (!lista.length) return { linhas: [], total: 0 };
    q = q.in("id", lista);
  }

  // Busca principal = TITULAR primeiro (Matheus 27-28/10): quem está com o nome da proposta/apólice. Aceita nome, CPF/CNPJ ou Código do
  // cliente (CLI-000123); acha pelo cliente do documento, pelo segurado/garantido da apólice lida e pelas partes do card. Só se ninguém
  // casar é que vale o resto: Nº da apólice / Código O2 do documento / Nosso nº do Corp (número puro) ou nome da imobiliária.
  if (termo) {
    const digitos = termo.replace(/\D/g, "");
    const pareceCpf = (digitos.length === 11 || digitos.length === 14) && /^[0-9.\-\/ ]+$/.test(termo);
    const pareceCli = /^cli-?\d+$/i.test(termo);
    const pareceNumero = /^\d+$/.test(termo);
    if (!pareceNumero || pareceCpf) {
      const { data: ids, error: e } = await sb.rpc("erp_docs_por_titular", { p_busca: termo, p_limite: 150 }); // 400 ids estouravam o tamanho da URL do .in() ("fetch failed") em nomes comuns
      if (e) throw new Error(`erp_docs_por_titular: ${e.message}`);
      const lista = ((ids ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : (Object.values(x as object)[0] as string)));
      if (lista.length) q = q.in("id", lista);
      else if (pareceCli || pareceCpf) return { linhas: [], total: 0 };
      else {
        const like = `%${termo.replace(/[%_]/g, "")}%`;
        const { data: imobs } = await sb.from("imobiliarias").select("id").or(`nome.ilike.${like},apelido.ilike.${like}`).limit(50);
        const idsImob = (imobs ?? []).map((i) => i.id);
        if (!idsImob.length) return { linhas: [], total: 0 };
        q = q.in("imobiliaria_principal_id", idsImob);
      }
    }
    if (pareceNumero && !pareceCpf) q = q.or(`nosso_numero.eq.${termo},nosso_numero_corp.eq.${termo},numero_apolice.eq.${termo}`);
  }

  const { data, count, error } = await q.order("vigencia_inicio", { ascending: false }).order("nosso_numero", { ascending: false }).limit(limite);
  if (error) throw new Error(`erp_documentos: ${error.message}`);
  const linhas = ((data ?? []) as unknown as LinhaBruta[]).map(mapear);
  await completarTitulares(sb, linhas);
  return { linhas, total: count };
}

export type DocumentoFicha = DocumentoLista & {
  corretora: string | null;
  tipo_contratacao: string | null;
  modo_cobranca: string;
  locatario_id: string | null;
  /** Partes lidas na apólice do acervo (Fiança): segurado = locador = proprietário; garantido = locatário. */
  /** endereço do risco lido na apólice do acervo (quando o documento não tem item com endereço) */
  local_risco: string | null;
  partes_apolice: { papel: "segurado" | "garantido"; locatario_id: string | null; nome: string | null; cpf: string | null }[];
  /** Linhas da grade de comissões do Corp deste documento (baixa real): situação recebida/pendente por parcela. */
  comissoes_corp: { parcela_n: number | null; situacao: string; valor: number; data: string | null }[];
  /** Todo o histórico do titular (segurado do Fiança ou cliente do documento) na O2. */
  cliente_kpis: { documentos: number; vigentes: number; produtos: string[]; premio_total: number; comissao: number; desde: string | null } | null;
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
  /** endossos desta apólice (filhos por documento_pai_id), do mais antigo ao mais novo */
  endossos: EndossoDoc[];
  /** quando o documento é um endosso: a apólice que ele altera */
  apolice_mae: { id: string; nosso_numero: number; numero_apolice: string | null; vigencia_inicio: string | null; vigencia_fim: string | null } | null;
  cadeia: { canal: string | null; imobiliaria: string | null; grupo: string | null; cliente: string | null };
};
export type EndossoDoc = {
  id: string;
  nosso_numero: number;
  nosso_numero_corp: number | null;
  tipo: string;
  numero_endosso: string | null;
  dt_emissao: string | null;
  vigencia_inicio: string | null;
  premio_liquido: number;
  comissao_valor: number;
  situacao: string;
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
        ", corretora:erp_corretoras(apelido), canal:erp_canais(nome), imob_grupo:imobiliarias!erp_documentos_imobiliaria_principal_id_fkey(grupo:imobiliaria_grupos(nome)), tipo_contratacao, revisao_pendente, revisado_por_email, locatario_id, numero_proposta, numero_endosso, dt_proposta, dt_emissao, qtd_parcelas, forma_pagamento, premio_adicional, iof, comissao_pct, comissao_base, premiacao_valor, cancelado_em, competencia, congelado, fora_regra_pbi, origem, observacoes, digitado_em, documento_renovado_id, documento_pai_id"
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
    documento_pai_id: string | null;
  };

  const [{ data: prods }, { data: parcs }, { data: anexos }, { data: eventos }, { data: renovadoDe }, { data: renovadoPor }, { data: itens }, { data: origens }, { data: familia }, { data: endossos }, { data: mae }, { data: partesAcervo }, { data: comCorp }] = await Promise.all([
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
      ? sb.from("apolice_documentos").select("id, arquivo_nome, fonte, numero_apolice, produto, local_risco").eq("nosso_numero", String(d.nosso_numero_corp)).limit(10)
      : Promise.resolve({ data: [] as { id: string; arquivo_nome: string | null; fonte: string | null; numero_apolice: string | null; produto: string | null; local_risco?: string | null }[] }),
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
    // linha do tempo da apólice: endossos ligados a ela (Matheus 25/10: todo endosso é filho de uma apólice)
    sb
      .from("erp_documentos")
      .select("id, nosso_numero, nosso_numero_corp, tipo, numero_endosso, dt_emissao, vigencia_inicio, premio_liquido, comissao_valor, situacao")
      .eq("documento_pai_id", id)
      .order("vigencia_inicio", { ascending: true, nullsFirst: true })
      .limit(200),
    d.documento_pai_id
      ? sb.from("erp_documentos").select("id, nosso_numero, numero_apolice, vigencia_inicio, vigencia_fim").eq("id", d.documento_pai_id).maybeSingle()
      : Promise.resolve({ data: null }),
    sb.from("erp_doc_partes_acervo").select("papel, locatario:locatarios(id, nome, cpf)").eq("documento_id", id),
    sb.from("erp_corp_comissoes").select("parcela_n, situacao, valor, data").eq("documento_id", id).limit(400),
  ]);

  // titular para o quadro do cliente: segurado (locador) da apólice de Fiança; nos demais produtos, o cliente do documento
  const partesBrutas = (partesAcervo ?? []) as unknown as { papel: "segurado" | "garantido"; locatario: { id: string; nome: string | null; cpf: string | null } | null }[];
  const pessoaTitular = partesBrutas.find((p) => p.papel === "segurado")?.locatario?.id ?? d.locatario_id;
  void pessoaTitular; // os KPIs do cliente ficam só na ficha do cliente (Matheus 28/10)

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
    comissoes_corp: ((comCorp ?? []) as { parcela_n: number | null; situacao: string; valor: number | string; data: string | null }[]).map((c) => ({ parcela_n: c.parcela_n, situacao: c.situacao, valor: Number(c.valor), data: c.data })),
    cliente_kpis: null,
    local_risco: (() => {
      const v = ((anexos ?? []) as { local_risco?: unknown }[]).find((x) => x.local_risco)?.local_risco;
      if (!v) return null;
      if (typeof v === "string") return v;
      const t = (v as { texto?: unknown }).texto;
      return typeof t === "string" ? t : null;
    })(),
    partes_apolice: partesBrutas
      .map((p) => ({ papel: p.papel, locatario_id: p.locatario?.id ?? null, nome: p.locatario?.nome ?? null, cpf: p.locatario?.cpf ?? null }))
      .sort((a, b) => (a.papel === b.papel ? 0 : a.papel === "segurado" ? -1 : 1)),
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
    anexos: ((anexos ?? []) as { id: string; arquivo_nome: string | null; fonte: string | null; numero_apolice: string | null; produto: string | null; local_risco?: string | null }[]).map((a) => ({
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
    endossos: ((endossos ?? []) as EndossoDoc[]).map((e) => ({
      ...e,
      nosso_numero: Number(e.nosso_numero),
      nosso_numero_corp: e.nosso_numero_corp === null ? null : Number(e.nosso_numero_corp),
      premio_liquido: Number(e.premio_liquido ?? 0),
      comissao_valor: Number(e.comissao_valor ?? 0),
    })),
    apolice_mae: mae ? { ...(mae as NonNullable<DocumentoFicha["apolice_mae"]>), nosso_numero: Number((mae as { nosso_numero: number }).nosso_numero) } : null,
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
