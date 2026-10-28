// Painel Comercial v5 (28/10/2026): cálculo dos datasets a partir dos dados
// brutos do Bitrix. Funções puras (sem I/O) para poder conferir com os JSONs
// do pacote da Vanessa. Mesmos IDs de dataset e mesmas colunas do index.html.
//
// Regras: PROMPT_executor_workspace.md (itens 3, 6 e 7). Nada aqui grava no
// CRM e nenhuma fórmula foi inventada: o que o documento não define fica nulo
// ("—" na tela) e é listado em PENDENCIAS.

export type Linha = Record<string, unknown>;
export type Datasets = Record<string, Linha[]>;

export type DealBruto = Record<string, unknown> & { ID: string; CATEGORY_ID: string; STAGE_ID: string };
export type HistoricoBruto = { ID: number | string; OWNER_ID: number | string; CREATED_TIME: string; STAGE_ID: string; STAGE_SEMANTIC_ID?: string; CATEGORY_ID?: number | string };
export type EmpresaBruta = { ID: string; TITLE?: string; [campo: string]: unknown };
export type AtividadeBruta = {
  ID: string;
  PROVIDER_ID?: string;
  DIRECTION?: string;
  OWNER_ID?: string;
  OWNER_TYPE_ID?: string;
  RESPONSIBLE_ID?: string;
  CREATED: string;
};

export type EntradaConstrucao = {
  agora: Date;
  deals: DealBruto[]; // funis 0, 1 e 12
  historico: HistoricoBruto[]; // crm.stagehistory.list, entityTypeId 2
  empresas: Map<string, EmpresaBruta>; // por ID
  atividades: AtividadeBruta[]; // desde o início do mês anterior
  nomesEtapas12: Record<string, string>; // STATUS_ID -> nome atual (crm.dealcategory.stage.list id 12)
  metasPersonalizadas: Map<string, { meta: number | null; unidade: string | null; prazo: string | null }>; // por card
  mesesCongelados: Datasets; // kpi/equipe/camp_kpi de meses já fechados (retrato fixo)
};

// ---------------------------------------------------------------------------
// Constantes do CRM (item 3 do prompt)
// ---------------------------------------------------------------------------

export const VENDEDORAS = ["Dayane", "Livia", "Henrique", "Vanessa"] as const;
const PAGAS_COMISSAO = ["Dayane", "Livia"]; // regra de comissão individual: só elas
export const PRAZO_PARADO_DIAS = 2; // novo critério: mais de 2 dias na mesma etapa
export const CRM_CORRETO_DESDE = "2026-10";
const META_TAXA = 0.6;
const VALOR_BASE_CALL = 50;
const VALOR_COMPLEMENTO_OPORTUNIDADE = 50;
const PCT_COMISSAO_O2 = 0.005;

export const USUARIOS: Record<string, string> = { "11": "Vanessa", "210": "Dayane", "3962": "Livia", "35": "Henrique", "13": "Fabrício" };

const F = {
  motivo: "UF_CRM_1784138667",
  campanha: "UF_CRM_1791415290699",
  campanhaIni: "UF_CRM_1791415305057",
  campanhaFim: "UF_CRM_1791415322176",
  resultadoCall: "UF_CRM_1791466822034",
  formato: "UF_CRM_6AA451914C752",
  statusReuniao: "UF_CRM_6AA4519187ECF",
  reuniaoOriginal: "UF_CRM_6AA45191B1764",
  reuniaoAtual: "UF_CRM_6AA45191D48C1",
  reuniaoRealizada: "UF_CRM_6AA45191E7B9F",
  tipos: "UF_CRM_1792168723247",
  gestor: "UF_CRM_O2_GESTOR_CONTA",
};
const E = { apolices: "UF_CRM_1788467865683", comissao: "UF_CRM_1788467885830", dataResultado: "UF_CRM_1789589770952" };

const MOTIVO: Record<string, { grupo: string; nome: string }> = {
  "2148": { grupo: "A", nome: "A. QUEDA DE PRODUÇÃO" },
  "2150": { grupo: "B", nome: "B. REATIVAÇÃO PRODUTO" },
  "2152": { grupo: "C", nome: "C. REATIVAÇÃO INATIVO" },
  "2154": { grupo: "D", nome: "D. CAMPANHA" },
  "2156": { grupo: "E", nome: "E. CONTRATAÇÃO PENDENTE - SUPORTE COMERCIAL" },
  "2158": { grupo: "F1", nome: "F1. PÓS-RESULTADO (RECORRÊNCIA)" },
  "3626": { grupo: "F2", nome: "F2. SUPORTE E RELACIONAMENTO (NÃO PONTUA)" },
};
const FAMILIA: Record<string, string> = { A: "Recuperar produção", B: "Recuperar produção", C: "Recuperar produção", D: "Campanha", E: "Suporte/acompanhamento", F1: "Suporte/acompanhamento", F2: "Suporte/acompanhamento" };

const RESULTADO_CALL: Record<string, string> = { "3274": "Oportunidade de cotação gerada", "3276": "Avanço de relacionamento / cadastro", "3278": "Sem demanda atual", "3280": "Sem avanço / desinteresse" };
const FORMATO: Record<string, string> = { "3078": "Call", "3080": "Visita presencial" };
const STATUS_REUNIAO: Record<string, string> = { "3082": "Agendada", "3084": "Reagendada", "3086": "Realizada", "3088": "Cancelada", "3090": "Não compareceu", "3092": "Adiada sem nova data" };
const TIPOS_OPORTUNIDADE: Record<string, string> = { "3306": "Fiança", "3308": "Incêndio", "3310": "Capitalização", "3312": "Renovações" };

const CAMPANHAS: Record<string, { nome: string; inicio: string; fim: string }> = {
  "3606": { nome: "Elite 3 meses", inicio: "2026-10-01", fim: "2026-12-31" },
  "3608": { nome: "Elite 2 meses", inicio: "2026-10-01", fim: "2026-11-30" },
  "3602": { nome: "Black Incêndio — Reativação", inicio: "2026-11-01", fim: "2026-11-30" },
  "3604": { nome: "Black Incêndio — Proprietários/fiadores", inicio: "2026-11-01", fim: "2026-11-30" },
  "3610": { nome: "Quinzena Maluca Cap", inicio: "2026-10-15", fim: "2026-10-30" },
  "3612": { nome: "Cap Friday O2", inicio: "2026-11-01", fim: "2026-11-30" },
};

const ETAPAS_SUCESSO: Record<string, string> = {
  NEW: "RADAR DE NEGÓCIOS/ANÁLISE",
  UC_L6RJ2U: "Contato em andamento",
  UC_G2AEBP: "Análise de desempenho",
  UC_QEBNPE: "Visita/Call",
  UC_A37BU6: "Pós visita/call",
  UC_ZX9NXX: "Oportunidade",
  UC_GT4DU8: "Em campanha",
  UC_ARK8G9: "Resultados gerados",
  UC_I8X3YE: "Ação futura",
  UC_SWMRPW: "Reciclagem",
  UC_I95JZY: "Cliente sem potencial",
};
const ETAPAS_ATIVACAO: Record<string, string> = {
  "C1:UC_6NH11N": "Novo parceiro",
  "C1:UC_7DCH1P": "Onboarding/Acompanhamento",
  "C1:UC_69C23P": "Onboarding/Acompanhamento",
  "C1:NEW": "Resultados",
};
const GESTOR_OBRIGATORIO_SUCESSO = new Set(["UC_A37BU6", "UC_ZX9NXX"]); // Pós visita/call e Oportunidade

// Exceções conhecidas (item 7 do prompt).
const EXCECAO_RESULTADO_FORA_DO_MES: Record<string, string> = { "NK BARROSO": "2026-09" };
const CARDS_TESTE = new Set(["1828", "1858"]);

export const PENDENCIAS = [
  "meta_camp: base de +40% por cliente (período anterior de mesma duração) não calculada: exige a produção por cliente em Fiança, Incêndio e Capitalização.",
  "meta60: dataset legado sem tabela na tela; mantido vazio até a Vanessa confirmar a definição.",
  "Comissão: linhas 'Conferir' de call de mês anterior (ex.: cotação de Incêndio aberta no mês) dependem do script comissao_sucesso, que não veio no pacote.",
  "Comissão do Henrique: regra não documentada; não calculada.",
];

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const vazio = (v: unknown) => v === null || v === undefined || v === "" || v === "0" || (Array.isArray(v) && v.length === 0);
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : vazio(v) ? [] : [String(v)]);

/** Campo do tipo "data" do Bitrix: vem como meia-noite UTC com offset; vale o texto. */
const dataSimples = (v: unknown): string | null => (vazio(v) ? null : str(v).slice(0, 10));
/** Campo de data/hora: converte para o dia em São Paulo. */
const dataSP = (v: unknown): string | null => {
  if (vazio(v)) return null;
  const d = new Date(str(v));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
};
const mesDe = (data: string | null) => (data ? data.slice(0, 7) : null);
const numero = (v: unknown): number => {
  if (vazio(v)) return 0;
  const n = Number(str(v).split("|")[0].replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const arred = (n: number, c = 2) => Math.round(n * 10 ** c) / 10 ** c;
const diasEntre = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / 864e5);
const frase = (nome: string) => {
  const t = nome.trim().toLowerCase().replace(/call/g, "Call");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

type Card = {
  id: string;
  funil: "Sucesso" | "Campanhas" | "Ativação";
  cat: number;
  aberto: boolean;
  stageId: string;
  etapa: string;
  vendedora: string;
  gestor: string;
  cliente: string;
  empresaId: string;
  motivo: string | null;
  motivoGrupo: string | null;
  campanha: { id: string; nome: string; inicio: string; fim: string } | null;
  produtos: string[];
  criado: string | null;
  entrouNaEtapa: Date | null;
  diasEtapa: number | null;
  parado: boolean;
  diasSemAtividade: number | null;
  deal: DealBruto;
};

function nomeVendedora(id: unknown) {
  return USUARIOS[str(id)] ?? `Usuário ${str(id)}`;
}

export function mesesDoPeriodo(agora: Date): string[] {
  const hoje = agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [a, m] = hoje.split("-").map(Number);
  const out: string[] = [];
  for (let k = 0; k < 2; k++) {
    const d = new Date(Date.UTC(a, m - 1 - k, 1));
    out.unshift(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const ROTULO_MES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// ---------------------------------------------------------------------------
// Construção principal
// ---------------------------------------------------------------------------

export function construirDatasets(entrada: EntradaConstrucao): Datasets {
  const { agora, deals, historico, empresas, atividades, nomesEtapas12, metasPersonalizadas, mesesCongelados } = entrada;
  const hoje = agora.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const mesAtual = hoje.slice(0, 7);
  const meses = mesesDoPeriodo(agora);

  // ----- histórico de etapas: última entrada na etapa atual -----
  const porCard = new Map<string, HistoricoBruto[]>();
  for (const h of historico) {
    const k = str(h.OWNER_ID);
    (porCard.get(k) ?? porCard.set(k, []).get(k)!).push(h);
  }
  for (const l of porCard.values()) l.sort((a, b) => Number(a.ID) - Number(b.ID));

  const nomeEtapa = (d: DealBruto): string => {
    const cat = Number(d.CATEGORY_ID);
    if (cat === 12) return frase(nomesEtapas12[d.STAGE_ID] ?? d.STAGE_ID);
    if (cat === 1) return ETAPAS_ATIVACAO[d.STAGE_ID] ?? d.STAGE_ID;
    return ETAPAS_SUCESSO[d.STAGE_ID] ?? ({ WON: "Ganho", LOSE: "Perda", APOLOGY: "Analisar falha" } as Record<string, string>)[d.STAGE_ID] ?? d.STAGE_ID;
  };

  const cards: Card[] = deals
    .filter((d) => !CARDS_TESTE.has(d.ID))
    .map((d) => {
      const cat = Number(d.CATEGORY_ID);
      const empresa = empresas.get(str(d.COMPANY_ID));
      const eventos = porCard.get(d.ID) ?? [];
      const entrada = [...eventos].reverse().find((e) => e.STAGE_ID === d.STAGE_ID);
      const entrouNaEtapa = entrada ? new Date(entrada.CREATED_TIME) : null;
      const diasEtapa = entrouNaEtapa ? diasEntre(entrouNaEtapa, agora) : null;
      const aberto = str(d.CLOSED) !== "Y";
      const motivoId = str(d[F.motivo]);
      const campId = str(d[F.campanha]);
      const camp = CAMPANHAS[campId];
      const iniDeal = dataSimples(d[F.campanhaIni]);
      const fimDeal = dataSimples(d[F.campanhaFim]);
      const ult = vazio(d.LAST_ACTIVITY_TIME) ? null : new Date(str(d.LAST_ACTIVITY_TIME));
      const gestorId = str(d[F.gestor]);
      return {
        id: d.ID,
        funil: cat === 12 ? "Campanhas" : cat === 1 ? "Ativação" : "Sucesso",
        cat,
        aberto,
        stageId: d.STAGE_ID,
        etapa: nomeEtapa(d),
        vendedora: nomeVendedora(d.ASSIGNED_BY_ID),
        gestor: vazio(gestorId) ? "Sem gestor" : nomeVendedora(gestorId),
        cliente: str(empresa?.TITLE ?? d.TITLE),
        empresaId: str(d.COMPANY_ID),
        motivo: MOTIVO[motivoId]?.nome ?? null,
        motivoGrupo: MOTIVO[motivoId]?.grupo ?? null,
        campanha: camp ? { id: campId, nome: camp.nome, inicio: iniDeal ?? camp.inicio, fim: fimDeal ?? camp.fim } : null,
        produtos: lista(d[F.tipos]).map((x) => TIPOS_OPORTUNIDADE[x]).filter(Boolean),
        criado: dataSP(d.DATE_CREATE),
        entrouNaEtapa,
        diasEtapa,
        // Critério novo (item 6a): mais de 2 dias na mesma etapa, pela data real de entrada.
        parado: aberto && entrouNaEtapa !== null && agora.getTime() - entrouNaEtapa.getTime() > PRAZO_PARADO_DIAS * 864e5,
        diasSemAtividade: ult ? diasEntre(ult, agora) : null,
        deal: d,
      } satisfies Card;
    });

  const abertosFluxo = cards.filter((c) => c.aberto && (c.funil === "Sucesso" || c.funil === "Campanhas"));
  const abertosAtiv = cards.filter((c) => c.aberto && c.funil === "Ativação");
  const situacao = (c: Card) => (c.diasEtapa === null ? "Sem data de entrada" : c.parado ? "Parado" : "No prazo");
  // Reativação: cards do Sucesso criados na carga da planilha cross-selling (motivo B, criados em 26/10).
  const ehReativacao = (c: Card) => c.funil === "Sucesso" && c.motivoGrupo === "B" && c.criado === "2026-10-26";

  const d: Datasets = {};

  // ----- suc_clientes / suc_parados / suc_etapas / suc_motivos -----
  d.suc_clientes = abertosFluxo.map((c) => ({
    card: Number(c.id),
    cliente: c.cliente,
    vendedora: c.vendedora,
    etapa: c.etapa,
    situacao: situacao(c),
    motivo: c.motivo,
    gestor: c.gestor,
    funil: c.funil,
    campanha: c.campanha?.nome ?? null,
    reativacao: ehReativacao(c) ? "Sim" : "Não",
    produtos: c.produtos.length ? c.produtos.join(", ") : null,
    dias_etapa: c.diasEtapa,
  }));
  d.suc_parados = abertosFluxo
    .filter((c) => c.parado)
    .map((c) => ({ card: Number(c.id), cliente: c.cliente, vendedora: c.vendedora, etapa: c.etapa, dias: c.diasEtapa, prazo: PRAZO_PARADO_DIAS, atraso: (c.diasEtapa ?? 0) - PRAZO_PARADO_DIAS, funil: c.funil }))
    .sort((a, b) => b.atraso - a.atraso);

  const ordemSuc = [...Object.values(ETAPAS_SUCESSO)];
  const ordemCamp = [...new Set(abertosFluxo.filter((c) => c.funil === "Campanhas").map((c) => c.etapa))];
  d.suc_etapas = [...ordemSuc, ...ordemCamp].map((etapa, i) => {
    const cs = abertosFluxo.filter((c) => c.etapa === etapa);
    return {
      ordem: i + 1,
      etapa,
      total: cs.length,
      em_andamento: cs.filter((c) => !c.parado).length,
      parados: cs.filter((c) => c.parado).length,
      sucesso: cs.filter((c) => c.funil === "Sucesso").length,
      campanhas: cs.filter((c) => c.funil === "Campanhas").length,
      reativacao: cs.filter(ehReativacao).length,
    };
  });

  d.suc_motivos = Object.entries(MOTIVO).map(([, m]) => {
    const cs = abertosFluxo.filter((c) => c.motivoGrupo === m.grupo);
    const linha: Linha = { grupo: m.grupo, motivo: m.nome, total: cs.length, familia: FAMILIA[m.grupo] };
    for (const v of VENDEDORAS) linha[v] = cs.filter((c) => c.vendedora === v).length;
    return linha;
  });
  d.motivos_legenda = [
    { codigo: "A", motivo: "Queda de produção", uso: "Cliente ativo produzindo abaixo da média" },
    { codigo: "B", motivo: "Reativação de produto", uso: "Cliente ativo que parou um produto" },
    { codigo: "C", motivo: "Reativação de inativo", uso: "Cliente sem produção recente" },
    { codigo: "D", motivo: "Campanha", uso: "Entrou por campanha; o ciclo fica no campo Campanha" },
    { codigo: "E", motivo: "Contratação pendente — suporte comercial", uso: "Negócio em andamento travado" },
    { codigo: "F1", motivo: "Pós-resultado", uso: "Acompanhar quem já gerou resultado para garantir recorrência" },
    { codigo: "F2", motivo: "Suporte e relacionamento", uso: "Treinamento, cadastro e demais ações de suporte. Não pontua" },
  ];

  // ----- Ativação -----
  const gruposAtiv = ["Novo parceiro", "Onboarding/Acompanhamento", "Resultados"];
  d.ativ_etapas = gruposAtiv.map((etapa) => {
    const cs = abertosAtiv.filter((c) => c.etapa === etapa);
    return { etapa, total: cs.length, em_andamento: cs.filter((c) => !c.parado).length, parados: cs.filter((c) => c.parado).length };
  });

  // ----- eventos (calls/visitas) a partir dos campos de reunião do card -----
  type Evento = { id: string; data: string; card: string; cliente: string; vendedora: string; evento: string; resultado: string; pontua: string; funil: string; resultadoId: string; realizada: boolean; treino: boolean; agendada: boolean };
  const eventos: Evento[] = [];
  for (const c of cards) {
    const dl = c.deal;
    const status = STATUS_REUNIAO[str(dl[F.statusReuniao])];
    const formato = FORMATO[str(dl[F.formato])];
    const dtRealizada = dataSP(dl[F.reuniaoRealizada]);
    const dtAtual = dataSP(dl[F.reuniaoAtual]) ?? dataSP(dl[F.reuniaoOriginal]);
    const dt = dtRealizada ?? dtAtual;
    if (!status || !dt) continue;
    const resultadoId = str(dl[F.resultadoCall]);
    const realizada = status === "Realizada";
    const treino = resultadoId === "3276" || c.motivoGrupo === "F2";
    let pontua = "Não";
    if (realizada) pontua = treino ? "Não (treinamento)" : resultadoId ? "Sim" : "Pendente";
    else if (status === "Agendada" || status === "Reagendada") pontua = dt >= hoje ? "Agendada" : "Pendente";
    eventos.push({
      id: `${c.id}-c`,
      data: dt,
      card: c.id,
      cliente: c.cliente,
      vendedora: c.vendedora,
      evento: formato ?? "Reunião",
      resultado: resultadoId ? RESULTADO_CALL[resultadoId] ?? "—" : realizada ? "Sem resultado registrado" : dt >= hoje ? "Reunião agendada" : "Sem resultado registrado (agendada, sem data de realizada)",
      pontua,
      funil: c.funil,
      resultadoId,
      realizada,
      treino,
      agendada: true,
    });
  }
  const eventosCall = eventos.filter((e) => e.agendada);
  d.suc_eventos = eventosCall
    .map(({ id, data, card, cliente, vendedora, evento, resultado, pontua, funil }) => ({ id, data, card: Number(card), cliente, vendedora, evento, resultado, pontua, funil }))
    .sort((a, b) => String(a.data).localeCompare(String(b.data)));

  // ----- histórico: resultados, perdas e encerramentos por mês -----
  const donoAtual = new Map(cards.map((c) => [c.id, c]));
  type Marco = { mes: string; vendedora: string; card: string; tipo: "resultado" | "perda" | "encerramento" | "ativado" | "ativ_perda" };
  const marcos: Marco[] = [];
  for (const h of historico) {
    const c = donoAtual.get(str(h.OWNER_ID));
    if (!c) continue;
    let m = mesDe(dataSP(h.CREATED_TIME));
    if (!m) continue;
    const excecao = Object.entries(EXCECAO_RESULTADO_FORA_DO_MES).find(([k]) => c.cliente.toUpperCase().includes(k));
    if (excecao && c.funil !== "Ativação") m = excecao[1];
    const base = { mes: m, vendedora: c.vendedora, card: c.id };
    if (c.funil !== "Ativação") {
      if (h.STAGE_ID === "UC_ARK8G9" || h.STAGE_ID === "WON" || h.STAGE_ID === "C12:FINAL_INVOICE") marcos.push({ ...base, tipo: "resultado" });
      else if (h.STAGE_ID === "LOSE" || h.STAGE_ID === "C12:LOSE") marcos.push({ ...base, tipo: "perda" });
      else if (h.STAGE_ID === "APOLOGY" || h.STAGE_ID === "C12:APOLOGY") marcos.push({ ...base, tipo: "encerramento" });
    } else {
      if (c.cliente.toUpperCase().includes("CORREIA NETO")) continue; // conta só no Sucesso, não na Ativação
      if (h.STAGE_ID === "C1:NEW" || h.STAGE_ID === "C1:WON") marcos.push({ ...base, tipo: "ativado" });
      else if (h.STAGE_ID === "C1:LOSE") marcos.push({ ...base, tipo: "ativ_perda" });
    }
  }
  const unicos = (ms: Marco[]) => new Set(ms.map((x) => x.card)).size;

  // ----- Resultado financeiro (Empresa vinculada) -----
  const empresaVendedora = new Map<string, string>();
  for (const c of cards) {
    if (c.empresaId && c.empresaId !== "0" && (!empresaVendedora.has(c.empresaId) || c.cat === 0)) empresaVendedora.set(c.empresaId, c.vendedora);
  }
  type Fin = { cliente: string; vendedora: string; apolices: number; comissao: number; data: string | null; mes: string | null; fora: string | null };
  const fin: Fin[] = [];
  for (const [id, vend] of empresaVendedora) {
    const e = empresas.get(id);
    if (!e) continue;
    const apolices = Math.round(numero(e[E.apolices]));
    const comissao = numero(e[E.comissao]);
    if (!apolices && !comissao) continue;
    const data = dataSimples(e[E.dataResultado]);
    const titulo = str(e.TITLE);
    const excecao = Object.entries(EXCECAO_RESULTADO_FORA_DO_MES).find(([k]) => titulo.toUpperCase().includes(k));
    fin.push({ cliente: titulo, vendedora: vend, apolices, comissao, data, mes: excecao ? excecao[1] : mesDe(data), fora: excecao ? excecao[1] : null });
  }
  d.resultado_fin = fin
    .map((f) => ({
      cliente: f.cliente,
      vendedora: f.vendedora,
      apolices: f.apolices,
      comissao_o2: arred(f.comissao),
      data_resultado: !f.data ? "sem data" : f.fora ? `${mesDe(f.data)} (correto ${f.fora})` : mesDe(f.data),
      conta_out: f.mes === mesAtual ? "Sim" : "Não",
      obs: !f.data ? "Sem DATA - RESULTADO COMERCIAL GERADO: não dá para pôr no mês." : f.fora ? "Data no CRM difere da data correta do resultado." : "",
    }))
    .sort((a, b) => String(a.cliente).localeCompare(String(b.cliente)));

  // ----- KPIs por mês e vendedora -----
  const kpi: Linha[] = [];
  const add = (mes: string, v: string, chave: string, valor: number | null) => kpi.push({ id: `${mes}|${v}|${chave}`, mes, vendedora: v, chave, valor });
  const VT = [...VENDEDORAS, "Todas"] as string[];
  const de = (v: string) => (c: { vendedora: string }) => v === "Todas" || c.vendedora === v;

  // retrato de hoje
  for (const v of VT) {
    const f = abertosFluxo.filter(de(v));
    add("hoje", v, "ativ_cards", abertosAtiv.filter(de(v)).length);
    add("hoje", v, "suc_cards", f.filter((c) => c.funil === "Sucesso").length);
    add("hoje", v, "camp_cards", f.filter((c) => c.funil === "Campanhas").length);
    add("hoje", v, "fluxo", f.length);
    add("hoje", v, "andamento", f.filter((c) => !c.parado).length);
    add("hoje", v, "parados", f.filter((c) => c.parado).length);
    add("hoje", v, "reativacao", f.filter(ehReativacao).length);
  }

  // comissão por call (regra do item 8; só Dayane e Livia)
  const comissao: Linha[] = [];
  const mesesLive = meses.filter((m) => m >= CRM_CORRETO_DESDE);
  const prefixo: Record<string, string> = { Dayane: "D", Livia: "L" };
  for (const v of PAGAS_COMISSAO) {
    let n = 0;
    for (const e of eventosCall.filter((x) => x.vendedora === v && mesesLive.includes(mesDe(x.data) ?? "")).sort((a, b) => a.data.localeCompare(b.data))) {
      n++;
      const pontuou = e.pontua === "Sim";
      const opp = pontuou && e.resultadoId === "3274";
      const pendente = e.pontua === "Pendente";
      const base = pontuou ? VALOR_BASE_CALL : 0;
      const comp = opp ? VALOR_COMPLEMENTO_OPORTUNIDADE : 0;
      comissao.push({
        id: `${prefixo[v]}${n}`,
        vendedora: v,
        data: e.data,
        cliente: e.cliente,
        formato: e.evento,
        resultado: e.treino ? "Treinamento/cadastro" : opp ? "Oportunidade gerada" : pontuou ? e.resultado : e.resultado,
        base,
        complemento: comp,
        total: base + comp,
        situacao: pontuou ? "Paga" : e.treino ? "Não pontua" : pendente ? "Pendente: preencher resultado" : "Não pontua",
        card: Number(e.card),
      });
    }
    // 0,5% da Comissão O2 do cliente que fechou, no mês da data do resultado
    for (const f of fin.filter((x) => x.vendedora === v && x.mes && mesesLive.includes(x.mes))) {
      n++;
      comissao.push({
        id: `${prefixo[v]}${n}`,
        vendedora: v,
        data: f.data ?? "",
        cliente: f.cliente,
        formato: null,
        resultado: `0,5% da Comissão O2 (${f.apolices} apólice(s))`,
        base: 0,
        complemento: arred(f.comissao * PCT_COMISSAO_O2),
        total: arred(f.comissao * PCT_COMISSAO_O2),
        situacao: "Paga",
        card: 0,
      });
    }
  }
  d.comissao = comissao;

  const resumoComissao = (v: string, mes: string) => {
    const linhas = comissao.filter((x) => x.vendedora === v && mesDe(str(x.data)) === mes);
    const pend = linhas.filter((x) => str(x.situacao).startsWith("Pendente")).length;
    const base = linhas.reduce((s, x) => s + Number(x.base), 0);
    const comp = linhas.reduce((s, x) => s + Number(x.complemento), 0);
    return { linhas, pend, base, comp, total: base + comp };
  };

  // metas 60% (ações que geraram oportunidade)
  const acoesDo = (v: string, mes: string) => eventosCall.filter((e) => (v === "Todas" || e.vendedora === v) && mesDe(e.data) === mes && !e.treino && (e.pontua === "Sim" || e.pontua === "Pendente"));
  const metaAcoes: Linha[] = [];
  const mesCorrente = mesAtual;
  for (const v of ["Dayane", "Livia", "Henrique", "Todas"]) {
    const ac = acoesDo(v, mesCorrente);
    const opp = ac.filter((e) => e.resultadoId === "3274").length;
    const taxa = ac.length ? opp / ac.length : null;
    metaAcoes.push({
      vendedora: v === "Todas" ? "Equipe" : v,
      acoes: ac.length,
      com_oportunidade: opp,
      taxa,
      atingimento: taxa === null ? null : taxa / META_TAXA,
      situacao: taxa === null ? "Sem ações" : taxa >= META_TAXA ? "Atingiu" : "Abaixo de 60%",
      obs: v === "Henrique" ? "Supervisor" : v === "Todas" ? "Treinamento/cadastro fora da base; pipes Sucesso + Campanhas + Ativação" : ac.map((e) => `${e.cliente} (${e.resultadoId === "3274" ? "oportunidade" : "sem resultado"}, ${e.funil})`).join("; "),
    });
  }
  d.meta_acoes = metaAcoes;
  d.meta60 = [];

  // meses ao vivo
  for (const mes of mesesLive) {
    const metaDe = new Map(metaAcoes.map((m) => [m.vendedora === "Equipe" ? "Todas" : String(m.vendedora), m]));
    for (const v of VT) {
      const ev = eventosCall.filter((e) => (v === "Todas" || e.vendedora === v) && mesDe(e.data) === mes);
      const realizadas = ev.filter((e) => e.pontua === "Sim");
      const ms = marcos.filter((x) => (v === "Todas" || x.vendedora === v) && x.mes === mes);
      const fv = fin.filter((f) => (v === "Todas" || f.vendedora === v) && f.mes === mes);
      const rc = v === "Todas" ? null : PAGAS_COMISSAO.includes(v) ? resumoComissao(v, mes) : null;
      const rcTodas = v === "Todas" ? PAGAS_COMISSAO.map((p) => resumoComissao(p, mes)) : null;
      add(mes, v, "agendaram", ev.length);
      add(mes, v, "realizaram", realizadas.length);
      add(mes, v, "treino", ev.filter((e) => e.treino && e.realizada).length);
      add(mes, v, "oportunidade", realizadas.filter((e) => e.resultadoId === "3274").length);
      add(mes, v, "resultado", unicos(ms.filter((x) => x.tipo === "resultado")));
      add(mes, v, "perdas", unicos(ms.filter((x) => x.tipo === "perda")));
      add(mes, v, "encerramento", unicos(ms.filter((x) => x.tipo === "encerramento")));
      add(mes, v, "apolices", fv.reduce((s, f) => s + f.apolices, 0));
      add(mes, v, "comissao_o2", arred(fv.reduce((s, f) => s + f.comissao, 0)));
      const mm = metaDe.get(v);
      add(mes, v, "meta_taxa", mes === mesCorrente ? ((mm?.taxa as number | null) ?? null) : null);
      add(mes, v, "meta_acoes", mes === mesCorrente ? ((mm?.acoes as number | null) ?? null) : null);
      add(mes, v, "meta_opp", mes === mesCorrente ? ((mm?.com_oportunidade as number | null) ?? null) : null);
      add(mes, v, "comissao_vend", rc ? rc.total : rcTodas ? rcTodas.reduce((s, r) => s + r.total, 0) : null);
      add(mes, v, "calls_pendentes", rc ? rc.pend : rcTodas ? rcTodas.reduce((s, r) => s + r.pend, 0) : null);
      const ativDeals = cards.filter((c) => c.funil === "Ativação" && (v === "Todas" || c.vendedora === v));
      add(mes, v, "ativ_novos", ativDeals.filter((c) => mesDe(c.criado) === mes).length);
      add(mes, v, "ativ_ativados", unicos(ms.filter((x) => x.tipo === "ativado")));
      add(mes, v, "ativ_perdas", unicos(ms.filter((x) => x.tipo === "ativ_perda")));
      const empAtiv = new Set(ativDeals.map((c) => c.empresaId));
      const fa = fv.filter((f) => [...empAtiv].some((id) => empresas.get(id)?.TITLE === f.cliente));
      add(mes, v, "ativ_apolices", fa.reduce((s, f) => s + f.apolices, 0));
      add(mes, v, "ativ_comissao", arred(fa.reduce((s, f) => s + f.comissao, 0)));
    }
  }
  // meses fechados: retrato fixo guardado (mês encerrado não recalcula)
  for (const r of mesesCongelados.kpi ?? []) if (!mesesLive.includes(str(r.mes))) kpi.push(r);
  d.kpi = kpi;

  d.comissao_resumo = [...PAGAS_COMISSAO, "Total"].map((v) => {
    const alvo = v === "Total" ? PAGAS_COMISSAO : [v];
    const rs = alvo.map((p) => resumoComissao(p, mesCorrente));
    const realizadas = rs.reduce((s, r) => s + r.linhas.filter((x) => Number(x.base) > 0).length, 0);
    const oportunidades = rs.reduce((s, r) => s + r.linhas.filter((x) => Number(x.complemento) >= VALOR_COMPLEMENTO_OPORTUNIDADE && str(x.resultado) === "Oportunidade gerada").length, 0);
    const total = rs.reduce((s, r) => s + r.total, 0);
    const pend = rs.reduce((s, r) => s + r.pend, 0);
    const pct = rs.reduce((s, r) => s + r.linhas.filter((x) => str(x.resultado).startsWith("0,5%")).reduce((a, x) => a + Number(x.total), 0), 0);
    return {
      vendedora: v,
      calls: realizadas,
      oportunidades,
      base: rs.reduce((s, r) => s + r.base, 0),
      complemento: rs.reduce((s, r) => s + r.comp, 0),
      pendentes: pend,
      total,
      potencial: total + pend * (VALOR_BASE_CALL + VALOR_COMPLEMENTO_OPORTUNIDADE),
      comissao_o2_convertida: arred(fin.filter((f) => alvo.includes(f.vendedora) && f.mes === mesCorrente).reduce((s, f) => s + f.comissao, 0)),
      pct_05: arred(pct),
    };
  });

  // ----- equipe (tabela de colaboradoras) -----
  const kd = new Map(kpi.map((r) => [`${r.mes}|${r.vendedora}|${r.chave}`, r.valor as number | null]));
  const equipe: Linha[] = [];
  for (const m of meses) {
    for (const v of VT) {
      const q = (k: string) => kd.get(`${m}|${v}|${k}`) ?? null;
      const h = (k: string) => kd.get(`hoje|${v}|${k}`) ?? null;
      equipe.push({ id: `${m}|${v}`, mes: m, vendedora: v === "Todas" ? "Equipe" : v, ativ: h("ativ_cards"), sucesso: h("suc_cards"), campanhas: h("camp_cards"), parados: h("parados"), calls: q("realizaram"), oportunidades: q("oportunidade"), resultados: q("resultado"), meta: q("meta_taxa"), comissao_vend: q("comissao_vend") });
    }
  }
  d.equipe = equipe;

  // ----- Campanhas -----
  const cardsCamp = cards.filter((c) => c.funil === "Campanhas" && c.aberto);
  d.camp_cards = cardsCamp
    .map((c) => {
      const meta = metasPersonalizadas.get(c.id);
      return {
        card: Number(c.id),
        cliente: c.cliente,
        vendedora: c.vendedora,
        gestor: c.gestor,
        campanha: c.campanha?.nome ?? "Sem campanha",
        etapa: c.etapa,
        produtos: c.produtos.length ? c.produtos.join(", ") : "—",
        dias_etapa: c.diasEtapa,
        dias_sem_ativ: c.diasSemAtividade,
        situacao: c.diasEtapa === null ? "Sem data de entrada" : c.parado ? "Parado" : "Em movimento",
        meta_personalizada: meta?.meta ?? null,
        meta_unidade: meta?.unidade ?? null,
        meta_prazo: meta?.prazo ?? null,
        meta_atingimento: null,
      };
    })
    .sort((a, b) => (b.dias_sem_ativ ?? -1) - (a.dias_sem_ativ ?? -1));

  const campanhasVivas = [...new Map(cardsCamp.filter((c) => c.campanha).map((c) => [c.campanha!.nome, c.campanha!])).values()];
  const campKpi: Linha[] = [];
  for (const camp of [...campanhasVivas, { nome: "Todas", inicio: campanhasVivas.map((c) => c.inicio).sort()[0] ?? hoje, fim: campanhasVivas.map((c) => c.fim).sort().reverse()[0] ?? hoje }]) {
    for (const v of VT) {
      const cs = cardsCamp.filter((c) => (camp.nome === "Todas" || c.campanha?.nome === camp.nome) && (v === "Todas" || c.vendedora === v));
      const nomes = new Set(cs.map((c) => c.cliente));
      const ids = new Set(cs.map((c) => c.id));
      const diasTotal = Math.max(1, diasEntre(new Date(camp.inicio), new Date(camp.fim)) + 1);
      const diasRest = Math.max(0, diasEntre(new Date(hoje), new Date(camp.fim)));
      for (const m of meses) {
        const vivo = m >= CRM_CORRETO_DESDE;
        const cot = eventosCall.filter((e) => ids.has(e.card) && mesDe(e.data) === m && e.resultadoId === "3274").length;
        const ap = fin.filter((f) => nomes.has(f.cliente) && f.mes === m).reduce((s, f) => s + f.apolices, 0);
        const apAcum = fin.filter((f) => nomes.has(f.cliente) && f.data && f.data >= camp.inicio && f.mes !== null && f.mes === (EXCECAO_RESULTADO_FORA_DO_MES[Object.keys(EXCECAO_RESULTADO_FORA_DO_MES).find((k) => f.cliente.toUpperCase().includes(k)) ?? ""] ?? f.mes)).reduce((s, f) => s + f.apolices, 0);
        const sem = fin.filter((f) => nomes.has(f.cliente) && !f.data);
        campKpi.push({
          id: `${camp.nome}|${m}|${v}`,
          campanha: camp.nome,
          mes: m,
          vendedora: v,
          cards: cs.length,
          cotacoes_mes: vivo ? cot : null,
          apolices_mes: vivo ? ap : null,
          apolices_acum: vivo ? apAcum : null,
          apolices_sem_data: sem.reduce((s, f) => s + f.apolices, 0),
          clientes_sem_data: sem.length,
          base_ref: null,
          meta: null,
          atingimento: null,
          inicio: camp.inicio,
          fim: camp.fim,
          dias_total: diasTotal,
          dias_restantes: diasRest,
          tempo_decorrido: arred(1 - diasRest / diasTotal, 3),
        });
      }
    }
  }
  d.camp_kpi = campKpi;

  // ----- Gestor da Conta -----
  const cardsGestor = cards.filter((c) => c.funil !== "Ativação");
  d.gestor_cards = cardsGestor.map((c) => ({ card: Number(c.id), cliente: c.cliente, vendedora: c.vendedora, gestor: c.gestor, etapa: c.etapa.toUpperCase(), aberto: c.aberto ? "Aberto" : "Fechado", funil: c.funil }));
  const etapasGestor = [...new Map(abertosFluxo.map((c) => [`${c.funil}|${c.etapa}`, c])).values()];
  const linhasGestor = etapasGestor.map((ref) => {
    const cs = abertosFluxo.filter((c) => c.funil === ref.funil && c.etapa === ref.etapa);
    const com = cs.filter((c) => c.gestor !== "Sem gestor").length;
    return { etapa: ref.funil === "Campanhas" ? `${ref.etapa.toUpperCase()} (Campanhas)` : ref.etapa.toUpperCase(), cards: cs.length, com_gestor: com, sem_gestor: cs.length - com, pct: cs.length ? com / cs.length : 0, obrigatorio: ref.funil === "Campanhas" || GESTOR_OBRIGATORIO_SUCESSO.has(ref.stageId) ? "Sim" : "Não", funil: ref.funil };
  });
  const totComGestor = abertosFluxo.filter((c) => c.gestor !== "Sem gestor").length;
  d.gestor_etapas = [...linhasGestor, { etapa: "Total aberto", cards: abertosFluxo.length, com_gestor: totComGestor, sem_gestor: abertosFluxo.length - totComGestor, pct: abertosFluxo.length ? totComGestor / abertosFluxo.length : 0, obrigatorio: "-", funil: "Sucesso + Campanhas" }];
  const pares = new Map<string, Linha>();
  for (const c of abertosFluxo.filter((x) => x.gestor !== "Sem gestor")) {
    const par = `${c.gestor} + ${c.vendedora}`;
    const r = pares.get(par) ?? { par, gestor: c.gestor, vendedora: c.vendedora, cards: 0, obs: c.gestor === c.vendedora ? "Mesma pessoa nos dois papéis" : "" };
    r.cards = Number(r.cards) + 1;
    pares.set(par, r);
  }
  d.gestor_pares = [...pares.values()].sort((a, b) => Number(b.cards) - Number(a.cards));

  // ----- Reativação por produto -----
  const reat = abertosFluxo.filter(ehReativacao);
  d.reativacao = [];
  for (const v of ["Dayane", "Livia", "Henrique", "Vanessa", "Total"]) {
    const cs = reat.filter((c) => v === "Total" || c.vendedora === v);
    if (v !== "Total" && !cs.length) continue;
    d.reativacao.push({ chave: `${v}|Cards`, vendedora: v, produto: "Cards (únicos)", cards: cs.length, abertos: cs.length });
    for (const p of ["Fiança", "Incêndio", "Capitalização"]) {
      const n = cs.filter((c) => c.produtos.includes(p)).length;
      d.reativacao.push({ chave: `${v}|${p}`, vendedora: v, produto: p, cards: n, abertos: n });
    }
  }

  // ----- Ativação por vendedora -----
  d.ativ_vendedoras = (["Dayane", "Livia", "Henrique"] as const).map((v) => {
    const cs = abertosAtiv.filter((c) => c.vendedora === v);
    const ativados = unicos(marcos.filter((x) => x.tipo === "ativado" && x.vendedora === v && x.mes === mesCorrente));
    const comissaoConvertida = fin.filter((f) => f.vendedora === v && f.mes === mesCorrente && cards.some((c) => c.funil === "Ativação" && c.vendedora === v && c.empresaId && empresas.get(c.empresaId)?.TITLE === f.cliente)).reduce((s, f) => s + f.comissao, 0);
    return { vendedora: v, clientes: cs.length, ativados, conversao: cs.length ? ativados / cs.length : "sem base", comissao_o2_convertida: arred(comissaoConvertida), valor_05: PAGAS_COMISSAO.includes(v) ? arred(comissaoConvertida * PCT_COMISSAO_O2) : 0 };
  });

  // ----- ligações e WhatsApp (só o que passa pelo Bitrix) -----
  const empresaDoCard = new Map(cards.map((c) => [c.id, c.empresaId]));
  const empresaDaAtividade = (a: AtividadeBruta): string | null => {
    if (a.OWNER_TYPE_ID === "4") return str(a.OWNER_ID);
    if (a.OWNER_TYPE_ID === "2") return empresaDoCard.get(str(a.OWNER_ID)) || null;
    return null;
  };
  const nomeEmpresa = (id: string) => str(empresas.get(id)?.TITLE) || `Empresa ${id}`;
  const mesAnterior = meses[0];
  const contar = (resp: string, mes: string, f: (a: AtividadeBruta) => boolean) => atividades.filter((a) => a.RESPONSIBLE_ID === resp && mesDe(dataSP(a.CREATED)) === mes && f(a));
  const ehLigacao = (a: AtividadeBruta) => a.PROVIDER_ID === "VOXIMPLANT_CALL";
  const ehWpp = (a: AtividadeBruta) => a.PROVIDER_ID === "IMOPENLINES_SESSION";
  const idDe: Record<string, string> = { Dayane: "210", Livia: "3962", Henrique: "35", Vanessa: "11" };
  d.contatos_vend = (["Dayane", "Livia", "Henrique"] as const).map((v) => {
    const r = idDe[v];
    const emp = new Set([...contar(r, mesCorrente, ehLigacao), ...contar(r, mesCorrente, ehWpp)].map(empresaDaAtividade).filter((x): x is string => !!x));
    return {
      vendedora: v,
      lig_set: contar(r, mesAnterior, ehLigacao).length || null,
      lig_out: contar(r, mesCorrente, (a) => ehLigacao(a) && a.DIRECTION === "2").length,
      rec_out: contar(r, mesCorrente, (a) => ehLigacao(a) && a.DIRECTION === "1").length,
      wpp_set: contar(r, mesAnterior, ehWpp).length || null,
      wpp_out: contar(r, mesCorrente, ehWpp).length,
      empresas_out: emp.size,
    };
  });
  const porEmpresa = (resp: string | null) => {
    const m = new Map<string, number>();
    for (const a of atividades) {
      if (mesDe(dataSP(a.CREATED)) !== mesCorrente || !(ehLigacao(a) || ehWpp(a))) continue;
      if (resp && a.RESPONSIBLE_ID !== resp) continue;
      const emp = empresaDaAtividade(a);
      if (emp) m.set(emp, (m.get(emp) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  d.contatos_empresas = [];
  let n = 0;
  for (const [quem, resp, topo] of [["Time todo", null, 10], ["Dayane", "210", 3], ["Livia", "3962", 4]] as const) {
    for (const [empId, qtd] of porEmpresa(resp).slice(0, topo)) d.contatos_empresas.push({ id: `E${++n}`, vendedora: quem, empresa: nomeEmpresa(empId), contatos: qtd });
  }

  // ----- apoio -----
  d.meses = meses
    .slice()
    .reverse()
    .map((m) => {
      const [a, mm] = m.split("-").map(Number);
      const atual = m === mesAtual;
      return { mes: m, rotulo: `${ROTULO_MES[mm - 1]} ${a}`, periodo: atual ? `01 a ${hoje.slice(8, 10)}/${hoje.slice(5, 7)} (parcial)` : "mês fechado", padrao: atual ? "Sim" : "Não" };
    });
  d.origens = origens(hoje);
  return d;
}

function origens(hoje: string): Linha[] {
  const dd = `${hoje.slice(8, 10)}/${hoje.slice(5, 7)}`;
  const itens: [string, string, string][] = [
    ["ativ_cards", "Cards na Ativação", "Bitrix › Negócios › funil Ativação Novos Clientes, cards abertos hoje."],
    ["suc_cards", "Cards no Sucesso", "Bitrix › Negócios › funil Sucesso do Cliente, cards abertos hoje (inclui reativação)."],
    ["camp_cards", "Cards em Campanhas", "Bitrix › Negócios › funil Campanhas, cards abertos hoje."],
    ["fluxo", "Clientes no fluxo", "Sucesso + Campanhas, cards abertos hoje."],
    ["andamento", "Em andamento", "Cards abertos que estão há 2 dias ou menos na mesma etapa."],
    ["parados", "Parados", "Cards há mais de 2 dias na mesma etapa. A data de entrada na etapa vem do histórico de etapas do Bitrix (não da última edição do card). Sem histórico, aparece como \"sem data de entrada\"."],
    ["reativacao", "Reativação", "Cards criados em 26/10 da planilha cross-selling, motivo B."],
    ["agendaram", "Calls/visitas agendadas", "Cards com data de reunião no mês (campos de reunião do negócio)."],
    ["realizaram", "Calls/visitas realizadas", "Reunião com status Realizada no mês e campo Resultado da visita/call preenchido que pontua (sem treinamento/cadastro)."],
    ["treino", "Treinamento/cadastro", "Resultado \"Avanço de relacionamento / cadastro\" ou motivo F2. Conta como contato, não pontua."],
    ["oportunidade", "Oportunidades", "Resultado da visita/call = Oportunidade de cotação gerada, no mês da reunião."],
    ["resultado", "Resultados", "Card entrou em Resultados gerados (Sucesso), Apuração do resultado (Campanhas) ou foi ganho no mês, pelo histórico de etapas."],
    ["perdas", "Perdas", "Cards perdidos no mês. Fechamento em lote em Analisar falha é encerramento de ciclo, não perda."],
    ["apolices", "Apólices", "Empresa vinculada › Resultado Financeiro (Nº de apólices), pela DATA - RESULTADO COMERCIAL GERADO no mês."],
    ["comissao_o2", "Comissão O2", "Empresa vinculada › Resultado Financeiro (Comissão O2), pela DATA - RESULTADO COMERCIAL GERADO no mês."],
    ["comissao_vend", "Comissão da vendedora", "Out/26 em diante: R$ 50 por call/visita realizada + R$ 50 se gerar oportunidade + 0,5% da Comissão O2 de quem fechou. Set/26 fechado pela regra de 14/10."],
    ["meta_taxa", "Meta 60%", "Calls/visitas realizadas no mês (Sucesso, Campanhas e Ativação, sem treinamento) que geraram oportunidade. 60% = 100% da meta."],
    ["cotacoes_mes", "Cotações do mês", "Calls/visitas de clientes da campanha com resultado \"Oportunidade de cotação gerada\" no mês."],
    ["apolices_mes", "Apólices do mês", "Resultado Financeiro da Empresa com data no mês, só clientes da campanha."],
    ["apolices_sem_data", "Apólices sem data", "Clientes da campanha com apólices no Resultado Financeiro, mas sem DATA - RESULTADO COMERCIAL GERADO. Não entram em nenhum mês até a data ser preenchida."],
    ["meta_camp", "Meta da campanha", "Meta personalizada por cliente, cadastrada no Workspace. Sem meta válida, mostra \"meta não definida\"."],
    ["prazo", "Prazo", `Dias até o fim da campanha, contados a partir de ${dd}.`],
    ["camp_parado", "Parados na campanha", "Cards do funil Campanhas há mais de 2 dias na mesma etapa. \"Dias sem atividade\" é informação extra."],
  ];
  return itens.map(([chave, indicador, origem]) => ({ chave, indicador, origem }));
}
