import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarEmLotes } from "@/lib/supabase/emLotes";
import { buscarCodigosCorp } from "@/lib/baseUnica/codigosCorp";

// Metas e produção automática da CAMPANHA (22/10/2026). A campanha comercial
// tem período, produtos, metas individuais por imobiliária (ou por grupo/rede),
// responsável da O2 por imobiliária e premiação; e-mails de acompanhamento
// (parciais) ficam como e-mails filhos dela (campanhas.campanha_pai_id).
//
// Regras combinadas com o Matheus (22/10/2026):
//  - Meta é individual, definida uma a uma (a base histórica aparece só como
//    referência, a parceria é subjetiva).
//  - Contratação = conversão contada pelo mês da efetivação em todos os
//    produtos (Fiança convertido, Capitalização pago, Ramos Elementares
//    efetivado -- lote por card é controle da operação, não fechamento).
//  - Apuração pelo funil (Bitrix/planilhas, já com a imobiliária resolvida
//    pela base única); conferência pelo Corp (o que foi convertido vira
//    apólice lá).
//  - Participante pode ser a imobiliária (unidade) ou o grupo/rede inteiro.
//  - Resultado financeiro = comissão − repasse − custo da premiação (Corp).

export const METRICAS_META = [
  { valor: "contratacoes", rotulo: "Contratações (efetivadas)", moeda: false },
  { valor: "cotacoes", rotulo: "Cotações recebidas", moeda: false },
  { valor: "premio", rotulo: "Prêmio das contratações (R$)", moeda: true },
  { valor: "comissao", rotulo: "Comissão das contratações (R$)", moeda: true },
] as const;
export type MetricaMeta = (typeof METRICAS_META)[number]["valor"];

export function metricaInfo(valor: string) {
  return METRICAS_META.find((m) => m.valor === valor) ?? METRICAS_META[0];
}

// Produtos que dá pra medir por imobiliária. Automóvel não tem imobiliária
// ligada e fica de fora das metas por imobiliária.
export const PRODUTOS_BASE = [
  { valor: "fianca", rotulo: "Seguro Fiança" },
  { valor: "capitalizacao", rotulo: "Capitalização" },
  { valor: "re", rotulo: "Ramos Elementares" },
] as const;

export function rotuloProdutoBase(valor: string): string {
  return PRODUTOS_BASE.find((p) => p.valor === valor)?.rotulo ?? valor;
}

// Produto da campanha (lista de Campanhas) -> produto da base de produção.
// Incêndio, RC Obras, RCP, Condomínio e Seguro Celular são Ramos
// Elementares; Automóvel e Institucional não têm produção por imobiliária.
const BASE_POR_PRODUTO_CAMPANHA: Record<string, string> = {
  fianca: "fianca",
  capitalizacao: "capitalizacao",
  incendio: "re",
  rc_obras: "re",
  rcp: "re",
  condominio: "re",
  seguro_celular: "re",
};
export function produtosBaseDaCampanha(produtosCampanha: string[]): string[] {
  return [...new Set(produtosCampanha.map((p) => BASE_POR_PRODUTO_CAMPANHA[p]).filter((p): p is string => !!p))];
}

// Ramo do Corp -> produto do programa.
const PRODUTO_POR_RAMO_CORP: Record<string, string> = {
  FIAN: "fianca",
  "2FIA": "fianca",
  CAP: "capitalizacao",
  CAP2: "capitalizacao",
  IMOB: "re",
  "2IMO": "re",
  RESI: "re",
  EMPR: "re",
  COND: "re",
  CRES: "re",
  CCOM: "re",
  BIKE: "re",
  RC: "re",
  RCP: "re",
  PORT: "re",
  "2POR": "re",
};

// O que o cálculo precisa da campanha.
export type ConfigDesempenho = {
  nome: string;
  produtos: string[]; // produtos da BASE (fianca, capitalizacao, re)
  metrica: string;
  inicio: string; // YYYY-MM-DD
  fim: string;
  premiacao_descricao: string | null;
  custo_premiacao_geral: number;
};

export type ParticipanteRow = {
  id: string; // id da linha de meta, ou "imob:<id>" quando ainda não tem meta salva
  imobiliaria_id: string | null;
  grupo_id: string | null;
  meta: number | null;
  observacao: string | null;
  custo_premiacao: number;
  responsavel_email: string | null;
  // Gestor da conta (27/10/2026): pessoa da O2 que cuida da conta, distinta
  // do responsável pela imobiliária na campanha. Fica na linha de meta.
  gestor_conta_email: string | null;
  // Período INDIVIDUAL do participante (03/11/2026); vazio = vale o da campanha.
  periodo_inicio?: string | null;
  periodo_fim?: string | null;
  periodo_origem?: string | null;
};

export type Farol = "nao_iniciada" | "sem_meta" | "atingida" | "no_ritmo" | "atencao" | "em_risco" | "nao_atingida";

export const ROTULO_FAROL: Record<Farol, string> = {
  nao_iniciada: "Não iniciada",
  sem_meta: "Sem meta",
  atingida: "Meta atingida",
  no_ritmo: "No ritmo",
  atencao: "Atenção",
  em_risco: "Em risco",
  nao_atingida: "Não atingida",
};

export const COR_FAROL: Record<Farol, string> = {
  nao_iniciada: "bg-gray-100 text-gray-600",
  sem_meta: "bg-gray-100 text-gray-600",
  atingida: "bg-green-600 text-white",
  no_ritmo: "bg-green-100 text-green-800",
  atencao: "bg-amber-100 text-amber-800",
  em_risco: "bg-red-100 text-red-700",
  nao_atingida: "bg-red-600 text-white",
};

export type ContagemFunil = { cotacoes: number; contratacoes: number; premio: number; comissao: number; emAndamento: number };
// Meta, realizado, projeção e base usam SÓ contratos novos (27/10/2026,
// documento de ajustes): os campos de topo são de negócios novos e as
// renovações ficam em `renovacoes`, fora da meta.
export type NumerosFunil = ContagemFunil & { renovacoes: ContagemFunil };

// Fase 2 (22/10/2026): oportunidades em aberto e alertas por participante.
export type Oportunidade = {
  produto: string;
  status: string;
  entrada: string; // YYYY-MM-DD
  dias: number; // desde a entrada
  valor: number | null; // prêmio cotado (ou valor do título, na Capitalização)
  link: string | null; // card no Bitrix
  tipo: "novo" | "renovacao";
  // Data em que a cotação foi aprovada, quando a fonte tem (Fiança do Bitrix). null = não disponível.
  aprovadaEm?: string | null;
  pretendente: string | null; // preenchido depois, em pretendentes.ts (título do card / locatário)
  // De onde buscar o nome do pretendente; descartado depois de resolver.
  ref?: { fonte: string | null; bitrixId: string | null; locatarioId: string | null };
};
export type Alerta = { tipo: "sem_cotacao" | "aprovada_parada" | "abaixo_base"; texto: string };

export const DIAS_SEM_COTACAO_ALERTA = 15;
export const DIAS_APROVADA_PARADA = 7;
export const FATOR_ABAIXO_BASE = 0.7;
export const FATOR_ATENCAO_FAROL = 0.8;
const DIAS_MINIMOS_PARA_RITMO = 14;

const ENTIDADE_BITRIX: Record<string, number> = { fianca: 1042, capitalizacao: 1048, re: 1046 };
function linkBitrix(produto: string, fonte: string | null, id: string | null): string | null {
  const entidade = ENTIDADE_BITRIX[produto];
  if (fonte !== "bitrix" || !id || !entidade) return null;
  return `https://o2seguros.bitrix24.com.br/crm/type/${entidade}/details/${id}/`;
}
// Confiança do número de produção: "ok" = há vínculo com a fonte (zero é zero de verdade);
// "sem_vinculo" = nenhuma ficha encontrada; "sem_vinculo_producao" = ficha sem vínculo
// confirmado com Bitrix/planilhas (zero NÃO é confiável).
export type DadosStatus = "ok" | "sem_vinculo" | "sem_vinculo_producao";
export type NumerosCorp = { documentos: number; premio: number; comissao: number; repasse: number };

export type LinhaDesempenho = {
  participanteId: string;
  imobiliariaId: string | null;
  grupoId: string | null;
  tipo: "imobiliaria" | "grupo";
  nome: string;
  unidades: string[]; // nomes das imobiliárias contadas
  unidadeIds: string[];
  meta: number | null;
  observacao: string | null;
  responsavelEmail: string | null;
  gestorContaEmail: string | null;
  custoPremiacao: number;
  realizado: number; // no período todo da campanha, só contratos novos
  realizadoMes: number; // no mês de referência (ver DesempenhoCampanha.janelaMes), só novos
  cotacoesMes: number; // cotações recebidas no mês de referência (só novos)
  metaMensal: number | null; // meta total ÷ meses do período
  base: number; // média mensal da métrica nos 6 meses antes do início (só novos)
  percentual: number | null;
  faltam: number | null;
  projecao: number | null;
  ritmoSemana: number | null;
  farol: Farol;
  funil: NumerosFunil;
  corp: NumerosCorp;
  resultado: number; // comissão Corp − repasse Corp − custo da premiação individual
  avisos: string[];
  alertas: Alerta[];
  oportunidades: Oportunidade[];
  ultimaCotacao: string | null;
  // Período de apuração DESTE participante (individual ou o da campanha).
  inicio: string;
  fim: string;
  periodoIndividual: boolean;
  periodoOrigem: string | null;
  diasTotais: number;
  diasDecorridos: number;
  diasRestantes: number;
  abertosDesde: string; // oportunidades consideradas: entradas a partir desta data
  dadosStatus: DadosStatus;
};

export type DesempenhoCampanha = {
  hoje: string;
  diasTotais: number;
  diasDecorridos: number;
  diasRestantes: number;
  // Meses do período (dias ÷ 30,44, mínimo 1) -- divisor da meta mensal.
  mesesDoPeriodo: number;
  // Janela do mês de referência (mês de hoje, ou do último dia da campanha
  // se ela já acabou), recortada ao período da campanha.
  janelaMes: { de: string; ate: string };
  linhas: LinhaDesempenho[];
  totais: {
    meta: number;
    metaMensal: number;
    realizado: number;
    realizadoMes: number;
    cotacoesMes: number;
    percentual: number | null;
    projecao: number | null;
    participantesComMeta: number;
    noRitmoOuAtingida: number;
    participantesComAlerta: number;
    oportunidades: number;
    funil: NumerosFunil;
    corp: NumerosCorp;
    custoPremiacao: number; // geral + individuais
    resultado: number;
  };
};

// ---------- datas ----------

export function hojeBrasilia(agora = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split("-").map(Number);
  const r = new Date(Date.UTC(a, m - 1 + meses, d));
  return r.toISOString().slice(0, 10);
}

const MESES_BASE = 6;
const STATUS_TERMINAIS = new Set(["Convertido", "Perdido", "Recusado"]);
const STATUS_ABERTOS = new Set(["Em análise", "Aprovado"]);

type LinhaFunil = {
  id: string;
  chave_caso: string | null;
  imobiliaria_id: string;
  produto: string;
  status_padrao: string | null;
  data_recebimento: string | null;
  data_efetivacao: string | null;
  premio: number | null;
  comissao: number | null;
  herdada: boolean | null;
  fonte: string | null;
  origem_bitrix_id: string | null;
  valor_titulo: number | null;
  tipo: string | null; // 'novo' | 'renovacao' (producao_unificada.tipo)
  locatario_id: string | null;
};

type Imob ={ id: string; nome: string; apelido: string | null; codigo_produtor_corp: string | null; grupo_id: string | null };

async function lerTodasPaginas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const todos: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    todos.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return todos;
}

// Números do funil por imobiliária: cotação = caso que entrou no período
// (primeira entrada, sem contar herança); contratação = caso convertido com
// efetivação no período (sem data de efetivação, vale a de recebimento).
//
// 27/10/2026: o que é renovação (producao_unificada.tipo = 'renovacao') vai
// para `renovacoes` e NÃO entra nos campos de topo -- a meta da campanha
// considera só contratos novos. Qualquer outro valor de tipo (inclusive
// vazio) conta como novo, que é o comportamento de antes.
function numerosPorImobiliaria(linhas: LinhaFunil[], de: string, ate: string, abertosDesde: string, oportunidades?: Map<string, Oportunidade[]>) {
  const porCaso = new Map<string, LinhaFunil[]>();
  for (const l of linhas) {
    const chave = l.chave_caso || l.id;
    const lista = porCaso.get(chave);
    if (lista) lista.push(l);
    else porCaso.set(chave, [l]);
  }
  const res = new Map<string, NumerosFunil>();
  const pegar = (imob: string) => {
    let n = res.get(imob);
    if (!n) {
      n = zeroFunil();
      res.set(imob, n);
    }
    return n;
  };
  for (const casos of porCaso.values()) {
    const imob = casos[0].imobiliaria_id;
    const ehRenovacao = casos.some((c) => c.tipo === "renovacao");
    const alvo = (): ContagemFunil => (ehRenovacao ? pegar(imob).renovacoes : pegar(imob));
    const entradas = casos.filter((c) => !c.herdada && c.data_recebimento).map((c) => c.data_recebimento!) ;
    const entrada = entradas.length ? entradas.sort()[0] : null;
    if (entrada && entrada >= de && entrada <= ate) alvo().cotacoes++;

    const convertidos = casos.filter((c) => c.status_padrao === "Convertido");
    if (convertidos.length) {
      const datas = convertidos.map((c) => c.data_efetivacao || c.data_recebimento).filter((d): d is string => !!d).sort();
      const data = datas[0];
      if (data && data >= de && data <= ate) {
        const n = alvo();
        n.contratacoes++;
        n.premio += Math.max(0, ...casos.map((c) => Number(c.premio) || 0));
        n.comissao += Math.max(0, ...casos.map((c) => Number(c.comissao) || 0));
      }
    } else if (!casos.some((c) => STATUS_TERMINAIS.has(c.status_padrao ?? ""))) {
      const recente = casos.map((c) => c.data_recebimento).filter((d): d is string => !!d).sort().pop();
      if (recente && recente >= abertosDesde && recente <= ate && casos.some((c) => STATUS_ABERTOS.has(c.status_padrao ?? ""))) {
        alvo().emAndamento++;
        if (oportunidades) {
          // A linha mais recente do caso diz em que pé ele está agora.
          const atual = [...casos].sort((a, b) => (a.data_recebimento ?? "").localeCompare(b.data_recebimento ?? "")).pop()!;
          const entrada = entrada_do_caso(casos) ?? recente;
          const lista = oportunidades.get(imob) ?? [];
          lista.push({
            produto: atual.produto,
            status: casos.some((c) => c.status_padrao === "Aprovado") ? "Aprovado" : "Em análise",
            entrada,
            dias: Math.max(0, diasEntre(entrada, ate)),
            valor: Number(atual.premio) || Number(atual.valor_titulo) || null,
            link: linkBitrix(atual.produto, atual.fonte, atual.origem_bitrix_id),
            tipo: ehRenovacao ? "renovacao" : "novo",
            pretendente: null,
            ref: { fonte: atual.fonte, bitrixId: atual.origem_bitrix_id, locatarioId: casos.map((c) => c.locatario_id).find((l) => !!l) ?? null },
          });
          oportunidades.set(imob, lista);
        }
      }
    }
  }
  return res;
}

function entrada_do_caso(casos: LinhaFunil[]): string | null {
  const datas = casos.filter((c) => !c.herdada && c.data_recebimento).map((c) => c.data_recebimento!).sort();
  return datas[0] ?? null;
}

export function valorDaMetrica(n: ContagemFunil, metrica: string): number {
  if (metrica === "cotacoes") return n.cotacoes;
  if (metrica === "premio") return n.premio;
  if (metrica === "comissao") return n.comissao;
  return n.contratacoes;
}

function somarContagem(a: ContagemFunil, b: ContagemFunil): ContagemFunil {
  return {
    cotacoes: a.cotacoes + b.cotacoes,
    contratacoes: a.contratacoes + b.contratacoes,
    premio: a.premio + b.premio,
    comissao: a.comissao + b.comissao,
    emAndamento: a.emAndamento + b.emAndamento,
  };
}

function somarFunil(a: NumerosFunil, b: NumerosFunil | undefined): NumerosFunil {
  if (!b) return a;
  return { ...somarContagem(a, b), renovacoes: somarContagem(a.renovacoes, b.renovacoes) };
}

const zeroContagem = (): ContagemFunil => ({ cotacoes: 0, contratacoes: 0, premio: 0, comissao: 0, emAndamento: 0 });
// Função (não constante) para nunca compartilhar o objeto `renovacoes` entre
// linhas -- numerosPorImobiliaria muda os contadores no lugar.
function zeroFunil(): NumerosFunil {
  return { ...zeroContagem(), renovacoes: zeroContagem() };
}
const ZERO_CORP: NumerosCorp = { documentos: 0, premio: 0, comissao: 0, repasse: 0 };

function farolDe(meta: number | null, realizado: number, projecao: number | null, decorridos: number, restantes: number): Farol {
  if (decorridos <= 0) return "nao_iniciada";
  if (meta === null || meta <= 0) return "sem_meta";
  if (realizado >= meta) return "atingida";
  if (restantes <= 0) return "nao_atingida";
  if (projecao !== null && projecao >= meta) return "no_ritmo";
  if (projecao !== null && projecao >= meta * FATOR_ATENCAO_FAROL) return "atencao";
  return "em_risco";
}

function alertasDe(a: {
  ultimaCotacao: string | null;
  hoje: string;
  oportunidades: Oportunidade[];
  realizado: number;
  base: number;
  diasDecorridos: number;
  programaEmAndamento: boolean;
  moeda: boolean;
}): Alerta[] {
  if (!a.programaEmAndamento) return [];
  const alertas: Alerta[] = [];
  if (!a.ultimaCotacao) alertas.push({ tipo: "sem_cotacao", texto: "Nenhuma cotação nos últimos 6 meses." });
  else {
    const dias = diasEntre(a.ultimaCotacao, a.hoje);
    if (dias >= DIAS_SEM_COTACAO_ALERTA) alertas.push({ tipo: "sem_cotacao", texto: `Sem cotação nova há ${dias} dias.` });
  }
  const paradas = a.oportunidades.filter((o) => o.status === "Aprovado" && o.dias >= DIAS_APROVADA_PARADA);
  if (paradas.length)
    alertas.push({ tipo: "aprovada_parada", texto: `${paradas.length} cotação(ões) aprovada(s) há ${DIAS_APROVADA_PARADA}+ dias sem fechar.` });
  if (a.base > 0 && a.diasDecorridos >= DIAS_MINIMOS_PARA_RITMO) {
    const ritmoMes = (a.realizado / a.diasDecorridos) * 30;
    if (ritmoMes < a.base * FATOR_ABAIXO_BASE) {
      const f = (n: number) => (a.moeda ? `R$ ${Math.round(n).toLocaleString("pt-BR")}` : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
      alertas.push({ tipo: "abaixo_base", texto: `Ritmo de ${f(ritmoMes)}/mês, abaixo da própria base (${f(a.base)}/mês).` });
    }
  }
  return alertas;
}

// Mesmas fórmulas de projeção, ritmo necessário e farol da linha do quadro, para
// um prazo PRÓPRIO do cliente (ex.: Expan, Silvério e Adjuve têm campanha de
// 2 meses dentro de uma campanha de 3). Usada pelo Painel Comercial quando o
// fim no CRM difere do fim cadastrado na campanha.
export function ritmoEFarolNoPrazo(meta: number | null, realizado: number, inicio: string, fim: string, agora = new Date()) {
  const hoje = hojeBrasilia(agora);
  const fimEfetivo = hoje < fim ? hoje : fim;
  const diasTotais = diasEntre(inicio, fim) + 1;
  const diasDecorridos = Math.max(0, Math.min(diasTotais, diasEntre(inicio, fimEfetivo) + 1));
  const diasRestantes = Math.max(0, diasEntre(hoje, fim));
  const projecao = diasDecorridos > 0 ? (realizado / diasDecorridos) * diasTotais : null;
  const faltam = meta !== null ? Math.max(0, meta - realizado) : null;
  const semanas = diasRestantes / 7;
  const ritmoSemana = faltam !== null && faltam > 0 && semanas > 0 ? faltam / semanas : null;
  const mesesDoPeriodo = Math.max(1, Math.round(diasTotais / 30.4375));
  return {
    diasTotais,
    diasDecorridos,
    diasRestantes,
    projecao,
    ritmoSemana,
    farol: farolDe(meta, realizado, projecao, diasDecorridos, diasRestantes),
    metaMensal: meta !== null && meta > 0 ? meta / mesesDoPeriodo : null,
  };
}

export async function montarDesempenhoCampanha(
  db: SupabaseClient,
  programa: ConfigDesempenho,
  participantes: ParticipanteRow[],
  agora = new Date()
): Promise<DesempenhoCampanha> {
  const hoje = hojeBrasilia(agora);
  const fimEfetivo = hoje < programa.fim ? hoje : programa.fim;
  const diasTotais = diasEntre(programa.inicio, programa.fim) + 1;
  const diasDecorridos = Math.max(0, Math.min(diasTotais, diasEntre(programa.inicio, fimEfetivo) + 1));
  const diasRestantes = Math.max(0, diasEntre(hoje, programa.fim));
  const diaAnterior = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  // Meta mensal = meta total ÷ meses do período (decisão do Matheus,
  // 27/10/2026). Mês de referência = mês de hoje, ou do último dia da
  // campanha se ela já acabou, recortado ao período.
  const mesesDoPeriodo = Math.max(1, Math.round(diasTotais / 30.4375));
  const primeiroDiaDoMes = `${fimEfetivo.slice(0, 7)}-01`;
  const janelaMes = { de: primeiroDiaDoMes > programa.inicio ? primeiroDiaDoMes : programa.inicio, ate: fimEfetivo };

  // Período INDIVIDUAL (03/11/2026): cada participante pode ter início/fim próprios
  // (ex.: Adjuve, Expan e Silvério 01/10-30/11; Chez a partir de 13/10). Sem período
  // próprio vale o da campanha. Início/fim nunca saem do cadastro por suposição.
  const periodoDe = (p: ParticipanteRow) => ({ inicio: p.periodo_inicio || programa.inicio, fim: p.periodo_fim || programa.fim });
  const menorInicio = participantes.reduce((m, p) => { const i = periodoDe(p).inicio; return i < m ? i : m; }, programa.inicio);
  const maiorFim = participantes.reduce((m, p) => { const f = periodoDe(p).fim; return f > m ? f : m; }, programa.fim);
  const baseDesde = somarMeses(menorInicio, -MESES_BASE);

  // Unidades de cada participante (imobiliária ou todas as do grupo).
  const idsImob = participantes.filter((p) => p.imobiliaria_id).map((p) => p.imobiliaria_id!);
  const idsGrupo = participantes.filter((p) => p.grupo_id).map((p) => p.grupo_id!);
  const imobs: Imob[] = [];
  if (idsImob.length) {
    imobs.push(...(await buscarEmLotes<Imob>(idsImob, (lote) => db.from("imobiliarias").select("id, nome, apelido, codigo_produtor_corp, grupo_id").in("id", lote))));
  }
  const grupos = new Map<string, string>();
  if (idsGrupo.length) {
    const [{ data: membros }, { data: gs }] = await Promise.all([
      db.from("imobiliarias").select("id, nome, apelido, codigo_produtor_corp, grupo_id").in("grupo_id", idsGrupo),
      db.from("imobiliaria_grupos").select("id, nome").in("id", idsGrupo),
    ]);
    for (const m of (membros ?? []) as Imob[]) if (!imobs.some((i) => i.id === m.id)) imobs.push(m);
    for (const g of (gs ?? []) as { id: string; nome: string }[]) grupos.set(g.id, g.nome);
  }
  const imobPorId = new Map(imobs.map((i) => [i.id, i]));
  const unidadesDe = (p: ParticipanteRow): Imob[] =>
    p.imobiliaria_id ? [imobPorId.get(p.imobiliaria_id)].filter((i): i is Imob => !!i) : imobs.filter((i) => i.grupo_id === p.grupo_id);

  const produtos = programa.produtos.filter((p) => PRODUTOS_BASE.some((x) => x.valor === p));
  const todosIds = imobs.map((i) => i.id);

  // Funil (planilhas + Bitrix) desde o início da base de comparação. Falha de
  // consulta PROPAGA o erro (nunca vira zero): quem chama mostra "dados indisponíveis".
  const linhasFunil =
    todosIds.length && produtos.length
      ? await lerTodasPaginas<LinhaFunil>((de, ate) =>
          db.rpc("campanha_programa_funil", { p_imobs: todosIds, p_produtos: produtos, p_desde: baseDesde }).range(de, ate)
        )
      : [];

  // Vínculo com a FONTE DE PRODUÇÃO (Bitrix/planilhas): ficha sem nenhum vínculo
  // confirmado não tem como mostrar produção -- é "sem vínculo", não "zero".
  const FONTES_PRODUCAO = ["bitrix_empresa", "bitrix_cap_texto", "planilha_fianca", "planilha_cap"];
  const comVinculoProducao = new Set<string>();
  if (todosIds.length) {
    const regs = await buscarEmLotes<{ imobiliaria_id: string | null }>(todosIds, (lote) =>
      db.from("imobiliaria_registros_fonte").select("imobiliaria_id").eq("situacao", "confirmado").in("fonte", FONTES_PRODUCAO).in("imobiliaria_id", lote)
    );
    for (const r of regs) if (r.imobiliaria_id) comVinculoProducao.add(r.imobiliaria_id);
  }

  const ultimaEntradaPorImob = new Map<string, string>();
  for (const l of linhasFunil) {
    // "Sem cotação nova" olha só negócios novos (renovação tem funil próprio).
    if (!l.data_recebimento || l.herdada || l.data_recebimento > hoje || l.tipo === "renovacao") continue;
    const atual = ultimaEntradaPorImob.get(l.imobiliaria_id);
    if (!atual || l.data_recebimento > atual) ultimaEntradaPorImob.set(l.imobiliaria_id, l.data_recebimento);
  }

  // Números do funil por período (cada período distinto é calculado uma vez).
  const porPeriodo = new Map<string, ReturnType<typeof contextoDoPeriodo>>();
  function contextoDoPeriodo(inicio: string, fim: string) {
    const fimEf = hoje < fim ? hoje : fim;
    const totais = diasEntre(inicio, fim) + 1;
    const decorridos = Math.max(0, Math.min(totais, diasEntre(inicio, fimEf) + 1));
    const restantes = Math.max(0, diasEntre(hoje, fim));
    const meses = Math.max(1, Math.round(totais / 30.4375));
    const pDia = `${fimEf.slice(0, 7)}-01`;
    const janela = { de: pDia > inicio ? pDia : inicio, ate: fimEf };
    const oportunidades = new Map<string, Oportunidade[]>();
    return {
      inicio,
      fim,
      fimEfetivo: fimEf,
      diasTotais: totais,
      diasDecorridos: decorridos,
      diasRestantes: restantes,
      mesesDoPeriodo: meses,
      abertosDesde: somarMeses(inicio, -2),
      oportunidades,
      doPeriodo: numerosPorImobiliaria(linhasFunil, inicio, fimEf, somarMeses(inicio, -2), oportunidades),
      daBase: numerosPorImobiliaria(linhasFunil, somarMeses(inicio, -MESES_BASE), diaAnterior(inicio), somarMeses(inicio, -MESES_BASE)),
      doMes: numerosPorImobiliaria(linhasFunil, janela.de, janela.ate, somarMeses(janela.de, -2)),
    };
  }
  const contexto = (inicio: string, fim: string) => {
    const chave = `${inicio}|${fim}`;
    let c = porPeriodo.get(chave);
    if (!c) {
      c = contextoDoPeriodo(inicio, fim);
      porPeriodo.set(chave, c);
    }
    return c;
  };

  // Corp: documentos novos (não cancelados) no período de cada participante, por
  // código de produtor. Uma ficha pode ter mais de um produtor no Corp (ex.:
  // Dreher 327 + 356) — conta todos os códigos ligados a ela (22/10/2026).
  const codigosCorpPorImob = await buscarCodigosCorp(db, todosIds);
  const codigosDaUnidade = (u: Imob): number[] => {
    const lista = (codigosCorpPorImob.get(u.id) ?? []).map((c) => Number(c.codigo));
    if (!lista.length) lista.push(Number(u.codigo_produtor_corp));
    return lista.filter((n) => Number.isFinite(n) && n > 0);
  };
  const codigos = [...new Set(imobs.flatMap(codigosDaUnidade))];
  type LinhaCorp = { codigo_produtor: number; ramo: string; tipo: string; cancelado: string; pr_liquido: number | null; vl_com: number | null; vl_com_prod: number | null; dt_proposta: string };
  const fimMaxEfetivo = hoje < maiorFim ? hoje : maiorFim;
  const linhasCorp =
    codigos.length && menorInicio <= fimMaxEfetivo
      ? await lerTodasPaginas<LinhaCorp>((de, ate) =>
          db
            .from("corp_producao_produtor")
            .select("codigo_produtor, ramo, tipo, cancelado, pr_liquido, vl_com, vl_com_prod, dt_proposta")
            .in("codigo_produtor", codigos)
            .gte("dt_proposta", menorInicio)
            .lte("dt_proposta", fimMaxEfetivo)
            .range(de, ate)
        )
      : [];
  const corpNovos = linhasCorp.filter((l) => {
    if (l.tipo !== "NOVO" || l.cancelado !== "F") return false;
    const produto = PRODUTO_POR_RAMO_CORP[l.ramo];
    return !!produto && produtos.includes(produto);
  });

  const linhas: LinhaDesempenho[] = participantes.map((p) => {
    const per = periodoDe(p);
    const ctx = contexto(per.inicio, per.fim);
    const unidades = unidadesDe(p);
    let funil = zeroFunil();
    let base = zeroFunil();
    let funilMes = zeroFunil();
    const corp = { ...ZERO_CORP };
    const codigosVistos = new Set<number>();
    const avisos: string[] = [];
    for (const u of unidades) {
      funil = somarFunil(funil, ctx.doPeriodo.get(u.id));
      base = somarFunil(base, ctx.daBase.get(u.id));
      funilMes = somarFunil(funilMes, ctx.doMes.get(u.id));
      const codsUnidade = codigosDaUnidade(u);
      for (const cod of codsUnidade) {
        if (!codigosVistos.has(cod)) {
          codigosVistos.add(cod);
          for (const c of corpNovos) {
            if (c.codigo_produtor !== cod || c.dt_proposta < ctx.inicio || c.dt_proposta > ctx.fimEfetivo) continue;
            corp.documentos++;
            corp.premio += Number(c.pr_liquido) || 0;
            corp.comissao += Number(c.vl_com) || 0;
            corp.repasse += Number(c.vl_com_prod) || 0;
          }
        }
      }
      if (!codsUnidade.length) {
        avisos.push(`${u.apelido || u.nome} sem código do Corp: a conferência não inclui essa unidade.`);
      }
    }
    if (!unidades.length) avisos.push("Nenhuma imobiliária encontrada para este participante.");
    const vinculoProducao = unidades.some((u) => comVinculoProducao.has(u.id));
    const dadosStatus: DadosStatus = !unidades.length ? "sem_vinculo" : !vinculoProducao ? "sem_vinculo_producao" : "ok";
    if (dadosStatus === "sem_vinculo_producao") avisos.push("Nenhuma ficha deste participante tem vínculo confirmado com a fonte de produção (Bitrix/planilhas): o zero não é confiável.");
    const oportunidades = unidades
      .flatMap((u) => ctx.oportunidades.get(u.id) ?? [])
      .sort((a, b) => (a.status === b.status ? b.dias - a.dias : a.status === "Aprovado" ? -1 : 1));
    const ultimaCotacao =
      unidades
        .map((u) => ultimaEntradaPorImob.get(u.id))
        .filter((d): d is string => !!d)
        .sort()
        .pop() ?? null;
    const realizado = valorDaMetrica(funil, programa.metrica);
    const realizadoMes = valorDaMetrica(funilMes, programa.metrica);
    const meta = p.meta === null || p.meta === undefined ? null : Number(p.meta);
    const projecao = ctx.diasDecorridos > 0 ? (realizado / ctx.diasDecorridos) * ctx.diasTotais : null;
    const faltam = meta !== null ? Math.max(0, meta - realizado) : null;
    const semanas = ctx.diasRestantes / 7;
    const ritmoSemana = faltam !== null && faltam > 0 && semanas > 0 ? faltam / semanas : null;
    const nome = p.grupo_id
      ? `${grupos.get(p.grupo_id) ?? "Grupo"} (grupo)`
      : unidades[0]
        ? unidades[0].apelido || unidades[0].nome
        : "Imobiliária removida";
    return {
      participanteId: p.id,
      imobiliariaId: p.imobiliaria_id,
      grupoId: p.grupo_id,
      tipo: p.grupo_id ? "grupo" : "imobiliaria",
      nome,
      unidades: unidades.map((u) => u.apelido || u.nome),
      unidadeIds: unidades.map((u) => u.id),
      meta,
      observacao: p.observacao,
      responsavelEmail: p.responsavel_email,
      gestorContaEmail: p.gestor_conta_email ?? null,
      custoPremiacao: Number(p.custo_premiacao) || 0,
      realizado,
      realizadoMes,
      cotacoesMes: funilMes.cotacoes,
      metaMensal: meta !== null && meta > 0 ? meta / ctx.mesesDoPeriodo : null,
      base: valorDaMetrica(base, programa.metrica) / MESES_BASE,
      percentual: meta && meta > 0 ? (realizado / meta) * 100 : null,
      faltam,
      projecao,
      ritmoSemana,
      farol: farolDe(meta, realizado, projecao, ctx.diasDecorridos, ctx.diasRestantes),
      funil,
      corp,
      resultado: corp.comissao - corp.repasse - (Number(p.custo_premiacao) || 0),
      avisos,
      alertas: alertasDe({
        ultimaCotacao,
        hoje,
        oportunidades: oportunidades.filter((o) => o.tipo === "novo"),
        realizado,
        base: valorDaMetrica(base, programa.metrica) / MESES_BASE,
        diasDecorridos: ctx.diasDecorridos,
        programaEmAndamento: ctx.diasDecorridos > 0 && ctx.diasRestantes > 0,
        moeda: metricaInfo(programa.metrica).moeda,
      }),
      oportunidades,
      ultimaCotacao,
      inicio: ctx.inicio,
      fim: ctx.fim,
      periodoIndividual: ctx.inicio !== programa.inicio || ctx.fim !== programa.fim,
      periodoOrigem: p.periodo_origem ?? null,
      diasTotais: ctx.diasTotais,
      diasDecorridos: ctx.diasDecorridos,
      diasRestantes: ctx.diasRestantes,
      abertosDesde: ctx.abertosDesde,
      dadosStatus,
    };
  });

  const comMeta = linhas.filter((l) => l.meta !== null && l.meta > 0);
  const metaTotal = comMeta.reduce((s, l) => s + (l.meta ?? 0), 0);
  const realizadoTotal = linhas.reduce((s, l) => s + l.realizado, 0);
  const realizadoMesTotal = linhas.reduce((s, l) => s + l.realizadoMes, 0);
  const cotacoesMesTotal = linhas.reduce((s, l) => s + l.cotacoesMes, 0);
  const metaMensalTotal = comMeta.reduce((s, l) => s + (l.metaMensal ?? 0), 0);
  const funilTotal = linhas.reduce((s, l) => somarFunil(s, l.funil), zeroFunil());
  const corpTotal = linhas.reduce(
    (s, l) => ({ documentos: s.documentos + l.corp.documentos, premio: s.premio + l.corp.premio, comissao: s.comissao + l.corp.comissao, repasse: s.repasse + l.corp.repasse }),
    { ...ZERO_CORP }
  );
  const custoTotal = (Number(programa.custo_premiacao_geral) || 0) + linhas.reduce((s, l) => s + l.custoPremiacao, 0);

  return {
    hoje,
    diasTotais,
    diasDecorridos,
    diasRestantes,
    mesesDoPeriodo,
    janelaMes,
    linhas,
    totais: {
      meta: metaTotal,
      metaMensal: metaMensalTotal,
      realizado: realizadoTotal,
      realizadoMes: realizadoMesTotal,
      cotacoesMes: cotacoesMesTotal,
      percentual: metaTotal > 0 ? (comMeta.reduce((s, l) => s + l.realizado, 0) / metaTotal) * 100 : null,
      projecao: diasDecorridos > 0 ? (realizadoTotal / diasDecorridos) * diasTotais : null,
      participantesComMeta: comMeta.length,
      noRitmoOuAtingida: comMeta.filter((l) => l.farol === "atingida" || l.farol === "no_ritmo").length,
      participantesComAlerta: linhas.filter((l) => l.alertas.length > 0).length,
      // Só negócios novos; as renovações em aberto estão em funil.renovacoes.emAndamento.
      oportunidades: linhas.reduce((s, l) => s + l.oportunidades.filter((o) => o.tipo === "novo").length, 0),
      funil: funilTotal,
      corp: corpTotal,
      custoPremiacao: custoTotal,
      resultado: corpTotal.comissao - corpTotal.repasse - custoTotal,
    },
  };
}
