// ERP O2 — Gestão das baixas: regra da BAIXA AUTOMÁTICA (Matheus, 29/10/2026). Hoje só AVALIA ("seria baixado automaticamente");
// a baixa de verdade fica desligada (erp_baixa_automatica_config.ativa = false) até duas semanas de teste conferido.
//
// Um extrato está no padrão quando TODAS as condições valem:
//   1. o valor do pagamento do dia bate com o banco (Nibo), dentro da tolerância de R$ 6;
//   2. todas as linhas estão ligadas a uma parcela/documento do ERP (nenhuma "não encontrada");
//   3. nenhuma linha divergente do previsto (diferença acima da tolerância por parcela), nenhum estorno,
//      nenhuma linha em tratativa aberta, e a soma das linhas fecha com o total do extrato.
// Fora do padrão, a baixa é MANUAL (a equipe resolve o que depende de ação humana).
import { TOLERANCIA_CAIXA, type DiaCaixa } from "./caixaNibo";

export type ExtratoParaAvaliar = {
  tipo: string;
  linhas: number;
  conta_fecha: boolean;
  n_estorno: number;
  n_divergente: number;
  n_nao_encontrada: number;
  tratar_em_aberto: number;
  baixa_aprovada_em: string | null;
  data_recebimento: string | null;
};

export type SituacaoBanco = "bate" | "diferente" | "sem_banco";

// o dia do extrato no confronto com o banco (compararDias junta dias vizinhos quando o banco pagou em outro dia)
export function bancoDoExtrato(dias: DiaCaixa[] | undefined, dataRecebimento: string | null): { situacao: SituacaoBanco; dia: DiaCaixa | null } {
  if (!dias || !dataRecebimento) return { situacao: "sem_banco", dia: null };
  const t = new Date(`${dataRecebimento}T00:00:00Z`).getTime();
  const perto = dias
    .filter((d) => d.extrato > 0 && Math.abs(new Date(`${d.dia}T00:00:00Z`).getTime() - t) <= 3 * 86400000)
    .sort((a, b) => Math.abs(new Date(`${a.dia}T00:00:00Z`).getTime() - t) - Math.abs(new Date(`${b.dia}T00:00:00Z`).getTime() - t))[0];
  if (!perto || perto.banco <= 0) return { situacao: "sem_banco", dia: perto ?? null };
  return { situacao: Math.abs(perto.dif) <= TOLERANCIA_CAIXA ? "bate" : "diferente", dia: perto };
}

export function avaliarBaixaAutomatica(e: ExtratoParaAvaliar, banco: SituacaoBanco): { seria: boolean; faltas: string[] } {
  if (e.baixa_aprovada_em) return { seria: false, faltas: [] };
  const faltas: string[] = [];
  if (e.tipo === "resumo_mensal" || e.linhas === 0) faltas.push("sem linhas para baixar (só o total do mês)");
  if (banco === "sem_banco") faltas.push("o valor não aparece no banco no dia");
  else if (banco === "diferente") faltas.push("o banco difere do extrato");
  if (e.n_nao_encontrada > 0) faltas.push(`${e.n_nao_encontrada} linha(s) sem apólice/parcela no ERP`);
  if (e.n_divergente > 0) faltas.push(`${e.n_divergente} linha(s) diferem do previsto`);
  if (e.n_estorno > 0) faltas.push(`${e.n_estorno} estorno(s)`);
  if (e.tratar_em_aberto > 0) faltas.push(`${e.tratar_em_aberto} linha(s) em tratativa`);
  if (!e.conta_fecha && e.linhas > 0) faltas.push("a soma das linhas não fecha com o total do extrato");
  return { seria: faltas.length === 0, faltas };
}
