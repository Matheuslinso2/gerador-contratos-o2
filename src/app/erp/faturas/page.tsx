import ConferenciaPage from "../conferencia/page";

export const metadata = { title: "Faturas" };

// Etapa "Faturas" do processo do ERP (Matheus 26/10): por enquanto, as seções de fatura que estavam na Conferência
// (alertas e "fora das últimas faturas"). A tela de cada fatura (movimento mês a mês) vem na fase B.
export default async function ErpFaturasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return ConferenciaPage({ searchParams: Promise.resolve({ ...sp, secao: "faturas" }) });
}
