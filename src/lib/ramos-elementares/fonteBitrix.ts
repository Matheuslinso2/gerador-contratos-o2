
import "server-only";

import {
  buscarDefinicaoCampos,
  buscarEmpresas,
  buscarUsuarios,
  listarHistoricoEtapas,
  listarItensSpa,
  type BitrixDefinicaoCampo,
  type BitrixItemRaw,
  type BitrixStageHistoryEvent,
} from "@/lib/bitrix/client";
import { diasUteisEquivalentesEntre } from "@/lib/bitrix/horarioComercial";
import type { CelulaGoogle, FonteRamosBruta } from "./fonteGoogle";

const ENTITY_TYPE_ID = 1046;
const CATEGORIA_CONTRATACOES = 22;
const CATEGORIA_MOVIMENTACOES = 24;
const URL_SPA = "https://o2seguros.bitrix24.com.br/crm/type/1046/list/category/22/";

const CAMPOS = {
  tipoProcesso: "ufCrm12TipoProcesso",
  produto: "ufCrm12Produto",
  operacaoSusep: "ufCrm12OperacaoSusep",
  // "Seguradora final" (texto livre) -- campo antigo, mantido só como
  // fallback pra cards antigos que não têm o campo de seleção abaixo
  // preenchido. Confirmado com o Matheus (15/09/2026): não dá pra excluir
  // esse campo no Bitrix porque já tem histórico preenchido nele, mas a
  // partir de agora a equipe só preenche o campo de seleção.
  seguradora: "ufCrm12Seguradora",
  // "Seguradora final (seleção)" -- campo NOVO (lista fixa/enum,
  // isMultiple no Bitrix mas usado como escolha única na prática), criado
  // pra evitar erro de digitação do texto livre acima. É o campo principal
  // a partir de 15/09/2026.
  seguradoraSelecao: "ufCrm12SeguradoraFinalMulti",
  cotadorOrigem: "ufCrm12CotadorOrigem",
  origemProducao: "ufCrm12OrigemProducao",
  numeroOrcamento: "ufCrm12NumOrcamento",
  numeroApolice: "ufCrm12NumApolice",
  competencia: "ufCrm12CompetenciaOperacional",
  fimVigencia: "ufCrm12FimVigencia",
  premioTotal: "ufCrm12PremioTotal",
  // Achado real (2026-09-10): não existe campo "ufCrm12Comissao"/"ufCrm12Repasse"
  // nessa SPA -- o card só guarda o PERCENTUAL de cada um ("Comissão (%)" /
  // "Repasse (%)", campos type:"double"), confirmado via crm.item.fields. O
  // valor em R$ precisa ser calculado (ver valorComissao/valorRepasse
  // abaixo).
  //
  // 2º achado real (29/09/2026, mesmo padrão de bug, de novo): em algum
  // momento depois de 10/09 a equipe passou a preencher dois campos NOVOS
  // ("Comissão (%) - decimal" / "Repasse (%) - decimal", ufCrm12_1788368973918
  // / ufCrm12_1788368984463) em vez dos de cima -- confirmado via
  // crm.item.list: nos 112 cards EFETIVADOS (categoria 22) só 2 ainda têm só
  // o campo antigo preenchido (cards bem antigos), o resto usa só o novo (ou
  // os dois, sempre com o mesmo valor). "Comissão dos efetivados" saía quase
  // zerada em setembro porque comissaoPercentual (antigo) não tinha mais
  // dado nenhum. Usa o novo com fallback pro antigo, mesma ideia já usada em
  // seguradora/seguradoraSelecao acima.
  comissaoPercentual: "ufCrm12_1788368973918",
  comissaoPercentualAntigo: "ufCrm12ComissaoPercentual",
  repassePercentual: "ufCrm12_1788368984463",
  repassePercentualAntigo: "ufCrm12RepassePercentual",
  comissaoAnterior: "ufCrm12ComissaoAnterior",
  restituicao: "ufCrm12Restituicao",
  tipoMovimentacao: "ufCrm12TipoMovimentacao",
} as const;

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).trim();
}

function normalizar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

function valorEnum(
  item: BitrixItemRaw,
  campo: string,
  definicoes: Record<string, BitrixDefinicaoCampo>
): string {
  const bruto = item[campo];
  const valor = Array.isArray(bruto) ? bruto[0] : bruto;
  if (valor === null || valor === undefined || valor === "") return "";
  const opcao = definicoes[campo]?.items?.find((entrada) => String(entrada.ID) === String(valor));
  return opcao?.VALUE || texto(valor);
}

function dinheiro(valor: unknown): number {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  const bruto = texto(valor).split("|")[0].replace(/\s/g, "");
  if (!bruto) return 0;
  const normalizado = bruto.includes(",")
    ? bruto.replace(/\./g, "").replace(",", ".")
    : bruto;
  const convertido = Number(normalizado);
  return Number.isFinite(convertido) ? convertido : 0;
}

// Comissão e repasse só existem como PERCENTUAL no card (ver comentário em
// CAMPOS) -- os dois incidem sobre o PRÊMIO TOTAL, não um sobre o outro
// (confirmado com o Matheus: repasse não é uma fatia da comissão, é o mesmo
// tipo de cálculo dela, só que com o percentual de repasse).
// Prefere o campo novo; cai pro antigo só quando o novo está vazio de
// verdade (card de antes da migração) -- nunca os dois juntos.
function campoComFallback(item: BitrixItemRaw, principal: string, antigo: string): unknown {
  const valor = item[principal];
  if (valor !== null && valor !== undefined && valor !== "") return valor;
  return item[antigo];
}

function valorComissao(item: BitrixItemRaw, premioTotal: number): number {
  const percentual = dinheiro(campoComFallback(item, CAMPOS.comissaoPercentual, CAMPOS.comissaoPercentualAntigo));
  return premioTotal * (percentual / 100);
}

function valorRepasse(item: BitrixItemRaw, premioTotal: number): number {
  const percentual = dinheiro(campoComFallback(item, CAMPOS.repassePercentual, CAMPOS.repassePercentualAntigo));
  return premioTotal * (percentual / 100);
}

function dataValida(valor: unknown): Date | null {
  const bruto = texto(valor);
  if (!bruto) return null;
  const data = new Date(bruto);
  return Number.isNaN(data.getTime()) ? null : data;
}

function competenciaData(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Mês (YYYY-MM) de um instante, no horário de Brasília -- usado pra dizer em
// que mês o card foi efetivado (o evento do Bitrix vem com hora; perto da
// virada do mês, UTC jogaria o card no mês errado).
function mesBrasilia(data: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(data);
  const ano = partes.find((p) => p.type === "year")?.value;
  const mes = partes.find((p) => p.type === "month")?.value;
  return `${ano}-${mes}`;
}

function proximaCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes, 1));
  return competenciaData(data);
}

function serialGoogle(data: Date | null): number | null {
  if (!data) return null;
  return data.getTime() / 86_400_000 + 25_569;
}

// Achado real (17/09/2026, mesmo padrão do bug já corrigido no painel de
// Seguro Fiança): esse mapa é fixo e não muda sozinho se o funil for
// reconfigurado no Bitrix -- foi exatamente o que aconteceu aqui. Duas
// etapas novas (DT1046_22:UC_JJMDWB "Liberado para Negociação" e
// DT1046_22:UC_MZKZUF "Negociação Segimob") foram criadas na categoria 22
// depois que esse mapa foi escrito e nunca entraram aqui -- qualquer card
// nelas caía no fallback pro código bruto ("UC_JJMDWB"/"UC_MZKZUF") em vez
// de um nome, exatamente o que apareceu no quadro "Novos negócios --
// situação atual". Se esse bug voltar (código aparecendo em vez de nome),
// reconfira com crm.status.list (filter ENTITY_ID=DYNAMIC_1046_STAGE_22)
// antes de mexer em outra coisa.
function etapaNovo(item: BitrixItemRaw): string {
  return etapaPorStageId(texto(item.stageId));
}

function etapaPorStageId(stageId: string): string {
  const etapa = stageId.split(":").pop() || "";
  const mapa: Record<string, string> = {
    NEW: "PENDENTE",
    PREPARATION: "AG COTAÇÃO",
    UC_JJMDWB: "LIBERADO P/ NEGOCIAÇÃO",
    UC_MZKZUF: "NEGOCIAÇÃO SEGIMOB",
    CLIENT: "EM NEGOCIAÇÃO",
    EM_EMISSAO: "CONTRATAR",
    SUCCESS: "EFETIVADO",
    FAIL: "NÃO EFETIVADO",
  };
  return mapa[etapa] || etapa || "PENDENTE";
}

function etapaMovimentacao(item: BitrixItemRaw, tipoMovimentacao: string): string {
  const etapa = texto(item.stageId).split(":").pop() || "";
  if (etapa === "SUCCESS") {
    return normalizar(tipoMovimentacao) === "CANCELAMENTO" ? "CANCELADO" : "EFETIVADO";
  }
  if (etapa === "FAIL") return "NÃO EFETIVADO";
  return "PENDENTE";
}

// Regra do Matheus (18/10/2026): a efetivação conta no mês em que aconteceu,
// não no mês de origem do card. Quando o card só foi efetivado/perdido DEPOIS
// do mês que está sendo montado, nesse mês ele ainda estava em andamento --
// o status exibido é o da última etapa não terminal até o fim do mês.
function statusNoMes(eventos: BitrixStageHistoryEvent[], competencia: string): string {
  let ultimo: BitrixStageHistoryEvent | undefined;
  for (const evento of eventos) {
    if (evento.STAGE_SEMANTIC_ID === "S" || evento.STAGE_SEMANTIC_ID === "F") continue;
    const data = dataValida(evento.CREATED_TIME);
    if (data && mesBrasilia(data) <= competencia) ultimo = evento;
  }
  return ultimo ? etapaPorStageId(ultimo.STAGE_ID) : "PENDENTE";
}

function eventoTerminal(eventos: BitrixStageHistoryEvent[]): BitrixStageHistoryEvent | undefined {
  return eventos.find((evento) => evento.STAGE_SEMANTIC_ID === "S" || evento.STAGE_SEMANTIC_ID === "F");
}

function duracaoEmDias(
  item: BitrixItemRaw,
  eventos: BitrixStageHistoryEvent[],
  agora: Date
): number | null {
  const inicio = dataValida(item.createdTime);
  if (!inicio) return null;
  const terminal = eventoTerminal(eventos);
  const fim = terminal ? dataValida(terminal.CREATED_TIME) : agora;
  if (!fim || fim < inicio) return null;
  return diasUteisEquivalentesEntre(inicio, fim);
}

function dataTerminal(eventos: BitrixStageHistoryEvent[]): Date | null {
  const terminal = eventoTerminal(eventos);
  return terminal ? dataValida(terminal.CREATED_TIME) : null;
}

function linhaNovo(params: {
  item: BitrixItemRaw;
  status: string;
  origem: string;
  produto: string;
  seguradora: string;
  imobiliaria: string;
  responsavel: string;
  competencia: Date;
  eventos: BitrixStageHistoryEvent[];
  agora: Date;
  desfechoNoMes: boolean;
}): CelulaGoogle[] {
  const { item, status, origem, produto, seguradora, imobiliaria, responsavel, competencia, eventos, agora, desfechoNoMes } = params;
  const linha: CelulaGoogle[] = Array(42).fill(null);
  const criadaEm = dataValida(item.createdTime);
  const duracao = duracaoEmDias(item, eventos, agora);
  linha[0] = status;
  linha[2] = origem;
  linha[3] = serialGoogle(criadaEm);
  linha[5] = serialGoogle(competencia);
  linha[7] = normalizar(origem) === "SEGIMOB" ? "IMOBILIARIA" : responsavel;
  linha[8] = serialGoogle(criadaEm);
  linha[11] = duracao;
  linha[12] = duracao;
  linha[13] = imobiliaria;
  linha[25] = produto;
  linha[26] = seguradora;
  linha[27] = texto(item[CAMPOS.numeroOrcamento]);
  const premioTotal = dinheiro(item[CAMPOS.premioTotal]);
  const comissao = valorComissao(item, premioTotal);
  linha[29] = premioTotal;
  linha[32] = comissao;
  linha[34] = valorRepasse(item, premioTotal);
  linha[39] = desfechoNoMes ? serialGoogle(dataTerminal(eventos)) : null;
  return linha;
}

function linhaRenovacao(params: {
  item: BitrixItemRaw;
  status: string;
  origem: string;
  produto: string;
  seguradora: string;
  imobiliaria: string;
  responsavel: string;
  eventos: BitrixStageHistoryEvent[];
  desfechoNoMes: boolean;
}): CelulaGoogle[] {
  const { item, status, origem, produto, seguradora, imobiliaria, responsavel, eventos, desfechoNoMes } = params;
  const linha: CelulaGoogle[] = Array(27).fill(null);
  linha[0] = status;
  linha[1] = origem;
  linha[2] = texto(item[CAMPOS.numeroApolice]);
  linha[3] = serialGoogle(dataValida(item[CAMPOS.fimVigencia]));
  linha[4] = imobiliaria;
  linha[7] = produto;
  linha[8] = seguradora;
  const premioTotal = dinheiro(item[CAMPOS.premioTotal]);
  const comissao = valorComissao(item, premioTotal);
  linha[13] = dinheiro(item[CAMPOS.comissaoAnterior]);
  linha[15] = premioTotal;
  linha[17] = comissao;
  linha[19] = valorRepasse(item, premioTotal);
  linha[20] = normalizar(origem) === "SEGIMOB" ? "IMOBILIARIA" : responsavel;
  linha[21] = serialGoogle(dataValida(item.createdTime));
  linha[25] = desfechoNoMes ? serialGoogle(dataTerminal(eventos)) : null;
  return linha;
}

function linhaEndosso(params: {
  item: BitrixItemRaw;
  status: string;
  produto: string;
  seguradora: string;
  imobiliaria: string;
  responsavel: string;
  eventos: BitrixStageHistoryEvent[];
  agora: Date;
}): CelulaGoogle[] {
  const { item, status, produto, seguradora, imobiliaria, responsavel, eventos, agora } = params;
  const linha: CelulaGoogle[] = Array(21).fill(null);
  linha[0] = status;
  linha[3] = serialGoogle(dataValida(item.createdTime));
  linha[5] = imobiliaria;
  linha[7] = produto;
  linha[8] = texto(item[CAMPOS.numeroApolice]);
  linha[9] = seguradora;
  linha[10] = responsavel;
  linha[14] = duracaoEmDias(item, eventos, agora);
  linha[16] = dinheiro(item[CAMPOS.restituicao]);
  return linha;
}

export async function lerFonteRamosElementaresBitrix(
  competencia: string,
  agora = new Date()
): Promise<FonteRamosBruta> {
  const [itens, historico, definicoes] = await Promise.all([
    listarItensSpa(ENTITY_TYPE_ID),
    listarHistoricoEtapas(ENTITY_TYPE_ID),
    buscarDefinicaoCampos(ENTITY_TYPE_ID),
  ]);

  const [empresas, usuarios] = await Promise.all([
    buscarEmpresas(itens.map((item) => Number(item.companyId || 0))),
    buscarUsuarios(itens.map((item) => Number(item.assignedById || 0))),
  ]);

  const historicoPorItem = new Map<number, BitrixStageHistoryEvent[]>();
  for (const evento of historico) {
    const lista = historicoPorItem.get(Number(evento.OWNER_ID)) || [];
    lista.push(evento);
    historicoPorItem.set(Number(evento.OWNER_ID), lista);
  }
  for (const lista of historicoPorItem.values()) {
    lista.sort((a, b) => new Date(a.CREATED_TIME).getTime() - new Date(b.CREATED_TIME).getTime());
  }

  const abas: FonteRamosBruta["abas"] = {
    novosPendentes: [],
    novosMes: [],
    renovacoesAtual: [],
    renovacoesFutura: [],
    endossos: [],
  };
  const avisos: string[] = [];
  let semCompetencia = 0;
  const futura = proximaCompetencia(competencia);

  for (const item of itens) {
    const eventos = historicoPorItem.get(Number(item.id)) || [];
    const dataCompetenciaInformada = dataValida(item[CAMPOS.competencia]);
    const dataCriacao = dataValida(item.createdTime);
    const dataCompetencia = dataCompetenciaInformada || dataCriacao;
    if (!dataCompetencia) continue;
    if (!dataCompetenciaInformada) semCompetencia++;

    const competenciaItem = competenciaData(dataCompetencia);
    const origem = valorEnum(item, CAMPOS.origemProducao, definicoes) || texto(item[CAMPOS.cotadorOrigem]) || "NÃO INFORMADA";
    const produto = valorEnum(item, CAMPOS.produto, definicoes) || "NÃO INFORMADO";
    const seguradora =
      valorEnum(item, CAMPOS.seguradoraSelecao, definicoes) || texto(item[CAMPOS.seguradora]);
    const imobiliaria = empresas[Number(item.companyId)] || "NÃO INFORMADA";
    const responsavel = usuarios[Number(item.assignedById)] || "NÃO INFORMADO";
    const tipoProcesso = normalizar(valorEnum(item, CAMPOS.tipoProcesso, definicoes));

    if (Number(item.categoryId) === CATEGORIA_MOVIMENTACOES) {
      if (competenciaItem !== competencia) continue;
      const tipoMovimentacao = valorEnum(item, CAMPOS.tipoMovimentacao, definicoes);
      abas.endossos.push(
        linhaEndosso({
          item,
          status: etapaMovimentacao(item, tipoMovimentacao),
          produto,
          seguradora,
          imobiliaria,
          responsavel,
          eventos,
          agora,
        })
      );
      continue;
    }

    if (Number(item.categoryId) !== CATEGORIA_CONTRATACOES) continue;
    const statusAtual = etapaNovo(item);
    const terminal = statusAtual === "EFETIVADO" || statusAtual === "NÃO EFETIVADO";
    // Mês do desfecho (efetivado/perdido), em Brasília. Só vale se o card está
    // terminal agora (card reaberto não tem desfecho).
    const dataDesfecho = terminal ? dataTerminal(eventos) : null;
    const mesDesfecho = dataDesfecho ? mesBrasilia(dataDesfecho) : null;
    // Desfecho depois do mês montado: nesse mês o card ainda estava aberto.
    const abertoNoMes = !terminal || (mesDesfecho !== null && mesDesfecho > competencia);
    const status = terminal && mesDesfecho !== null && mesDesfecho > competencia ? statusNoMes(eventos, competencia) : statusAtual;
    const desfechoNoMes = terminal && mesDesfecho !== null && mesDesfecho <= competencia;
    const desfechoDesteMes = mesDesfecho === competencia;

    if (tipoProcesso === "RENOVACAO") {
      const linha = linhaRenovacao({ item, status, origem, produto, seguradora, imobiliaria, responsavel, eventos, desfechoNoMes });
      if (competenciaItem === competencia) abas.renovacoesAtual.push(linha);
      // Renovação de outra competência efetivada/perdida neste mês (antecipada
      // ou atrasada): conta aqui, no mês em que aconteceu.
      else if (desfechoDesteMes) abas.renovacoesAtual.push(linha);
      else if (competenciaItem === futura) abas.renovacoesFutura.push(linha);
      continue;
    }

    // Regra da efetivação (18/10/2026): o card pertence ao mês se foi
    // concluído nele, ou se já tinha entrado (competência <= mês) e ainda
    // estava aberto nele. Concluído num mês anterior ao montado não conta mais.
    const pertence = desfechoDesteMes || (competenciaItem <= competencia && abertoNoMes);
    if (!pertence) continue;

    const linha = linhaNovo({
      desfechoNoMes,
      item,
      status,
      origem,
      produto,
      seguradora,
      imobiliaria,
      responsavel,
      competencia: dataCompetencia,
      eventos,
      agora,
    });
    if (competenciaItem === competencia) abas.novosMes.push(linha);
    else abas.novosPendentes.push(linha);
  }

  if (semCompetencia > 0) {
    avisos.push(
      `${semCompetencia} card(s) sem Competência operacional foram classificados provisoriamente pela data de criação.`
    );
  }

  return {
    competencia,
    planilha: {
      id: `bitrix-spa-${ENTITY_TYPE_ID}`,
      titulo: "Bitrix24 — Produção Incêndio",
      url: URL_SPA,
      modificadaEm: agora.toISOString(),
      tipo: "bitrix24",
    },
    abas,
    nomesAbas: {
      novosPendentes: "CRM — PENDÊNCIAS ANTERIORES",
      novosMes: "CRM — NOVOS DO MÊS",
      renovacoesAtual: "CRM — RENOVAÇÕES DA COMPETÊNCIA",
      renovacoesFutura: "CRM — PRÓXIMA COMPETÊNCIA",
      endossos: "CRM — ENDOSSOS E CANCELAMENTOS",
    },
    avisos,
  };
}
