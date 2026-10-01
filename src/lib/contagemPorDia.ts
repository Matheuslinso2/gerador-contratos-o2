// Contagem diária (fuso de Brasília) de cards criados e concluídos com
// sucesso numa competência -- vai junto no retrato salvo dos painéis de
// Capitalização e Seguro Auto pra o relatório diário do WhatsApp ler o
// "Ontem" do próprio Workspace, sem consultar o Bitrix (pedido do Matheus,
// 01/10/2026). Fiança já tinha seus quadros diários.

export type ContagemDia = { data: string; novos: number; concluidos: number };

const formatoDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function contarPorDia(competencia: string, criados: Date[], concluidos: Date[]): ContagemDia[] {
  const porDia = new Map<string, ContagemDia>();
  const dia = (data: string) => {
    let linha = porDia.get(data);
    if (!linha) porDia.set(data, (linha = { data, novos: 0, concluidos: 0 }));
    return linha;
  };
  for (const d of criados) {
    const data = formatoDia.format(d);
    if (data.startsWith(competencia)) dia(data).novos++;
  }
  for (const d of concluidos) {
    const data = formatoDia.format(d);
    if (data.startsWith(competencia)) dia(data).concluidos++;
  }
  return [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data));
}
