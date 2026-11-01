// Período padrão de TODAS as telas do ERP (Matheus 01/11/2026): o mês corrente, com navegação por mês e por ano.
// O mês escolhido vem da URL (?mes=AAAA-MM). Mês aberto (o corrente) recalcula; mês fechado vira retrato fixo.
// Cada aba decide a sua herança de meses anteriores (pendências que seguem abertas); o mês escolhido define só o recorte do mês.

const ROTULOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export type PeriodoMes = {
  /** AAAA-MM */
  mes: string;
  /** 1º dia do mês (AAAA-MM-DD) */
  de: string;
  /** último dia do mês (AAAA-MM-DD) */
  ate: string;
  rotulo: string;
  ehMesAtual: boolean;
  /** mês já encerrado: os números ficam congelados no retrato do fechamento */
  fechado: boolean;
  anterior: string;
  proximo: string;
  anoAnterior: string;
  anoProximo: string;
  mesAtual: string;
};

function hojeSP(): Date {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return new Date(`${partes}T12:00:00Z`);
}

const fmt = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, "0")}`;
const soma = (ano: number, mes: number, delta: number) => {
  const t = ano * 12 + (mes - 1) + delta;
  return fmt(Math.floor(t / 12), (t % 12) + 1);
};

export function mesAtual(): string {
  const h = hojeSP();
  return fmt(h.getUTCFullYear(), h.getUTCMonth() + 1);
}

/** Lê ?mes=AAAA-MM (inválido ou vazio = mês corrente). */
export function periodoDoMes(param?: string | null): PeriodoMes {
  const atual = mesAtual();
  const ok = param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param);
  const mes = ok ? (param as string) : atual;
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return {
    mes,
    de: `${mes}-01`,
    ate: `${mes}-${String(ultimo).padStart(2, "0")}`,
    rotulo: `${ROTULOS[m - 1]} de ${a}`,
    ehMesAtual: mes === atual,
    fechado: mes < atual,
    anterior: soma(a, m, -1),
    proximo: soma(a, m, 1),
    anoAnterior: soma(a, m, -12),
    anoProximo: soma(a, m, 12),
    mesAtual: atual,
  };
}

/** Idade máxima do retrato: mês aberto = 15 min; mês fechado = nunca refaz (congelado). */
export const IDADE_RETRATO_ABERTO = "00:15:00";
export const IDADE_RETRATO_FECHADO = "36500 days";
