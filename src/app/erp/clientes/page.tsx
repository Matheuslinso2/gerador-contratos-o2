import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { buscarClientes, codigoCliente, formatarDocumento } from "@/lib/erp/clientes";
import { lerFiltros } from "@/lib/erp/filtros";
import FiltrosErp from "../FiltrosErp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clientes" };

// Cadastro de clientes do ERP (Matheus 27/10/2026), como o menu de Clientes do Corp: base única de pessoas (titular, segurado, proprietário,
// inquilino, garantido). Código do cliente CLI-000001 para toda a base; CPF/CNPJ sempre; e-mail ou telefone sempre.
// Duas listas de trabalho: "cadastro incompleto" (falta contato ou CPF/CNPJ) e "a cadastrar" (parte da proposta sem cliente no cadastro).
type Pendente = { id: string; papel: string; nome: string | null; documento_numero: string | null; nosso_numero: number; documento_id: string };

const PAPEL: Record<string, string> = { locatario: "Locatário", garantido: "Garantido (locatário)", proprietario: "Proprietário (segurado)", condutor: "Condutor", beneficiario: "Beneficiário" };

export default async function ErpClientesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = lerFiltros(sp);
  const vista = sp.vista === "incompletos" || sp.vista === "a_cadastrar" ? (sp.vista as string) : "todos";
  const limite = Math.min(Number(typeof sp.limite === "string" ? sp.limite : 50) || 50, 500);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [lista, { data: resumo }, { count: nACadastrar }, pend] = await Promise.all([
    vista === "a_cadastrar" ? Promise.resolve({ linhas: [], total: 0 }) : buscarClientes(supabase, { q: f.q, incompleto: vista === "incompletos", limite }),
    // contagens da base em tabela pronta (cron horário): contar 37 mil cadastros na hora passava de 1 s
    supabase.from("erp_clientes_resumo").select("total, incompletos").eq("id", 1).maybeSingle(),
    supabase.from("erp_item_partes").select("id", { count: "exact", head: true }).is("locatario_id", null),
    vista === "a_cadastrar"
      ? supabase
          .from("erp_item_partes")
          .select("id, papel, nome, documento_numero, item:erp_documento_itens!inner(documento_id, documento:erp_documentos!inner(nosso_numero))")
          .is("locatario_id", null)
          .order("id", { ascending: false })
          .limit(limite)
      : Promise.resolve({ data: [] }),
  ]);
  const totalBase = resumo?.total ?? null;
  const nIncompletos = resumo?.incompletos ?? null;
  const pendentes: Pendente[] = ((pend.data ?? []) as unknown as { id: string; papel: string; nome: string | null; documento_numero: string | null; item: { documento_id: string; documento: { nosso_numero: number } } }[]).map((p) => ({
    id: p.id, papel: p.papel, nome: p.nome, documento_numero: p.documento_numero, nosso_numero: p.item.documento.nosso_numero, documento_id: p.item.documento_id,
  }));

  const chip = (v: string, rotulo: string) => (
    <Link href={v === "todos" ? "/erp/clientes" : `/erp/clientes?vista=${v}`} className={`rounded-full border px-3 py-1 text-xs font-medium ${vista === v ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 text-gray-700"}`}>
      {rotulo}
    </Link>
  );

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 p-8">
      <PageHeader
        icon={<IconReport />}
        titulo="ERP O2 — Clientes"
        subtitulo="Base única de pessoas do ERP: titular, segurado, proprietário, inquilino e garantido, de todos os produtos. Cada cliente tem um código único (CLI-000001); CPF ou CNPJ é obrigatório, e também e-mail ou telefone."
      />

      <div className="flex flex-wrap items-center gap-2">
        {chip("todos", `Todos (${(totalBase ?? 0).toLocaleString("pt-BR")})`)}
        {chip("incompletos", `Cadastro incompleto (${(nIncompletos ?? 0).toLocaleString("pt-BR")})`)}
        {chip("a_cadastrar", `A cadastrar: partes de proposta sem cliente (${(nACadastrar ?? 0).toLocaleString("pt-BR")})`)}
        <Link href="/erp/clientes/novo" className="ml-auto rounded-full bg-o2-navy px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90">+ Novo cliente</Link>
      </div>

      {vista !== "a_cadastrar" && (
        <FiltrosErp caminho="/erp/clientes" campos={["busca"]} valores={f} rotuloBusca="Buscar cliente" placeholderBusca="Nome · CPF/CNPJ · CLI-000123" resumo={<>{lista.total !== null ? `${lista.total.toLocaleString("pt-BR")} cliente(s)` : "os mais recentes (use a busca para localizar)"}</>} />
      )}

      {vista === "a_cadastrar" ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <p className="border-b border-gray-100 p-3 text-xs text-gray-600">
            Partes de propostas que ainda não estão no cadastro: sem CPF/CNPJ válido a pessoa não é criada sozinha. Complete o documento no card ou cadastre o cliente.
          </p>
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr><th className="px-3 py-2">Documento</th><th className="px-3 py-2">Papel</th><th className="px-3 py-2">Nome</th><th className="px-3 py-2">CPF/CNPJ informado</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pendentes.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium"><Link href={`/erp/documentos/${p.documento_id}`} className="text-o2-navy hover:underline">{p.nosso_numero}</Link></td>
                  <td className="px-3 py-2">{PAPEL[p.papel] ?? p.papel}</td>
                  <td className="px-3 py-2">{p.nome ?? <span className="text-gray-400">sem nome</span>}</td>
                  <td className="px-3 py-2">{p.documento_numero ? formatarDocumento(p.documento_numero) : <span className="text-red-600">sem CPF/CNPJ</span>}</td>
                </tr>
              ))}
              {pendentes.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-gray-500">Nenhuma parte pendente.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : lista.linhas.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Nenhum cliente encontrado.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr><th className="px-3 py-2">Código</th><th className="px-3 py-2">Nome</th><th className="px-3 py-2">CPF/CNPJ</th><th className="px-3 py-2">E-mail</th><th className="px-3 py-2">Telefone</th><th className="px-3 py-2">Cadastro</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.linhas.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium"><Link href={`/erp/clientes/${c.id}`} className="text-o2-navy hover:underline">{codigoCliente(c.codigo_cliente)}</Link></td>
                  <td className="px-3 py-2">{c.nome ?? "—"}</td>
                  <td className="px-3 py-2">{c.cpf ? formatarDocumento(c.cpf) : <span className="text-red-600">falta</span>}</td>
                  <td className="px-3 py-2">{c.email ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2">{c.telefone ?? <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-2">{c.cadastro_incompleto ? <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-800">incompleto</span> : <span className="text-green-700">ok</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {vista !== "a_cadastrar" && (lista.total ?? 0) > lista.linhas.length && (
        <Link href={`/erp/clientes?${new URLSearchParams({ ...(f.q ? { q: f.q } : {}), ...(vista !== "todos" ? { vista } : {}), limite: String(lista.linhas.length + 50) })}`} className="inline-block rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy hover:bg-o2-navy hover:text-white">
          Mostrar mais
        </Link>
      )}
    </main>
  );
}
