// Período coberto pelo relatório diário do WhatsApp (definido com o Matheus
// em 01/10/2026): sai só de segunda a sexta às 8h; "Ontem" é o dia
// anterior, e na segunda vira sexta + sábado + domingo. "No mês" é a
// competência do ÚLTIMO dia do período -- no dia 1º, fecha o mês anterior.
// Tudo no fuso de Brasília (sem horário de verão desde 2019, então -03:00
// fixo é seguro).

const FUSO = "America/Sao_Paulo";
const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export type PeriodoRelatorio = {
  dias: string[]; // "YYYY-MM-DD", em ordem
  inicio: Date; // 00:00 de Brasília do primeiro dia
  fim: Date; // 00:00 de Brasília de hoje (exclusivo)
  competenciaMes: string; // "YYYY-MM"
  rotulo: string; // ex: "terça, 30/09" ou "sexta 26/09 a domingo 28/09"
};

function hojeEmBrasilia(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function diaDaSemana(dia: string): number {
  return new Date(`${dia}T12:00:00Z`).getUTCDay();
}

function rotuloDia(dia: string, comVirgula: boolean): string {
  const [, mes, d] = dia.split("-");
  return `${DIAS_SEMANA[diaDaSemana(dia)]}${comVirgula ? "," : ""} ${d}/${mes}`;
}

export function calcularPeriodoRelatorio(agora = new Date()): PeriodoRelatorio {
  const hoje = hojeEmBrasilia(agora);
  const quantosDias = diaDaSemana(hoje) === 1 ? 3 : 1;
  const dias = Array.from({ length: quantosDias }, (_, i) => somarDias(hoje, i - quantosDias));
  const ultimo = dias[dias.length - 1];
  return {
    dias,
    inicio: new Date(`${dias[0]}T00:00:00-03:00`),
    fim: new Date(`${hoje}T00:00:00-03:00`),
    competenciaMes: ultimo.slice(0, 7),
    rotulo: dias.length === 1 ? rotuloDia(ultimo, true) : `${rotuloDia(dias[0], false)} a ${rotuloDia(ultimo, false)}`,
  };
}

export function ehDiaUtil(agora = new Date()): boolean {
  const dia = diaDaSemana(hojeEmBrasilia(agora));
  return dia >= 1 && dia <= 5;
}
