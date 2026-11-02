import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";

// Cubos de COBERTURAS e de SINISTROS do Robô O2 (02/11/2026), ao lado do cubo de prêmio/aluguel (roboAnalises.ts).
// - chat_cubo_coberturas: coberturas de cada item das apólices do ERP (importância segurada, taxa, prêmio, franquia) x produto x seguradora x imobiliária x bairro x faixa de aluguel x mês.
// - chat_cubo_sinistros: cada sinistro do Corp (3.467) ligado à apólice do ERP pelo nosso nº do Corp (91%): valor avisado, indenizado, despesas x produto x subtipo x seguradora x cobertura x imobiliária x bairro x mês de ocorrência x mês da apólice.
// - Sinistralidade = indenizado ÷ prêmio total das apólices da MESMA coorte (mesmo mês de início da apólice) e dos mesmos filtros. Capitalização (resgates) fica fora.
// Atualizados de hora em hora junto com o cubo principal (chat_cubo_atualizar).

const compacto = (o: unknown) => JSON.stringify(o, (_k, v) => (v === null ? undefined : v));
const mesParaData = (m?: string) => (m && /^\d{4}-\d{2}$/.test(m) ? `${m}-01` : undefined);

type Linha = Record<string, unknown>;

async function resolverEntidades(imobiliaria: string | undefined, p: Record<string, unknown>): Promise<string | null> {
  if (!imobiliaria) return null;
  const { resolverImobiliarias } = await import("./roboFerramentas");
  const { fichas, grupo, ambiguo } = await resolverImobiliarias(imobiliaria);
  if (!fichas.length) return JSON.stringify({ encontrou: false, observacao: "Imobiliária não encontrada no banco único." });
  if (ambiguo) return JSON.stringify({ erro: "Nome de imobiliária ambíguo; peça um nome mais específico." });
  p.entidade_ids = [...new Set(fichas.map((f) => f.grupo_id ?? f.id))];
  p.imobiliariaConsiderada = grupo ?? fichas.map((f) => f.nome).join("; ");
  return null;
}

// ------------------------------------------------------------------ COBERTURAS
export const FERRAMENTA_CUBO_COBERTURAS: Anthropic.Tool = {
  name: "consultar_cubo_coberturas",
  description:
    "ESTATÍSTICAS DE COBERTURAS das apólices do ERP (cubo pronto, atualizado de hora em hora): quantidade de itens com cada cobertura, importância segurada média, taxa média, prêmio da cobertura, franquia média e aluguel médio, cruzando produto, cobertura, seguradora, imobiliária/grupo, bairro, cidade, faixa de aluguel, status da apólice e período (mês de início da vigência). Use para 'importância segurada média por cobertura', 'quais coberturas mais contratadas na Fiança', 'cobertura de IPTU/condomínio por faixa de aluguel'. Só existe cobertura detalhada em parte das apólices (cerca de 1.470 documentos, quase todos Fiança: aluguel, IPTU, condomínio, água...); o retorno traz 'cobertura' com o que ficou sem dado, e bairro quase não existe aqui: avise.",
  input_schema: {
    type: "object",
    properties: {
      agrupar: { type: "array", items: { type: "string", enum: ["mes", "trimestre", "semestre", "ano", "produto", "status", "seguradora", "entidade_nome", "bairro", "cidade", "faixa_aluguel", "cobertura"] }, description: "Colunas para agrupar. Vazio = só o total." },
      produto: { type: "string" },
      cobertura: { type: "string", description: "Parte do nome da cobertura (ex.: IPTU, CONDOMÍNIO, ALUGUEL, ÁGUA, LUZ)." },
      seguradora: { type: "string" },
      imobiliaria: { type: "string", description: "Nome da imobiliária ou grupo." },
      status: { type: "string", description: "vigente, vencido, cancelado." },
      bairro: { type: "string" },
      cidade: { type: "string" },
      faixa_aluguel: { type: "string" },
      mes_de: { type: "string", description: "AAAA-MM." },
      mes_ate: { type: "string", description: "AAAA-MM." },
      limite: { type: "integer" },
    },
  },
};

type EntradaCob = { agrupar?: string[]; produto?: string; cobertura?: string; seguradora?: string; imobiliaria?: string; status?: string; bairro?: string; cidade?: string; faixa_aluguel?: string; mes_de?: string; mes_ate?: string; limite?: number };

export async function consultarCuboCoberturas(e: EntradaCob): Promise<string> {
  const p: Record<string, unknown> = { ...e, mes_de: mesParaData(e.mes_de), mes_ate: mesParaData(e.mes_ate) };
  if ((e.mes_de && !p.mes_de) || (e.mes_ate && !p.mes_ate)) return JSON.stringify({ erro: "Use meses no formato AAAA-MM." });
  if (e.produto) p.produto = e.produto.toLowerCase() === "re" ? "incendio" : e.produto.toLowerCase();
  const falha = await resolverEntidades(e.imobiliaria, p);
  if (falha) return falha;
  delete p.imobiliaria;
  const { data, error } = await createServiceClient().rpc("chat_cubo_cob_consultar", { p });
  if (error) return `Erro: ${error.message}`;
  const r = data as { linhas: Linha[]; total: Record<string, number>; atualizadoEm: string | null };
  const t = r.total ?? {};
  return compacto({
    filtros: { ...e, imobiliaria: p.imobiliariaConsiderada ?? e.imobiliaria },
    total: t,
    linhas: r.linhas ?? [],
    cobertura: { itensComCobertura: t.itens_com_cobertura, comBairro: t.com_bairro, comAluguel: t.com_aluguel, comImportanciaSegurada: t.com_importancia_segurada },
    cuboAtualizadoEm: r.atualizadoEm,
    avisos: [
      "Coberturas detalhadas existem em apenas uma pequena parte das apólices (cerca de 1.470 documentos, quase todos Fiança). Diga isso ao usuário: não é a carteira toda.",
      "'apolices_somadas_por_grupo' soma documentos por grupo; uma apólice com várias coberturas aparece em cada uma, então não some entre coberturas.",
      "Prêmio e taxa por cobertura quase não vêm preenchidos na Fiança (só a importância segurada); não afirme prêmio por cobertura quando vier vazio.",
    ],
  });
}

// ------------------------------------------------------------------ SINISTROS
export const FERRAMENTA_CUBO_SINISTROS: Anthropic.Tool = {
  name: "consultar_cubo_sinistros",
  description:
    "ESTATÍSTICAS DE SINISTROS e INDENIZAÇÕES (cubo pronto, atualizado de hora em hora; fonte: sinistros do Corp ligados à apólice do ERP): quantidade, valor avisado, valor indenizado, indenização média e despesas, cruzando produto, subtipo, situação, seguradora, cobertura, imobiliária/grupo, bairro, cidade, faixa de aluguel, mês de ocorrência e mês de início da apólice. Com sinistralidade=true calcula também o PRÊMIO das apólices da mesma coorte e a SINISTRALIDADE (indenizado ÷ prêmio total), podendo agrupar por produto, seguradora, imobiliária, bairro, cidade, faixa de aluguel e ano/mês da apólice. Use para 'quanto foi indenizado na Fiança por seguradora', 'sinistralidade da imobiliária X', 'indenização média por faixa de aluguel', 'sinistros por cobertura'. IMPORTANTE: 'capitalizacao' no Corp são RESGATES, não sinistro de risco: nunca entram na sinistralidade; mostre à parte se o usuário pedir. Só ~9% dos sinistros de seguro têm bairro; o retorno traz 'cobertura' para avisar.",
  input_schema: {
    type: "object",
    properties: {
      agrupar: { type: "array", items: { type: "string", enum: ["mes", "trimestre", "semestre", "ano", "mes_apolice", "ano_apolice", "produto", "subtipo", "situacao", "seguradora", "cobertura", "entidade_nome", "bairro", "cidade", "faixa_aluguel", "com_apolice"] }, description: "Colunas para agrupar. mes/ano = ocorrência do sinistro; mes_apolice/ano_apolice = início da vigência da apólice. Vazio = só o total." },
      produto: { type: "string", description: "fianca, incendio, automovel, condominio, residencial, empresarial, vida, rc... ('capitalizacao' = resgates)." },
      subtipo: { type: "string" },
      situacao: { type: "string" },
      seguradora: { type: "string", description: "TOKIO, PORTO, POTTENCIAL, YELUM, TOO, ALLIANZ..." },
      cobertura: { type: "string" },
      imobiliaria: { type: "string", description: "Nome da imobiliária ou grupo." },
      bairro: { type: "string" },
      cidade: { type: "string" },
      faixa_aluguel: { type: "string" },
      mes_de: { type: "string", description: "AAAA-MM: ocorrência do sinistro (início)." },
      mes_ate: { type: "string", description: "AAAA-MM: ocorrência do sinistro (fim)." },
      mes_apolice_de: { type: "string", description: "AAAA-MM: início de vigência da apólice (início)." },
      mes_apolice_ate: { type: "string", description: "AAAA-MM: início de vigência da apólice (fim)." },
      sinistralidade: { type: "boolean", description: "true = soma o prêmio das apólices da mesma coorte e calcula indenizado ÷ prêmio. Não aceita agrupar por mes/cobertura/subtipo/situacao." },
      limite: { type: "integer" },
    },
  },
};

type EntradaSin = {
  agrupar?: string[]; produto?: string; subtipo?: string; situacao?: string; seguradora?: string; cobertura?: string; imobiliaria?: string; bairro?: string; cidade?: string; faixa_aluguel?: string;
  mes_de?: string; mes_ate?: string; mes_apolice_de?: string; mes_apolice_ate?: string; sinistralidade?: boolean; limite?: number;
};

// dimensões que existem nos dois cubos (sinistros e prêmio das apólices): coluna no cubo de sinistros -> coluna no cubo principal
const DIM_COMUM: Record<string, string> = { produto: "produto", seguradora: "seguradora", entidade_nome: "entidade_nome", bairro: "bairro", cidade: "cidade", faixa_aluguel: "faixa_aluguel", ano_apolice: "ano", mes_apolice: "mes" };

export async function consultarCuboSinistros(e: EntradaSin): Promise<string> {
  const mesesInvalidos = (["mes_de", "mes_ate", "mes_apolice_de", "mes_apolice_ate"] as const).some((k) => e[k] && !/^\d{4}-\d{2}$/.test(e[k]!));
  if (mesesInvalidos) return JSON.stringify({ erro: "Use meses no formato AAAA-MM." });
  const p: Record<string, unknown> = { ...e, mes_de: mesParaData(e.mes_de), mes_ate: mesParaData(e.mes_ate), mes_apolice_de: mesParaData(e.mes_apolice_de), mes_apolice_ate: mesParaData(e.mes_apolice_ate) };
  if (e.produto) p.produto = e.produto.toLowerCase() === "re" ? "incendio" : e.produto.toLowerCase();
  const falha = await resolverEntidades(e.imobiliaria, p);
  if (falha) return falha;
  delete p.imobiliaria;
  delete p.sinistralidade;

  const sb = createServiceClient();
  const agrupar = e.agrupar ?? [];
  if (e.sinistralidade) {
    const naoComum = agrupar.filter((a) => !(a in DIM_COMUM));
    if (naoComum.length) return JSON.stringify({ erro: `Sinistralidade só agrupa por produto, seguradora, imobiliária, bairro, cidade, faixa de aluguel e mês/ano da apólice. Remova: ${naoComum.join(", ")}.` });
    if (!e.produto) p.excluir_produto = "capitalizacao";
    else if (String(p.produto) === "capitalizacao") return JSON.stringify({ erro: "Capitalização no Corp são resgates, não sinistro de risco: não há sinistralidade." });
  }
  const { data, error } = await sb.rpc("chat_cubo_sin_consultar", { p });
  if (error) return `Erro: ${error.message}`;
  const r = data as { linhas: Linha[]; total: Record<string, number>; atualizadoEm: string | null };
  const t = r.total ?? {};
  const aviso: string[] = [
    "Fonte: sinistros do Corp ligados à apólice do ERP pelo nosso nº do Corp (cerca de 91% ligam). Valor indenizado = o que o Corp registra como pago; valor avisado = o que foi pedido no aviso.",
    "'capitalizacao' no Corp são resgates de título, não sinistro de risco.",
  ];
  let linhas = r.linhas ?? [];
  let sinist: Linha | undefined;

  if (e.sinistralidade) {
    // prêmio das apólices da mesma coorte (início da vigência), mesmos filtros, mesmas dimensões
    const pp: Record<string, unknown> = { fato: "apolice", agrupar: agrupar.map((a) => DIM_COMUM[a]), limite: 300 };
    for (const k of ["produto", "seguradora", "bairro", "cidade", "faixa_aluguel", "entidade_ids"] as const) if (p[k] !== undefined) pp[k] = p[k];
    if (p.entidade_ids) pp.entidade_ids = p.entidade_ids;
    if (p.excluir_produto) pp.excluir_produto = p.excluir_produto;
    pp.mes_de = p.mes_apolice_de;
    pp.mes_ate = p.mes_apolice_ate;
    const { data: dp, error: ep } = await sb.rpc("chat_cubo_consultar", { p: pp });
    if (ep) return `Erro: ${ep.message}`;
    const premios = (dp as { linhas: Linha[]; total: Record<string, number> }) ?? { linhas: [], total: {} };
    const chave = (o: Linha, mapa: (a: string) => string) => agrupar.map((a) => String(o[mapa(a)] ?? "")).join("|");
    const premioPor = new Map(premios.linhas.map((o) => [chave(o, (a) => DIM_COMUM[a]), o]));
    const taxa = (ind: unknown, pr: unknown) => (Number(pr) > 0 ? Math.round((Number(ind) / Number(pr)) * 1000) / 10 : null);
    if (agrupar.length) {
      linhas = linhas.map((o) => {
        const pr = premioPor.get(chave(o, (a) => a));
        return { ...o, premio_total_apolices: pr?.premio_total ?? null, apolices: pr?.qtd ?? null, sinistralidade_percentual: taxa(o.valor_indenizado, pr?.premio_total) };
      });
    } else {
      sinist = { premio_total_apolices: premios.total?.premio_total ?? null, apolices: premios.total?.qtd ?? null, sinistralidade_percentual: taxa(t.valor_indenizado, premios.total?.premio_total) };
    }
    aviso.push(
      "SINISTRALIDADE = valor indenizado ÷ prêmio total das apólices da MESMA coorte (mesmo mês/ano de início de vigência e mesmos filtros), em %. É uma medida indicativa: o prêmio é o das apólices que estão no ERP, e coortes recentes ainda vão acumular sinistros.",
      "Sinistros sem apólice ligada ficam sem imobiliária/bairro/coorte e podem não entrar em recortes: veja 'cobertura.ligadosAApolice'."
    );
  }

  return compacto({
    filtros: { ...e, imobiliaria: p.imobiliariaConsiderada ?? e.imobiliaria },
    total: { ...t, ...(sinist ?? {}) },
    linhas,
    cobertura: { totalDeSinistros: t.sinistros, ligadosAApolice: t.ligados_a_apolice, comBairro: t.com_bairro, comFaixaDeAluguel: t.com_faixa_aluguel },
    cuboAtualizadoEm: r.atualizadoEm,
    avisos: aviso,
  });
}

export async function executarFerramentaRisco(nome: string, entrada: unknown): Promise<string | null> {
  try {
    if (nome === FERRAMENTA_CUBO_COBERTURAS.name) return await consultarCuboCoberturas(entrada as EntradaCob);
    if (nome === FERRAMENTA_CUBO_SINISTROS.name) return await consultarCuboSinistros(entrada as EntradaSin);
  } catch (err) {
    return `Erro no cubo: ${err instanceof Error ? err.message : String(err)}`;
  }
  return null;
}
