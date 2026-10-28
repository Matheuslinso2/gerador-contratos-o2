import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { lerFiltros, SEGURADORA_FATURA } from "@/lib/erp/filtros";
import { formatarReais } from "@/lib/sinistros/regras";
import FiltrosErp from "../FiltrosErp";

export const metadata = { title: "Imobiliárias" };
export const dynamic = "force-dynamic";

// ERP O2 — imobiliárias vistas pelo ERP. É a MESMA base única `imobiliarias` do Workspace e do Power BI (Matheus 28/10): o cadastro mora lá
// e aqui aparece o que é pertinente à gestão — grupo, códigos (O2, Corp, centralizador do Power BI), canal, produção vigente, propostas pendentes
// de emissão, faturas por seguradora e pró-labore pago direto. Resumos em tabela pronta (erp_imobiliarias_resumo, cron horário).
type Resumo = {
  imobiliaria_id: string; docs_total: number; docs_vigentes: number; premio_vigente: number; comissao_vigente: number;
  produtos: string[]; seguradoras: string[]; propostas_pendentes: number; faturas: number; seguradoras_fatura: string[];
};
type Imob = {
  id: string; nome: string; codigo_o2: number | null; codigo_produtor_corp: number | null; cidade: string | null; uf: string | null;
  papel_no_grupo: string | null; centralizador_power_bi: string | null; email_faturas: string[] | null;
  grupo: { nome: string } | null; canal: { nome: string } | null;
};

const VISTAS = [
  { chave: "vigentes", rotulo: "Com apólices vigentes" },
  { chave: "pendentes", rotulo: "Com propostas pendentes" },
  { chave: "faturas", rotulo: "Com fatura" },
  { chave: "todas", rotulo: "Todas" },
] as const;

export default async function ErpImobiliarias({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = lerFiltros(sp);
  const vista = VISTAS.find((v) => v.chave === sp.vista)?.chave ?? "vigentes";
  const limite = Math.min(Number(typeof sp.limite === "string" ? sp.limite : 100) || 100, 800);
  const supabase = await createClient();

  // filtros que resolvem uma lista de ids antes de ler o resumo
  let ids: string[] | null = null;
  const termo = f.q?.trim();
  if (termo) {
    const q = supabase.from("imobiliarias").select("id").limit(400);
    const { data } = /^\d+$/.test(termo) ? await q.or(`codigo_o2.eq.${termo},codigo_produtor_corp.eq.${termo}`) : await q.or(`nome.ilike.%${termo.replace(/[%_,()]/g, "")}%,apelido.ilike.%${termo.replace(/[%_,()]/g, "")}%,centralizador_power_bi.ilike.%${termo.replace(/[%_,()]/g, "")}%`);
    ids = (data ?? []).map((r: { id: string }) => r.id);
  }
  if (f.seguradora) {
    const { data: seg } = await supabase.from("erp_seguradoras").select("id").eq("abreviacao", f.seguradora).maybeSingle();
    const [{ data: comFatura }, { data: comPl }] = await Promise.all([
      supabase.from("faturas_esperadas").select("imobiliaria_id").eq("ativo", true).eq("seguradora", SEGURADORA_FATURA[f.seguradora] ?? "—"),
      supabase.from("erp_repasse_direto_seguradora").select("imobiliaria_id").eq("seguradora_id", seg?.id ?? "00000000-0000-0000-0000-000000000000"),
    ]);
    const daSeg = new Set([...(comFatura ?? []), ...(comPl ?? [])].map((r: { imobiliaria_id: string }) => r.imobiliaria_id));
    ids = ids ? ids.filter((i) => daSeg.has(i)) : [...daSeg];
  }
  const vazio = ["00000000-0000-0000-0000-000000000000"];

  let consulta = supabase.from("erp_imobiliarias_resumo").select("*", { count: "exact" }).order("premio_vigente", { ascending: false }).order("docs_total", { ascending: false }).limit(limite);
  if (ids) consulta = consulta.in("imobiliaria_id", ids.length ? ids : vazio);
  if (vista === "vigentes" && !termo) consulta = consulta.gt("docs_vigentes", 0);
  if (vista === "pendentes") consulta = consulta.gt("propostas_pendentes", 0);
  if (vista === "faturas") consulta = consulta.gt("faturas", 0);
  const { data: resumos, count } = await consulta;
  const lista = (resumos ?? []) as Resumo[];
  const idsLista = lista.map((r) => r.imobiliaria_id);

  const [{ data: imobs }, { data: pl }] = await Promise.all([
    idsLista.length
      ? supabase
          .from("imobiliarias")
          .select("id, nome, codigo_o2, codigo_produtor_corp, cidade, uf, papel_no_grupo, centralizador_power_bi, email_faturas, grupo:imobiliaria_grupos(nome), canal:erp_canais(nome)")
          .in("id", idsLista)
      : Promise.resolve({ data: [] }),
    supabase.from("erp_repasse_direto_seguradora").select("imobiliaria_id, pct, seguradora:erp_seguradoras(abreviacao)"),
  ]);
  const porId = new Map(((imobs ?? []) as unknown as Imob[]).map((i) => [i.id, i]));
  const proLabore = new Map<string, string[]>();
  for (const r of (pl ?? []) as unknown as { imobiliaria_id: string; pct: number; seguradora: { abreviacao: string } | null }[]) {
    const l = proLabore.get(r.imobiliaria_id) ?? [];
    l.push(`${r.seguradora?.abreviacao ?? "?"} ${Number(r.pct)}`);
    proLabore.set(r.imobiliaria_id, l);
  }
  const href = (v: string) => (v === "vigentes" ? "/erp/imobiliarias" : `/erp/imobiliarias?vista=${v}`);

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <h1 className="text-xl font-semibold text-o2-navy">Imobiliárias</h1>
        <p className="text-sm text-gray-600">
          A mesma base única de imobiliárias do Workspace e do Power BI. O cadastro (dados, contatos, grupo) é editado no Workspace; aqui aparece o que importa para a gestão: produção vigente, propostas pendentes de emissão, faturas e repasse.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {VISTAS.map((v) => (
          <Link key={v.chave} href={href(v.chave)} className={`rounded-full border px-3 py-1 text-xs font-medium ${vista === v.chave ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 text-gray-700"}`}>
            {v.rotulo}
          </Link>
        ))}
      </div>
      <FiltrosErp
        caminho="/erp/imobiliarias"
        campos={["busca", "seguradora"]}
        valores={f}
        rotuloBusca="Imobiliária"
        placeholderBusca="Nome, apelido, grupo do Power BI, cód. O2 da imobiliária ou cód. no Corp"
        resumo="Seguradora: imobiliárias com fatura nessa seguradora ou com pró-labore pago direto por ela."
      />
      <p className="text-xs text-gray-500">{(count ?? lista.length).toLocaleString("pt-BR")} imobiliária(s){lista.length < (count ?? 0) ? ` · mostrando ${lista.length}` : ""} · ordenadas pelo prêmio das apólices vigentes</p>
      <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Imobiliária</th>
              <th className="px-3 py-2">Grupo</th>
              <th className="px-3 py-2">Cód. O2 / no Corp (da imobiliária)</th>
              <th className="px-3 py-2 text-right">Vigentes</th>
              <th className="px-3 py-2 text-right">Prêmio vigente</th>
              <th className="px-3 py-2 text-right">Pend. emissão</th>
              <th className="px-3 py-2">Produtos</th>
              <th className="px-3 py-2">Fatura em</th>
              <th className="px-3 py-2">Pró-labore direto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lista.map((r) => {
              const i = porId.get(r.imobiliaria_id);
              if (!i) return null;
              return (
                <tr key={r.imobiliaria_id} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5">
                    <Link href={`/erp/imobiliarias/${i.id}`} className="font-medium text-o2-navy hover:underline">{i.nome}</Link>
                    <span className="block text-[11px] text-gray-400">{[i.cidade, i.uf].filter(Boolean).join(" / ") || "sem cidade"}{i.canal ? ` · canal ${i.canal.nome}` : ""}</span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-600">
                    {i.grupo ? <>{i.grupo.nome}{i.papel_no_grupo ? <span className="text-gray-400"> · {i.papel_no_grupo}</span> : null}</> : i.centralizador_power_bi ? <span className="text-gray-400" title="centralizador no Power BI">{i.centralizador_power_bi}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-1.5">{i.codigo_o2 ?? "—"} <span className="text-gray-400">/ {i.codigo_produtor_corp ?? "—"}</span></td>
                  <td className="px-3 py-1.5 text-right">{r.docs_vigentes.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-1.5 text-right">{r.docs_vigentes ? formatarReais(Number(r.premio_vigente)) : <span className="text-gray-300">—</span>}</td>
                  <td className="px-3 py-1.5 text-right">{r.propostas_pendentes > 0 ? <span className="rounded-full bg-orange-100 px-2 py-0.5 font-medium text-orange-800">{r.propostas_pendentes}</span> : <span className="text-gray-300">0</span>}</td>
                  <td className="px-3 py-1.5 text-gray-600">{r.produtos.length ? r.produtos.join(", ") : "—"}</td>
                  <td className="px-3 py-1.5 text-gray-600">{r.seguradoras_fatura.length ? r.seguradoras_fatura.join(", ") : <span className="text-gray-300">não</span>}</td>
                  <td className="px-3 py-1.5 text-gray-600">{proLabore.get(i.id)?.join(" · ") ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(count ?? 0) > lista.length && (
        <Link href={`${href(vista)}${href(vista).includes("?") ? "&" : "?"}limite=${lista.length + 100}${f.q ? `&q=${encodeURIComponent(f.q)}` : ""}${f.seguradora ? `&seguradora=${f.seguradora}` : ""}`} className="inline-block rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy hover:bg-o2-navy hover:text-white">
          Mostrar mais
        </Link>
      )}
    </main>
  );
}
