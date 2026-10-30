import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import RascunhoAutomatico from "@/components/RascunhoAutomatico";
import InfoLegenda from "@/components/InfoLegenda";
import { criarCliente } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Novo cliente" };

const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-navy focus:outline-none";

export default async function NovoClientePage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { erro } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  return (
    <main className="mx-auto w-full max-w-[640px] flex-1 space-y-4 p-8">
      <Link href="/erp/clientes" className="text-sm text-gray-500 hover:text-o2-navy hover:underline">← Clientes</Link>
      <h1 className="text-xl font-semibold text-o2-navy">
        Novo cliente
        <InfoLegenda titulo="Novo cliente">
          Cadastro de uma pessoa na base única de clientes, feito antes de criar o documento, como no Corp. Obrigatórios: nome ou razão social, CPF ou CNPJ válido e pelo menos um entre e-mail e telefone. Se o CPF/CNPJ já existir, o sistema abre o cadastro que já existe, sem criar outro. O rascunho é guardado automaticamente enquanto você digita. Cada cliente novo recebe seu Código do cliente (CLI-000001 e seguintes).
        </InfoLegenda>
      </h1>
      <p className="text-sm text-gray-600">
        Cadastre antes de criar o documento, como no Corp. CPF ou CNPJ é obrigatório, e também e-mail ou telefone. Se o CPF/CNPJ já existir, o sistema abre o cadastro que já existe, sem criar outro.
      </p>
      {erro && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{erro.split(" | ").map((e) => <span key={e} className="block">{e}</span>)}</p>}
      <form action={criarCliente} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <RascunhoAutomatico />
        <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">Nome completo ou razão social
          <input name="nome" required className={input} />
        </label>
        <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">CPF ou CNPJ
          <input name="documento" required inputMode="numeric" placeholder="somente números ou com pontuação" className={input} />
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">E-mail
            <input name="email" type="email" className={input} />
          </label>
          <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">Telefone com DDD
            <input name="telefone" inputMode="tel" className={input} />
          </label>
        </div>
        <p className="text-[11px] text-gray-500">Informe ao menos um dos dois: e-mail ou telefone.</p>
        <button type="submit" className="rounded-full bg-o2-navy px-5 py-2 text-sm font-semibold text-white hover:opacity-90">Cadastrar cliente</button>
      </form>
    </main>
  );
}
