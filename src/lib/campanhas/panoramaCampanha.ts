import type { SupabaseClient } from "@supabase/supabase-js";
import { metricaInfo, type ConfigDesempenho, type DesempenhoCampanha, type Farol, type LinhaDesempenho } from "./desempenho";

// Panorama da campanha (30/10/2026): o quadro de acompanhamento de UMA
// imobiliária (ou grupo) dentro da campanha -- meta, realizado, quanto falta,
// prazo e a evolução das parciais já enviadas. Cada "Enviar parciais" grava uma
// VERSÃO (campanhas_panoramas) com os números exatamente como foram mostrados;
// a imagem do e-mail e o histórico saem dessas versões, nunca de um recálculo.

export type PontoHistorico = { versao: number; data: string; realizado: number };

export type DadosPanorama = {
  campanha: string;
  participante: string;
  metrica: string;
  moeda: boolean;
  unidade: string; // "contratações", "cotações"... (vazio quando é valor em R$)
  inicio: string;
  fim: string;
  posicaoEm: string; // YYYY-MM-DD
  versao: number;
  meta: number | null;
  realizado: number;
  faltam: number | null;
  percentual: number | null;
  diasRestantes: number;
  emAndamento: number;
  farol: Farol;
  premiacao: string | null;
  historico: PontoHistorico[]; // parciais anteriores já enviadas (mais antiga primeiro)
};

const UNIDADE: Record<string, string> = { contratacoes: "contratações", cotacoes: "cotações", premio: "", comissao: "" };

export const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export function formatarValor(n: number, moeda: boolean): string {
  return moeda ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

export function dadosDoPanorama(
  config: ConfigDesempenho,
  linha: LinhaDesempenho,
  desempenho: DesempenhoCampanha,
  versao: number,
  historico: PontoHistorico[]
): DadosPanorama {
  const info = metricaInfo(config.metrica);
  const meta = linha.meta ?? null;
  return {
    campanha: config.nome,
    participante: linha.nome.replace(/ \(grupo\)$/, ""),
    metrica: info.rotulo,
    moeda: info.moeda,
    unidade: UNIDADE[config.metrica] ?? "",
    inicio: config.inicio,
    fim: config.fim,
    posicaoEm: desempenho.hoje,
    versao,
    meta,
    realizado: linha.realizado,
    faltam: linha.faltam,
    percentual: meta && meta > 0 ? (linha.realizado / meta) * 100 : null,
    diasRestantes: desempenho.diasRestantes,
    emAndamento: linha.funil.emAndamento,
    farol: linha.farol,
    premiacao: config.premiacao_descricao,
    historico,
  };
}

/** Parciais já ENVIADAS de cada participante da campanha (mais antiga primeiro). */
export async function historicoPorParticipante(db: SupabaseClient, campanhaId: string): Promise<Map<string, PontoHistorico[]>> {
  const { data } = await db
    .from("campanhas_panoramas")
    .select("participante_id, versao, dados, enviado_em")
    .eq("campanha_id", campanhaId)
    .eq("status", "enviada")
    .order("versao", { ascending: true });
  const mapa = new Map<string, PontoHistorico[]>();
  for (const r of (data ?? []) as { participante_id: string; versao: number; dados: DadosPanorama; enviado_em: string | null }[]) {
    mapa.set(r.participante_id, [...(mapa.get(r.participante_id) ?? []), { versao: r.versao, data: r.dados.posicaoEm, realizado: r.dados.realizado }]);
  }
  return mapa;
}

export function enderecoDaImagem(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) throw new Error("NEXT_PUBLIC_SITE_URL não configurada");
  return `${base.replace(/\/$/, "")}/api/campanhas/panorama/${token}`;
}

/** Resumo em texto dos mesmos números (vai abaixo da imagem, para quem bloqueia imagens). */
export function resumoEmTexto(d: DadosPanorama): string {
  const u = d.moeda || !d.unidade ? "" : ` ${d.unidade}`;
  const partes = [`Meta: ${d.meta ? formatarValor(d.meta, d.moeda) + u : "ainda não definida"}`, `Realizado: ${formatarValor(d.realizado, d.moeda)}${u}`];
  if (d.faltam !== null && d.faltam > 0) partes.push(`Faltam: ${formatarValor(d.faltam, d.moeda)}${u}`);
  if (d.diasRestantes > 0) partes.push(`${d.diasRestantes} dias até ${dataBr(d.fim)}`);
  return partes.join(" · ");
}
