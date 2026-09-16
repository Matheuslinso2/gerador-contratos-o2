import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarAnaliseGerencialAoVivo, NOME_NAO_ADMINISTRADA, type AnaliseGerencial } from "./seguroFianca";

// Classificação operacional das imobiliárias (estudo da Patricia,
// 16/09/2026): cada imobiliária recebe uma classe em Cotações (quem mais
// demanda) e outra em Contratações (quem mais entrega contrato fechado),
// pela posição dela no ranking do período -- não por % fixo de
// participação. Cadência confirmada com o Matheus: a cada 2 meses (não a
// regra mais complexa do estudo original, de 3 meses fechados + janela
// móvel de 6 meses).
export const CLASSES_ATIVAS = [
  { nome: "Pilar Central", cumulativo: 10 },
  { nome: "Consolidado", cumulativo: 30 },
  { nome: "Expansão", cumulativo: 60 },
  { nome: "Fiel da Balança", cumulativo: 85 },
  { nome: "Avulso", cumulativo: 100 },
] as const;

export const NOME_FORA_DE_LINHA = "Fora de Linha";

// Ordem de hierarquia (pra ordenar a coluna na tabela) -- do maior volume
// esperado pro menor, com "sem classe" (nunca teve atividade) no final.
export const ORDEM_HIERARQUIA = [...CLASSES_ATIVAS.map((c) => c.nome), NOME_FORA_DE_LINHA];

export type ClasseImobiliaria = { classe: string; volume: number };

// Pares fixos de calendário ancorados em mês ímpar (Jan-Fev, Mar-Abr, ...,
// Nov-Dez). O par que contém "hoje" nunca está fechado (hoje sempre cai
// dentro dele, não depois) -- o par fechado é sempre os 2 meses anteriores
// a esse. Confere com o exemplo do estudo: em setembro, o par fechado é
// julho-agosto; setembro só "acompanha" até outubro fechar o próximo par.
export function parFechado(hoje: Date = new Date()): [string, string] {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth() + 1;
  const inicioParCorrente = mes % 2 === 1 ? mes : mes - 1;
  let inicioFechado = inicioParCorrente - 2;
  let anoFechado = ano;
  if (inicioFechado < 1) {
    inicioFechado += 12;
    anoFechado -= 1;
  }
  const mesA = String(inicioFechado).padStart(2, "0");
  const mesB = String(inicioFechado + 1).padStart(2, "0");
  return [`${anoFechado}-${mesA}`, `${anoFechado}-${mesB}`];
}

// Ranking por posição, respeitando empate (regra explícita do estudo:
// imobiliárias com o mesmo volume ficam juntas na mesma classe, mesmo que
// isso estoure a faixa-alvo -- nunca quebra um grupo empatado no meio).
export function classificarEixo(
  volumes: Record<string, number>,
  jaTeveAtividadeAntes: Set<string>
): Record<string, ClasseImobiliaria> {
  const resultado: Record<string, ClasseImobiliaria> = {};

  for (const [nome, volume] of Object.entries(volumes)) {
    if (volume === 0 && jaTeveAtividadeAntes.has(nome)) {
      resultado[nome] = { classe: NOME_FORA_DE_LINHA, volume: 0 };
    }
  }

  const ativos = Object.entries(volumes).filter(([, v]) => v > 0);
  if (!ativos.length) return resultado;
  ativos.sort((a, b) => b[1] - a[1]);

  const blocos: [string, number][][] = [];
  for (const par of ativos) {
    const ultimoBloco = blocos[blocos.length - 1];
    if (ultimoBloco && ultimoBloco[0][1] === par[1]) ultimoBloco.push(par);
    else blocos.push([par]);
  }

  const total = ativos.length;
  let consumidos = 0;
  let indiceClasse = 0;
  for (const bloco of blocos) {
    while (indiceClasse < CLASSES_ATIVAS.length - 1 && (consumidos / total) * 100 >= CLASSES_ATIVAS[indiceClasse].cumulativo) {
      indiceClasse++;
    }
    const classe = CLASSES_ATIVAS[indiceClasse].nome;
    for (const [nome, volume] of bloco) resultado[nome] = { classe, volume };
    consumidos += bloco.length;
  }

  return resultado;
}

export type ClassificacaoImobiliarias = {
  par: [string, string];
  porImobiliaria: Record<string, { cotacoes: ClasseImobiliaria | null; contratacoes: ClasseImobiliaria | null }>;
  incompleto: boolean;
  // Meses do par sem nenhum card criado no Bitrix (kpis.total === 0) -- ex:
  // julho/2026, quando a Fiança ainda rodava no sistema anterior e a SPA do
  // Bitrix (entityTypeId 1042) não tinha nenhum card criado nesse mês. Não é
  // "incompleto" (a busca funcionou), mas o volume desse mês fica de fora
  // da soma -- o quadro avisa isso na tela em vez de mostrar um número
  // menor sem explicação.
  mesesSemDadosNativos: string[];
};

// Lê o retrato salvo da competência; se nunca foi salvo (a página nunca foi
// aberta durante aquele mês), busca ao vivo no Bitrix -- o histórico é
// completo independente do mês, então funciona normalmente pra competências
// passadas -- e salva o resultado, mesmo padrão de upsert que
// src/app/seguro-fianca/page.tsx já faz pro mês corrente.
async function obterPayloadCompetencia(supabase: SupabaseClient, competencia: string): Promise<AnaliseGerencial | null> {
  const { data } = await supabase.from("seguro_fianca_snapshots").select("payload").eq("competencia", competencia).maybeSingle();
  if (data?.payload) return data.payload as AnaliseGerencial;

  try {
    const gerencial = await buscarAnaliseGerencialAoVivo(competencia);
    await supabase
      .from("seguro_fianca_snapshots")
      .upsert({ competencia, atualizado_em: new Date().toISOString(), payload: gerencial }, { onConflict: "competencia" });
    return gerencial;
  } catch {
    return null;
  }
}

export async function montarClassificacaoImobiliarias(supabase: SupabaseClient): Promise<ClassificacaoImobiliarias> {
  const par = parFechado();
  const [payloadA, payloadB] = await Promise.all([obterPayloadCompetencia(supabase, par[0]), obterPayloadCompetencia(supabase, par[1])]);

  if (!payloadA || !payloadB) {
    return { par, porImobiliaria: {}, incompleto: true, mesesSemDadosNativos: [] };
  }

  const mesesSemDadosNativos: string[] = [];
  if (payloadA.kpis.total === 0) mesesSemDadosNativos.push(par[0]);
  if (payloadB.kpis.total === 0) mesesSemDadosNativos.push(par[1]);

  const cotacoes: Record<string, number> = {};
  const contratacoes: Record<string, number> = {};
  for (const payload of [payloadA, payloadB]) {
    for (const im of payload.topImobiliarias) {
      if (im.nome === NOME_NAO_ADMINISTRADA) continue;
      cotacoes[im.nome] = (cotacoes[im.nome] ?? 0) + im.total;
      contratacoes[im.nome] = (contratacoes[im.nome] ?? 0) + im.convertidos;
    }
  }

  // "Já teve atividade antes" (qualquer competência salva antes do par) --
  // distingue Fora de Linha (tinha atividade, zerou) de quem nunca teve
  // nenhuma (fica de fora do ranking, não vira alerta).
  const { data: anteriores } = await supabase.from("seguro_fianca_snapshots").select("payload").lt("competencia", par[0]);
  const jaTeveAtividadeAntes = new Set<string>();
  for (const linha of anteriores ?? []) {
    const payload = linha.payload as AnaliseGerencial | null;
    for (const im of payload?.topImobiliarias ?? []) {
      if (im.nome === NOME_NAO_ADMINISTRADA) continue;
      if (im.total > 0 || im.convertidos > 0) jaTeveAtividadeAntes.add(im.nome);
    }
  }

  const classeCotacoes = classificarEixo(cotacoes, jaTeveAtividadeAntes);
  const classeContratacoes = classificarEixo(contratacoes, jaTeveAtividadeAntes);

  const nomes = new Set([...Object.keys(cotacoes), ...Object.keys(contratacoes)]);
  const porImobiliaria: ClassificacaoImobiliarias["porImobiliaria"] = {};
  for (const nome of nomes) {
    porImobiliaria[nome] = {
      cotacoes: classeCotacoes[nome] ?? null,
      contratacoes: classeContratacoes[nome] ?? null,
    };
  }

  return { par, porImobiliaria, incompleto: false, mesesSemDadosNativos };
}
