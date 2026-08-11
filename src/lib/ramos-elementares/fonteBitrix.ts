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
import type { CelulaGoogle, FonteRamosBruta } from "./fonteGoogle";

const ENTITY_TYPE_ID = 1046;
const CATEGORIA_CONTRATACOES = 22;
const CATEGORIA_MOVIMENTACOES = 24;
const URL_SPA = "https://o2seguros.bitrix24.com.br/crm/type/1046/list/category/22/";

const CAMPOS = {
  tipoProcesso: "ufCrm12TipoProcesso",
  produto: "ufCrm12Produto",
  operacaoSusep: "ufCrm12OperacaoSusep",
  seguradora: "ufCrm12Seguradora",
  cotadorOrigem: "ufCrm12CotadorOrigem",
  origemProducao: "ufCrm12OrigemProducao",
  numeroOrcamento: "ufCrm12NumOrcamento",
  numeroApolice: "ufCrm12NumApolice",
  competencia: "ufCrm12CompetenciaOperacional",
  fimVigencia: "ufCrm12FimVigencia",
  premioTotal: "ufCrm12PremioTotal",
  comissao: "ufCrm12Comissao",
  repasse: "ufCrm12Repasse",
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

function dataValida(valor: unknown): Date | null {
  const bruto = texto(valor);
  if (!bruto) return null;
  const data = new Date(bruto);
  return Number.isNaN(data.getTime()) ? null : data;
}

function competenciaData(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
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

function etapaNovo(item: BitrixItemRaw): string {
  const etapa = texto(item.stageId).split(":").pop() || "";
  const mapa: Record<string, string> = {
    NEW: "PENDENTE",
    PREPARATION: "AG COTAÇÃO",
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
  return (fim.getTime() - inicio.getTime()) / 86_400_000;
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
}): CelulaGoogle[] {
  const { item, status, origem, produto, seguradora, imobiliaria, responsavel, competencia, eventos, agora } = params;
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
  linha[29] = dinheiro(item[CAMPOS.premioTotal]);
  linha[32] = dinheiro(item[CAMPOS.comissao]);
  linha[34] = dinheiro(item[CAMPOS.repasse]);
  linha[39] = serialGoogle(dataTerminal(eventos));
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
}): CelulaGoogle[] {
  const { item, status, origem, produto, seguradora, imobiliaria, responsavel, eventos } = params;
  const linha: CelulaGoogle[] = Array(27).fill(null);
  linha[0] = status;
  linha[1] = origem;
  linha[2] = texto(item[CAMPOS.numeroApolice]);
  linha[3] = serialGoogle(dataValida(item[CAMPOS.fimVigencia]));
  linha[4] = imobiliaria;
  linha[7] = produto;
  linha[8] = seguradora;
  linha[13] = dinheiro(item[CAMPOS.comissaoAnterior]);
  linha[15] = dinheiro(item[CAMPOS.premioTotal]);
  linha[17] = dinheiro(item[CAMPOS.comissao]);
  linha[19] = dinheiro(item[CAMPOS.repasse]);
  linha[20] = normalizar(origem) === "SEGIMOB" ? "IMOBILIARIA" : responsavel;
  linha[21] = serialGoogle(dataValida(item.createdTime));
  linha[25] = serialGoogle(dataTerminal(eventos));
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
    const seguradora = texto(item[CAMPOS.seguradora]);
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
    const status = etapaNovo(item);
    const terminal = status === "EFETIVADO" || status === "NÃO EFETIVADO";

    if (tipoProcesso === "RENOVACAO") {
      const linha = linhaRenovacao({ item, status, origem, produto, seguradora, imobiliaria, responsavel, eventos });
      if (competenciaItem === competencia) abas.renovacoesAtual.push(linha);
      else if (competenciaItem === futura) abas.renovacoesFutura.push(linha);
      continue;
    }

    const linha = linhaNovo({
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
    else if (competenciaItem < competencia && !terminal) abas.novosPendentes.push(linha);
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
