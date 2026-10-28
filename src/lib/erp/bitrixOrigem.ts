import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarDefinicaoCampos, chamarBitrix, listarHistoricoEtapas, listarItensSpa, type BitrixDefinicaoCampo, type BitrixItemRaw, type BitrixStageHistoryEvent } from "@/lib/bitrix/client";
import { gerarLinkCard } from "@/lib/bitrix/entidadesCard";
import { SEGURADORAS as SEGURADORAS_FIANCA } from "@/lib/bitrix/seguroFianca";
import { garantirCliente, tipoDoDocumento } from "@/lib/erp/clientes";

// ERP O2 — Fase 1b / T2: todo card do Bitrix vira documento do ERP, em todos os produtos.
//
// Princípios do Matheus (25/10/2026):
//   * o card é o INÍCIO da informação e acompanha o documento até a apólice: pré-cadastro
//     para revisão humana (automático quando o fluxo for 100% confiável), campos preenchidos
//     sempre que pertinentes (imóvel, partes, coberturas, veículo…), trilha inteira salva;
//   * vale para TODOS os produtos: Fiança (SPA 1042), Produção Incêndio/RE (1046: incêndio
//     imobiliário e individual, condomínio, celular, RCP), Capitalização (1048), Automóvel (1050);
//   * TUDO é salvo, inclusive recusado, perdido e não efetivado: se o card existiu, a história
//     completa está no banco. O ERP controla o que foi efetivado/convertido, como o Corp hoje.
// O Código O2 nasce aqui, interno (parâmetro codigo_o2_exposto). Única escrita possível no Bitrix: comentário
// nos cards de ENDOSSO dizendo a que apólice do Corp foram ligados (vincularEndossoAoPai) — desligada no cron.

type Raw = Record<string, unknown>;
type Defs = Record<string, BitrixDefinicaoCampo & { title?: string; type?: string }>;
type Etapa = { statusId: string; nome: string; semantica: "P" | "S" | "F" };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const [s] = String(v).split("|");
  const n = Number(String(s).replace(/\./g, (m, i, str) => (str.includes(",") ? "" : m)).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const data = (v: unknown): string | null => (texto(v) ? String(v).slice(0, 10) : null);
const addDays = (d: string, n: number): string => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const digitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");
/** CPF/CNPJ que veio como número perde zeros à esquerda: completa para 11 ou 14. */
const documento = (v: unknown): string | null => {
  const d = digitos(v);
  if (!d) return null;
  if (d.length < 11) return d.padStart(11, "0");
  if (d.length > 11 && d.length < 14) return d.padStart(14, "0");
  return d;
};
const rotulo = (defs: Defs, campo: string, v: unknown): string | null => {
  const s = texto(v);
  if (!s) return null;
  if (Array.isArray(v)) return v.map((x) => rotulo(defs, campo, x)).filter(Boolean).join(", ") || null;
  const item = defs[campo]?.items?.find((i) => String(i.ID) === s);
  return item ? item.VALUE : s;
};

// ------------------------------------------------------------ o que cada produto sabe extrair do card
export type TipoEndosso = "C" | "I" | "M" | "R" | "X";
/** Rótulo do tipo de endosso no card → tipo do Corp. Desconhecido = C (cobrança), como antes. */
export function tipoEndossoDoRotulo(rotulo: string | null | undefined): TipoEndosso {
  const t = (rotulo ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (t.includes("CANCEL")) return t.includes("ITEM") ? "I" : "X";
  if (t.includes("RESTITU") || t.includes("DEVOLU")) return "R";
  if (t.includes("SEM PREM") || t.includes("SEM CUSTO") || t.includes("TROCA") || t.includes("CADASTR")) return "M";
  return "C";
}

export type Extraido = {
  produto: string; // erp_ramos.produto
  ramoAbrev: string | null; // abreviação preferida (IMOB, RESI, CAP, AUTO…); null = decide pelo produto
  corretora: "corretora" | "capitalizacao";
  tipo: "A" | "C"; // A apólice · C endosso
  /** tipo de endosso do Corp que o card define (C cobrança, I cancel. de item, M sem prêmio, R restituição, X cancel. de
   * apólice) — o funil de endossos de cada SPA é a origem do tipo e do motivo (Matheus 25/10/2026) */
  tipoEndosso?: TipoEndosso;
  tipo_corp: "NOVO" | "RENV" | "END";
  seguradoraNome: string | null;
  premio: number | null;
  parcelas: number | null;
  comissaoPct: number | null;
  repassePct: number | null;
  vigIni: string | null;
  vigFim: string | null;
  nnCorp: number | null;
  numeroApolice: string | null;
  numeroProposta: string | null;
  anterior: { apolice: string | null; proposta: string | null }; // renovação: liga ao documento anterior (thread, como o Corp)
  cliente: { documento: string | null; nome: string | null; email: string | null; telefone: string | null };
  imobTexto: string | null; // nome/código da imobiliária quando o card não usa Empresa
  tipoContratacao: "indicacao_imobiliaria" | "venda_direta" | "frota" | "canal" | null;
  canalVenda: string | null;
  modoCobranca: "nao_informado" | "fatura" | "boleto" | "cartao" | "debito";
  formaPagamento: string | null;
  observacoes: string | null;
  item: { administrado?: boolean | null; tipo_imovel?: string | null; cep?: string | null; logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null; valor_aluguel?: number | null; plano?: string | null; observacoes?: string | null; placa?: string | null; veiculo?: string | null } | null;
  partes: { papel: "garantido" | "locatario" | "proprietario" | "condutor" | "beneficiario"; nome: string | null; documento_numero: string | null; ordem: number }[];
  coberturas: { nome: string; importancia_segurada: number | null }[];
};

export type ConfigSpa = {
  entityTypeId: number;
  nome: string;
  renovacaoCategorias: number[];
  endossoCategorias: number[];
  extrair: (it: BitrixItemRaw, defs: Defs) => Extraido;
};

const SEG_RE: Record<string, string> = { PORTO: "PORT", YELLUM: "YELU", YELUM: "YELU", TOKIO: "TOKI", "SEG/TOKIO": "TOKI", "SEG/ZURICH": "ZURI", ZURICH: "ZURI", ALLIANZ: "ALLI", BRADESCO: "BRAD", HDI: "HDI", ALFA: "ALF", SUHAI: "SUHA", "ITAÚ": "ITAU", ITAU: "ITAU", AZUL: "AZUL", MITSUI: "MITS", MAPFRE: "MAPF", SULAMERICA: "SULA" };

export const CONFIGS: ConfigSpa[] = [
  {
    entityTypeId: 1042,
    nome: "Seguro Fiança",
    renovacaoCategorias: [32],
    endossoCategorias: [],
    extrair: (it, defs) => {
      const r = it as Raw;
      const segNome = rotulo(defs, "ufCrm10_1776352200", r.ufCrm10_1776352200);
      const cfg = SEGURADORAS_FIANCA.find((s) => segNome && segNome.toLowerCase().includes(s.nome.toLowerCase()));
      const parcelas = cfg?.parcelas ? num(r[cfg.parcelas]) : null;
      const valorParcela = cfg ? num(r[cfg.valor]) : null;
      const premio = num(r.ufCrm10_1781029986152) ?? (valorParcela && parcelas ? Math.round(valorParcela * parcelas * 100) / 100 : null);
      const tipoLoc = (rotulo(defs, "ufCrm10_1776351302", r.ufCrm10_1776351302) ?? "").toLowerCase();
      const cpf1 = documento(r.ufCrm10_1776351609);
      const voceE = rotulo(defs, "ufCrm10_1781120236", r.ufCrm10_1781120236) ?? "";
      return {
        produto: "fianca", ramoAbrev: null, corretora: "corretora", tipo: "A", tipo_corp: "NOVO",
        seguradoraNome: segNome, premio, parcelas,
        comissaoPct: num(r.ufCrm10_1779820737) ?? (cfg?.comissao ? num(r[cfg.comissao]) : null), repassePct: null,
        vigIni: data(r.ufCrm10_1779821934), vigFim: data(r.ufCrm10_1779821962),
        nnCorp: num(r.ufCrm10_1778258392), numeroApolice: null, numeroProposta: null,
        anterior: { apolice: texto(r.ufCrm10_1790800677), proposta: null },
        cliente: { documento: cpf1, nome: texto(r.ufCrm10_1776354897), email: texto(r.ufCrm10_1783366659), telefone: texto(r.ufCrm10_1783366668) },
        imobTexto: texto(r.ufCrm10_1783371296),
        tipoContratacao: it.companyId ? "indicacao_imobiliaria" : voceE.includes("Pretendente") || voceE.includes("Proprietário") ? "venda_direta" : null,
        canalVenda: null, modoCobranca: "nao_informado", formaPagamento: null,
        observacoes: texto(r.ufCrm10_1776352503),
        item: {
          administrado: (() => { const a = rotulo(defs, "ufCrm10_1781116076", r.ufCrm10_1781116076); if (a === "Sim") return true; if (a === "Não") return false; if (r.ufCrm10_1788957284213 === "Y" || r.ufCrm10_1788957828053 === "Y") return true; if (r.ufCrm10_1788957284213 === "N") return false; return null; })(),
          tipo_imovel: tipoLoc.includes("comerc") ? "comercial" : tipoLoc.includes("resid") ? "residencial" : null,
          cep: texto(r.ufCrm10_1776351647), logradouro: texto(r.ufCrm10_1776351662), numero: texto(r.ufCrm10_1776351686), complemento: texto(r.ufCrm10_1776351702),
          cidade: texto(r.ufCrm10_1776351708), uf: rotulo(defs, "ufCrm10_1776351720", r.ufCrm10_1776351720),
          valor_aluguel: num(r.ufCrm10_1776352052), plano: rotulo(defs, "ufCrm10_1776351571", r.ufCrm10_1776351571),
          observacoes: [rotulo(defs, "ufCrm10_1781116634", r.ufCrm10_1781116634), rotulo(defs, "ufCrm10_1781118439", r.ufCrm10_1781118439), rotulo(defs, "ufCrm10_1776351520", r.ufCrm10_1776351520)].filter(Boolean).join(" · ") || null,
        },
        partes: [
          { papel: "locatario", ordem: 1, nome: texto(r.ufCrm10_1776354897), documento_numero: cpf1 },
          { papel: "locatario", ordem: 2, nome: texto(r.ufCrm10_1783438270), documento_numero: documento(r.ufCrm10_1783438283) },
        ].filter((p) => p.nome || p.documento_numero) as Extraido["partes"],
        coberturas: [["Aluguel", r.ufCrm10_1776352052], ["IPTU", r.ufCrm10_1776352100], ["Condomínio", r.ufCrm10_1776352074], ["Água", r.ufCrm10_1776352111], ["Luz", r.ufCrm10_1776352123]]
          .map(([nome, v]) => ({ nome: String(nome), importancia_segurada: num(v) })).filter((c) => c.importancia_segurada),
      };
    },
  },
  {
    entityTypeId: 1046,
    nome: "Produção Incêndio / Ramos Elementares",
    renovacaoCategorias: [34],
    endossoCategorias: [24],
    extrair: (it, defs) => {
      const r = it as Raw;
      const produto = rotulo(defs, "ufCrm12Produto", r.ufCrm12Produto) ?? "";
      const ramoAbrev = produto.includes("Imobili") ? "IMOB" : produto.includes("Residencial") ? "RESI" : produto.includes("Empresarial") ? "EMPR" : produto.includes("Celular") ? "PORT" : produto.includes("RCP") ? "RCP" : produto.includes("Condom") ? "COND" : null;
      const produtoErp = ramoAbrev === "COND" ? "condominio" : ramoAbrev === "PORT" ? "portateis" : ramoAbrev === "RCP" ? "rc" : "incendio";
      const segSel = rotulo(defs, "ufCrm12SeguradoraFinalMulti", r.ufCrm12SeguradoraFinalMulti) ?? texto(r.ufCrm12Seguradora);
      const segNome = segSel ? (SEG_RE[segSel.split(",")[0].trim().toUpperCase()] ?? segSel) : null;
      const origem = rotulo(defs, "ufCrm12OrigemProducao", r.ufCrm12OrigemProducao) ?? "";
      const operacao = rotulo(defs, "ufCrm12OperacaoSusep", r.ufCrm12OperacaoSusep) ?? "";
      const processo = rotulo(defs, "ufCrm12TipoProcesso", r.ufCrm12TipoProcesso) ?? "";
      const movimentacao = rotulo(defs, "ufCrm12TipoMovimentacao", r.ufCrm12TipoMovimentacao);
      const endosso = Number(it.categoryId) === 24;
      const comDec = num(r.ufCrm12_1788368973918);
      const repDec = num(r.ufCrm12_1788368984463);
      const cpf = documento(r.ufCrm12_1787688840267);
      return {
        produto: produtoErp, ramoAbrev, corretora: operacao.includes("Capitaliza") ? "capitalizacao" : "corretora",
        tipo: endosso ? "C" : "A", tipo_corp: endosso ? "END" : processo.includes("Renova") ? "RENV" : "NOVO",
        tipoEndosso: endosso ? tipoEndossoDoRotulo(rotulo(defs, "ufCrm12_1789156499539", r.ufCrm12_1789156499539)) : undefined,
        seguradoraNome: segNome, premio: num(r.ufCrm12PremioTotal) ?? num(r.ufCrm12_1789158416459), parcelas: num(r.ufCrm12Parcelas),
        comissaoPct: comDec !== null ? (comDec <= 1 ? comDec * 100 : comDec) : num(r.ufCrm12ComissaoPercentual),
        repassePct: repDec !== null ? (repDec <= 1 ? repDec * 100 : repDec) : num(r.ufCrm12RepassePercentual),
        vigIni: data(r.ufCrm12CompetenciaOperacional), vigFim: data(r.ufCrm12FimVigencia),
        nnCorp: null, numeroApolice: texto(r.ufCrm12NumApolice), numeroProposta: texto(r.ufCrm12NumOrcamento),
        anterior: { apolice: null, proposta: null },
        cliente: { documento: cpf, nome: texto(it.title), email: null, telefone: null },
        imobTexto: null,
        tipoContratacao: origem.includes("Segimob") ? "canal" : it.companyId ? "indicacao_imobiliaria" : null,
        canalVenda: origem.includes("Segimob") ? "segimob" : null,
        modoCobranca: ramoAbrev === "IMOB" ? "fatura" : "nao_informado", formaPagamento: null,
        observacoes: [texto(r.ufCrm12Observacoes), movimentacao ? `Movimentação: ${movimentacao}` : null, rotulo(defs, "ufCrm12_1789156499539", r.ufCrm12_1789156499539) ? `Endosso: ${rotulo(defs, "ufCrm12_1789156499539", r.ufCrm12_1789156499539)}` : null, texto(r.ufCrm12ReferenciaPlanilha) ? `Planilha: ${texto(r.ufCrm12ReferenciaPlanilha)}` : null].filter(Boolean).join("\n") || null,
        item: {
          cep: texto(r.ufCrm12_1790085456047), logradouro: texto(r.ufCrm12_1790085424526), numero: texto(r.ufCrm12_1790085444491), complemento: texto(r.ufCrm12_1790085448344),
          cidade: texto(r.ufCrm12_1790085451655), valor_aluguel: num(r.ufCrm12_1790085479280),
          observacoes: [num(r.ufCrm12QtdEnderecos) ? `${num(r.ufCrm12QtdEnderecos)} endereço(s) na solicitação` : null, num(r.ufCrm12QtdEnderecosContratados) ? `${num(r.ufCrm12QtdEnderecosContratados)} contratado(s)` : null].filter(Boolean).join(" · ") || null,
        },
        partes: cpf || texto(it.title) ? [{ papel: "garantido", ordem: 1, nome: texto(it.title), documento_numero: cpf }] : [],
        coberturas: [],
      };
    },
  },
  {
    entityTypeId: 1048,
    nome: "Título de Capitalização",
    renovacaoCategorias: [38],
    endossoCategorias: [40],
    extrair: (it, defs) => {
      const r = it as Raw;
      const pj = (rotulo(defs, "ufCrm14CapTipoLocat", r.ufCrm14CapTipoLocat) ?? "").includes("jur");
      const docCliente = pj ? documento(r.ufCrm14CapLocatPjCnpj) : documento(r.ufCrm14CapLocatPfCpf);
      const nomeCliente = pj ? texto(r.ufCrm14CapLocatPjRazao) : texto(r.ufCrm14CapLocatPfNome);
      const origem = rotulo(defs, "ufCrm14CapOrigem", r.ufCrm14CapOrigem) ?? "";
      const endosso = Number(it.categoryId) === 40;
      const locadorPj = (rotulo(defs, "ufCrm14CapTipoLocador", r.ufCrm14CapTipoLocador) ?? "").includes("jur");
      return {
        produto: "capitalizacao", ramoAbrev: null, corretora: "capitalizacao",
        tipo: endosso ? "C" : "A", tipo_corp: endosso ? "END" : Number(it.categoryId) === 38 ? "RENV" : "NOVO",
        tipoEndosso: endosso ? "M" : undefined, // funil Endossos do Cap: troca de locador/locatário/titular, sem prêmio
        seguradoraNome: texto(r.ufCrm14CapSeguradora), premio: num(r.ufCrm14CapValorTit), parcelas: 1,
        comissaoPct: num(r.ufCrm14CapComissaoPct), repassePct: null,
        vigIni: data(r.ufCrm14CapVigInicio), vigFim: data(r.ufCrm14CapVigFim),
        nnCorp: null, numeroApolice: null, numeroProposta: texto(r.ufCrm14CapNumProposta),
        anterior: { apolice: null, proposta: texto(r.ufCrm14_1792781102) },
        cliente: { documento: docCliente, nome: nomeCliente, email: texto(r.ufCrm14CapLocatEmail) ?? texto(r.ufCrm14CapEmailEnvio), telefone: texto(r.ufCrm14CapLocatFone) },
        imobTexto: texto(r.ufCrm14CapImobAdmin),
        tipoContratacao: origem.includes("Imobili") ? "indicacao_imobiliaria" : origem.includes("Corretor") ? "canal" : origem.includes("Propriet") ? "venda_direta" : null,
        canalVenda: null,
        modoCobranca: (rotulo(defs, "ufCrm14CapFormaPgto", r.ufCrm14CapFormaPgto) ?? "").toLowerCase().startsWith("cart") ? "cartao" : (rotulo(defs, "ufCrm14CapFormaPgto", r.ufCrm14CapFormaPgto) ?? "").toLowerCase().startsWith("bolet") ? "boleto" : "nao_informado",
        formaPagamento: rotulo(defs, "ufCrm14CapFormaPgto", r.ufCrm14CapFormaPgto),
        observacoes: [texto(r.ufCrm14CapGarantia), rotulo(defs, "ufCrm14CapEncConsid", r.ufCrm14CapEncConsid) ? `Encargos: ${rotulo(defs, "ufCrm14CapEncConsid", r.ufCrm14CapEncConsid)}` : null, rotulo(defs, "ufCrm14CapPrazoRenov", r.ufCrm14CapPrazoRenov) ? `Prazo: ${rotulo(defs, "ufCrm14CapPrazoRenov", r.ufCrm14CapPrazoRenov)}` : null, texto(r.ufCrm14_1792781102) ? `Proposta anterior: ${texto(r.ufCrm14_1792781102)}` : null].filter(Boolean).join("\n") || null,
        item: { cep: texto(r.ufCrm14CapImovelCep), logradouro: texto(r.ufCrm14CapImovelEnd), bairro: texto(r.ufCrm14CapImovelBairro), cidade: texto(r.ufCrm14CapImovelCidade) },
        partes: [
          { papel: "locatario" as const, ordem: 1, nome: nomeCliente, documento_numero: docCliente },
          { papel: "proprietario" as const, ordem: 1, nome: locadorPj ? texto(r.ufCrm14CapLocadorPjRazao) : texto(r.ufCrm14CapLocadorPfNome), documento_numero: locadorPj ? documento(r.ufCrm14CapLocadorPjCnpj) : documento(r.ufCrm14CapLocadorPfCpf) },
        ].filter((p) => p.nome || p.documento_numero),
        coberturas: [],
      };
    },
  },
  {
    entityTypeId: 1050,
    nome: "Seguro Automóvel",
    renovacaoCategorias: [],
    endossoCategorias: [],
    extrair: (it, defs) => {
      const r = it as Raw;
      return {
        produto: "automovel", ramoAbrev: "AUTO", corretora: "corretora", tipo: "A", tipo_corp: "NOVO",
        seguradoraNome: null, premio: num(r.ufCrm16_1787061422), parcelas: num(r.ufCrm16_1787060548431),
        comissaoPct: num(r.ufCrm16_1787060483253), repassePct: null,
        vigIni: null, vigFim: null, nnCorp: null, numeroApolice: null, numeroProposta: null, anterior: { apolice: null, proposta: null },
        cliente: { documento: null, nome: texto(r.ufCrm16_1787056933080) ?? texto(it.title), email: texto(r.ufCrm16_1787056957386), telefone: texto(r.ufCrm16_1787056962877) },
        imobTexto: null,
        tipoContratacao: it.companyId ? "indicacao_imobiliaria" : "venda_direta", canalVenda: it.companyId ? null : "venda_direta",
        modoCobranca: "nao_informado", formaPagamento: null,
        observacoes: [texto(r.ufCrm16_1787057323033) ? `Endereço: ${texto(r.ufCrm16_1787057323033)}` : null, rotulo(defs, "ufCrm16_1787057098438", r.ufCrm16_1787057098438) ? `Uso: ${rotulo(defs, "ufCrm16_1787057098438", r.ufCrm16_1787057098438)}` : null, texto(r.ufCrm16_1787057276856) ? `Estado civil: ${texto(r.ufCrm16_1787057276856)}` : null].filter(Boolean).join("\n") || null,
        item: { observacoes: [r.ufCrm16_1787056986772 ? "garagem na residência" : null, rotulo(defs, "ufCrm16_1787057051225", r.ufCrm16_1787057051225) ? `portão ${rotulo(defs, "ufCrm16_1787057051225", r.ufCrm16_1787057051225)}` : null].filter(Boolean).join(" · ") || null },
        partes: [{ papel: "condutor", ordem: 1, nome: texto(r.ufCrm16_1787056933080) ?? texto(it.title), documento_numero: null }],
        coberturas: [],
      };
    },
  },
];

// ------------------------------------------------------------ etapas (ao vivo, com semântica do Bitrix)
async function listarEtapas(entityTypeId: number): Promise<Map<string, Etapa>> {
  const r = await chamarBitrix<{ result: { STATUS_ID: string; NAME: string; SEMANTICS?: string; ENTITY_ID: string }[] }>("crm.status.list", {} as never);
  const m = new Map<string, Etapa>();
  for (const s of r.result.filter((s) => s.ENTITY_ID.startsWith(`DYNAMIC_${entityTypeId}_`))) {
    m.set(s.STATUS_ID, { statusId: s.STATUS_ID, nome: s.NAME, semantica: s.SEMANTICS === "S" || s.SEMANTICS === "F" ? s.SEMANTICS : "P" });
  }
  return m;
}

/** Situação do ERP pelo funil/etapa. Cotação → proposta (negociação) → digitado (efetivado); recusado/perdido quando falha. */
export function situacaoDoCard(cfg: ConfigSpa, it: BitrixItemRaw, etapas: Map<string, Etapa>): { situacao: string; motivo?: string } {
  const et = etapas.get(it.stageId);
  const sem = et?.semantica ?? (it.stageId.endsWith(":SUCCESS") ? "S" : it.stageId.endsWith(":FAIL") ? "F" : "P");
  const cat = Number(it.categoryId);
  const nome = (et?.nome ?? it.stageId).toLowerCase();
  if (sem === "S") {
    // Fiança: SUCESSO na Análise (cat 18) é cotação aprovada, ainda não efetivada
    if (cfg.entityTypeId === 1042 && cat === 18) return { situacao: "cotacao" };
    return { situacao: "digitado" };
  }
  if (sem === "F") {
    const perdido = /perd|desist|não renov|nao renov|sem emiss|s\/ retorno|não realizado|nao realizado/.test(nome);
    return { situacao: perdido ? "perdido" : "recusado", motivo: et?.nome ?? "recusado/perdido" };
  }
  // em andamento: negociação/contratação = proposta; o resto = cotação
  const emProposta = /negoci|contrat|emiss|contrato|proposta|pagamento|boleto|cadastr|transmit|vistoria|desconto/.test(nome) || (cfg.entityTypeId === 1042 && cat === 20);
  return { situacao: emProposta ? "proposta" : "cotacao" };
}

export function dadosLegiveis(item: BitrixItemRaw, defs: Defs): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [campo, def] of Object.entries(defs)) {
    const v = (item as Raw)[campo];
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    const r = def.title ?? campo;
    out[r] = def.type === "enumeration" ? rotulo(defs, campo, v) : def.type === "money" ? num(v) : v;
  }
  return out;
}

export type ResumoSincronizacao = {
  spa: number; nome: string; cards: number; criados: number; ligados_ao_corp: number; atualizados: number;
  sem_imobiliaria: number; sem_cliente: number; comentarios_capturados: number; renovacoes_ligadas: number;
  endossos_ligados: number; endossos_sem_apolice: number; avisos_no_bitrix: number; erros: { card: number; erro: string }[];
};
/** escreverNoBitrix: "abertos" = só cards de endosso em andamento recebem campo/comentário (cron);
 * "todos" = também os encerrados (teste por --card); false/ausente = só o banco. */
type Opcoes = { desde: string; gravar: boolean; comentarios: number; apenasCards?: number[]; apenasAlterados?: boolean; escreverNoBitrix?: "abertos" | "todos" | false };

export async function sincronizarSpa(sb: SupabaseClient, cfg: ConfigSpa, o: Opcoes): Promise<ResumoSincronizacao> {
  const r: ResumoSincronizacao = { spa: cfg.entityTypeId, nome: cfg.nome, cards: 0, criados: 0, ligados_ao_corp: 0, atualizados: 0, sem_imobiliaria: 0, sem_cliente: 0, comentarios_capturados: 0, renovacoes_ligadas: 0, endossos_ligados: 0, endossos_sem_apolice: 0, avisos_no_bitrix: 0, erros: [] };
  const [todos, historico, defs, etapas] = await Promise.all([listarItensSpa(cfg.entityTypeId), listarHistoricoEtapas(cfg.entityTypeId), buscarDefinicaoCampos(cfg.entityTypeId) as Promise<Defs>, listarEtapas(cfg.entityTypeId)]);
  let itens = todos.filter((i) => String(i.createdTime).slice(0, 10) >= o.desde);
  if (o.apenasCards?.length) itens = itens.filter((i) => o.apenasCards!.includes(Number(i.id)));
  if (o.apenasAlterados) {
    // cron de hora em hora: só cards novos ou mexidos desde a última captura (cabe nos 60 s da Vercel)
    const capturados = new Map<number, string>();
    for (let de = 0; ; de += 1000) {
      const { data } = await sb.from("erp_origens").select("item_id, card_atualizado_em").eq("sistema", "bitrix").eq("entity_type_id", cfg.entityTypeId).order("item_id").range(de, de + 999);
      for (const x of data ?? []) capturados.set(Number(x.item_id), String(x.card_atualizado_em ?? ""));
      if (!data || data.length < 1000) break;
    }
    // compara instantes (o Bitrix manda +03:00, o banco devolve UTC): texto não serve
    itens = itens.filter((i) => !capturados.has(Number(i.id)) || Date.parse(capturados.get(Number(i.id))!) < Date.parse(String(i.updatedTime)));
  }
  r.cards = itens.length;
  const eventosPorCard = new Map<number, BitrixStageHistoryEvent[]>();
  for (const e of historico) eventosPorCard.set(Number(e.OWNER_ID), [...(eventosPorCard.get(Number(e.OWNER_ID)) ?? []), e]);

  // o Supabase devolve no máximo 1.000 linhas por consulta: pagina o que pode passar disso
  const todasAsLinhas = async <T,>(monta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> => {
    const out: T[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await monta(de, de + 999);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []));
      if (!data || data.length < 1000) return out;
    }
  };
  const [{ data: ramos }, { data: corretoras }, { data: segs }, vinculos, chavesExistentes] = await Promise.all([
    sb.from("erp_ramos").select("id, abreviacao, produto, corretora_id"),
    sb.from("erp_corretoras").select("id, apelido"),
    sb.from("erp_seguradoras").select("id, nome, abreviacao"),
    todasAsLinhas<{ chave_externa: string; imobiliaria_id: string }>((de, ate) => sb.from("imobiliaria_registros_fonte").select("chave_externa, imobiliaria_id").eq("fonte", "bitrix_empresa").not("imobiliaria_id", "is", null).range(de, ate)),
    todasAsLinhas<{ chave: string; entidade_id: string }>((de, ate) => sb.from("erp_chaves_externas").select("chave, entidade_id").eq("sistema", "bitrix").eq("entidade", "documento").like("chave", `${cfg.entityTypeId}:%`).order("chave").range(de, ate)),
  ]);
  const corretoraId = (k: Extraido["corretora"]) => (corretoras ?? []).find((c) => (k === "capitalizacao" ? /capitaliza/i : /corretora/i).test(c.apelido))?.id ?? null;
  const ramoId = (x: Extraido, corr: string | null) => {
    const lista = (ramos ?? []).filter((rm) => (x.ramoAbrev ? rm.abreviacao === x.ramoAbrev || (rm.abreviacao === "2" + x.ramoAbrev) || (x.ramoAbrev === "CAP" && rm.abreviacao === "CAP2") : rm.produto === x.produto));
    return (lista.find((rm) => rm.corretora_id === corr) ?? lista.find((rm) => !rm.corretora_id) ?? lista[0])?.id ?? null;
  };
  const segId = (nome: string | null) => {
    if (!nome) return null;
    const n = nome.toLowerCase();
    return (segs ?? []).find((s) => n === s.abreviacao.toLowerCase() || n.includes(s.nome.toLowerCase().split(" ")[0]) || n.includes(s.abreviacao.toLowerCase()))?.id ?? null;
  };
  const imobPorEmpresa = new Map(vinculos.map((v) => [String(v.chave_externa), v.imobiliaria_id as string]));
  const docPorChave = new Map(chavesExistentes.map((c) => [c.chave as string, c.entidade_id as string]));
  const cacheImobTexto = new Map<string, string | null>();

  let comentariosRestantes = o.comentarios;
  for (const item of itens) {
    const id = Number(item.id);
    try {
      const chave = `${cfg.entityTypeId}:${id}`;
      const x = cfg.extrair(item, defs);
      // o funil manda: renovação/endosso pela categoria do card, independente do que a extração assumiu
      if (cfg.renovacaoCategorias.includes(Number(item.categoryId))) x.tipo_corp = "RENV";
      if (cfg.endossoCategorias.includes(Number(item.categoryId))) { x.tipo_corp = "END"; x.tipo = "C"; }
      const sit = situacaoDoCard(cfg, item, etapas);
      // produtor: Empresa do card → ficha; senão, texto do card resolvido pela base única (nunca cria ficha)
      let imobId = item.companyId ? imobPorEmpresa.get(String(item.companyId)) ?? null : null;
      if (!imobId && x.imobTexto) {
        if (!cacheImobTexto.has(x.imobTexto)) cacheImobTexto.set(x.imobTexto, (await sb.rpc("erp_resolver_produtor", { p: x.imobTexto })).data ?? null);
        imobId = cacheImobTexto.get(x.imobTexto) ?? null;
      }
      if (!imobId) r.sem_imobiliaria++;
      if (!x.cliente.documento) r.sem_cliente++;
      const corr = corretoraId(x.corretora);
      const ramo = ramoId(x, corr);
      const seg = segId(x.seguradoraNome);

      let locatarioId: string | null = null;
      if (x.cliente.documento && o.gravar) {
        await sb.from("locatarios").upsert({ cpf: x.cliente.documento, nome: x.cliente.nome, email: x.cliente.email, telefone: x.cliente.telefone, primeira_fonte: `bitrix:${chave}` }, { onConflict: "cpf", ignoreDuplicates: true });
        locatarioId = (await sb.from("locatarios").select("id").eq("cpf", x.cliente.documento).maybeSingle()).data?.id ?? null;
      }

      let docId = docPorChave.get(chave) ?? null;
      const ehEndosso = x.tipo_corp === "END";
      // card de endosso é documento próprio, filho da apólice — nunca a própria apólice (até 25/10 o nº da
      // apólice do card casava com a apólice do Corp e 55 cards de endosso viraram a apólice): solta e recria
      if (docId && ehEndosso) {
        const { data: ja } = await sb.from("erp_documentos").select("tipo").eq("id", docId).maybeSingle();
        if (ja && (ja.tipo === "A" || ja.tipo === "F")) docId = null;
      }
      let modo: "criado" | "ligado" | "atualizado" = "atualizado";
      const ehRenovacao = cfg.renovacaoCategorias.includes(Number(item.categoryId));
      // Num card de RENOVAÇÃO o "Nosso Nº Corp" é a apólice ANTERIOR (148/150 batem com o "fim da
      // vigência anterior" do card) — vira o elo da família, nunca o próprio documento.
      let anteriorId: string | null = null;
      if (x.nnCorp) {
        const { data: doCorp } = await sb.from("erp_documentos").select("id, vigencia_fim").eq("nosso_numero_corp", x.nnCorp).maybeSingle();
        if (doCorp) {
          if (ehRenovacao) anteriorId = doCorp.id;
          else if (!docId) { docId = doCorp.id; modo = "ligado"; }
        }
      }
      if (!docId && x.numeroApolice && !ehEndosso) {
        const { data: porApolice } = await sb.from("erp_documentos").select("id").eq("numero_apolice", x.numeroApolice).eq("origem", "corp_import").limit(1).maybeSingle();
        if (porApolice) { docId = porApolice.id; modo = "ligado"; }
      }
      // Renovação: o Corp pode já ter digitado a apólice nova (ex.: 133629 = renovação do 114924).
      // Casa quando há UM candidato do Corp, renovação, mesmo produto, mesma imob/cliente, começando
      // perto da vigência inicial do card e que renova o anterior (ou ainda não está ligado a ninguém).
      if (!docId && ehRenovacao && x.vigIni && ramo) {
        let q = sb.from("erp_documentos").select("id, documento_renovado_id, imobiliaria_principal_id, locatario_id")
          .eq("origem", "corp_import").eq("tipo", "A").eq("tipo_corp", "RENV")
          .gte("vigencia_inicio", addDays(x.vigIni, -5)).lte("vigencia_inicio", addDays(x.vigIni, 5))
          .in("ramo_id", (ramos ?? []).filter((rm) => rm.produto === x.produto).map((rm) => rm.id));
        if (seg) q = q.eq("seguradora_id", seg);
        const { data: cands } = await q.limit(50);
        const bons = (cands ?? []).filter((c) =>
          (anteriorId ? c.documento_renovado_id === anteriorId || c.documento_renovado_id === null : true) &&
          ((imobId && c.imobiliaria_principal_id === imobId) || (locatarioId && c.locatario_id === locatarioId)));
        const exatos = anteriorId ? bons.filter((c) => c.documento_renovado_id === anteriorId) : [];
        const escolhido = exatos.length === 1 ? exatos[0] : bons.length === 1 ? bons[0] : null;
        if (escolhido) { docId = escolhido.id; modo = "ligado"; }
      }
      const premio = x.premio ?? 0;
      const comissaoPct = x.comissaoPct ?? 0;
      if (!docId) {
        modo = "criado";
        if (!o.gravar) { r.criados++; continue; }
        const competencia = (x.vigIni ?? String(item.createdTime).slice(0, 10)).slice(0, 7) + "-01";
        const { data: novo, error } = await sb.from("erp_documentos").insert({
          corretora_id: corr, tipo: x.tipo_corp === "END" ? x.tipoEndosso ?? "C" : x.tipo, tipo_corp: x.tipo_corp, seguradora_id: seg, ramo_id: ramo,
          locatario_id: locatarioId, imobiliaria_principal_id: imobId, canal_venda: x.canalVenda,
          tipo_contratacao: x.tipoContratacao, modo_cobranca: x.modoCobranca === "fatura" && !imobId ? "nao_informado" : x.modoCobranca,
          numero_apolice: x.numeroApolice, numero_proposta: x.numeroProposta, forma_pagamento: null,
          dt_proposta: String(item.createdTime).slice(0, 10), vigencia_inicio: x.vigIni, vigencia_fim: x.vigFim,
          qtd_parcelas: x.parcelas, premio_liquido: premio, premio_total: premio,
          comissao_pct: comissaoPct, comissao_valor: Math.round(premio * comissaoPct) / 100,
          situacao: sit.situacao, motivo_cancelamento: sit.motivo ?? null, competencia,
          origem: "bitrix", origem_ref: chave, observacoes: [x.observacoes, x.formaPagamento ? `Forma de pagamento: ${x.formaPagamento}` : null].filter(Boolean).join("\n") || null,
          digitado_em: item.createdTime, revisao_pendente: true,
        }).select("id").single();
        if (error) throw new Error(error.message);
        docId = novo.id;
        if (imobId) await sb.from("erp_documento_produtores").insert({ documento_id: docId, imobiliaria_id: imobId, agente: "imob", principal: true, pct_participacao: 100, repasse_pct: x.repassePct ?? 0, repasse_valor_previsto: x.repassePct ? Math.round(premio * x.repassePct) / 100 : 0 });
      } else if (o.gravar) {
        const { data: atual } = await sb.from("erp_documentos").select("origem, locatario_id, imobiliaria_principal_id, tipo_contratacao, seguradora_id, numero_apolice, numero_proposta").eq("id", docId).single();
        const patch: Record<string, unknown> = {};
        if (atual?.origem === "bitrix") {
          Object.assign(patch, { tipo_corp: x.tipo_corp, ...(x.tipo_corp === "END" ? { tipo: x.tipoEndosso ?? "C" } : {}), situacao: sit.situacao, motivo_cancelamento: sit.motivo ?? null, vigencia_inicio: x.vigIni, vigencia_fim: x.vigFim, seguradora_id: seg ?? atual.seguradora_id, qtd_parcelas: x.parcelas, numero_apolice: x.numeroApolice ?? atual.numero_apolice, numero_proposta: x.numeroProposta ?? atual.numero_proposta });
          if (premio) { patch.premio_liquido = premio; patch.premio_total = premio; patch.comissao_valor = Math.round(premio * comissaoPct) / 100; }
          if (comissaoPct) patch.comissao_pct = comissaoPct;
        }
        if (!atual?.locatario_id && locatarioId) patch.locatario_id = locatarioId;
        if (!atual?.imobiliaria_principal_id && imobId) patch.imobiliaria_principal_id = imobId;
        if (!atual?.tipo_contratacao && x.tipoContratacao) patch.tipo_contratacao = x.tipoContratacao;
        if (Object.keys(patch).length) await sb.from("erp_documentos").update(patch).eq("id", docId);
      }
      if (modo === "criado") r.criados++; else if (modo === "ligado") r.ligados_ao_corp++; else r.atualizados++;
      if (!o.gravar || !docId) continue;

      await sb.from("erp_chaves_externas").upsert({ sistema: "bitrix", entidade: "documento", entidade_id: docId, chave, dados: { entityTypeId: cfg.entityTypeId, itemId: id } }, { onConflict: "sistema,entidade,chave" });

      // renovação: liga ao documento anterior pelo nº da apólice/proposta citado no card (thread, como o Corp)
      if (x.tipo_corp === "RENV" && (anteriorId || x.anterior.apolice || x.anterior.proposta)) {
        const { data: atualDoc } = await sb.from("erp_documentos").select("documento_renovado_id").eq("id", docId).single();
        if (!atualDoc?.documento_renovado_id && anteriorId && anteriorId !== docId) {
          await sb.from("erp_documentos").update({ documento_renovado_id: anteriorId }).eq("id", docId);
          r.renovacoes_ligadas++;
        } else if (!atualDoc?.documento_renovado_id) {
          // o card cita "apólice anterior" ou "proposta anterior", mas o Corp guarda o nº do título/apólice
          // em numero_apolice — procura as duas referências nas duas colunas
          let ant: { id: string } | null = null;
          for (const ref of [x.anterior.apolice, x.anterior.proposta].filter((v): v is string => !!v)) {
            for (const coluna of ["numero_apolice", "numero_proposta"] as const) {
              ant = (await sb.from("erp_documentos").select("id").eq(coluna, ref).neq("id", docId).order("vigencia_inicio", { ascending: false }).limit(1).maybeSingle()).data;
              if (ant) break;
            }
            if (ant) break;
          }
          if (ant) {
            await sb.from("erp_documentos").update({ documento_renovado_id: ant.id }).eq("id", docId);
            r.renovacoes_ligadas++;
          }
        }
      }

      const { data: itemExistente } = await sb.from("erp_documento_itens").select("id").eq("documento_id", docId).eq("item_n", 1).maybeSingle();
      if (!itemExistente && (x.item || x.partes.length || x.coberturas.length)) {
        const { data: it, error: eIt } = await sb.from("erp_documento_itens").insert({ documento_id: docId, item_n: 1, contrato_inicio: x.vigIni, contrato_fim: x.vigFim, ...(x.item ?? {}) }).select("id").single();
        if (eIt) throw new Error(eIt.message);
        if (x.partes.length) {
          // cadastro de clientes como no Corp (Matheus 27/10): toda parte com CPF/CNPJ válido existe no cadastro (é criada se for nova) e fica ligada
          const partesGravar = [];
          for (const p of x.partes) {
            let pessoa: string | null = p.documento_numero && p.documento_numero === x.cliente.documento ? locatarioId : null;
            if (!pessoa && o.gravar) pessoa = (await garantirCliente(sb, { documento: p.documento_numero, nome: p.nome, fonte: `bitrix:${chave}` }))?.id ?? null;
            partesGravar.push({ ...p, item_id: it.id, locatario_id: pessoa });
          }
          await sb.from("erp_item_partes").insert(partesGravar);
        }
        if (x.coberturas.length) await sb.from("erp_item_coberturas").insert(x.coberturas.map((c) => ({ ...c, item_id: it.id })));
      }

      // partes já gravadas que ainda não têm cliente (o card ganhou o CPF/CNPJ depois): cria o cliente se for novo e liga
      if (o.gravar && x.partes.some((p) => tipoDoDocumento(p.documento_numero))) {
        const { data: it2 } = await sb.from("erp_documento_itens").select("id").eq("documento_id", docId).eq("item_n", 1).maybeSingle();
        if (it2) {
          const { data: soltas } = await sb.from("erp_item_partes").select("id, nome, documento_numero").eq("item_id", it2.id).is("locatario_id", null);
          for (const p of soltas ?? []) {
            const g = await garantirCliente(sb, { documento: p.documento_numero, nome: p.nome, fonte: `bitrix:${chave}` });
            if (g) await sb.from("erp_item_partes").update({ locatario_id: g.id }).eq("id", p.id);
          }
        }
      }

      const eventos = (eventosPorCard.get(id) ?? []).sort((a, b) => a.CREATED_TIME.localeCompare(b.CREATED_TIME)).map((e) => ({ quando: e.CREATED_TIME, categoria: e.CATEGORY_ID, etapa: etapas.get(e.STAGE_ID)?.nome ?? e.STAGE_ID, semantica: e.STAGE_SEMANTIC_ID }));
      const { data: origemAtual } = await sb.from("erp_origens").select("id, comentarios_capturados_em, card_atualizado_em").eq("sistema", "bitrix").eq("entity_type_id", cfg.entityTypeId).eq("item_id", id).maybeSingle();
      let comentarios: unknown[] | undefined;
      if (comentariosRestantes > 0 && (!origemAtual?.comentarios_capturados_em || Date.parse(String(origemAtual.card_atualizado_em ?? 0)) < Date.parse(String(item.updatedTime)))) {
        comentarios = await lerComentarios(cfg.entityTypeId, id);
        comentariosRestantes--;
        r.comentarios_capturados++;
      }
      const { error: eOri } = await sb.from("erp_origens").upsert({
        documento_id: docId, sistema: "bitrix", entity_type_id: cfg.entityTypeId, item_id: id,
        categoria_id: Number(item.categoryId), etapa_id: `${etapas.get(item.stageId)?.nome ?? item.stageId}`, titulo: item.title, url: gerarLinkCard(cfg.entityTypeId, id),
        dados: item, dados_legiveis: dadosLegiveis(item, defs), historico_etapas: eventos,
        card_criado_em: item.createdTime, card_atualizado_em: item.updatedTime, capturado_em: new Date().toISOString(),
        ...(comentarios ? { comentarios, comentarios_capturados_em: new Date().toISOString() } : {}),
      }, { onConflict: "sistema,entity_type_id,item_id" });
      if (eOri) throw new Error(eOri.message);

      if (ehEndosso) {
        const aberto = sit.situacao === "cotacao" || sit.situacao === "proposta";
        const escrever = o.escreverNoBitrix === "todos" || (o.escreverNoBitrix === "abertos" && aberto);
        const v = await vincularEndossoAoPai(sb, { cfg, item, x, docId, seg, escrever });
        if (v.pai) r.endossos_ligados++; else r.endossos_sem_apolice++;
        if (v.avisou) r.avisos_no_bitrix++;
      }
    } catch (e) {
      r.erros.push({ card: id, erro: (e as Error).message });
    }
  }
  return r;
}

// ------------------------------------------------------------ endosso → apólice (nº da apólice do Corp no card)
// Todo card de endosso diz qual apólice altera pelo NÚMERO DA APÓLICE do Corp que já está no card
// (1046: "Número da apólice"; 1048: "Proposta anterior"/"Número da proposta" = nº do título no Corp).
// Matheus 25/10/2026: até o ERP valer (jan/2027) a referência é o Corp, não o Código O2 — sem campo novo.
// Mesma regra de erp_vincular_endossos (seguradora + nº), mas só liga com UMA apólice possível
// (ou uma só cobrindo a data do endosso). Várias ou nenhuma: fica sem pai e, se a escrita no Bitrix
// estiver ligada, comenta no card pedindo o nº certo. Nunca repete o comentário (erp_origens.aviso_vinculo).
type Apolice = { id: string; nosso_numero: number | null; nosso_numero_corp: number | null; numero_apolice: string | null; vigencia_inicio: string | null; vigencia_fim: string | null; origem: string | null };
const COLS_APOLICE = "id, nosso_numero, nosso_numero_corp, numero_apolice, vigencia_inicio, vigencia_fim, origem";
const br = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "?");

/** Escrita no Bitrix pelo webhook de entrada (o mesmo das integrações que criam/atualizam cards). */
async function escreverBitrix(metodo: string, params: Record<string, unknown>): Promise<void> {
  const base = process.env.BITRIX_WEBHOOK_URL;
  if (!base) throw new Error("BITRIX_WEBHOOK_URL não configurada");
  const resp = await fetch(`${base.endsWith("/") ? base : base + "/"}${metodo}.json`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params), cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok || dados.error) throw new Error(`Bitrix ${metodo}: ${dados.error_description || dados.error || `HTTP ${resp.status}`}`);
}

export async function vincularEndossoAoPai(
  sb: SupabaseClient,
  a: { cfg: ConfigSpa; item: BitrixItemRaw; x: Extraido; docId: string; seg: string | null; escrever: boolean },
): Promise<{ pai: Apolice | null; motivo: string | null; avisou: boolean }> {
  const { data: doc } = await sb.from("erp_documentos").select("documento_pai_id").eq("id", a.docId).single();
  let pai: Apolice | null = null;
  let motivo: string | null = null;
  // Cap: o Corp guarda o nº do título em numero_apolice; o card de endosso traz o título atual na "Proposta anterior"
  const numero = a.x.numeroApolice ?? (a.cfg.entityTypeId === 1048 ? a.x.anterior.proposta ?? a.x.numeroProposta : null);

  if (!numero) motivo = "o card não tem o nº da apólice";
  else if (!a.seg) motivo = "o card não tem a seguradora";
  else {
    const bruto = numero.trim();
    const partes = bruto.split(/\s+e\s+|[\/,;]|\s{2,}/i).map((s) => s.trim()).filter(Boolean);
    if (partes.length > 1) motivo = `o card cita mais de uma apólice (${bruto}); cada endosso precisa de um card por apólice`;
    else if (digitos(bruto).replace(/^0+/, "").length < 5) motivo = `o nº da apólice no card (${bruto}) está incompleto`;
    else {
      // o card às vezes traz zeros à esquerda (07764752) que o Corp não guarda (7764752)
      const variantes = [...new Set([bruto, bruto.replace(/[\s.\-]/g, ""), digitos(bruto), digitos(bruto).replace(/^0+/, "")].filter(Boolean))];
      const { data } = await sb.from("erp_documentos").select(COLS_APOLICE).in("tipo", ["A", "F"]).eq("seguradora_id", a.seg)
        .in("numero_apolice", variantes).not("situacao", "in", "(cotacao,proposta,recusado,perdido)").limit(50);
      let cands = (data ?? []) as Apolice[];
      // a apólice do Corp vale mais que o card de produção que ainda não foi ligado a ela
      if (cands.some((c) => c.origem === "corp_import")) cands = cands.filter((c) => c.origem === "corp_import");
      if (cands.length > 1) {
        const dt = a.x.vigIni ?? String(a.item.createdTime).slice(0, 10);
        const cobrem = cands.filter((c) => c.vigencia_inicio && c.vigencia_inicio <= dt && (!c.vigencia_fim || dt <= c.vigencia_fim));
        if (cobrem.length === 1) cands = cobrem;
      }
      if (cands.length === 1) pai = cands[0];
      else motivo = cands.length ? `há ${cands.length} apólices nº ${bruto} dessa seguradora no Corp` : `não achei a apólice nº ${bruto} dessa seguradora no Corp`;
    }
  }

  if (pai && pai.id !== a.docId && pai.id !== doc?.documento_pai_id) {
    const { error } = await sb.from("erp_documentos").update({ documento_pai_id: pai.id }).eq("id", a.docId);
    if (error) throw new Error(error.message);
  }
  if (!a.escrever) return { pai, motivo, avisou: false };

  const chaveAviso = pai ? `ligado:${pai.id}` : `pedir:${motivo}`;
  const id = Number(a.item.id);
  const { data: ori } = await sb.from("erp_origens").select("aviso_vinculo").eq("sistema", "bitrix").eq("entity_type_id", a.cfg.entityTypeId).eq("item_id", id).maybeSingle();
  if (ori?.aviso_vinculo === chaveAviso) return { pai, motivo, avisou: false };
  const texto = pai
    ? `ERP O2: endosso ligado à apólice ${pai.numero_apolice ?? "s/ nº"}${pai.nosso_numero_corp ? ` (nosso nº Corp ${pai.nosso_numero_corp})` : ""}, vigência ${br(pai.vigencia_inicio)} a ${br(pai.vigencia_fim)}.`
    : `ERP O2: não consegui identificar com certeza a apólice deste endosso (${motivo}). Por favor, confira o campo "Número da apólice": um único número, igual ao do Corp.`;
  await escreverBitrix("crm.timeline.comment.add", { fields: { ENTITY_ID: id, ENTITY_TYPE: `dynamic_${a.cfg.entityTypeId}`, COMMENT: texto } });
  await sb.from("erp_origens").update({ aviso_vinculo: chaveAviso, aviso_vinculo_em: new Date().toISOString() }).eq("sistema", "bitrix").eq("entity_type_id", a.cfg.entityTypeId).eq("item_id", id);
  return { pai, motivo, avisou: true };
}

async function lerComentarios(entityTypeId: number, itemId: number): Promise<{ quando: string; autor: number | null; texto: string }[]> {
  try {
    const resp = await chamarBitrix<{ result: { COMMENT?: string; CREATED?: string; AUTHOR_ID?: string | number }[] }>("crm.timeline.comment.list", {
      "filter[ENTITY_ID]": itemId, "filter[ENTITY_TYPE]": `dynamic_${entityTypeId}`, "select[]": ["ID", "COMMENT", "CREATED", "AUTHOR_ID"],
    } as never);
    return (resp.result ?? [])
      .map((c) => ({ quando: c.CREATED ?? "", autor: c.AUTHOR_ID ? Number(c.AUTHOR_ID) : null, texto: (c.COMMENT ?? "").replace(/\[\/?[A-Z]+[^\]]*\]/g, "").trim() }))
      .filter((c) => c.texto).sort((a, b) => a.quando.localeCompare(b.quando));
  } catch { return []; }
}
