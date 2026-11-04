import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";
import { compacto, semCamposFinanceiros } from "@/lib/whatsappFerramentas";
import { chaveFonetica, normalizar } from "./roboFerramentas";

// Buscas por PESSOA e por CARD para o Robô O2 (01/11/2026, pedido do Matheus: a equipe trabalha com nomes, CPF,
// e-mails, apólices e contatos todo dia, principalmente quem cota). Só equipe O2 chega aqui; somente leitura.
// - buscar_pessoa: cadastro único de pessoas (locatarios) + tudo ligado a ela (documentos do ERP, cotações/produção).
// - buscar_nos_paineis: cards/negociações dentro dos retratos dos painéis (cotações em andamento do Bitrix que
//   ainda não viraram documento do ERP e por isso não estão ligadas a uma pessoa cadastrada).

export const FERRAMENTAS_BUSCA: Anthropic.Tool[] = [
  {
    name: "buscar_pessoa",
    description:
      "Procura uma PESSOA (cliente, inquilino/locatário, proprietário, segurado) pelo nome, CPF/CNPJ, e-mail ou telefone. Devolve cadastro (nome, CPF/CNPJ, e-mail, telefone, código do cliente) e tudo ligado a ela: documentos do ERP (apólices, endossos, propostas, com papel, seguradora, imobiliária, vigência, prêmio) e cotações/produção das planilhas e do Corp. Para cotações em andamento do Bitrix que ainda não têm cadastro, use também buscar_nos_paineis.",
    input_schema: { type: "object", properties: { termo: { type: "string", description: "Nome (ou parte), CPF/CNPJ (com ou sem pontos), e-mail ou telefone." } }, required: ["termo"] },
  },
  {
    name: "buscar_nos_paineis",
    description:
      "Procura um texto (nome de segurado/titular/locatário, nº da apólice, nome do negociador/cotador, imobiliária) dentro dos cards e negociações dos retratos dos painéis (Ramos Elementares, Fiança, Renovação de Fiança, Capitalização, Auto) nos últimos meses, incluindo meses futuros de renovação. É o jeito de achar uma cotação em andamento pelo nome do cliente ou saber o que um cotador está trabalhando.",
    input_schema: { type: "object", properties: { termo: { type: "string" } }, required: ["termo"] },
  },
  {
    name: "listar_cotacoes_com_pessoa",
    description:
      "Lista as cotações do Bitrix (producao_resolvida, fonte bitrix) de uma ou mais fichas de imobiliária, JÁ COM o nome do INQUILINO analisado (Seguro Fiança) ou do SEGURADO/titular (outros ramos: Ramos Elementares etc.), tirado do título do card. Use quando o pedido for uma lista de cotações/efetivadas/convertidas 'com o inquilino' ou 'com o segurado'. Informe imobiliaria_ids (pegue com buscar_imobiliaria, todas as fichas do grupo), produto (fianca, re, capitalizacao, automovel; opcional), campo_data ('efetivacao' = data em que virou proposta, ou 'recebimento') com de/ate (AAAA-MM-DD) e opcionalmente status_padrao. Capitalização e Automóvel ainda não têm o nome ligado à cotação: o retorno diz 'nome não disponível'. Resposta com nome de pessoa NÃO vira PDF.",
    input_schema: {
      type: "object",
      properties: {
        imobiliaria_ids: { type: "array", items: { type: "string" } },
        produto: { type: "string" },
        campo_data: { type: "string", enum: ["efetivacao", "recebimento"] },
        de: { type: "string" },
        ate: { type: "string", description: "Inclusive." },
        status_padrao: { type: "string", description: "Ex.: Convertido (efetivada), Em análise, Aprovado, Perdido, Recusado." },
      },
      required: ["imobiliaria_ids", "de", "ate"],
    },
  },
];

type Pessoa = { id: string; cpf: string | null; nome: string | null; email: string | null; telefone: string | null; codigo_cliente: number | string | null; codigo_corp_cliente: number | string | null; tipo_documento: string | null };

type Parecido = { fonte: string; ref: string; nome: string; extra: string | null; sim: number };

// Conceito de cada situação, no glossário do Matheus (cotação -> proposta em emissão -> apólice).
const CONCEITO_DA_SITUACAO: Record<string, string> = {
  cotacao: "COTAÇÃO em negociação",
  proposta: "PROPOSTA em emissão (cotação efetivada; aguarda a seguradora emitir; sem nº de apólice e sem vigência é o normal)",
  vigente: "APÓLICE vigente",
  vencido: "APÓLICE vencida",
  cancelado: "APÓLICE cancelada",
  perdido: "cotação perdida",
  recusado: "cotação recusada",
};
const FUNIL_DO_CARD: Record<number, string> = { 1042: "Seguro Fiança", 1046: "Ramos Elementares", 1048: "Capitalização", 1050: "Seguro Automóvel" };

async function buscarPessoa(termo: string, verComissao: boolean): Promise<string> {
  const sb = createServiceClient();
  const t = termo.trim();
  if (t.length < 3) return JSON.stringify({ erro: "Informe pelo menos 3 caracteres." });
  const digitos = t.replace(/\D/g, "");
  const ehNumero = digitos.length >= 6 && digitos.length >= t.replace(/[\s().\-/]/g, "").length - 1;
  const ehEmail = t.includes("@");
  const emailCompleto = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
  const nomeBusca = !ehEmail && !ehNumero;
  const COLS = "id, cpf, nome, email, telefone, codigo_cliente, codigo_corp_cliente, tipo_documento";

  let pessoasAch: Pessoa[] = [];
  let parecidos: Parecido[] = [];
  if (nomeBusca) {
    // Nome PARECIDO (grafia/som): "Raquel" acha "Rachel", "Matos" acha "Mattos" -- cadastro, itens de documento, cards do ERP e arquivo de cards.
    const { data, error } = await sb.rpc("chat_nomes_parecidos", { p_termo: t, p_limite: 30 });
    if (error) return `Erro: ${error.message}`;
    parecidos = (data ?? []) as Parecido[];
    const idsCad = parecidos.filter((p) => p.fonte === "cadastro").map((p) => p.ref);
    if (idsCad.length) {
      const { data: ps } = await sb.from("locatarios").select(COLS).in("id", idsCad);
      const ordem = new Map(idsCad.map((id, i) => [id, i]));
      pessoasAch = ((ps ?? []) as unknown as Pessoa[]).sort((a, b) => (ordem.get(a.id) ?? 0) - (ordem.get(b.id) ?? 0));
    }
  } else {
    let q = sb.from("locatarios").select(COLS).limit(15);
    if (ehEmail) q = emailCompleto ? q.ilike("email", t) : q.ilike("email", `%${t}%`);
    else if (digitos.length === 11 || digitos.length === 14) q = q.eq("cpf", digitos);
    else q = q.or(`cpf.ilike.%${digitos}%,telefone.ilike.%${digitos.slice(-8, -4)}%${digitos.slice(-4)}%,codigo_cliente.eq.${Number(digitos) || 0}`);
    const { data, error } = await q;
    if (error) return `Erro: ${error.message}`;
    pessoasAch = (data ?? []) as unknown as Pessoa[];
    // E-mail completo sem resultado exato: cai para busca parcial.
    if (!pessoasAch.length && emailCompleto) {
      const { data: parcial } = await sb.from("locatarios").select(COLS).ilike("email", `%${t}%`).limit(15);
      pessoasAch = (parcial ?? []) as unknown as Pessoa[];
    }
  }
  // Saída limitada a 8 pessoas (a lista inteira estoura o limite).
  const pessoas = pessoasAch.slice(0, 8);
  const pessoasNaoMostradas = pessoasAch.length - pessoas.length;

  // Pessoas só citadas pelo nome em itens de documento (sem cadastro ligado).
  let soNome: { documento_id: string | null; papel: string | null; nome: string | null; documento_numero: string | null; item_id: string }[] = [];
  const itemRefs = parecidos.filter((p) => p.fonte === "item_do_documento").map((p) => p.ref);
  if (itemRefs.length) {
    const { data } = await sb.from("erp_item_partes").select("item_id, papel, nome, documento_numero").in("id", itemRefs).limit(15);
    soNome = ((data ?? []) as unknown as { item_id: string; papel: string | null; nome: string | null; documento_numero: string | null }[]).map((r) => ({ ...r, documento_id: null }));
  }

  const ids = pessoas.map((p) => p.id);
  const papeis = new Map<string, Set<string>>(); // documento_id -> papéis
  const marca = (doc: string | null | undefined, papel: string) => {
    if (!doc) return;
    const s = papeis.get(doc) ?? new Set<string>();
    s.add(papel);
    papeis.set(doc, s);
  };
  if (ids.length) {
    const [{ data: d1 }, { data: d2 }, { data: ip }] = await Promise.all([
      sb.from("erp_documentos").select("id").in("locatario_id", ids).limit(200),
      sb.from("erp_doc_partes_acervo").select("documento_id, papel").in("locatario_id", ids).limit(200),
      sb.from("erp_item_partes").select("item_id, papel").in("locatario_id", ids).limit(200),
    ]);
    for (const r of d1 ?? []) marca(r.id as string, "locatário/titular do documento");
    for (const r of d2 ?? []) marca(r.documento_id as string, String(r.papel ?? "parte"));
    const itens = [...new Set([...(ip ?? []), ...soNome].map((r) => r.item_id as string))];
    if (itens.length) {
      const { data: it } = await sb.from("erp_documento_itens").select("id, documento_id").in("id", itens);
      const docDoItem = new Map((it ?? []).map((r) => [r.id as string, r.documento_id as string]));
      for (const r of ip ?? []) marca(docDoItem.get(r.item_id as string), String(r.papel ?? "parte"));
      for (const r of soNome) marca(docDoItem.get(r.item_id), String(r.papel ?? "parte"));
    }
  } else if (soNome.length) {
    const { data: it } = await sb.from("erp_documento_itens").select("id, documento_id").in("id", soNome.map((r) => r.item_id));
    const docDoItem = new Map((it ?? []).map((r) => [r.id as string, r.documento_id as string]));
    for (const r of soNome) marca(docDoItem.get(r.item_id), String(r.papel ?? "parte"));
  }

  // Cards do Bitrix com o nome no título: ligados a documento do ERP (erp_origens) ou guardados à parte (perdidos/recusados).
  const cardsErpRefs = parecidos.filter((p) => p.fonte === "card_erp");
  if (cardsErpRefs.length) {
    const { data: ori } = await sb.from("erp_origens").select("documento_id, item_id, entity_type_id").eq("sistema", "bitrix").in("item_id", cardsErpRefs.map((c) => Number(c.ref)));
    for (const o of ori ?? []) if (cardsErpRefs.some((c) => c.ref === String(o.item_id) && c.extra === String(o.entity_type_id))) marca(o.documento_id as string, "titular do card");
  }
  let cardsArquivados: unknown[] = [];
  const cardsArqRefs = parecidos.filter((p) => p.fonte === "card_arquivo");
  if (cardsArqRefs.length) {
    const { data } = await sb.from("bitrix_cards_arquivo").select("item_id, entity_type_id, titulo, etapa, situacao, motivo, card_criado_em").in("item_id", cardsArqRefs.map((c) => Number(c.ref))).limit(10);
    cardsArquivados = (data ?? []).map((c) => ({
      cardNumero: c.item_id,
      funil: FUNIL_DO_CARD[c.entity_type_id as number] ?? c.entity_type_id,
      titulo: c.titulo,
      situacao: c.situacao,
      motivo: c.motivo,
      criadoEm: c.card_criado_em,
      conceito: "COTAÇÃO " + (c.situacao === "recusado" ? "recusada" : "perdida") + " (foto guardada)",
    }));
  }

  if (!pessoas.length && !soNome.length && !papeis.size && !cardsArquivados.length)
    return JSON.stringify({ encontrou: false, observacao: "Ninguém com esse dado no cadastro, nos cards ou nos itens de documento. Tente buscar_nos_paineis (cotações em andamento) ou outra grafia." });

  const docIds = [...papeis.keys()].slice(0, 25);
  let documentos: unknown[] = [];
  if (docIds.length) {
    const [{ data: docs }, { data: segs }, { data: ramos }, { data: fila }, { data: origens }] = await Promise.all([
      sb
        .from("erp_documentos")
        .select("id, tipo, situacao, numero_apolice, numero_proposta, numero_endosso, seguradora_id, ramo_id, imobiliaria_principal_id, vigencia_inicio, vigencia_fim, premio_total")
        .in("id", docIds),
      sb.from("erp_seguradoras").select("id, nome"),
      sb.from("erp_ramos").select("id, nome"),
      sb.from("erp_emissao_fila_pronta").select("id, data_efetivacao").in("id", docIds),
      sb.from("erp_origens").select("documento_id, item_id, entity_type_id, etapa_id, card_criado_em").eq("sistema", "bitrix").in("documento_id", docIds),
    ]);
    const imobIds = [...new Set((docs ?? []).map((d) => d.imobiliaria_principal_id as string | null).filter((v): v is string => !!v))];
    const { data: imobs } = imobIds.length ? await sb.from("imobiliarias").select("id, nome").in("id", imobIds) : { data: [] as { id: string; nome: string }[] };
    const segNome = new Map((segs ?? []).map((s) => [s.id as string, s.nome as string]));
    const ramoNome = new Map((ramos ?? []).map((r) => [r.id as string, r.nome as string]));
    const imobNome = new Map((imobs ?? []).map((i) => [i.id as string, i.nome as string]));
    const efetivadaEm = new Map((fila ?? []).map((f) => [f.id as string, f.data_efetivacao as string | null]));
    const cardDoDoc = new Map((origens ?? []).map((o) => [o.documento_id as string, o]));
    const TIPOS: Record<string, string> = { A: "Apólice", C: "Endosso de cobrança", D: "Devolução", F: "Fatura", I: "End. cancelamento de item", M: "Endosso sem prêmio", R: "Endosso de restituição", X: "End. cancelamento de apólice" };
    documentos = (docs ?? [])
      .map((d) => {
        const card = cardDoDoc.get(d.id as string);
        return {
          conceito: d.tipo === "A" ? (CONCEITO_DA_SITUACAO[d.situacao as string] ?? d.situacao) : `${TIPOS[d.tipo as string] ?? d.tipo} (${d.situacao})`,
          numeroApolice: d.numero_apolice,
          numeroProposta: d.numero_proposta,
          numeroEndosso: d.numero_endosso,
          seguradora: segNome.get(d.seguradora_id as string) ?? null,
          ramo: ramoNome.get(d.ramo_id as string) ?? null,
          imobiliaria: imobNome.get(d.imobiliaria_principal_id as string) ?? null,
          vigenciaInicio: d.vigencia_inicio,
          vigenciaFim: d.vigencia_fim,
          premioTotal: d.premio_total,
          efetivadaEm: efetivadaEm.get(d.id as string) ?? null,
          card: card ? { numero: card.item_id, funil: FUNIL_DO_CARD[card.entity_type_id as number] ?? card.entity_type_id, etapa: card.etapa_id, criadoEm: card.card_criado_em } : null,
          papelDaPessoa: [...(papeis.get(d.id as string) ?? [])].join(", "),
        };
      })
      .sort((a, b) => String(b.efetivadaEm ?? b.card?.criadoEm ?? b.vigenciaInicio ?? "").localeCompare(String(a.efetivadaEm ?? a.card?.criadoEm ?? a.vigenciaInicio ?? "")));
  }

  // Cotações e produção (planilhas, Corp) ligadas ao cadastro.
  let producao: unknown[] = [];
  if (ids.length) {
    const { data } = await sb
      .from("producao_resolvida")
      .select("produto, tipo, fonte, status_padrao, ramo_padrao, seguradora, data_recebimento, data_efetivacao, responsavel, premio, imobiliaria_exibicao")
      .in("locatario_id", ids)
      .order("data_recebimento", { ascending: false, nullsFirst: false })
      .limit(15);
    producao = verComissao ? (data ?? []) : semCamposFinanceiros(data ?? []);
  }

  // Grafia diferente da digitada (ex.: "Raquel" -> "Rachel"): avisa para o usuário confirmar.
  const tokensDigitados = normalizar(t).split(" ").filter(Boolean);
  const grafiaDiferente = nomeBusca && parecidos.length > 0 && !parecidos.some((p) => tokensDigitados.every((tk) => normalizar(p.nome).includes(tk)));

  return compacto({
    ...(grafiaDiferente ? { avisoNome: "Nenhum cadastro com essa grafia exata; achei nomes de grafia parecida. Diga ao usuário como entendeu (ex.: \"entendi Rachel\") e peça confirmação se houver mais de uma pessoa." } : {}),
    pessoas: pessoas.map((p) => {
      const tel = String(p.telefone ?? "").replace(/\D/g, "");
      const suspeito = /@o2seguros\.com\.br$/i.test(String(p.email ?? "")) || (tel.length >= 8 && (/^(\d)\1+$/.test(tel) || /^(\d\d)\1+\d?$/.test(tel)));
      return {
        nome: p.nome,
        documento: p.cpf,
        tipoDocumento: p.tipo_documento,
        email: p.email,
        telefone: p.telefone,
        codigoCliente: p.codigo_cliente,
        codigoCorpCliente: p.codigo_corp_cliente,
        ...(suspeito ? { avisoDados: "E-mail ou telefone parece preenchimento provisório (da própria O2 ou número repetido): avise o usuário que o contato pode não ser do cliente." } : {}),
      };
    }),
    ...(pessoasNaoMostradas > 0 ? { pessoasNaoMostradas, aviso: "Há mais cadastros com esse dado: peça um nome completo ou CPF para refinar." } : {}),
    ...(soNome.length ? { citadosApenasPeloNome: soNome.map((r) => ({ nome: r.nome, documento: r.documento_numero, papel: r.papel })).slice(0, 15) } : {}),
    documentosDoErp: documentos,
    ...(cardsArquivados.length ? { cardsRecusadosOuPerdidosGuardados: cardsArquivados } : {}),
    cotacoesEProducao: producao,
    nota: "'documentosDoErp' traz o conceito certo de cada item (cotação, proposta em emissão, apólice). Cotações em andamento do Bitrix ainda sem documento no ERP e linhas de planilha/painel não aparecem aqui: use buscar_nos_paineis.",
  });
}

const PAINEIS_BUSCA: { nome: string; tabela: string; mesesFuturos?: boolean }[] = [
  { nome: "ramos_elementares", tabela: "ramos_elementares_snapshots", mesesFuturos: true },
  { nome: "seguro_fianca", tabela: "seguro_fianca_snapshots" },
  { nome: "renovacao_fianca", tabela: "seguro_fianca_renovacao_snapshots" },
  { nome: "capitalizacao", tabela: "capitalizacao_snapshots" },
  { nome: "seguro_auto", tabela: "seguro_auto_snapshots" },
];

type Achado = { painel: string; competencia: string; caminho: string; registro: Record<string, unknown> };

function procurar(no: unknown, caminho: string, termo: string, achados: Achado[], painel: string, competencia: string) {
  if (achados.length >= 60 || no == null) return;
  if (Array.isArray(no)) {
    no.forEach((v, i) => procurar(v, `${caminho}[${i}]`, termo, achados, painel, competencia));
    return;
  }
  if (typeof no !== "object") return;
  const obj = no as Record<string, unknown>;
  // Só valores simples do próprio objeto (o registro de um card/negociação).
  const proprios = Object.fromEntries(Object.entries(obj).filter(([, v]) => v == null || typeof v !== "object"));
  const texto = normalizar(Object.values(proprios).map((v) => String(v ?? "")).join(" "));
  const digitos = termo.replace(/\D/g, "");
  const textoDigitos = Object.values(proprios).map((v) => String(v ?? "").replace(/\D/g, "")).join(" ");
  // Também acha por SOM parecido: "Raquel" casa com "Rachel", "Matos" com "Mattos" (mesma regra do banco: chat_fonetica).
  const chavesTermo = termo.split(" ").map(chaveFonetica).filter(Boolean);
  const chavesRegistro = chavesTermo.length ? new Set(texto.split(" ").map(chaveFonetica)) : null;
  const porSom = !!chavesRegistro && chavesTermo.every((k) => chavesRegistro.has(k));
  if ((termo && (texto.includes(termo) || porSom)) || (digitos.length >= 6 && textoDigitos.includes(digitos))) {
    achados.push({ painel, competencia, caminho, registro: proprios });
  }
  for (const [k, v] of Object.entries(obj)) if (v && typeof v === "object") procurar(v, caminho ? `${caminho}.${k}` : k, termo, achados, painel, competencia);
}

async function buscarNosPaineis(termoOriginal: string, verComissao: boolean): Promise<string> {
  const termo = normalizar(termoOriginal);
  if (termo.length < 3) return JSON.stringify({ erro: "Informe pelo menos 3 caracteres." });
  const sb = createServiceClient();
  const achados: Achado[] = [];
  const lidos: string[] = [];
  await Promise.all(
    PAINEIS_BUSCA.map(async (p) => {
      const { data } = await sb
        .from(p.tabela)
        .select("competencia, payload")
        .order("competencia", { ascending: false })
        .limit(p.mesesFuturos ? 6 : 4);
      for (const r of (data ?? []) as { competencia: string; payload: unknown }[]) {
        lidos.push(`${p.nome} ${r.competencia}`);
        procurar(r.payload, "", termo, achados, p.nome, r.competencia);
      }
    })
  );
  const lista = (verComissao ? achados : semCamposFinanceiros(achados)).slice(0, 40);
  return compacto({
    termo: termoOriginal,
    retratosLidos: lidos.length,
    total: achados.length,
    resultados: lista,
    ...(achados.length === 0 ? { observacao: "Nada encontrado nos painéis dos últimos meses. Pode estar em meses mais antigos ou com outra grafia; tente buscar_pessoa." } : {}),
    nota: "O mesmo cartão pode aparecer em mais de um mês/lista dos retratos: não some resultados repetidos como se fossem negócios diferentes.",
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
// Funil do card que guarda a cotação de cada produto (o item_id se repete entre funis, por isso a preferência).
const FUNIL_POR_PRODUTO: Record<string, number> = { fianca: 1042, re: 1046, capitalizacao: 1048, automovel: 1050 };

async function listarCotacoesComPessoa(entrada: unknown, verComissao: boolean): Promise<string> {
  const e = (entrada ?? {}) as { imobiliaria_ids?: unknown; produto?: string; campo_data?: string; de?: string; ate?: string; status_padrao?: string };
  const ids = (Array.isArray(e.imobiliaria_ids) ? e.imobiliaria_ids.map(String) : []).filter((x) => UUID_RE.test(x));
  if (!ids.length) return JSON.stringify({ erro: "Informe imobiliaria_ids válidos (use buscar_imobiliaria)." });
  if (!e.de || !e.ate || !DATA_RE.test(e.de) || !DATA_RE.test(e.ate)) return JSON.stringify({ erro: "Informe de e ate no formato AAAA-MM-DD." });
  const campo = e.campo_data === "recebimento" ? "data_recebimento" : "data_efetivacao";
  const sb = createServiceClient();
  let q = sb
    .from("producao_resolvida")
    .select("produto, tipo, fonte, status_padrao, seguradora, data_recebimento, data_efetivacao, responsavel, premio, comissao, aluguel, origem_bitrix_id, imobiliaria_exibicao")
    .eq("fonte", "bitrix")
    .in("imobiliaria_id", ids)
    .gte(campo, e.de)
    .lte(campo, e.ate)
    .order(campo, { ascending: true })
    .limit(300);
  if (e.produto) q = q.eq("produto", e.produto);
  if (e.status_padrao) q = q.eq("status_padrao", e.status_padrao);
  const { data, error } = await q;
  if (error) return `Erro ao consultar: ${error.message}`;
  const linhas = (data ?? []) as Record<string, unknown>[];
  const itens = [...new Set(linhas.map((l) => Number(l.origem_bitrix_id)).filter((n) => Number.isFinite(n)))];
  const titulos = new Map<number, { funil: number; titulo: string }[]>();
  if (itens.length) {
    const { data: origens } = await sb.from("erp_origens").select("item_id, entity_type_id, titulo").in("item_id", itens).ilike("sistema", "bitrix%");
    for (const o of (origens ?? []) as { item_id: number; entity_type_id: number; titulo: string | null }[]) {
      if (!o.titulo) continue;
      const l = titulos.get(o.item_id) ?? [];
      l.push({ funil: o.entity_type_id, titulo: o.titulo });
      titulos.set(o.item_id, l);
    }
  }
  const saida = linhas.map((l) => {
    const { origem_bitrix_id: card, ...resto } = l;
    const cand = titulos.get(Number(card)) ?? [];
    const preferido = cand.find((c) => c.funil === FUNIL_POR_PRODUTO[String(l.produto)]);
    const nome = preferido?.titulo ?? null;
    return {
      ...resto,
      card,
      pessoa: nome ?? "nome não disponível",
      ...(nome ? {} : cand.length ? { avisoNome: "o card com esse número está em outro funil; nome não confiável" } : {}),
    };
  });
  return compacto({
    total: saida.length,
    cotacoes: verComissao ? saida : semCamposFinanceiros(saida),
    nota: "'pessoa' = título do card: no Seguro Fiança é o inquilino (às vezes com o cônjuge/co-inquilino separados por /); nos demais ramos é o segurado/titular. Campo 'tipo': novo, renovacao ou emissao (emissao = apólice do Corp, não é cotação).",
  });
}

export async function executarFerramentaBusca(nome: string, entrada: unknown, verComissao: boolean): Promise<string | null> {
  try {
    if (nome === "buscar_pessoa") return await buscarPessoa((entrada as { termo: string }).termo ?? "", verComissao);
    if (nome === "listar_cotacoes_com_pessoa") return await listarCotacoesComPessoa(entrada, verComissao);
    if (nome === "buscar_nos_paineis") return await buscarNosPaineis((entrada as { termo: string }).termo ?? "", verComissao);
    return null;
  } catch (err) {
    return `Erro ao consultar: ${err instanceof Error ? err.message : String(err)}`;
  }
}
