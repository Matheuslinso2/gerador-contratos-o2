import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import RascunhoAutomatico from "@/components/RascunhoAutomatico";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { dadosDeCabecalhoPorId, SITUACOES, tipoDoCabecalho } from "@/lib/erp/documentos";
import { codigoCliente, formatarDocumento, tipoDoDocumento } from "@/lib/erp/clientes";
import { atualizarCliente } from "../actions";
import BotaoVerDocumento from "../../BotaoVerDocumento";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cliente" };

const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-navy focus:outline-none";
const AVISO: Record<string, string> = { criado: "Cliente cadastrado.", salvo: "Alterações salvas.", ja_existia: "Esse CPF/CNPJ já estava cadastrado: este é o cadastro que já existia, nenhum cliente novo foi criado." };

type Doc = { id: string; nosso_numero: number; tipo: string; tipo_corp: string | null; situacao: string; numero_apolice: string | null; vigencia_inicio: string | null; premio_total: number | null; seguradora: { abreviacao: string } | null; ramo: { abreviacao: string } | null; imobiliaria: { nome: string } | null };
type Kpis = { documentos: number; vigentes: number; produtos: string[]; premio_total: number; comissao: number; desde: string | null };

export default async function ErpClienteFichaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; aviso?: string }> }) {
  const { id } = await params;
  const { erro, aviso } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: c } = await supabase.from("locatarios").select("id, codigo_cliente, nome, cpf, email, telefone, primeira_fonte, created_at, codigo_corp_cliente, contatos_anteriores, cadastro_incompleto").eq("id", id).maybeSingle();
  if (!c) redirect("/erp/clientes");

  const [{ data: kpiBruto }, { data: proprios }, { data: comoSegurado }] = await Promise.all([
    supabase.rpc("erp_cliente_kpis", { p_pessoa: id }),
    supabase.from("erp_documentos").select("id").eq("locatario_id", id).neq("situacao", "duplicado").limit(300),
    supabase.from("erp_doc_partes_acervo").select("documento_id").eq("locatario_id", id).limit(300),
  ]);
  const ids = [...new Set([...(proprios ?? []).map((d: { id: string }) => d.id), ...(comoSegurado ?? []).map((d: { documento_id: string }) => d.documento_id)])];
  const { data: docsBrutos } = ids.length
    ? await supabase
        .from("erp_documentos")
        .select("id, nosso_numero, tipo, tipo_corp, situacao, numero_apolice, vigencia_inicio, premio_total, seguradora:erp_seguradoras(abreviacao), ramo:erp_ramos(abreviacao), imobiliaria:imobiliarias!erp_documentos_imobiliaria_principal_id_fkey(nome)")
        .in("id", ids.slice(0, 200))
        .neq("situacao", "duplicado")
        .order("vigencia_inicio", { ascending: false, nullsFirst: false })
    : { data: [] };
  const docs = (docsBrutos ?? []) as unknown as Doc[];
  // cabeçalho padrão (Matheus 28/10): tipo, titular, produto, seguradora e vigência
  const cab = await dadosDeCabecalhoPorId(supabase, docs.map((d) => d.id));
  const kpi = kpiBruto as Kpis | null;
  const incompleto = c.cadastro_incompleto as boolean;
  const documentoValido = !!tipoDoDocumento(c.cpf);
  const anteriores = (Array.isArray(c.contatos_anteriores) ? c.contatos_anteriores : []) as { email: string | null; telefone: string | null; ate: string }[];

  return (
    <main className="mx-auto w-full max-w-[1000px] flex-1 space-y-5 p-8">
      <Link href="/erp/clientes" className="text-sm text-gray-500 hover:text-o2-navy hover:underline">← Clientes</Link>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold text-o2-navy">{c.nome ?? "Cliente sem nome"}</h1>
        <span className="rounded bg-o2-navy px-2 py-0.5 text-xs font-semibold text-white">{codigoCliente(c.codigo_cliente)}</span>
        {incompleto && <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-800">cadastro incompleto</span>}
      </div>
      {aviso && AVISO[aviso] && <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{AVISO[aviso]}</p>}
      {erro && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{erro.split(" | ").map((e) => <span key={e} className="block">{e}</span>)}</p>}

      {kpi && kpi.documentos > 0 && (
        <section className="grid grid-cols-2 gap-3 rounded-xl border border-gray-200 bg-white p-4 md:grid-cols-4">
          <Info rotulo="Documentos (todo o histórico)" valor={`${kpi.documentos} (${kpi.vigentes} vigentes)`} />
          <Info rotulo="Produtos" valor={kpi.produtos.length ? kpi.produtos.join(", ") : "—"} />
          <Info rotulo="Prêmio total gerado" valor={formatarReais(kpi.premio_total)} />
          <Info rotulo="Comissão gerada" valor={`${formatarReais(kpi.comissao)}${kpi.desde ? ` · desde ${formatarData(kpi.desde)}` : ""}`} />
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Cadastro</h2>
        <form action={atualizarCliente} className="space-y-3">
          <RascunhoAutomatico sufixo={c.id} />
          <input type="hidden" name="id" value={c.id} />
          <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">Nome completo ou razão social
            <input name="nome" defaultValue={c.nome ?? ""} required className={input} />
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">CPF/CNPJ</div>
              {documentoValido ? <div className="mt-1 rounded-lg bg-gray-50 px-3 py-2 text-sm">{formatarDocumento(c.cpf)}</div> : (
                <>
                  <input name="documento" defaultValue={c.cpf ?? ""} placeholder="falta: informe o CPF ou CNPJ" className={`${input} mt-1 border-red-300`} />
                  <p className="mt-1 text-[11px] text-red-700">{c.cpf ? "CPF/CNPJ inválido no cadastro: corrija." : "Sem CPF/CNPJ: informe."}</p>
                </>
              )}
            </div>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">E-mail
              <input name="email" type="email" defaultValue={c.email ?? ""} className={input} />
            </label>
            <label className="block text-[11px] font-medium uppercase tracking-wide text-gray-500">Telefone com DDD
              <input name="telefone" defaultValue={c.telefone ?? ""} className={input} />
            </label>
          </div>
          <p className="text-[11px] text-gray-500">
            Origem do cadastro: {c.primeira_fonte ?? "—"} · criado em {formatarData(c.created_at)}
            {c.codigo_corp_cliente ? ` · código do cliente no Corp ${c.codigo_corp_cliente}` : ""}. O CPF/CNPJ é a chave do cadastro e não muda; e-mail e telefone antigos ficam guardados no histórico.
          </p>
          <button type="submit" className="rounded-full bg-o2-navy px-5 py-2 text-sm font-semibold text-white hover:opacity-90">Salvar</button>
        </form>
        {anteriores.length > 0 && (
          <p className="text-[11px] text-gray-500">Contatos anteriores: {anteriores.map((a) => [a.email, a.telefone].filter(Boolean).join(" / ")).join(" · ")}</p>
        )}
      </section>

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Documentos deste cliente</h2>
        {docs.length === 0 ? (
          <p className="text-xs text-gray-500">Nenhum documento ligado a este cliente.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr><th className="py-1 pr-3">Abrir</th><th className="py-1 pr-3">Tipo de documento</th><th className="py-1 pr-3">Titular do seguro</th><th className="py-1 pr-3">Produto</th><th className="py-1 pr-3">Seguradora</th><th className="py-1 pr-3">Vigência</th><th className="py-1 pr-3">Situação</th><th className="py-1 pr-3">Código O2 do documento</th><th className="py-1 pr-3">Nº da apólice</th><th className="py-1 pr-3">Imobiliária</th><th className="py-1 pr-3 text-right">Prêmio total</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {docs.map((d) => {
                  const k = cab.get(d.id);
                  const t = tipoDoCabecalho({ tipo: d.tipo, tipo_corp: d.tipo_corp, situacao: d.situacao, modo_cobranca: k?.modo_cobranca ?? null });
                  return (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="py-1.5 pr-3"><BotaoVerDocumento id={d.id} /></td>
                      <td className="py-1.5 pr-3"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${t.cor}`}>{t.nome}</span></td>
                      <td className="py-1.5 pr-3">
                        {k?.titular ?? c.nome ? <span className="font-medium text-gray-900">{k?.titular ?? c.nome}</span> : "—"}
                        {k?.inquilino && k.inquilino !== (k.titular ?? c.nome) ? <span className="block text-[10px] text-gray-500">inquilino: {k.inquilino}</span> : null}
                      </td>
                      <td className="py-1.5 pr-3">{k?.produto_nome ?? d.ramo?.abreviacao ?? "—"}</td>
                      <td className="py-1.5 pr-3">{k?.seguradora_nome ?? d.seguradora?.abreviacao ?? "—"}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3">{d.vigencia_inicio || k?.vigencia_fim ? `${formatarData(d.vigencia_inicio)} a ${formatarData(k?.vigencia_fim ?? null)}` : "—"}</td>
                      <td className="py-1.5 pr-3">{SITUACOES[d.situacao] ?? d.situacao}</td>
                      <td className="py-1.5 pr-3 font-medium"><Link href={`/erp/documentos/${d.id}`} className="text-o2-navy hover:underline">{d.nosso_numero}</Link></td>
                      <td className="py-1.5 pr-3">{d.numero_apolice ?? <span className="text-gray-300">0</span>}</td>
                      <td className="py-1.5 pr-3">{d.imobiliaria?.nome ?? <span className="text-gray-300">—</span>}</td>
                      <td className="py-1.5 pr-3 text-right">{formatarReais(d.premio_total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function Info({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{rotulo}</div>
      <div className="text-sm text-gray-900">{valor}</div>
    </div>
  );
}
