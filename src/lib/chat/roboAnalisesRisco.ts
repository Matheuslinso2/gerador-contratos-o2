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

// ------------------------------------------------------------------ FINANCEIRO: repasses (equipe) e receita realizada/banco/DAS (só financeiro da O2)
export const FERRAMENTA_CUBO_FINANCEIRO: Anthropic.Tool = {
  name: "consultar_cubo_financeiro",
  description:
    "CUBO FINANCEIRO (atualizado de hora em hora): REPASSES às imobiliárias (repasse_erp e repasse_corp: liberados a toda a equipe) e, só para o financeiro da O2 (Matheus, William, Nathalie e Vanessa), a comissão RECEBIDA (receita, baixas do ERP), o repasse pago pelo banco e o DAS devido, tudo por mês, produto, ramo (IMOBILIARIO = incêndio imobiliário, 2 IMOBILIARIO), seguradora e imobiliária/grupo. Quatro fatos que NUNCA se somam entre si: receita (comissão recebida), repasse_erp (repasse gerado pelo ERP: bruto, retido e líquido; em 2026 está tudo 'pendente'), repasse_corp (controle do Corp: status pago = tem data de repasse; previsto = sem data) e repasse_pago_banco (o que o Nibo/banco pagou à imobiliária, SEM divisão por produto: ramo '(todos os produtos)'). Use para 'quanto foi repassado ao grupo X no ano', 'receita do incêndio imobiliário', 'repasse previsto x pago'. Repasse PAGO por produto: repasse_corp status pago; total pago à imobiliária: repasse_pago_banco; diga qual fonte usou e o que não existe por produto. A coluna das_devido_estimado (só no fato receita) é o DAS que a receita GEROU, estimado pela alíquota efetiva do Simples Nacional (Anexo III) do mês de cada empresa, calculada sobre o RBT12 = soma da comissão recebida dos 12 meses anteriores (hoje cerca de 16,4% a 17,4% na O2 Corretora e 14,6% a 15,6% na O2 Capitalização). É imposto DEVIDO estimado, NUNCA imposto pago: o pago vem de consultar_impostos_pagos (muitas guias estão em aberto). Dimensão empresa = O2 Corretora | O2 Capitalização (empresa do documento).",
  input_schema: {
    type: "object",
    properties: {
      agrupar: { type: "array", items: { type: "string", enum: ["fato", "mes", "trimestre", "semestre", "ano", "produto", "ramo", "status", "seguradora", "empresa", "entidade_nome"] }, description: "Colunas para agrupar. Agrupe sempre por fato (e status) para não misturar fontes." },
      empresa: { type: "string", enum: ["O2 Corretora", "O2 Capitalização"], description: "Empresa (CNPJ) do documento." },
      fato: { type: "string", enum: ["receita", "repasse_erp", "repasse_corp", "repasse_pago_banco"] },
      produto: { type: "string", description: "fianca, incendio, capitalizacao, automovel, condominio, vida..." },
      ramo: { type: "string", description: "Parte do nome do ramo: IMOBILIARIO (incêndio imobiliário), RESIDENCIAL, EMPRESARIAL, FIANÇA, CAPITALIZAÇÃO..." },
      status: { type: "string", description: "recebida | pendente | pago | previsto | cancelado" },
      seguradora: { type: "string" },
      imobiliaria: { type: "string", description: "Nome da imobiliária ou grupo (todas as fichas do grupo)." },
      mes_de: { type: "string", description: "AAAA-MM." },
      mes_ate: { type: "string", description: "AAAA-MM." },
      limite: { type: "integer" },
    },
  },
};

type EntradaFin = { agrupar?: string[]; empresa?: string; fato?: string; produto?: string; ramo?: string; status?: string; seguradora?: string; imobiliaria?: string; mes_de?: string; mes_ate?: string; limite?: number };

// Nível 1 (toda a equipe): repasses das apólices (repasse_erp e repasse_corp). Nível 3 (financeiro): também receita realizada, repasse pago pelo banco (Nibo) e DAS devido.
const FATOS_DO_FINANCEIRO = ["receita", "repasse_pago_banco"];

export async function consultarCuboFinanceiro(e: EntradaFin, verFinanceiro: boolean): Promise<string> {
  if (!verFinanceiro && e.fato && FATOS_DO_FINANCEIRO.includes(e.fato)) {
    return JSON.stringify({ erro: "Receita realizada e repasse pago pelo banco (Nibo) são do financeiro da O2 (Matheus, William, Nathalie e Vanessa). Os repasses das apólices (repasse_erp e repasse_corp) estão liberados." });
  }
  const p: Record<string, unknown> = { ...e, mes_de: mesParaData(e.mes_de), mes_ate: mesParaData(e.mes_ate) };
  if (!verFinanceiro) p.excluir_fatos = FATOS_DO_FINANCEIRO;
  if ((e.mes_de && !p.mes_de) || (e.mes_ate && !p.mes_ate)) return JSON.stringify({ erro: "Use meses no formato AAAA-MM." });
  if (e.produto) p.produto = e.produto.toLowerCase() === "re" ? "incendio" : e.produto.toLowerCase();
  const falha = await resolverEntidades(e.imobiliaria, p);
  if (falha) return falha;
  delete p.imobiliaria;
  const { data, error } = await createServiceClient().rpc("chat_cubo_fin_consultar", { p });
  if (error) return `Erro: ${error.message}`;
  const r = data as { linhas: Linha[]; total: Record<string, number>; atualizadoEm: string | null };
  return compacto({
    filtros: { ...e, imobiliaria: p.imobiliariaConsiderada ?? e.imobiliaria },
    total: r.total,
    linhas: r.linhas ?? [],
    cuboAtualizadoEm: r.atualizadoEm,
    avisos: [
      "Quatro fatos que NÃO se somam: receita (comissão recebida), repasse_erp (gerado no ERP), repasse_corp (controle do Corp) e repasse_pago_banco (pago pelo Nibo/banco, sem produto). Nunca some fatos diferentes.",
      "Em 2026 o ERP ainda não registra repasse como 'pago' (tudo pendente): o repasse efetivamente pago está no banco (por imobiliária, sem produto) e no Corp (status 'pago' = com data de repasse). Diga qual fonte usou e o que ficou sem dado.",
      "das_devido_estimado = comissão recebida x alíquota efetiva do Simples (Anexo III) do mês da empresa, pelo RBT12 (soma dos 12 meses anteriores de comissão recebida). É o imposto que a receita gerou (devido, estimado), NÃO o pago: muitas guias estão em aberto; para o pago use consultar_impostos_pagos e compare. Só cobre o DAS: o ISS retido na fonte pelas seguradoras e o IR indevido retido são outra coisa. valor_retido do repasse_erp é a retenção sobre o repasse.",
      "A alíquota efetiva é a mesma validada antes (Anexo III pelo RBT12); só existe para meses com 12 meses anteriores de baixa. Mês sem alíquota fica sem estimativa.",
      "Mês do repasse_erp = competência; do repasse_corp = data do repasse (ou previsão); da receita = data do recebimento; do banco = mês do pagamento.",
    ],
  });
}

// ------------------------------------------------------------------ IMPOSTOS PAGOS (Nibo) — só financeiro da O2
export const FERRAMENTA_IMPOSTOS_PAGOS: Anthropic.Tool = {
  name: "consultar_impostos_pagos",
  description:
    "IMPOSTOS REALMENTE PAGOS (só financeiro da O2: Matheus, William, Nathalie e Vanessa; fonte: pagamentos lançados no Nibo, atualizado de hora em hora), por mês de pagamento, empresa (corretora | capitalizacao) e tipo: DAS (Simples Nacional), ISS, IRPJ/CSLL, PIS/COFINS, contribuição sindical, parcelamento tributário e folha (INSS/FGTS). Use para 'quanto de imposto foi pago', 'o DAS de tal mês foi pago?', 'impostos pagos no ano'. IMPORTANTE: imposto PAGO não se calcula por taxa e não se divide por produto: muitas guias (DAS) publicadas pela contabilidade (Onvio) estão em aberto, então mês sem pagamento de DAS aqui = guia não paga. O imposto DEVIDO estimado sobre a receita de um produto/imobiliária está em consultar_cubo_financeiro (das_devido_estimado, alíquota efetiva do Simples pelo RBT12): apresente os dois lado a lado e nunca chame o estimado de pago.",
  input_schema: {
    type: "object",
    properties: {
      agrupar: { type: "array", items: { type: "string", enum: ["mes", "trimestre", "semestre", "ano", "empresa", "tipo_imposto", "categoria"] }, description: "Colunas para agrupar. Para ver meses sem pagamento de DAS agrupe por mes e tipo_imposto." },
      empresa: { type: "string", enum: ["corretora", "capitalizacao"] },
      tipo_imposto: { type: "string", description: "DAS (Simples Nacional) | ISS | IRPJ/CSLL | PIS/COFINS | contribuição sindical | parcelamento tributário | folha (INSS/FGTS)" },
      mes_de: { type: "string", description: "AAAA-MM." },
      mes_ate: { type: "string", description: "AAAA-MM." },
    },
  },
};

type EntradaImp = { agrupar?: string[]; empresa?: string; tipo_imposto?: string; mes_de?: string; mes_ate?: string };

export async function consultarImpostosPagos(e: EntradaImp): Promise<string> {
  const p: Record<string, unknown> = { ...e, mes_de: mesParaData(e.mes_de), mes_ate: mesParaData(e.mes_ate) };
  if ((e.mes_de && !p.mes_de) || (e.mes_ate && !p.mes_ate)) return JSON.stringify({ erro: "Use meses no formato AAAA-MM." });
  const { data, error } = await createServiceClient().rpc("chat_cubo_imp_consultar", { p });
  if (error) return `Erro: ${error.message}`;
  const r = data as { linhas: Linha[]; total: Record<string, number>; atualizadoEm: string | null };
  return compacto({
    filtros: e,
    total: r.total,
    linhas: r.linhas ?? [],
    cuboAtualizadoEm: r.atualizadoEm,
    avisos: [
      "Só aparece o que foi PAGO e lançado no Nibo (data do pagamento). Guia publicada pela contabilidade (Onvio) e não paga não aparece: mês sem DAS pago = guia em aberto, e não 'imposto zero'.",
      "Não dá para atribuir imposto pago a produto ou imobiliária (o DAS incide sobre o faturamento da empresa). O valor de cada guia emitida pela Onvio está nos PDFs das guias, que ainda não estão na base: diga que o valor devido por mês não está disponível.",
      "Pagamentos atrasados entram no mês em que foram pagos, não no da competência (ex.: DAS de dezembro/2025 pago em abril e junho/2026).",
    ],
  });
}

export async function executarFerramentaRisco(nome: string, entrada: unknown, verFinanceiro = false): Promise<string | null> {
  try {
    if (nome === FERRAMENTA_CUBO_COBERTURAS.name) return await consultarCuboCoberturas(entrada as EntradaCob);
    if (nome === FERRAMENTA_CUBO_SINISTROS.name) return await consultarCuboSinistros(entrada as EntradaSin);
    const negado = "Imposto, DAS, Nibo e receita realizada são do financeiro da O2 (Matheus, William, Nathalie e Vanessa) e não estão liberados para este perfil.";
    if (nome === FERRAMENTA_CUBO_FINANCEIRO.name) return await consultarCuboFinanceiro(entrada as EntradaFin, verFinanceiro);
    if (nome === FERRAMENTA_IMPOSTOS_PAGOS.name) return verFinanceiro ? await consultarImpostosPagos(entrada as EntradaImp) : negado;
  } catch (err) {
    return `Erro no cubo: ${err instanceof Error ? err.message : String(err)}`;
  }
  return null;
}
