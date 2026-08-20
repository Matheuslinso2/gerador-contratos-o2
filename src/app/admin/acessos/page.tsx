import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isMatheus } from "@/lib/admin";
import { signOut } from "../../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";

export const dynamic = "force-dynamic";

type LinhaAcesso = {
  email: string;
  dia: string;
  primeiro_acesso: string;
  ultimo_acesso: string;
  qtd_requisicoes: number;
};

function fmtHora(v: string): string {
  return new Date(v).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}
function fmtDia(dia: string): string {
  // dia vem como "YYYY-MM-DD" (date do Postgres) -- monta a data local sem
  // passar por Date(string) direto, que interpretaria como UTC meia-noite e
  // podia voltar um dia dependendo do fuso de quem está lendo.
  const [ano, mes, diaNum] = dia.split("-").map(Number);
  return new Date(ano, mes - 1, diaNum).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export default async function AdminAcessosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isMatheus(user?.email)) redirect("/");

  const LIMITE_DIAS = 30;
  const { data: acessos } = await supabase
    .from("workspace_acessos_diarios")
    .select("email, dia, primeiro_acesso, ultimo_acesso, qtd_requisicoes")
    .order("dia", { ascending: false })
    .order("email", { ascending: true })
    .limit(LIMITE_DIAS * 40);

  const porDia = new Map<string, LinhaAcesso[]>();
  for (const a of (acessos as LinhaAcesso[] | null) ?? []) {
    const lista = porDia.get(a.dia) ?? [];
    lista.push(a);
    porDia.set(a.dia, lista);
  }
  const dias = [...porDia.keys()].sort((a, b) => (a < b ? 1 : -1)).slice(0, LIMITE_DIAS);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-6 p-8">
        <div className="space-y-2">
          <BackLink />
          <div>
            <h1 className="text-xl font-semibold text-o2-navy">Uso diário do Workspace</h1>
            <p className="text-sm text-gray-500">
              Quem de fato usou o sistema em cada dia — não é histórico de login (a sessão fica salva por muito
              tempo, então &quot;último login&quot; não reflete uso real). Últimos {LIMITE_DIAS} dias com registro.
            </p>
          </div>
        </div>

        <div className="space-y-5">
          {dias.map((dia) => {
            const linhas = (porDia.get(dia) ?? []).sort((a, b) => a.email.localeCompare(b.email));
            return (
              <div key={dia} className="rounded-xl border border-o2-navy/10 bg-white p-4">
                <p className="mb-2 font-medium text-o2-navy">
                  {fmtDia(dia)} <span className="text-sm font-normal text-gray-400">({linhas.length} pessoa(s))</span>
                </p>
                <div className="space-y-1">
                  {linhas.map((l) => (
                    <div key={l.email} className="flex items-center justify-between text-sm text-gray-600">
                      <span>{l.email}</span>
                      <span className="text-gray-400">
                        {fmtHora(l.primeiro_acesso)}–{fmtHora(l.ultimo_acesso)} · {l.qtd_requisicoes} requisiç{l.qtd_requisicoes === 1 ? "ão" : "ões"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {dias.length === 0 && (
            <p className="text-sm text-gray-500">
              Nenhum acesso registrado ainda — o registro começou a valer a partir do deploy desta funcionalidade,
              não tem dado retroativo.
            </p>
          )}
        </div>
      </main>
    </>
  );
}
