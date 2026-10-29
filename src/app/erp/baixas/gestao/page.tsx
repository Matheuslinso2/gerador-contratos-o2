import ConteudoBaixas from "../ConteudoBaixas";

export const dynamic = "force-dynamic";

// Gestão das baixas (29/10/2026): um bloco por seguradora de cada empresa, com o que a seguradora pagou, o que bateu com o
// previsto e com o banco, os extratos (linhas e aprovação da baixa), o histórico, as anotações e o saldo a cobrar.
export default function GestaoBaixasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ConteudoBaixas searchParams={searchParams} modo="gestao" />;
}
