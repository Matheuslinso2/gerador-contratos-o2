// Contagem diária (fuso de Brasília) de cards criados e concluídos com
// sucesso numa competência -- vai junto no retrato salvo dos painéis de
// Capitalização e Seguro Auto pra o relatório diário do WhatsApp ler o
// "Ontem" do próprio Workspace, sem consultar o Bitrix (pedido do Matheus,
// 01/10/2026). Fiança já tinha seus quadros diários.

// comissao/perdidos entraram em 09/10/2026 (o "No mês" do relatório passou a
// contar o que foi efetivado NO MÊS, qualquer que seja o mês do pedido --
// pedido do Matheus) -- opcionais porque retratos anteriores não têm.
export type ContagemDia = { data: string; novos: number; concluidos: number; comissao?: number; perdidos?: number };

const formatoDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function contarPorDia(
  competencia: string,
  criados: Date[],
  concluidos: { quando: Date; comissao: number }[],
  perdidos: Date[]
): ContagemDia[] {
  const porDia = new Map<string, ContagemDia>();
  const dia = (data: string) => {
    let linha = porDia.get(data);
    if (!linha) porDia.set(data, (linha = { data, novos: 0, concluidos: 0, comissao: 0, perdidos: 0 }));
    return linha;
  };
  for (const d of criados) {
    const data = formatoDia.format(d);
    if (data.startsWith(competencia)) dia(data).novos++;
  }
  for (const { quando, comissao } of concluidos) {
    const data = formatoDia.format(quando);
    if (!data.startsWith(competencia)) continue;
    const linha = dia(data);
    linha.concluidos++;
    linha.comissao = Math.round(((linha.comissao ?? 0) + comissao) * 100) / 100;
  }
  for (const d of perdidos) {
    const data = formatoDia.format(d);
    if (data.startsWith(competencia)) dia(data).perdidos = (dia(data).perdidos ?? 0) + 1;
  }
  return [...porDia.values()].sort((a, b) => a.data.localeCompare(b.data));
}
