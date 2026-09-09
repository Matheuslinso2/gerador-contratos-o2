import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import FaturasSubHeader from "../FaturasSubHeader";
import SeletorCompetencia from "../SeletorCompetencia";
import { IconReport } from "../icons";

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
  seguradora: string | null;
  faturas_ids: string[];
  destinatarios: string[];
  resultado: string | null;
  erro_detalhe: string | null;
  enviado_por_email: string | null;
  created_at: string;
};

// Relatório de fechamento -- registro de tudo que já foi enviado numa
// competência, pra conferir antes de fechar o mês. Só o que foi enviado
// (pedido explícito do Matheus: pendência já tem espaço próprio na tela
// principal, aqui é o "livro-caixa" do que saiu de verdade).
export default async function FechamentoFaturasPage({
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
    .from("faturas_envios")
    .select("id, imobiliaria_id, seguradora, faturas_ids, destinatarios, resultado, erro_detalhe, enviado_por_email, created_at")
    .eq("competencia", competencia)
    .order("created_at", { ascending: false });
  const envios = (enviosData ?? []) as EnvioRow[];

  const [{ data: imobiliariasData }, { data: faturasData }] = await Promise.all([
    supabase
      .from("imobiliarias")
      .select("id, nome")
      .in("id", Array.from(new Set(envios.map((e) => e.imobiliaria_id).filter(Boolean) as string[]))),
    supabase
      .from("faturas")
      .select("id, valor, tipo_documento")
      .in("id", Array.from(new Set(envios.flatMap((e) => e.faturas_ids ?? [])))),
  ]);
  const nomePorImobiliaria = new Map((imobiliariasData ?? []).map((i) => [i.id, i.nome]));
  const faturaPorId = new Map((faturasData ?? []).map((f) => [f.id, f]));

  function valorDoEnvio(e: EnvioRow): number | null {
    const faturas = (e.faturas_ids ?? []).map((id) => faturaPorId.get(id)).filter(Boolean) as {
      valor: number | null;
      tipo_documento: string | null;
    }[];
    const boleto = faturas.find((f) => f.tipo_documento === "boleto" && f.valor !== null);
    const referencia = boleto ?? faturas.find((f) => f.valor !== null);
    return referencia?.valor ?? null;
  }

  const enviadosComSucesso = envios.filter((e) => e.resultado === "sucesso");
  const comErro = envios.filter((e) => e.resultado === "erro");
  const valorTotal = enviadosComSucesso.reduce((soma, e) => soma + (valorDoEnvio(e) ?? 0), 0);

  const porSeguradora = new Map<string, { qtd: number; valor: number }>();
  for (const e of enviadosComSucesso) {
    const seg = e.seguradora ?? "—";
    const atual = porSeguradora.get(seg) ?? { qtd: 0, valor: 0 };
    atual.qtd += 1;
    atual.valor += valorDoEnvio(e) ?? 0;
    porSeguradora.set(seg, atual);
  }

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-[1100px] flex-1 space-y-6 p-8">
        <FaturasSubHeader
          icon={<IconReport />}
          titulo="Fechamento de faturas"
          subtitulo="Registro de tudo que já foi enviado nessa competência, pra conferir antes de fechar o mês."
        />

        <div className="flex items-center gap-3 rounded-xl border border-o2-navy/10 bg-white p-3 shadow-sm">
          <span className="text-xs font-medium text-gray-500">Competência</span>
          <SeletorCompetencia competencia={competencia} basePath="/faturas/fechamento" />
          <span className="text-sm font-semibold text-o2-navy">{formatarCompetencia(competencia)}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Enviadas com sucesso</p>
            <p className="mt-1 text-2xl font-semibold text-o2-navy">{enviadosComSucesso.length}</p>
          </div>
          <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Com erro</p>
            <p className={`mt-1 text-2xl font-semibold ${comErro.length ? "text-red-600" : "text-o2-navy"}`}>
              {comErro.length}
            </p>
          </div>
          <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Valor total enviado</p>
            <p className="mt-1 text-2xl font-semibold text-o2-coral">{formatarValor(valorTotal)}</p>
          </div>
        </div>

        {porSeguradora.size > 0 && (
          <div className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-o2-navy">Por seguradora</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="pb-2 pr-4">Seguradora</th>
                    <th className="pb-2 pr-4">Enviadas</th>
                    <th className="pb-2">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(porSeguradora.entries()).map(([seg, dados]) => (
                    <tr key={seg} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-4 font-medium text-gray-800">{seg}</td>
                      <td className="py-2 pr-4 text-gray-600">{dados.qtd}</td>
                      <td className="py-2 text-gray-600">{formatarValor(dados.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
                    <th className="pb-2 pr-4">Seguradora</th>
                    <th className="pb-2 pr-4">Data/hora</th>
                    <th className="pb-2 pr-4">Destinatários</th>
                    <th className="pb-2 pr-4">Valor</th>
                    <th className="pb-2 pr-4">Autorizado por</th>
                    <th className="pb-2">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {envios.map((e) => (
                    <tr key={e.id} className="border-b border-gray-100 align-top last:border-0">
                      <td className="py-2 pr-4 font-medium text-gray-800">
                        {e.imobiliaria_id ? (nomePorImobiliaria.get(e.imobiliaria_id) ?? "—") : "—"}
                      </td>
                      <td className="py-2 pr-4 text-gray-600">{e.seguradora ?? "—"}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-gray-600">{formatarDataHora(e.created_at)}</td>
                      <td className="py-2 pr-4 max-w-[220px] break-words text-gray-600">
                        {e.destinatarios?.join(", ") || "—"}
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap text-gray-600">
                        {valorDoEnvio(e) !== null ? formatarValor(valorDoEnvio(e)!) : "—"}
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
