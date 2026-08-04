import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import SeletorCompetencia from "./SeletorCompetencia";
import { adicionarEsperada, editarEsperada, vincularCnpjProvisoria } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEGURADORAS_PADRAO = ["TOKIO", "PORTO FIANÇA", "PORTO RE", "TOO", "POTTENCIAL", "YELUM"];

const ROTULO_STATUS: Record<string, string> = {
  aguardando_upload: "Aguardando upload",
  fatura_carregada: "Carregada",
  aguardando_identificacao: "Aguardando identificação",
  aguardando_conferencia: "Aguardando conferência",
  pronta_para_envio: "Pronta para envio",
  enviada: "Enviada",
  erro_no_envio: "Erro no envio",
  duplicada: "Duplicada",
  cancelada: "Cancelada",
};

const COR_STATUS: Record<string, string> = {
  aguardando_upload: "bg-gray-100 text-gray-700",
  fatura_carregada: "bg-blue-100 text-blue-700",
  aguardando_identificacao: "bg-yellow-100 text-yellow-800",
  aguardando_conferencia: "bg-yellow-100 text-yellow-800",
  pronta_para_envio: "bg-green-100 text-green-700",
  enviada: "bg-green-100 text-green-700",
  erro_no_envio: "bg-red-100 text-red-700",
  duplicada: "bg-red-100 text-red-700",
  cancelada: "bg-gray-100 text-gray-500",
};

const inputClass = "w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-o2-coral focus:outline-none";

function mesAtualDefault(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
}

const POR_PAGINA = 20;

type EsperadaRow = {
  id: string;
  imobiliaria_id: string | null;
  dia_vencimento: number | null;
  cnpj_o2: string | null;
  observacao: string | null;
  nome_provisorio: string | null;
  imobiliarias: { nome: string; cnpj: string | null } | { nome: string; cnpj: string | null }[] | null;
};

export default async function FaturasPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    aviso?: string;
    erro?: string;
    competencia?: string;
    seguradora?: string;
    limite?: string;
  }>;
}) {
  const {
    ok,
    aviso,
    erro,
    competencia: competenciaParam,
    seguradora: seguradoraParam,
    limite: limiteParam,
  } = await searchParams;
  const competencia = competenciaParam || mesAtualDefault();
  const limite = Math.max(POR_PAGINA, Number(limiteParam) || POR_PAGINA);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: seguradorasData } = await supabase
    .from("faturas_esperadas")
    .select("seguradora")
    .eq("ativo", true);
  const seguradorasCadastradas = Array.from(new Set((seguradorasData ?? []).map((s) => s.seguradora)));
  const seguradoras = seguradorasCadastradas.length
    ? Array.from(new Set([...SEGURADORAS_PADRAO.filter((s) => seguradorasCadastradas.includes(s)), ...seguradorasCadastradas]))
    : SEGURADORAS_PADRAO;
  const seguradora = seguradoraParam && seguradoras.includes(seguradoraParam) ? seguradoraParam : seguradoras[0];

  const [{ data: esperadasData, count: totalEsperadas }, { data: faturasData }, { data: pendentesData }] = await Promise.all([
    supabase
      .from("faturas_esperadas")
      .select("id, imobiliaria_id, dia_vencimento, cnpj_o2, observacao, nome_provisorio, imobiliarias(nome, cnpj)", {
        count: "exact",
      })
      .eq("seguradora", seguradora)
      .eq("ativo", true)
      .order("id")
      .range(0, limite - 1),
    supabase
      .from("faturas")
      .select("id, imobiliaria_id, valor, vencimento, status, arquivo_nome")
      .eq("seguradora", seguradora)
      .eq("competencia", competencia),
    supabase.from("faturas").select("status").in("status", ["aguardando_identificacao", "aguardando_conferencia"]),
  ]);
  const esperadas = (esperadasData ?? []) as EsperadaRow[];
  const faturasPorImobiliaria = new Map((faturasData ?? []).map((f) => [f.imobiliaria_id, f]));
  const pendentes = pendentesData?.length ?? 0;

  // Faturas carregadas nessa seguradora/competência mas cuja imobiliária
  // ainda não está na lista de esperadas (parceiro novo, ainda sem
  // registro fixo) — mostra também, marcado.
  const idsEsperadas = new Set(esperadas.map((e) => e.imobiliaria_id));
  const extras = (faturasData ?? []).filter((f) => f.imobiliaria_id && !idsEsperadas.has(f.imobiliaria_id));

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-5xl flex-1 space-y-6 p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Faturas mensais</h1>
            <p className="text-sm text-gray-500">
              Boletos de seguradora recebidos para reenvio às imobiliárias — uso interno O2.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SeletorCompetencia competencia={competencia} />
            {pendentes > 0 && (
              <Link
                href="/faturas/conferencia"
                className="whitespace-nowrap rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
              >
                Conferência ({pendentes})
              </Link>
            )}
            <Link
              href="/faturas/upload"
              className="whitespace-nowrap rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              Enviar fatura
            </Link>
          </div>
        </div>

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">{ok}</p>}
        {aviso && (
          <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">{aviso}</p>
        )}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <div className="flex flex-wrap gap-1 border-b border-gray-200">
          {seguradoras.map((s) => (
            <Link
              key={s}
              href={`/faturas?competencia=${competencia}&seguradora=${encodeURIComponent(s)}`}
              className={`rounded-t-lg border border-b-0 px-3 py-1.5 text-sm font-medium ${
                s === seguradora
                  ? "border-gray-200 bg-white text-o2-navy"
                  : "border-transparent text-gray-500 hover:text-o2-navy"
              }`}
            >
              {s}
            </Link>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl rounded-tl-none border border-o2-navy/10 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500">
                <th className="px-3 py-2 font-medium">Parceiro</th>
                <th className="px-3 py-2 font-medium">CNPJ</th>
                <th className="px-3 py-2 font-medium">Venc.</th>
                <th className="px-3 py-2 font-medium">CNPJ O2</th>
                <th className="px-3 py-2 font-medium">Observação</th>
                <th className="px-3 py-2 font-medium">Situação ({competencia})</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {esperadas.map((e) => {
                const imob = Array.isArray(e.imobiliarias) ? e.imobiliarias[0] : e.imobiliarias;
                const fatura = e.imobiliaria_id ? faturasPorImobiliaria.get(e.imobiliaria_id) : undefined;
                const pendente = !imob && !!e.nome_provisorio;
                return (
                  <tr key={e.id} className={`border-b border-gray-50 last:border-0 align-top ${pendente ? "bg-orange-50/40" : ""}`}>
                    <td className="px-3 py-2 text-gray-800">{imob?.nome ?? e.nome_provisorio ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-500">
                      {imob?.cnpj ?? (
                        <form action={vincularCnpjProvisoria} className="flex items-center gap-1">
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="seguradora" value={seguradora} />
                          <input name="cnpj" placeholder="CNPJ" className={`${inputClass} w-28`} />
                          <button type="submit" className="whitespace-nowrap text-xs font-medium text-o2-navy hover:underline">
                            Vincular
                          </button>
                        </form>
                      )}
                    </td>
                    <form action={editarEsperada} id={`form-${e.id}`}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="seguradora" value={seguradora} />
                    </form>
                    <td className="px-3 py-2">
                      <input
                        form={`form-${e.id}`}
                        name="dia_vencimento"
                        type="number"
                        min={1}
                        max={31}
                        defaultValue={e.dia_vencimento ?? ""}
                        className={`${inputClass} w-14`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select form={`form-${e.id}`} name="cnpj_o2" defaultValue={e.cnpj_o2 ?? ""} className={inputClass}>
                        <option value="">—</option>
                        <option value="O2 Seguros">O2 Seguros</option>
                        <option value="O2 Cap">O2 Cap</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        form={`form-${e.id}`}
                        name="observacao"
                        defaultValue={e.observacao ?? ""}
                        className={`${inputClass} w-40`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {fatura ? (
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COR_STATUS[fatura.status] ?? "bg-gray-100 text-gray-700"}`}>
                          {ROTULO_STATUS[fatura.status] ?? fatura.status}
                        </span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                          Não tem fatura
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button
                        form={`form-${e.id}`}
                        type="submit"
                        className="text-xs font-medium text-o2-navy hover:underline"
                      >
                        Salvar
                      </button>
                      {e.imobiliaria_id && (
                        <>
                          {" · "}
                          <Link
                            href={`/faturas/imobiliaria/${e.imobiliaria_id}`}
                            className="text-xs font-medium text-o2-navy hover:underline"
                          >
                            Gerenciar
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}

              {extras.map((f) => (
                <tr key={f.id} className="border-b border-gray-50 bg-amber-50/40 last:border-0">
                  <td className="px-3 py-2 text-gray-800" colSpan={4}>
                    Parceiro novo (não cadastrado ainda) — {f.arquivo_nome}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">Confirme na Conferência</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COR_STATUS[f.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {ROTULO_STATUS[f.status] ?? f.status}
                    </span>
                  </td>
                  <td />
                </tr>
              ))}

              {!esperadas.length && !extras.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-500">
                    Nenhuma imobiliária cadastrada ainda pra {seguradora}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalEsperadas != null && totalEsperadas > esperadas.length && (
          <div className="text-center">
            <Link
              href={`/faturas?competencia=${competencia}&seguradora=${encodeURIComponent(seguradora)}&limite=${limite + POR_PAGINA}`}
              className="text-sm font-medium text-o2-navy hover:underline"
            >
              Mostrar mais {Math.min(POR_PAGINA, totalEsperadas - esperadas.length)} (
              {esperadas.length} de {totalEsperadas})
            </Link>
          </div>
        )}

        <details className="rounded-xl border border-o2-navy/10 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-o2-navy">+ Adicionar imobiliária</summary>
          <p className="mt-1 text-xs text-gray-500">
            Um cadastro só, marcando quais seguradoras essa imobiliária tem — não precisa repetir
            aba por aba.
          </p>
          <form action={adicionarEsperada} className="mt-3 space-y-3">
            <input type="hidden" name="voltar_para" value={`&competencia=${competencia}&seguradora=${encodeURIComponent(seguradora)}`} />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input name="nome" placeholder="Nome da imobiliária" required className={inputClass} />
              <input name="cnpj" placeholder="CNPJ" required className={inputClass} />
            </div>
            <div className="flex flex-wrap gap-3">
              {seguradoras.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-xs text-gray-700">
                  <input type="checkbox" name="seguradoras" value={s} defaultChecked={s === seguradora} />
                  {s}
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="rounded-full bg-o2-coral px-4 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
            >
              Adicionar
            </button>
          </form>
        </details>
      </main>
    </>
  );
}
