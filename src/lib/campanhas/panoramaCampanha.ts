import type { SupabaseClient } from "@supabase/supabase-js";
import { metricaInfo, rotuloProdutoBase, type ConfigDesempenho, type DadosStatus, type DesempenhoCampanha, type Farol, type LinhaDesempenho } from "./desempenho";

// Panorama da campanha (30/10/2026): o quadro de acompanhamento de UMA
// imobiliária (ou grupo) dentro da campanha -- meta, realizado, quanto falta,
// prazo e a evolução das parciais já enviadas. Cada "Enviar parciais" grava uma
// VERSÃO (campanhas_panoramas) com os números exatamente como foram mostrados;
// a imagem do e-mail e o histórico saem dessas versões, nunca de um recálculo.
//
// 03/11/2026: período INDIVIDUAL de cada participante; percentual pode passar de
// 100% (Meta 1 = base de 100%); oportunidades (cotações APROVADAS ainda não
// contratadas) ficam SEPARADAS da produção; "dados indisponíveis" nunca vira zero.

export type PontoHistorico = { versao: number; data: string; realizado: number };

export type OportunidadePanorama = {
  pretendente: string | null;
  produto: string; // "Seguro Fiança" | "Capitalização"
  // 04/11/2026: Capitalização entra como TÍTULO SOLICITADO (mesmos cards de "Títulos solicitados" do
  // painel de Capitalização). Ausente nas versões antigas = cotação aprovada.
  tipo?: "cotacao_aprovada" | "titulo_solicitado";
  etapa?: string | null; // etapa do card (títulos solicitados)
  aprovadaEm: string | null; // YYYY-MM-DD, só quando a fonte tem
  entrada: string; // YYYY-MM-DD (entrada da cotação ou solicitação do título)
  diasAguardando: number | null; // desde a aprovação (cotação) ou desde a solicitação (título), quando há data
};

/** Quantas oportunidades de cada tipo (versões antigas só têm cotações aprovadas). */
export function contagemOportunidades(oportunidades: OportunidadePanorama[]): { cotacoes: number; titulos: number } {
  const titulos = oportunidades.filter((o) => o.tipo === "titulo_solicitado").length;
  return { cotacoes: oportunidades.length - titulos, titulos };
}

export type DadosPanorama = {
  campanha: string;
  participante: string;
  metrica: string;
  moeda: boolean;
  unidade: string; // "contratações", "cotações"... (vazio quando é valor em R$)
  inicio: string; // início INDIVIDUAL
  fim: string; // encerramento INDIVIDUAL
  periodoIndividual: boolean;
  posicaoEm: string; // YYYY-MM-DD (dia da parcial)
  apuradoAte: string; // menor entre a parcial e o encerramento
  versao: number;
  meta: number | null; // Meta 1 = base de 100%
  realizado: number;
  faltam: number | null; // 0 quando a meta foi atingida/superada
  percentual: number | null; // pode passar de 100
  diasRestantes: number; // nunca negativo
  encerrada: boolean;
  dadosStatus: DadosStatus;
  oportunidades: OportunidadePanorama[]; // aprovadas e ainda não contratadas
  emAnalise: number; // cotações em análise (não aprovadas)
  oportunidadesDesde: string; // entradas a partir desta data
  // Regra exclusiva da Campanha Elite (Expan e Adjuve): só título de Capitalização a partir deste valor.
  capValorMinimo?: number | null;
  capForaDoMinimo?: number; // títulos que ficaram de fora por ela no período
  farol: Farol;
  premiacao: string | null;
  historico: PontoHistorico[]; // parciais anteriores já enviadas (mais antiga primeiro)
};

const UNIDADE: Record<string, string> = { contratacoes: "contratações", cotacoes: "cotações", premio: "", comissao: "" };

export const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

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
  const hoje = desempenho.hoje;
  const novas = linha.oportunidades.filter((o) => o.tipo === "novo");
  const aprovadas = novas.filter((o) => o.status === "Aprovado");
  const solicitados = novas.filter((o) => o.status === "Solicitado");
  return {
    campanha: config.nome,
    participante: linha.nome.replace(/ \(grupo\)$/, ""),
    metrica: info.rotulo,
    moeda: info.moeda,
    unidade: UNIDADE[config.metrica] ?? "",
    inicio: linha.inicio,
    fim: linha.fim,
    periodoIndividual: linha.periodoIndividual,
    posicaoEm: hoje,
    apuradoAte: hoje < linha.fim ? hoje : linha.fim,
    versao,
    meta,
    realizado: linha.realizado,
    faltam: meta === null ? null : Math.max(0, meta - linha.realizado),
    percentual: meta && meta > 0 ? (linha.realizado / meta) * 100 : null,
    diasRestantes: Math.max(0, linha.diasRestantes),
    encerrada: hoje > linha.fim,
    dadosStatus: linha.dadosStatus,
    oportunidades: [
      ...aprovadas.map(
        (o): OportunidadePanorama => ({
          pretendente: o.pretendente,
          produto: rotuloProdutoBase(o.produto),
          tipo: "cotacao_aprovada",
          aprovadaEm: o.aprovadaEm ?? null,
          entrada: o.entrada,
          diasAguardando: o.aprovadaEm ? Math.max(0, diasEntre(o.aprovadaEm, hoje)) : null,
        })
      ),
      ...solicitados.map(
        (o): OportunidadePanorama => ({
          pretendente: o.pretendente,
          produto: rotuloProdutoBase(o.produto),
          tipo: "titulo_solicitado",
          etapa: o.etapa ?? null,
          aprovadaEm: null,
          entrada: o.entrada,
          diasAguardando: Math.max(0, diasEntre(o.entrada, hoje)),
        })
      ),
    ].sort((a, b) => (b.diasAguardando ?? -1) - (a.diasAguardando ?? -1) || a.entrada.localeCompare(b.entrada)),
    emAnalise: novas.filter((o) => o.status === "Em análise").length,
    oportunidadesDesde: linha.abertosDesde,
    capValorMinimo: linha.capValorMinimo,
    capForaDoMinimo: linha.capDescartados.total,
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

/** Endereço rastreado do botão i do e-mail (redireciona para o destino que está no texto salvo da parcial). */
export function enderecoDoClique(token: string, indice: number): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) throw new Error("NEXT_PUBLIC_SITE_URL não configurada");
  return base.replace(/\/$/, "") + "/api/campanhas/clique/" + token + "?b=" + indice;
}

/** Resumo em texto dos mesmos números da imagem (vai abaixo dela, para quem bloqueia imagens). */
export function resumoEmTexto(d: DadosPanorama): string {
  const u = d.moeda || !d.unidade ? "" : ` ${d.unidade}`;
  if (d.dadosStatus !== "ok") return "Produção indisponível no momento: estamos conferindo o vínculo dos seus dados.";
  const partes = [`Meta: ${d.meta ? formatarValor(d.meta, d.moeda) + u : "ainda não definida"}`, `Realizado: ${formatarValor(d.realizado, d.moeda)}${u}`];
  if (d.percentual !== null) partes.push(`${Math.round(d.percentual)}% da meta`);
  if (d.faltam !== null) partes.push(d.faltam > 0 ? `Faltam: ${formatarValor(d.faltam, d.moeda)}${u}` : "Meta atingida");
  partes.push(d.encerrada ? `Campanha encerrada em ${dataBr(d.fim)}` : `${d.diasRestantes} dias até ${dataBr(d.fim)}`);
  const opp = contagemOportunidades(d.oportunidades);
  if (opp.cotacoes) partes.push(`${opp.cotacoes} cotação(ões) aprovada(s) aguardando contratação`);
  if (opp.titulos) partes.push(`${opp.titulos} título(s) de Capitalização solicitado(s) aguardando contratação`);
  if (d.capValorMinimo) partes.push(`Capitalização: contam títulos a partir de ${formatarValor(d.capValorMinimo, true)}`);
  return partes.join(" · ");
}
