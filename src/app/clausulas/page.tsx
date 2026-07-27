import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { addSeguradora, addProduto, addCobertura } from "./actions";
import { signOut } from "../actions";
import AppHeader from "@/components/AppHeader";
import BackLink from "@/components/BackLink";

export const dynamic = "force-dynamic";

export default async function ClausulasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) redirect("/");

  const [{ data: tiposGarantia }, { data: seguradoras }, { data: produtos }, { data: coberturas }] =
    await Promise.all([
      supabase.from("tipos_garantia").select("id, nome").order("nome"),
      supabase.from("seguradoras").select("id, nome").order("nome"),
      supabase
        .from("produtos")
        .select("id, nome, clausula_base, seguradoras(nome), tipos_garantia(nome)")
        .order("nome"),
      supabase
        .from("coberturas_adicionais")
        .select("id, nome, texto, produtos(nome)")
        .order("nome"),
    ]);

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-3xl flex-1 space-y-12 p-8">
      <div className="space-y-2">
        <BackLink />
        <h1 className="text-xl font-semibold text-o2-navy">Biblioteca de cláusulas de garantia</h1>
      </div>

      {/* Seguradoras */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-o2-navy">1. Seguradoras</h2>
        <form action={addSeguradora} className="flex gap-2">
          <label htmlFor="nome-seguradora" className="sr-only">Nome da seguradora</label>
          <input
            id="nome-seguradora"
            name="nome"
            placeholder="Nome da seguradora (ex: Porto Seguro)"
            required
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          <button className="rounded-full bg-o2-coral px-4 py-2 font-medium text-white transition hover:opacity-90" type="submit">
            Adicionar
          </button>
        </form>
        <ul className="list-disc pl-5">
          {seguradoras?.map((s) => <li key={s.id}>{s.nome}</li>)}
          {!seguradoras?.length && <p className="text-sm text-gray-500">Nenhuma seguradora cadastrada ainda.</p>}
        </ul>
      </section>

      {/* Produtos */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-o2-navy">2. Produtos (cláusula-base obrigatória)</h2>
        <form action={addProduto} className="space-y-2">
          <div className="flex gap-2">
            <select name="seguradora_id" className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none">
              <option value="">Sem seguradora (ex: Fiador, Caução)</option>
              {seguradoras?.map((s) => (
                <option key={s.id} value={s.id}>{s.nome}</option>
              ))}
            </select>
            <select name="tipo_garantia_id" required className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none">
              <option value="">Tipo de garantia...</option>
              {tiposGarantia?.map((t) => (
                <option key={t.id} value={t.id}>{t.nome}</option>
              ))}
            </select>
          </div>
          <label htmlFor="nome-produto" className="sr-only">Nome do produto</label>
          <input
            id="nome-produto"
            name="nome"
            placeholder="Nome do produto (ex: Fiança Taxa Fixa)"
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          <label htmlFor="clausula-base" className="sr-only">Texto da cláusula-base obrigatória</label>
          <textarea
            id="clausula-base"
            name="clausula_base"
            placeholder="Texto da cláusula-base obrigatória"
            required
            rows={4}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          <button className="rounded-full bg-o2-coral px-4 py-2 font-medium text-white transition hover:opacity-90" type="submit">
            Adicionar produto
          </button>
        </form>
        <ul className="space-y-2">
          {produtos?.map((p) => {
            const seguradora = Array.isArray(p.seguradoras) ? p.seguradoras[0] : p.seguradoras;
            const tipo = Array.isArray(p.tipos_garantia) ? p.tipos_garantia[0] : p.tipos_garantia;
            return (
              <li key={p.id} className="rounded-xl border border-o2-navy/10 bg-white p-3">
                <p className="font-medium">
                  {seguradora?.nome ? `${seguradora.nome} — ` : ""}
                  {p.nome} <span className="text-sm text-gray-500">({tipo?.nome})</span>
                </p>
                <p className="mt-1 text-sm text-gray-600">{p.clausula_base}</p>
              </li>
            );
          })}
          {!produtos?.length && <p className="text-sm text-gray-500">Nenhum produto cadastrado ainda.</p>}
        </ul>
      </section>

      {/* Coberturas adicionais */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-o2-navy">3. Coberturas adicionais (opcionais)</h2>
        <form action={addCobertura} className="space-y-2">
          <select name="produto_id" required className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none">
            <option value="">Produto...</option>
            {produtos?.map((p) => {
              const seguradora = Array.isArray(p.seguradoras) ? p.seguradoras[0] : p.seguradoras;
              return (
                <option key={p.id} value={p.id}>
                  {seguradora?.nome ? `${seguradora.nome} — ` : ""}
                  {p.nome}
                </option>
              );
            })}
          </select>
          <label htmlFor="nome-cobertura" className="sr-only">Nome da cobertura</label>
          <input
            id="nome-cobertura"
            name="nome"
            placeholder="Nome da cobertura (ex: Danos ao Imóvel)"
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          <label htmlFor="texto-cobertura" className="sr-only">Texto da cláusula dessa cobertura</label>
          <textarea
            id="texto-cobertura"
            name="texto"
            placeholder="Texto da cláusula dessa cobertura"
            required
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
          />
          <button className="rounded-full bg-o2-coral px-4 py-2 font-medium text-white transition hover:opacity-90" type="submit">
            Adicionar cobertura
          </button>
        </form>
        <ul className="space-y-2">
          {coberturas?.map((c) => {
            const produto = Array.isArray(c.produtos) ? c.produtos[0] : c.produtos;
            return (
              <li key={c.id} className="rounded-xl border border-o2-navy/10 bg-white p-3">
                <p className="font-medium">
                  {c.nome} <span className="text-sm text-gray-500">({produto?.nome})</span>
                </p>
                <p className="mt-1 text-sm text-gray-600">{c.texto}</p>
              </li>
            );
          })}
          {!coberturas?.length && <p className="text-sm text-gray-500">Nenhuma cobertura cadastrada ainda.</p>}
        </ul>
      </section>
      </main>
    </>
  );
}
