import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarAnaliseGerencialAoVivo, NOME_NAO_ADMINISTRADA, type AnaliseGerencial } from "./seguroFianca";
import { classificarEixo, parFechado, type ClasseImobiliaria } from "./classificacaoImobiliariasRegras";

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
