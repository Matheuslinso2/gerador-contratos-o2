import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import { resolverImobiliariaProvisoria } from "../../actions";
import { SEGURADORAS_CANONICAS } from "@/lib/faturasIdentificacao";

export const dynamic = "force-dynamic";

const inputClass = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none";

type Vinculo = {
  seguradora: string;
  ativo: boolean;
  dia_vencimento: number | null;
  cnpj_o2: string | null;
  observacao: string | null;
};

// "Editar" de uma imobiliária que ainda não tem CNPJ/CPF vinculado (só um
// nome_provisorio, vindo de uma fatura identificada por texto). Cadastro
// completo numa tela só: CNPJ/CPF + e-mail + dados de cada seguradora —
// ao salvar, cria (ou resolve) o registro de verdade em imobiliarias e
// converte as linhas provisórias, tudo de uma vez.
export default async function NovaImobiliariaFaturasPage({
  searchParams,
}: {
  searchParams: Promise<{ nome?: string; ok?: string; erro?: string }>;
}) {
  const { nome: nomeParam, ok, erro } = await searchParams;
  const nomeProvisorio = (nomeParam ?? "").trim();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");
  if (!nomeProvisorio) redirect("/faturas");

  const { data: vinculosData } = await supabase
    .from("faturas_esperadas")
    .select("seguradora, ativo, dia_vencimento, cnpj_o2, observacao")
    .eq("nome_provisorio", nomeProvisorio)
    .is("imobiliaria_id", null);

  const vinculos = (vinculosData ?? []) as Vinculo[];
  const porSeguradora = new Map(vinculos.map((v) => [v.seguradora, v]));
  const seguradoras = Array.from(new Set([...SEGURADORAS_CANONICAS, ...vinculos.map((v) => v.seguradora)]));

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
          <h1 className="text-xl font-semibold text-o2-navy">{nomeProvisorio}</h1>
          <p className="text-sm text-gray-500">Ainda sem CNPJ/CPF vinculado — complete o cadastro abaixo.</p>
        </div>

        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">✅ {ok}</p>}
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">⚠️ {erro}</p>}

        <form action={resolverImobiliariaProvisoria} className="space-y-6">
          <input type="hidden" name="nome_provisorio" value={nomeProvisorio} />

          <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-o2-navy">CNPJ ou CPF</h2>
            <p className="mb-3 text-xs text-gray-500">
              Obrigatório pra criar o cadastro definitivo — pode ser CPF, se for corretor autônomo.
            </p>
            <input name="cnpj" placeholder="Só números" required className={`${inputClass} max-w-xs`} />
          </div>

          <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-o2-navy">E-mail para envio de faturas</h2>
            <p className="mb-3 text-xs text-gray-500">
              Pra onde as faturas dessa imobiliária serão enviadas — diferente do e-mail de login dela.
            </p>
            <input
              name="email_faturas"
              type="email"
              placeholder="financeiro@imobiliaria.com.br"
              className={`${inputClass} max-w-sm`}
            />
          </div>

          <div className="rounded-xl border border-o2-navy/10 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-o2-navy">Seguradoras e dados de cada uma</h2>
            <p className="mb-4 text-xs text-gray-500">
              Já vem marcado quem tinha fatura pendente de identificação. Pode ajustar ou adicionar outras.
            </p>
            <input type="hidden" name="qtd" value={seguradoras.length} />
            <div className="space-y-4">
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
                        <label className="mb-0.5 block text-xs text-gray-500">Origem da fatura</label>
                        <select name={`cnpj_o2_${i}`} defaultValue={v?.cnpj_o2 ?? ""} className={inputClass}>
                          <option value="">—</option>
                          <option value="O2 Seguros">O2 Seguros</option>
                          <option value="O2 Capitalização">O2 Capitalização</option>
                          <option value="SegImob">SegImob</option>
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
            </div>
          </div>

          <button
            type="submit"
            className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Cadastrar imobiliária
          </button>
        </form>
      </main>
    </>
  );
}
