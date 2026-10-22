import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import InfoLegenda from "@/components/InfoLegenda";
import { IconMail } from "@/components/icons";
import { STATUS_PROGRAMA, metricaInfo, rotuloProdutoPrograma, hojeBrasilia } from "@/lib/campanhas/programas";

export const dynamic = "force-dynamic";

type Linha = {
  id: string;
  nome: string;
  produtos: string[];
  metrica: string;
  inicio: string;
  fim: string;
  status: string;
  arquivado_em: string | null;
  campanhas_programas_participantes: { count: number }[];
};

const COR_STATUS: Record<string, string> = {
  planejada: "bg-gray-100 text-gray-700",
  ativa: "bg-green-100 text-green-800",
  encerrada: "bg-amber-100 text-amber-800",
  apurada: "bg-o2-navy text-white",
};

const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export default async function ProgramasPage({ searchParams }: { searchParams: Promise<{ arquivados?: string }> }) {
  const { arquivados } = await searchParams;
  const verArquivados = arquivados === "1";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  let consulta = supabase
    .from("campanhas_programas")
    .select("id, nome, produtos, metrica, inicio, fim, status, arquivado_em, campanhas_programas_participantes(count)")
    .order("inicio", { ascending: false });
  consulta = verArquivados ? consulta.not("arquivado_em", "is", null) : consulta.is("arquivado_em", null);
  const { data } = await consulta;
  const programas = (data ?? []) as Linha[];
  const hoje = hojeBrasilia();

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-5xl flex-1 space-y-6 p-8">
        <Link href="/campanhas" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar para as campanhas
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <PageHeader
            icon={<IconMail />}
            titulo={verArquivados ? "Programas arquivados" : "Programas e metas"}
            subtitulo="Campanhas comerciais com período, metas por imobiliária e produção puxada automaticamente."
          />
          <div className="flex items-center gap-3">
            <Link href={verArquivados ? "/campanhas/programas" : "/campanhas/programas?arquivados=1"} className="text-sm font-medium text-o2-navy hover:underline">
              {verArquivados ? "Ver ativos" : "Programas arquivados"}
            </Link>
            {!verArquivados && (
              <Link href="/campanhas/programas/nova" className="whitespace-nowrap rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90">
                Novo programa
              </Link>
            )}
          </div>
        </div>

        <section className="rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-o2-navy">
            Programas
            <InfoLegenda titulo="Programas de campanha">
              Cada programa é uma campanha comercial com início e fim, produtos e meta individual por imobiliária ou grupo. O realizado vem sozinho das cotações (Bitrix e planilhas) e é conferido com a produção do Corp. Os e-mails da campanha (boas-vindas, parciais) continuam em Campanhas e podem ser ligados ao programa.
            </InfoLegenda>
          </h2>
          {programas.length === 0 ? (
            <p className="text-sm text-gray-500">{verArquivados ? "Nenhum programa arquivado." : "Nenhum programa ainda. Crie o primeiro em “Novo programa”."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="py-2 pr-3">Programa</th>
                    <th className="py-2 pr-3">Período</th>
                    <th className="py-2 pr-3">Produtos</th>
                    <th className="py-2 pr-3">Meta mede</th>
                    <th className="py-2 pr-3 text-right">Participantes</th>
                    <th className="py-2">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {programas.map((p) => {
                    const restantes = Math.round((Date.parse(`${p.fim}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86_400_000);
                    return (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <Link href={`/campanhas/programas/${p.id}`} className="font-medium text-o2-navy hover:underline">
                            {p.nome}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap text-gray-700">
                          {dataBr(p.inicio)} a {dataBr(p.fim)}
                          {p.status === "ativa" && restantes >= 0 && <span className="ml-2 text-xs text-gray-500">({restantes} dias restantes)</span>}
                        </td>
                        <td className="py-2 pr-3 text-gray-700">{p.produtos.map(rotuloProdutoPrograma).join(", ")}</td>
                        <td className="py-2 pr-3 text-gray-700">{metricaInfo(p.metrica).rotulo}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.campanhas_programas_participantes?.[0]?.count ?? 0}</td>
                        <td className="py-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COR_STATUS[p.status] ?? COR_STATUS.planejada}`}>{STATUS_PROGRAMA[p.status] ?? p.status}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
