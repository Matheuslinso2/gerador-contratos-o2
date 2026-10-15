// Panorama de Preços do Seguro Fiança (15/10/2026) -- lê do card o que o
// panorama precisa (cabeçalho + status de cada seguradora/plano) e decide
// quais cards entram na fila. Os PREÇOS não estão no Bitrix (vêm dos portais
// das seguradoras, digitados pelo colaborador) e ficam em panoramas_fianca.
// Spec: seguro-fianca-analise/ESPECIFICACAO-PANORAMA-PRECOS-FIANCA.md

import {
  buscarDefinicaoCampos,
  buscarEmpresas,
  buscarItem,
  buscarTodasPaginas,
  buscarUsuarios,
  type BitrixDefinicaoCampo,
  type BitrixItemRaw,
} from "./client";
import { ENTITY_TYPE_ID, ETAPAS } from "./seguroFianca";
import {
  LINHAS_PANORAMA,
  normalizarStatus,
  statusEditavel,
  type CabecalhoPanorama,
  type LinhaStatus,
} from "@/lib/panoramaFiancaConstantes";

export { LINHAS_PANORAMA, statusEditavel };
export type { CabecalhoPanorama, LinhaStatus };

const CAMPO_INQUILINO = "ufCrm10_1776354897";
const CAMPO_LOGRADOURO = "ufCrm10_1776351662";
const CAMPO_NUMERO = "ufCrm10_1776351686";
const CAMPO_COMPLEMENTO = "ufCrm10_1776351702";
const CAMPO_CIDADE = "ufCrm10_1776351708";
const CAMPO_UF = "ufCrm10_1776351993";
const CAMPO_CEP = "ufCrm10_1776351647";
const CAMPO_ENDERECO_COMPLETO = "ufCrm10_1781116682"; // formulário novo -- vazio na maioria dos cards, só fallback
const CAMPO_ALUGUEL = "ufCrm10_1776352052";
const CAMPO_CONDOMINIO = "ufCrm10_1776352074";
const CAMPO_IPTU = "ufCrm10_1776352100";

// Etapas em que o card pode ter panorama (spec, seção 1): fim da Análise e
// Cotação + começo da Negociação (inclui Em Negociação/Tratativa de
// Desconto, onde nascem as versões 2+).
export const ETAPAS_FILA = [
  "DT1042_18:CLIENT", // Aguardando Cotação
  "DT1042_18:UC_YW2LWF", // Aguardando Seguradora
  "DT1042_20:UC_PHJKU1", // Cotado com Pendência
  "DT1042_20:NEW", // Liberado para Negociar
  "DT1042_20:PREPARATION", // Em Negociação
  "DT1042_20:CLIENT", // Tratativa de Desconto
];

// Só estas 4 entram em "A montar" (spec, seção 1). Em Negociação e Tratativa
// de Desconto ficam na fila só quando o card JÁ tem versão (atualização/v2+).
export const ETAPAS_MONTAR = ETAPAS_FILA.slice(0, 4);

// Corte do lançamento (15/10/2026): o backlog anterior (~50 cards parados em
// Liberado para Negociar desde set/2026) já teve panorama feito à mão --
// sem o corte, a fila "A montar" nasceria entupida. Card mais antigo continua
// acessível digitando o nº na tela.
export const INICIO_FILA_PANORAMA = "2026-10-15T00:00:00-03:00";

export type CardPanorama = {
  id: number;
  etapa: string;
  etapaId: string;
  responsavel: string;
  movidoEm: string;
  cabecalho: CabecalhoPanorama;
  linhas: LinhaStatus[];
  assinaturaStatus: string;
};

// Campos money do Bitrix vêm como "1100|BRL".
function dinheiro(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(String(valor).split("|")[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : valor == null ? "" : String(valor).trim();
}

function rotuloOpcao(campos: Record<string, BitrixDefinicaoCampo>, campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "";
  return campos[campo]?.items?.find((i) => String(i.ID) === String(valor))?.VALUE ?? "";
}

// Logradouro/Número/Complemento/Cidade/UF/CEP são os campos realmente
// preenchidos (o "Endereço completo" do formulário novo quase nunca vem).
function montarEndereco(item: BitrixItemRaw, campos: Record<string, BitrixDefinicaoCampo>): string {
  const rua = [texto(item[CAMPO_LOGRADOURO]), texto(item[CAMPO_NUMERO])].filter(Boolean).join(", ");
  const cidadeUf = [texto(item[CAMPO_CIDADE]), rotuloOpcao(campos, CAMPO_UF, item[CAMPO_UF])].filter(Boolean).join("/");
  const cep = texto(item[CAMPO_CEP]);
  const partes = [rua, texto(item[CAMPO_COMPLEMENTO]), cidadeUf, cep && `CEP ${cep}`].filter(Boolean);
  return partes.length ? partes.join(" – ") : texto(item[CAMPO_ENDERECO_COMPLETO]);
}

function montarCard(
  item: BitrixItemRaw,
  campos: Record<string, BitrixDefinicaoCampo>,
  empresas: Record<number, string>,
  usuarios: Record<number, string>
): CardPanorama {
  const linhas = LINHAS_PANORAMA.map((l) => {
    const rotuloBitrix = rotuloOpcao(campos, l.campoStatus, item[l.campoStatus]);
    return { chave: l.chave, status: normalizarStatus(rotuloBitrix), rotuloBitrix };
  });
  return {
    id: item.id,
    etapa: ETAPAS.find((e) => e.statusId === item.stageId)?.nome ?? item.stageId,
    etapaId: item.stageId,
    responsavel: usuarios[item.assignedById] ?? "",
    movidoEm: item.movedTime,
    cabecalho: {
      imobiliaria: empresas[item.companyId] ?? "",
      inquilino: texto(item[CAMPO_INQUILINO]) || item.title,
      imovel: montarEndereco(item, campos),
      aluguel: dinheiro(item[CAMPO_ALUGUEL]),
      condominio: dinheiro(item[CAMPO_CONDOMINIO]),
      iptu: dinheiro(item[CAMPO_IPTU]),
    },
    linhas,
    // Comparada com a da última versão salva: mudou = "Atualização disponível".
    assinaturaStatus: linhas.map((l) => `${l.chave}:${l.status}`).join("|"),
  };
}

const CAMPOS_SELECT = [
  "id", "title", "stageId", "companyId", "assignedById", "movedTime",
  CAMPO_INQUILINO, CAMPO_LOGRADOURO, CAMPO_NUMERO, CAMPO_COMPLEMENTO, CAMPO_CIDADE, CAMPO_UF, CAMPO_CEP,
  CAMPO_ENDERECO_COMPLETO, CAMPO_ALUGUEL, CAMPO_CONDOMINIO, CAMPO_IPTU,
  ...LINHAS_PANORAMA.map((l) => l.campoStatus),
];

export async function listarCardsFila(): Promise<CardPanorama[]> {
  const [campos, itens] = await Promise.all([
    buscarDefinicaoCampos(ENTITY_TYPE_ID),
    buscarTodasPaginas<BitrixItemRaw>("crm.item.list", {
      entityTypeId: ENTITY_TYPE_ID,
      select: CAMPOS_SELECT,
      "filter[@stageId]": ETAPAS_FILA,
      "order[id]": "desc",
    }),
  ]);
  const [empresas, usuarios] = await Promise.all([
    buscarEmpresas(itens.map((i) => i.companyId)),
    buscarUsuarios(itens.map((i) => i.assignedById)),
  ]);
  return itens.map((i) => montarCard(i, campos, empresas, usuarios));
}

export async function buscarCardPanorama(id: number): Promise<CardPanorama> {
  const [campos, item] = await Promise.all([buscarDefinicaoCampos(ENTITY_TYPE_ID), buscarItem(ENTITY_TYPE_ID, id)]);
  const [empresas, usuarios] = await Promise.all([buscarEmpresas([item.companyId]), buscarUsuarios([item.assignedById])]);
  return montarCard(item, campos, empresas, usuarios);
}

// Card entra na fila quando pelo menos 1 seguradora aprovou/pré-aprovou --
// não espera as outras responderem (decisão 15/10/2026).
export const temSeguradoraAprovada = (c: CardPanorama) => c.linhas.some((l) => statusEditavel(l.status));
