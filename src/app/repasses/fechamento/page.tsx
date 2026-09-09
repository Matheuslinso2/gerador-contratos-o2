import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import FaturasSubHeader from "../../faturas/FaturasSubHeader";
import SeletorCompetenciaRepasses from "../SeletorCompetenciaRepasses";
import { IconReport } from "../../faturas/icons";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MESES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function formatarCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-");
  const nomeMes = MESES_PT[Number(mes) - 1];
  return nomeMes ? `${nomeMes} de ${ano}` : competencia;
}

function formatarValor(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function mesAtualDefault(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

type EnvioRow = {
  id: string;
  imobiliaria_id: string | null;
  repasses_ids: string[];
  destinatarios: string[];
  resultado: string | null;
  erro_detalhe: string | null;
  enviado_por_email: string | null;
  created_at: string;
};

// Mesmo relatório de fechamento de Faturas, adaptado pra Repasse -- só o
// que já foi enviado (pendência já tem espaço próprio na tela principal).
export default async function FechamentoRepassesPage({
  searchParams,
}: {
  searchParams: Promise<{ competencia?: string }>;
}) {
  const { competencia: competenciaParam } = await searchParams;
  const competencia = competenciaParam || mesAtualDefault();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: enviosData } = await supabase
    .from("repasses_envios")
    .select("id, imobiliaria_id, repasses_ids, destinatarios, resultado, erro_detalhe, enviado_por_email, created_at")
    .eq("competencia", competencia)
    .order("created_at", { ascending: false });
  const envios = (enviosData ?? []) as EnvioRow[];

  const [{ data: imobiliariasData }, { data: repassesData }] = await Promise.all([
    supabase
      .from("imobiliarias")
      .select("id, nome, codigo_produtor_corp")
      .in("id", Array.from(new Set(envios.map((e) => e.imobiliaria_id).filter(Boolean) as string[]))),
    supabase
      .from("repasses")
      .select("id, valor, tipo_documento")
      .in("id", Array.from(new Set(envios.flatMap((e) => e.repasses_ids ?? [])))),
  ]);
  const imobiliariaPorId = new Map((imobiliariasData ?? []).map((i) => [i.id, i]));
  const repassePorId = new Map((repassesData ?? []).map((r) => [r.id, r]));

  function valorDoEnvio(e: EnvioRow): number | null {
    const relatorio = (e.repasses_ids ?? [])
      .map((id) => repassePorId.get(id))
      .find((r) => r?.tipo_documento === "relatorio");
    return relatorio?.valor ?? null;
  }

  const enviadosComSucesso = envios.filter((e) => e.resultado === "sucesso");
  const comErro = envios.filter((e) => e.resultado === "erro");
  const valorTotal = enviadosComSucesso.reduce((soma, e) => soma + (valorDoEnvio(e) ?? 0), 0);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-[1100px] flex-1 space-y-6 p-8">
        <FaturasSubHeader
          icon={<IconReport />}
          titulo="Fechamento de repasses"
          subtitulo="Registro de tudo que já foi enviado nessa competência, pra conferir antes de fechar o mês."
          voltarHref="/repasses"
          voltarTexto="Voltar para Repasses"
        />

        <div className="flex items-center gap-3 rounded-xl border border-o2-navy/10 bg-white p-3 shadow-sm">
          <span className="text-xs font-medium text-gray-500">Competência</span>
          <SeletorCompetenciaRepasses competencia={competencia} basePath="/repasses/fechamento" />
          <span className="text-sm font-semibold text-o2-navy">{formatarCompetencia(competencia)}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Enviados com sucesso</p>
            <p className="mt-1 text-2xl font-semibold text-o2-navy">{enviadosComSucesso.length}</p>
          </div>
          <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Com erro</p>
            <p className={`mt-1 text-2xl font-semibold ${comErro.length ? "text-red-600" : "text-o2-navy"}`}>
              {comErro.length}
            </p>
          </div>
          <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Valor líquido total repassado</p>
            <p className="mt-1 text-2xl font-semibold text-o2-coral">{formatarValor(valorTotal)}</p>
          </div>
        </div>

        <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-o2-navy">Envios ({envios.length})</h2>
          {!envios.length ? (
            <p className="py-6 text-center text-sm text-gray-500">Nenhum envio registrado nessa competência.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="pb-2 pr-4">Imobiliária</th>
                    <th className="pb-2 pr-4">Código</th>
                    <th className="pb-2 pr-4">Data/hora</th>
                    <th className="pb-2 pr-4">Destinatários</th>
                    <th className="pb-2 pr-4">Valor líquido</th>
                    <th className="pb-2 pr-4">Autorizado por</th>
                    <th className="pb-2">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {envios.map((e) => {
                    const imob = e.imobiliaria_id ? imobiliariaPorId.get(e.imobiliaria_id) : null;
                    const valor = valorDoEnvio(e);
                    return (
                      <tr key={e.id} className="border-b border-gray-100 align-top last:border-0">
                        <td className="py-2 pr-4 font-medium text-gray-800">{imob?.nome ?? "—"}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-gray-500">
                          {imob?.codigo_produtor_corp ?? "—"}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap text-gray-600">{formatarDataHora(e.created_at)}</td>
                        <td className="py-2 pr-4 max-w-[220px] break-words text-gray-600">
                          {e.destinatarios?.join(", ") || "—"}
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap text-gray-600">
                          {valor !== null ? formatarValor(valor) : "—"}
                        </td>
                        <td className="py-2 pr-4 text-gray-600">{e.enviado_por_email ?? "—"}</td>
                        <td className="py-2">
                          {e.resultado === "sucesso" ? (
                            <span className="rounded-sm bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                              Sucesso
                            </span>
                          ) : (
                            <span
                              className="rounded-sm bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700"
                              title={e.erro_detalhe ?? ""}
                            >
                              Erro
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
