// Cálculo de tempo em horário comercial (segunda a sexta, 9h às 18h,
// America/Sao_Paulo) -- base das métricas de "tempo gasto"/"tempo médio"/
// "dias parado" dos painéis de Ramos Elementares, Seguro Fiança,
// Capitalização e Seguro Auto (decisão do Matheus, 15/09/2026: tempo
// corrido não reflete o tempo real de atendimento da equipe -- uma
// cotação parada da sexta à noite até segunda de manhã não deveria contar
// quase 3 dias). Sem tratamento de feriados nesta versão (confirmado).
//
// Os timestamps do Bitrix chegam como ISO com offset explícito (fuso do
// servidor, Moscou) -- new Date(...) já resolve isso pro instante absoluto
// certo. O que falta é decidir se esse instante "cai" em horário comercial
// EM BRASÍLIA, e isso não pode depender do timezone do processo Node (em
// produção na Vercel roda em UTC) -- por isso usamos Intl.DateTimeFormat
// com timeZone explícito, mesmo padrão já usado em competenciaAtual()
// (capitalizacao/painel.ts) e dataBrasiliaDeInstante() (seguroFianca.ts).

const FUSO = "America/Sao_Paulo";
// Brasil não tem mais horário de verão desde 2019 -- o offset de
// America/Sao_Paulo é sempre fixo em -03:00, o que permite construir a
// meia-noite de um dia civil brasileiro diretamente em UTC (03:00 UTC),
// sem precisar resolver DST.
const OFFSET_BRASILIA_HORAS = 3;

export const MINUTOS_POR_DIA_UTIL = 9 * 60; // 540 -- expediente 9h-18h
const HORA_INICIO_MIN = 9 * 60; // 09:00
const HORA_FIM_MIN = 18 * 60; // 18:00

const formatadorPartes = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DIAS_UTEIS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

type PartesBrasilia = { ano: number; mes: number; dia: number; diaUtil: boolean; minutoDoDia: number };

function partesBrasilia(data: Date): PartesBrasilia {
  const mapa: Record<string, string> = {};
  for (const p of formatadorPartes.formatToParts(data)) mapa[p.type] = p.value;
  const hora = Number(mapa.hour) % 24; // hour12:false pode devolver "24" na meia-noite
  return {
    ano: Number(mapa.year),
    mes: Number(mapa.month),
    dia: Number(mapa.day),
    diaUtil: DIAS_UTEIS.has(mapa.weekday),
    minutoDoDia: hora * 60 + Number(mapa.minute),
  };
}

// Meia-noite do PRÓXIMO dia civil brasileiro, como instante absoluto --
// construída direto em UTC (offset fixo) em vez de somar minutos ao
// instante de entrada, pra não perder precisão de segundos/ms na virada.
function proximaMeiaNoiteBrasilia(partes: PartesBrasilia): Date {
  return new Date(Date.UTC(partes.ano, partes.mes - 1, partes.dia + 1, OFFSET_BRASILIA_HORAS, 0, 0, 0));
}

// Minutos de horário comercial entre dois instantes -- avança um cursor
// dia civil por dia civil (em Brasília): fim de semana soma 0, dia útil
// soma a interseção do trecho daquele dia com a janela 9h-18h.
export function minutosComerciaisEntre(inicio: Date, fim: Date): number {
  if (!(fim > inicio)) return 0;

  let total = 0;
  let cursor = inicio;

  while (cursor < fim) {
    const partesCursor = partesBrasilia(cursor);
    const fimDoDiaCivil = proximaMeiaNoiteBrasilia(partesCursor);
    const noFimDoDia = fimDoDiaCivil <= fim;
    const limite = noFimDoDia ? fimDoDiaCivil : fim;

    if (partesCursor.diaUtil) {
      // Se paramos porque o dia civil virou, o trecho vai até 24h (não
      // "00:00", que seria o minuto do PRÓXIMO dia); se paramos porque
      // chegamos no fim de verdade, usa a hora real desse instante.
      const minutoFimTrecho = noFimDoDia ? 24 * 60 : partesBrasilia(limite).minutoDoDia;
      const inicioClamp = Math.max(partesCursor.minutoDoDia, HORA_INICIO_MIN);
      const fimClamp = Math.min(minutoFimTrecho, HORA_FIM_MIN);
      if (fimClamp > inicioClamp) total += fimClamp - inicioClamp;
    }

    cursor = limite;
  }

  return total;
}

// Conversão pros painéis que exibem "dias" (Capitalização, Seguro Auto,
// Ramos Elementares): dias úteis EQUIVALENTES (minutos / 540), não dias
// corridos -- ex: 1080 min comerciais = 2.0 "dias" (2 expedientes completos).
export function diasUteisEquivalentesEntre(inicio: Date, fim: Date): number {
  return minutosComerciaisEntre(inicio, fim) / MINUTOS_POR_DIA_UTIL;
}
