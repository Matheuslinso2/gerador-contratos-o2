import ConteudoBaixas from "./ConteudoBaixas";

export const dynamic = "force-dynamic";

// Conferência do mês: quadros por empresa, consolidado e gráfico diário. O detalhe, os extratos e a aprovação da baixa
// ficam na aba "Gestão das baixas" (/erp/baixas/gestao).
export default function ErpBaixasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ConteudoBaixas searchParams={searchParams} modo="conferencia" />;
}
