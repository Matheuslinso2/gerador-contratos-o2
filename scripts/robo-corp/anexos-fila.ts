// Regras de fila do robô de anexos, sem tocar no Corp (testável): documento com erro é PULADO,
// no máximo MAX_TENTATIVAS vezes no total (1ª na rodada, 2ª só no fim da fila) e nunca de novo
// no mesmo processo depois de um reinício. Decisão do Matheus 31/10: parado no erro a noite toda é desperdício.
export const MAX_TENTATIVAS = 2;

export type EntradaEstado = { resultado: string; versao?: number; tentativas?: number; erro?: string; pulado?: boolean };

/** Erro antigo (sem contador) conta como 1 tentativa já feita. */
export const tentativasDe = (e: EntradaEstado | undefined) => (e?.resultado === "erro" ? e.tentativas ?? 1 : 0);
/** Falhou MAX_TENTATIVAS vezes: fica fora da fila, na lista "pulados — revisar". */
export const estaPulado = (e: EntradaEstado | undefined) => e?.resultado === "erro" && (e.pulado === true || tentativasDe(e) >= MAX_TENTATIVAS);

/** Quem ainda precisa de visita: novos (e versão antiga) primeiro; erro com tentativa sobrando só DEPOIS de todos os demais. */
export function selecionarPendentes<T extends { nn: string }>(fila: T[], estado: Record<string, EntradaEstado>, versaoAtual: number, falhouNesteProcesso: Set<string>): T[] {
  const novos: T[] = [], retentar: T[] = [];
  for (const i of fila) {
    const e = estado[i.nn];
    if (falhouNesteProcesso.has(i.nn)) continue; // nunca volta nos mesmos depois de um reinício
    if (!e || (e.resultado !== "erro" && (e.versao ?? 1) < versaoAtual)) novos.push(i);
    else if (e.resultado === "erro" && !estaPulado(e)) retentar.push(i);
  }
  return [...novos, ...retentar];
}

/** Registra a falha: conta a tentativa e, na 2ª, marca como pulado. */
export function registrarErro(estado: Record<string, EntradaEstado>, nn: string, mensagem: string, quando = new Date().toISOString()) {
  const tentativas = tentativasDe(estado[nn]) + 1;
  estado[nn] = { quando, resultado: "erro", erro: mensagem, tentativas, pulado: tentativas >= MAX_TENTATIVAS } as EntradaEstado & { quando: string };
  return tentativas;
}
