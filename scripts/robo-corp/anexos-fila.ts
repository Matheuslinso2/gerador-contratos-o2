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

// ---- tipos de anexo (rótulo da aba Anexos do Corp, lido por imagem: recorte → sha1 → tipo) ----
// Conferidos a olho em 31/10 (mosaico dos 17 recortes). O recorte muda com a linha selecionada (fundo azul)
// e com o ícone (robô / pino), por isso há mais de um id por tipo.
export const TIPO_POR_ROTULO: Record<string, string> = {
  e13686035870: "Apólice", "93b35210f85f": "Apólice", "28cc48e3c54d": "Apólice", "26bc5e073ac1": "Apólice",
  "6b096b0dfa75": "Proposta", e397bec4478f: "Proposta", e1f9eb6a2f31: "Proposta", "829ffddf5474": "Proposta",
  "74a4fb265c89": "Endosso", "311786138bd0": "Endosso",
  "6cea5ecdda1d": "Certificado", "5cbb8ee06e5b": "Certificado",
  "21941a1734c2": "Boleto", "6800e182f329": "Boleto", aed7f0415fde: "Boleto",
  e1947b4cc768: "Outro", d072b2b994bc: "Outro",
};
/** Decisão do Matheus 31/10: Apólice, Proposta, Endosso e Certificado (documento oficial da Capitalização) são baixados; Boleto e Outro não. Rótulo desconhecido (recorte novo) é baixado por segurança e fica "sem tipo" até alguém classificar. */
export const TIPOS_BAIXAR = new Set(["Apólice", "Proposta", "Endosso", "Certificado"]);
export const deveBaixar = (rotulo: string) => { const t = TIPO_POR_ROTULO[rotulo]; return !t || TIPOS_BAIXAR.has(t); };
