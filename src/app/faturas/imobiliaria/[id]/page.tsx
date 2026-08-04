import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import { salvarSeguradorasImobiliaria, atualizarEmailFaturas } from "../../actions";

export const dynamic = "force-dynamic";

const SEGURADORAS_PADRAO = ["TOKIO", "PORTO FIANÇA", "PORTO RE", "TOO", "POTTENCIAL", "YELUM"];

const inputClass = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none";

type Vinculo = {
  seguradora: string;
  ativo: boolean;
  dia_vencimento: number | null;
  cnpj_o2: string | null;
  observacao: string | null;
};

export default async function ImobiliariaFaturasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; erro?: string }>;
}) {
  const { id } = await params;
  const { ok, erro } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: imobiliaria }, { data: vinculosData }] = await Promise.all([
    supabase.from("imobiliarias").select("id, nome, cnpj, email_faturas").eq("id", id).single(),
    supabase
      .from("faturas_esperadas")
      .select("seguradora, ativo, dia_vencimento, cnpj_o2, observacao")
      .eq("imobiliaria_id", id),
  ]);
  if (!imobiliaria) redirect("/faturas");

  const vinculos = (vinculosData ?? []) as Vinculo[];
  const porSeguradora = new Map(vinculos.map((v) => [v.seguradora, v]));
  const seguradoras = Array.from(new Set([...SEGURADORAS_PADRAO, ...vinculos.map((v) => v.seguradora)]));

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-2xl flex-1 space-y-6 p-8">
        <div className="space-y-1">
          <Link
            href="/faturas"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-o2-navy hover:underline"
          >
            ← Voltar para Faturas
          </Link>
          <h1 className="text-xl font-semibold text-o2-navy">{imobiliaria.nome}</h1>
          <p className="text-sm text-gray-500">CNPJ: {imobiliaria.cnpj}</p>
        </div>

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">✅ {ok}</p>}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {erro}</p>}

        <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-o2-navy">E-mail para envio de faturas</h2>
          <p className="mb-3 text-xs text-gray-500">
            Pra onde as faturas dessa imobiliária serão enviadas — diferente do e-mail de login dela.
          </p>
          <form action={atualizarEmailFaturas} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="imobiliaria_id" value={imobiliaria.id} />
            <input
              name="email_faturas"
              type="email"
              placeholder="financeiro@imobiliaria.com.br"
              defaultValue={imobiliaria.email_faturas ?? ""}
              className={`${inputClass} max-w-sm`}
            />
            <button
              type="submit"
              className="rounded-full bg-o2-navy px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              Salvar e-mail
            </button>
          </form>
        </div>

        <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-o2-navy">Seguradoras e dados de cada uma</h2>
          <p className="mb-4 text-xs text-gray-500">
            Desmarcar uma seguradora não apaga o histórico — só faz essa imobiliária parar de
            aparecer como esperada nela. Esses campos só são editáveis aqui, não na tela principal.
          </p>
          <form action={salvarSeguradorasImobiliaria} className="space-y-4">
            <input type="hidden" name="imobiliaria_id" value={imobiliaria.id} />
            <input type="hidden" name="qtd" value={seguradoras.length} />
            {seguradoras.map((s, i) => {
              const v = porSeguradora.get(s);
              return (
                <div key={s} className="rounded-lg border border-gray-200 p-3">
                  <input type="hidden" name={`seguradora_${i}`} value={s} />
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                    <input type="checkbox" name={`ativo_${i}`} defaultChecked={v?.ativo ?? false} />
                    {s}
                  </label>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <label className="mb-0.5 block text-xs text-gray-500">Dia de vencimento</label>
                      <input
                        name={`dia_vencimento_${i}`}
                        type="number"
                        min={1}
                        max={31}
                        defaultValue={v?.dia_vencimento ?? ""}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs text-gray-500">CNPJ O2</label>
                      <select name={`cnpj_o2_${i}`} defaultValue={v?.cnpj_o2 ?? ""} className={inputClass}>
                        <option value="">—</option>
                        <option value="O2 Seguros">O2 Seguros</option>
                        <option value="O2 Capitalização">O2 Capitalização</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs text-gray-500">Observação</label>
                      <input name={`observacao_${i}`} defaultValue={v?.observacao ?? ""} className={inputClass} />
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              type="submit"
              className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90"
            >
              Salvar
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
