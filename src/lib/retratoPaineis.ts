// Regra comum dos painéis que buscam no Bitrix (Fiança, Capitalização, Auto,
// Comercial, Ramos): abrir a página usa o retrato salvo se ele tiver até
// 10 minutos; passou disso -- ou ao clicar em "Atualizar agora" -- busca ao
// vivo. Antes toda abertura ia ao Bitrix (5 a 18 s por clique, medido em
// 15/10/2026). Um cron (vercel.json) renova os retratos a cada 10 min em
// horário comercial, então quase sempre há um recente esperando.

export const IDADE_MAXIMA_RETRATO_MS = 10 * 60 * 1000;

export function retratoRecente(atualizadoEm: string | null | undefined): boolean {
  if (!atualizadoEm) return false;
  return Date.now() - new Date(atualizadoEm).getTime() < IDADE_MAXIMA_RETRATO_MS;
}

// "Atualizar agora" manda a hora do clique (?atualizar=<ms>); vale só por 30 s
// pra um link ou recarga antiga com esse parâmetro não forçar busca ao vivo
// pra sempre.
export function pediuAtualizacao(valor: string | undefined): boolean {
  const quando = Number(valor);
  return Number.isFinite(quando) && quando > 0 && Math.abs(Date.now() - quando) < 30_000;
}
