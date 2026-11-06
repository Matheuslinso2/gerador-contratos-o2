// Comissão da equipe comercial pela regra de 06/11/2026 (Painel Comercial → Meta e Comissões Equipe).
// Função pura: cruza o que a equipe preencheu no Bitrix (calls, "Data de cotação", Resultado Financeiro da Empresa) com a
// evidência do Workspace (cotações e efetivações da produção unificada) e devolve, por linha, o motivo do crédito, a competência,
// o valor e a situação da conferência. Nada aqui grava em lugar nenhum.
//
// Gatilhos (valores e competências do documento do Matheus):
//  1. Call/visita que gerou cotação: R$ 50 no mês da PRIMEIRA cotação nova validada, vinculada à reunião.
//  2. Efetivação de negócio novo: R$ 50 no mês da PRIMEIRA efetivação elegível (pode pontuar sem call; soma com o gatilho 1).
//  3. Elite de Crescimento (Fiança e Capitalização): 0,5% sobre o excedente positivo da comissão O2 no ENCERRAMENTO da campanha.
// Só o preenchimento da equipe no Bitrix + a comprovação no Workspace colocam o crédito no total validado.

import type { BaseComissaoEquipe } from "./construir";

export type ProdutoBase = "fianca" | "re" | "capitalizacao";

export const VALOR_CREDITO = 50;
export const PCT_ELITE_CRESCIMENTO = 0.005;
export const META_ACOMPANHAMENTO_ELITE = 0.4; // só acompanhamento: qualquer crescimento positivo gera incentivo

const PRODUTO_DE_TIPO: Record<string, ProdutoBase> = { Fiança: "fianca", Incêndio: "re", Capitalização: "capitalizacao" };
export const ROTULO_PRODUTO: Record<ProdutoBase, string> = { fianca: "Fiança", re: "Incêndio / Ramos Elementares", capitalizacao: "Capitalização" };

/** Cotação ou efetivação do Workspace (produção unificada), já vinculada a uma imobiliária. */
export type EvidenciaWS = {
  id: string;
  chave: string | null;
  imobiliariaId: string;
  produto: string;
  tipo: string; // novo | renovacao
  status: string; // status_padrao
  dataCotacao: string | null; // data_recebimento
  dataEfetivacao: string | null;
  comissao: number | null;
  origemBitrixId: string | null;
  fonte: string;
};

export type Situacao =
  | "Comissão validada"
  | "Paga"
  | "Preenchimento pendente no Bitrix"
  | "Aguardando comprovação no Workspace"
  | "Divergência Bitrix × Workspace"
  | "Vínculo pendente"
  | "Aguardando efetivação"
  | "Sem crédito";

export type Gatilho = "cotacao" | "efetivacao" | "elite";

export type LinhaComissao = {
  id: string;
  vendedora: string;
  imobiliariaId: string | null;
  imobiliaria: string;
  empresaId: string;
  funilCampanha: string;
  produto: string;
  gatilho: Gatilho;
  motivo: string;
  competencia: string | null; // AAAA-MM
  valor: number;
  situacao: Situacao;
  validado: boolean; // entra no total validado
  detalhe: string; // campo faltante / dados das duas fontes / candidatos
  card: number | null;
  idsWorkspace: string[];
  historico: string[]; // recusas e recotações da mesma demanda (não pagam de novo)
};

export type EntradaComissao = {
  base: BaseComissaoEquipe;
  imobPorEmpresa: Map<string, string>; // empresa do Bitrix -> imobiliária (vínculo confirmado)
  nomeImob: Map<string, string>;
  evidencias: EvidenciaWS[];
  eliteImobs: Set<string>; // imobiliárias na campanha Elite (Fiança/Capitalização seguem a regra de crescimento)
  pagas: string[]; // quem recebe a comissão individual
  competenciaInicial: string; // AAAA-MM: antes disso a regra antiga/fechada vale
  paga?: (linha: LinhaComissao) => boolean; // confirmação financeira (futuro)
};

const dataValida = (s: string | null | undefined): s is string => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ano = Number(s.slice(0, 4));
  return ano >= 2025 && ano <= 2030 && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
};
const mesDe = (s: string | null) => (s ? s.slice(0, 7) : null);
const brData = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "—");
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** 0,5% sobre o excedente positivo da comissão total O2 da imobiliária em relação à referência histórica aprovada. */
export function incentivoEliteCrescimento(referencia: number, fechamento: number): { excedente: number; crescimento: number | null; incentivo: number } {
  const excedente = Math.max(0, fechamento - referencia);
  return { excedente, crescimento: referencia > 0 ? fechamento / referencia - 1 : null, incentivo: Math.round(excedente * PCT_ELITE_CRESCIMENTO * 100) / 100 };
}

export function calcularComissaoEquipe(entrada: EntradaComissao): LinhaComissao[] {
  const { base, imobPorEmpresa, nomeImob, evidencias, eliteImobs, pagas, competenciaInicial } = entrada;
  const linhas: LinhaComissao[] = [];
  let seq = 0;
  const nomeDa = (imob: string | null, fallback: string) => (imob ? (nomeImob.get(imob) ?? fallback) : fallback);

  const novas = evidencias.filter((e) => e.tipo === "novo");
  const donoDe = (card: { vendedora: string }) => card.vendedora;
  const cardsDosPagos = base.cards.filter((c) => pagas.includes(donoDe(c)));

  // Oportunidade = (imobiliária, produto). A responsável é a do card do Sucesso (ou, na falta, a do primeiro card).
  type Oportunidade = { imob: string; empresaId: string; produto: ProdutoBase; vendedora: string; cards: typeof base.cards; cliente: string };
  const oportunidades = new Map<string, Oportunidade>();
  for (const c of cardsDosPagos) {
    const imob = imobPorEmpresa.get(c.empresaId);
    if (!imob) continue;
    for (const nome of c.produtos) {
      const produto = PRODUTO_DE_TIPO[nome];
      if (!produto) continue;
      const chave = `${imob}|${produto}`;
      const o = oportunidades.get(chave);
      if (!o) oportunidades.set(chave, { imob, empresaId: c.empresaId, produto, vendedora: c.vendedora, cards: [c], cliente: c.cliente });
      else o.cards.push(c);
    }
  }
  for (const o of oportunidades.values()) o.vendedora = (o.cards.find((c) => c.funil === "Sucesso") ?? o.cards[0]).vendedora;
  const elite = (imob: string, produto: string) => eliteImobs.has(imob) && (produto === "fianca" || produto === "capitalizacao");
  const novaLinha = (p: Omit<LinhaComissao, "id" | "validado">): LinhaComissao => {
    seq++;
    const l: LinhaComissao = { ...p, id: `C${seq}`, validado: p.situacao === "Comissão validada" || p.situacao === "Paga" };
    if (l.validado && entrada.paga?.(l)) l.situacao = "Paga";
    linhas.push(l);
    return l;
  };

  // ----- Gatilho 1: calls/visitas que geraram cotação -----
  const callsGeraramCotacao = base.calls.filter((e) => e.realizada && !e.treino && e.resultadoId === "3274" && pagas.includes(e.vendedora) && e.data >= `${competenciaInicial}-01`); // CRM confiável desde out/26
  const primeiraCallPorCard = new Map<string, (typeof base.calls)[number]>();
  for (const e of [...callsGeraramCotacao].sort((a, b) => a.data.localeCompare(b.data))) if (!primeiraCallPorCard.has(e.card)) primeiraCallPorCard.set(e.card, e);

  // primeira cotação nova de cada (imobiliária, produto) após a call -> quais oportunidades disputam a mesma?
  type Alvo = { call: (typeof base.calls)[number]; card: (typeof base.cards)[number] | undefined; imob: string | null; produto: ProdutoBase | null };
  const alvos: Alvo[] = [];
  for (const call of primeiraCallPorCard.values()) {
    const card = base.cards.find((c) => c.card === call.card);
    const imob = imobPorEmpresa.get(call.empresaId) ?? null;
    const produtos = (card?.produtos ?? []).map((n) => PRODUTO_DE_TIPO[n]).filter(Boolean) as ProdutoBase[];
    if (!produtos.length) alvos.push({ call, card, imob, produto: null });
    else for (const p of produtos) alvos.push({ call, card, imob, produto: p });
  }
  const primeiraCotacao = (imob: string, produto: string, desde: string) => {
    const lista = novas
      .filter((e) => e.imobiliariaId === imob && e.produto === produto && dataValida(e.dataCotacao) && e.dataCotacao >= desde)
      .sort((a, b) => (a.dataCotacao as string).localeCompare(b.dataCotacao as string));
    if (!lista.length) return { primeira: null as EvidenciaWS | null, mesmoDia: [] as EvidenciaWS[], todas: lista };
    const dia = lista[0].dataCotacao;
    return { primeira: lista[0], mesmoDia: lista.filter((e) => e.dataCotacao === dia), todas: lista };
  };
  const disputa = new Map<string, number>();
  for (const a of alvos) if (a.imob && a.produto) disputa.set(`${a.imob}|${a.produto}`, (disputa.get(`${a.imob}|${a.produto}`) ?? 0) + 1);

  for (const a of alvos) {
    const { call, card, imob } = a;
    const funilCamp = card?.campanha ? `${card.funil} · ${card.campanha}` : (card?.funil ?? call.funil);
    const comum = { vendedora: call.vendedora, imobiliariaId: imob, imobiliaria: nomeDa(imob, card?.cliente ?? ""), empresaId: call.empresaId, funilCampanha: funilCamp, gatilho: "cotacao" as const, card: Number(call.card) };
    const motivoBase = `${call.evento} em ${brData(call.data)} com resultado "Oportunidade de cotação gerada"`;
    if (!imob) {
      novaLinha({ ...comum, produto: a.produto ? ROTULO_PRODUTO[a.produto] : "—", motivo: motivoBase, competencia: null, valor: VALOR_CREDITO, situacao: "Vínculo pendente", detalhe: "Empresa do Bitrix sem vínculo confirmado com a base única de imobiliárias.", idsWorkspace: [], historico: [] });
      continue;
    }
    if (!a.produto) {
      const candidatos = ["fianca", "re", "capitalizacao"].map((p) => ({ p, c: primeiraCotacao(imob, p, call.data) })).filter((x) => x.c.primeira);
      novaLinha({
        ...comum,
        produto: "—",
        motivo: motivoBase,
        competencia: null,
        valor: VALOR_CREDITO,
        situacao: candidatos.length ? "Preenchimento pendente no Bitrix" : "Aguardando comprovação no Workspace",
        detalhe: candidatos.length
          ? `Campo faltante: Tipos de oportunidade. Cotações no Workspace: ${candidatos.map((x) => `${ROTULO_PRODUTO[x.p as ProdutoBase]} em ${brData(x.c.primeira!.dataCotacao)}`).join("; ")}.`
          : "Campo faltante: Tipos de oportunidade. Nenhuma cotação nova no Workspace após a call.",
        idsWorkspace: candidatos.map((x) => x.c.primeira!.id),
        historico: [],
      });
      continue;
    }
    const produto = a.produto;
    if (elite(imob, produto)) {
      novaLinha({ ...comum, produto: ROTULO_PRODUTO[produto], motivo: motivoBase, competencia: null, valor: 0, situacao: "Sem crédito", detalhe: "Fiança/Capitalização da Elite seguem a regra de crescimento da campanha (apurada no encerramento), não os R$ 50.", idsWorkspace: [], historico: [] });
      continue;
    }
    const { primeira, mesmoDia, todas } = primeiraCotacao(imob, produto, call.data);
    const dataBitrix = dataValida(card?.dataCotacao ?? null) ? (card?.dataCotacao as string) : null;
    const rotuloProduto = ROTULO_PRODUTO[produto];
    if (!primeira) {
      novaLinha({
        ...comum,
        produto: rotuloProduto,
        motivo: motivoBase,
        competencia: mesDe(dataBitrix),
        valor: VALOR_CREDITO,
        situacao: "Aguardando comprovação no Workspace",
        detalhe: dataBitrix ? `Bitrix informa cotação em ${brData(dataBitrix)}; o Workspace não tem cotação nova de ${rotuloProduto} após a call.` : `Bitrix informa a call com cotação gerada, sem "Data de cotação"; o Workspace não tem cotação nova de ${rotuloProduto} após a call.`,
        idsWorkspace: [],
        historico: [],
      });
      continue;
    }
    const historico = todas.slice(1).map((e) => `${brData(e.dataCotacao)} · ${e.status}${e.chave ? ` · ${e.chave}` : ""}`);
    const competencia = mesDe(primeira.dataCotacao);
    const dadosWs = `Workspace: cotação ${brData(primeira.dataCotacao)} (${primeira.status}, ${rotuloProduto})`;
    const conflitaDisputa = (disputa.get(`${imob}|${produto}`) ?? 0) > 1;
    let situacao: Situacao;
    let detalhe: string;
    const nota = mesmoDia.length > 1 ? ` ${mesmoDia.length} cotações no mesmo dia (lote ou vários negócios): contam como uma só demanda.` : "";
    if (conflitaDisputa) {
      situacao = "Vínculo pendente";
      detalhe = `${dadosWs}. Mais de uma reunião disputa a mesma cotação.${nota}`;
    } else if (!dataBitrix) {
      situacao = "Preenchimento pendente no Bitrix";
      detalhe = `Campo faltante: Data de cotação. ${dadosWs}.${nota}`;
    } else if (dataBitrix !== primeira.dataCotacao) {
      situacao = "Divergência Bitrix × Workspace";
      detalhe = `Bitrix: Data de cotação ${brData(dataBitrix)}. ${dadosWs}.${nota}`;
    } else if (card?.situacaoCotacao === "Sem demanda atual") {
      situacao = "Divergência Bitrix × Workspace";
      detalhe = `Bitrix: situação da cotação "Sem demanda atual". ${dadosWs}.`;
    } else {
      situacao = "Comissão validada";
      detalhe = `Bitrix: Data de cotação ${brData(dataBitrix)}. ${dadosWs}.${nota}`;
    }
    novaLinha({ ...comum, produto: rotuloProduto, motivo: `Primeira cotação nova após ${motivoBase}`, competencia: dataValida(primeira.dataCotacao) ? competencia : null, valor: VALOR_CREDITO, situacao, detalhe, idsWorkspace: [primeira.id], historico });
  }

  // ----- Gatilho 2: primeira efetivação elegível da oportunidade -----
  const finPorEmpresa = new Map<string, (typeof base.fin)[number]>();
  for (const f of base.fin) finPorEmpresa.set(f.empresaId, f);
  for (const o of oportunidades.values()) {
    const imob = o.imob;
    const rotuloProduto = ROTULO_PRODUTO[o.produto];
    const primeiraCall = [...primeiraCallPorCard.values()].filter((c) => o.cards.some((x) => x.card === c.card)).sort((a, b) => a.data.localeCompare(b.data))[0];
    const desde = [`${competenciaInicial}-01`, primeiraCall?.data ?? ""].sort().pop() as string;
    const funilCamp = [...new Set(o.cards.map((c) => (c.campanha ? `${c.funil} · ${c.campanha}` : c.funil)))].join(" / ");
    const comum = { vendedora: o.vendedora, imobiliariaId: imob, imobiliaria: nomeDa(imob, o.cliente), empresaId: o.empresaId, funilCampanha: funilCamp, gatilho: "efetivacao" as const, card: Number(o.cards[0].card), produto: rotuloProduto };
    if (elite(imob, o.produto)) continue; // já sinalizado como regra da Elite no gatilho 1 (ou segue só o crescimento)
    const convertidas = novas.filter((e) => e.imobiliariaId === imob && e.produto === o.produto && e.status === "Convertido");
    const comData = convertidas
      .filter((e) => dataValida(e.dataEfetivacao) && (e.dataEfetivacao as string) >= desde)
      .sort((a, b) => (a.dataEfetivacao as string).localeCompare(b.dataEfetivacao as string));
    const semData = convertidas.filter((e) => !dataValida(e.dataEfetivacao));
    const fin = finPorEmpresa.get(o.empresaId);
    // Mês do resultado: o do Painel (já com as exceções conhecidas, ex.: NK Barroso = set/26), não só a data crua do CRM.
    const finMes = fin ? (fin.mes ?? mesDe(fin.data)) : null;
    const finOk = !!fin && (fin.apolices > 0 || fin.comissao > 0) && dataValida(fin.data);
    if (comData.length) {
      const primeira = comData[0];
      const mesWs = mesDe(primeira.dataEfetivacao);
      const dadosWs = `Workspace: efetivação ${brData(primeira.dataEfetivacao)} (${rotuloProduto}${primeira.comissao ? `, comissão ${brl(Number(primeira.comissao))}` : ""})`;
      const mesmoDia = comData.filter((e) => e.dataEfetivacao === primeira.dataEfetivacao);
      let situacao: Situacao;
      let detalhe: string;
      const nota = mesmoDia.length > 1 ? ` ${mesmoDia.length} efetivações no mesmo dia: contam como um só negócio novo.` : "";
      if (!finOk) {
        situacao = "Preenchimento pendente no Bitrix";
        detalhe = `Campo faltante: Resultado Financeiro da Empresa (apólices, comissão O2 e data do resultado). ${dadosWs}.${nota}`;
      } else if (finMes !== mesWs) {
        situacao = "Divergência Bitrix × Workspace";
        detalhe = `Bitrix: Resultado Financeiro em ${brData(fin!.data)} (${fin!.apolices} apólice(s), ${brl(fin!.comissao)}). ${dadosWs}.${nota}`;
      } else {
        situacao = "Comissão validada";
        detalhe = `Bitrix: Resultado Financeiro em ${brData(fin!.data)} (${fin!.apolices} apólice(s)). ${dadosWs}.${nota}`;
      }
      novaLinha({ ...comum, motivo: "Primeira efetivação elegível do negócio novo", competencia: mesWs, valor: VALOR_CREDITO, situacao, detalhe, idsWorkspace: [primeira.id], historico: comData.slice(1).map((e) => `${brData(e.dataEfetivacao)} · ${e.chave ?? e.id}`) });
      continue;
    }
    if (semData.length) {
      novaLinha({ ...comum, motivo: "Primeira efetivação elegível do negócio novo", competencia: finOk ? finMes : null, valor: VALOR_CREDITO, situacao: "Aguardando comprovação no Workspace", detalhe: `O Workspace tem ${semData.length} efetivação(ões) de ${rotuloProduto} sem data de efetivação (${semData.slice(0, 3).map((e) => e.chave ?? e.id).join(", ")}${semData.length > 3 ? ", …" : ""}); a data não é substituída por outra.`, idsWorkspace: semData.slice(0, 5).map((e) => e.id), historico: [] });
      continue;
    }
    const aprovadas = novas.filter((e) => e.imobiliariaId === imob && e.produto === o.produto && e.status === "Aprovado" && dataValida(e.dataCotacao) && (e.dataCotacao as string) >= desde);
    if (aprovadas.length) {
      novaLinha({ ...comum, motivo: "Primeira efetivação elegível do negócio novo", competencia: null, valor: VALOR_CREDITO, situacao: "Aguardando efetivação", detalhe: `${aprovadas.length} cotação(ões) aprovada(s) de ${rotuloProduto} ainda não efetivada(s) (${aprovadas.slice(0, 3).map((e) => `${brData(e.dataCotacao)} ${e.chave ?? e.id}`).join("; ")}${aprovadas.length > 3 ? "; …" : ""}).`, idsWorkspace: aprovadas.slice(0, 5).map((e) => e.id), historico: [] });
      continue;
    }
    if (finOk && (finMes ?? "") >= desde.slice(0, 7)) {
      novaLinha({ ...comum, motivo: "Primeira efetivação elegível do negócio novo", competencia: finMes, valor: VALOR_CREDITO, situacao: "Aguardando comprovação no Workspace", detalhe: `Bitrix: Resultado Financeiro em ${brData(fin!.data)} (${fin!.apolices} apólice(s), ${brl(fin!.comissao)}). O Workspace não tem efetivação nova de ${rotuloProduto} no período.`, idsWorkspace: [], historico: [] });
    }
  }

  // Elite: apuração só no encerramento da campanha (a referência histórica aprovada vem do fechamento, não deste cálculo).
  return linhas.filter((l) => !l.competencia || l.competencia >= competenciaInicial || l.situacao === "Sem crédito");
}

export type ResumoComissao = { vendedora: string; competencia: string; validado: number; pendente: number; linhas: number; porSituacao: Record<string, number> };

export function resumirComissaoEquipe(linhas: LinhaComissao[]): ResumoComissao[] {
  const mapa = new Map<string, ResumoComissao>();
  for (const l of linhas) {
    if (l.valor === 0 && l.situacao === "Sem crédito") continue;
    const comp = l.competencia ?? "sem competência";
    const chave = `${l.vendedora}|${comp}`;
    const r = mapa.get(chave) ?? { vendedora: l.vendedora, competencia: comp, validado: 0, pendente: 0, linhas: 0, porSituacao: {} };
    r.linhas++;
    r.porSituacao[l.situacao] = (r.porSituacao[l.situacao] ?? 0) + 1;
    if (l.validado) r.validado += l.valor;
    else r.pendente += l.valor;
    mapa.set(chave, r);
  }
  return [...mapa.values()].sort((a, b) => a.vendedora.localeCompare(b.vendedora) || a.competencia.localeCompare(b.competencia));
}
