import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { nomeTipoDocumento, TIPOS_DOCUMENTO } from "@/lib/erp/documentos";
import { lerFiltros } from "@/lib/erp/filtros";
import FiltrosErp from "../FiltrosErp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Emissão" };

// Etapa Emissão (Matheus 27/10): proposta = cotação efetivada (card concluído com sucesso no funil) e transmitida à seguradora.
// Toda proposta fica aqui, pendente, até virar apólice: o nº da apólice (ou do endosso) prova a emissão. Corp e Bitrix na mesma lista.
// Lê tabelas prontas (erp_emissao_fila_pronta / erp_emissao_kpis_pronta), recalculadas a cada hora pelo cron erp-faturas.

type Linha = {
  id: string; nosso_numero: number; nosso_numero_corp: number | null; tipo: string; tipo_corp: string | null; origem: string;
  seguradora: string | null; produto: string | null; ramo: string | null; imobiliaria_id: string | null; imobiliaria: string | null;
  cliente: string | null; canal_venda: string | null; vigencia_inicio: string | null; premio_liquido: number | null; comissao_valor: number | null;
  data_efetivacao: string; fonte_data: string; card_url: string | null;
};
type Kpis = { efetivados: number; emitidos: number; pendentes: number; bitrix: number; corp: number };

const FAIXAS = [
  { chave: "ate5", rotulo: "até 5 dias", cor: "bg-green-50 text-green-800 border-green-200" },
  { chave: "6a10", rotulo: "6 a 10 dias", cor: "bg-yellow-50 text-yellow-800 border-yellow-200" },
  { chave: "11a15", rotulo: "11 a 15 dias", cor: "bg-orange-50 text-orange-800 border-orange-200" },
  { chave: "mais15", rotulo: "mais de 15 dias", cor: "bg-red-50 text-red-800 border-red-200" },
] as const;

const dia = (d: Date) => d.toISOString().slice(0, 10);
const somarDias = (hoje: Date, n: number) => dia(new Date(hoje.getTime() + n * 86400000));
const diasEntre = (data: string, hoje: Date) => Math.round((Date.parse(dia(hoje)) - Date.parse(data)) / 86400000);
const corDias = (n: number) => (n <= 5 ? "bg-green-100 text-green-800" : n <= 10 ? "bg-yellow-100 text-yellow-800" : n <= 15 ? "bg-orange-100 text-orange-800" : "bg-red-100 text-red-700");

export default async function ErpEmissaoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const f = lerFiltros(sp);
  const um = (k: string) => { const v = sp[k]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined; };
  const faixa = FAIXAS.find((x) => x.chave === um("faixa"))?.chave;
  const origem = um("origem") === "bitrix" || um("origem") === "corp" ? um("origem") : undefined;
  const atraso = um("atraso") === "1";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const hoje = new Date();
  const mes = f.mes ?? dia(hoje).slice(0, 7); // abre no mês corrente (regra do ERP)
  const ini = `${mes}-01`;
  const [a, m] = mes.split("-").map(Number);
  const fim = dia(new Date(Date.UTC(a, m, 1)));

  // escopo: pendentes efetivadas no mês escolhido, ou todo o atraso (meses anteriores ao escolhido)
  const base = () => {
    let q = supabase.from("erp_emissao_fila_pronta").select("*", { count: "exact" });
    q = atraso ? q.lt("data_efetivacao", ini) : q.gte("data_efetivacao", ini).lt("data_efetivacao", fim);
    if (f.seguradora) q = q.eq("seguradora", f.seguradora);
    if (f.produto) q = q.eq("produto", f.produto);
    if (f.tipo) q = q.eq("tipo", f.tipo);
    if (f.imobiliaria) q = q.ilike("imobiliaria", `%${f.imobiliaria.replace(/[%_,()]/g, "")}%`);
    if (f.q) {
      const t = f.q.replace(/[%_,()]/g, "");
      q = /^\d+$/.test(t) ? q.or(`nosso_numero.eq.${t},nosso_numero_corp.eq.${t},cliente.ilike.%${t}%`) : q.ilike("cliente", `%${t}%`);
    }
    if (origem === "bitrix") q = q.eq("origem", "bitrix");
    if (origem === "corp") q = q.neq("origem", "bitrix");
    if (faixa) {
      if (faixa === "ate5") q = q.gte("data_efetivacao", somarDias(hoje, -5));
      if (faixa === "6a10") q = q.lt("data_efetivacao", somarDias(hoje, -5)).gte("data_efetivacao", somarDias(hoje, -10));
      if (faixa === "11a15") q = q.lt("data_efetivacao", somarDias(hoje, -10)).gte("data_efetivacao", somarDias(hoje, -15));
      if (faixa === "mais15") q = q.lt("data_efetivacao", somarDias(hoje, -15));
    }
    return q;
  };
  const contarFaixa = async (chave: (typeof FAIXAS)[number]["chave"]) => {
    let q = supabase.from("erp_emissao_fila_pronta").select("id", { count: "exact", head: true });
    q = atraso ? q.lt("data_efetivacao", ini) : q.gte("data_efetivacao", ini).lt("data_efetivacao", fim);
    if (f.seguradora) q = q.eq("seguradora", f.seguradora);
    if (f.produto) q = q.eq("produto", f.produto);
    if (f.tipo) q = q.eq("tipo", f.tipo);
    if (f.imobiliaria) q = q.ilike("imobiliaria", `%${f.imobiliaria.replace(/[%_,()]/g, "")}%`);
    if (origem === "bitrix") q = q.eq("origem", "bitrix");
    if (origem === "corp") q = q.neq("origem", "bitrix");
    if (chave === "ate5") q = q.gte("data_efetivacao", somarDias(hoje, -5));
    if (chave === "6a10") q = q.lt("data_efetivacao", somarDias(hoje, -5)).gte("data_efetivacao", somarDias(hoje, -10));
    if (chave === "11a15") q = q.lt("data_efetivacao", somarDias(hoje, -10)).gte("data_efetivacao", somarDias(hoje, -15));
    if (chave === "mais15") q = q.lt("data_efetivacao", somarDias(hoje, -15));
    return (await q).count ?? 0;
  };

  const limite = Math.min(Number(um("limite")) || 100, 1000);
  const [{ data: kpiRow }, { count: atrasoTotal }, linhasRes, ...contagens] = await Promise.all([
    supabase.from("erp_emissao_kpis_pronta").select("dados").eq("mes", ini).maybeSingle(),
    supabase.from("erp_emissao_fila_pronta").select("id", { count: "exact", head: true }).lt("data_efetivacao", ini),
    base().order("data_efetivacao", { ascending: true }).limit(limite),
    ...FAIXAS.map((x) => contarFaixa(x.chave)),
  ]);
  const kpi = (kpiRow?.dados ?? null) as Kpis | null;
  const linhas = (linhasRes.data ?? []) as Linha[];
  const total = linhasRes.count ?? linhas.length;

  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...f, origem, faixa, atraso: atraso ? "1" : undefined, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/erp/emissao${p.size ? `?${p}` : ""}`;
  };
  const rotuloMes = new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 p-8">
      <PageHeader
        icon={<IconReport />}
        titulo="ERP O2 — Emissão"
        subtitulo="Propostas: cotações que o cliente autorizou e a operação já transmitiu à seguradora. Cada uma fica aqui, pendente, até virar apólice (ou endosso emitido). O nº da apólice prova a emissão. Corp e Bitrix na mesma lista."
      />

      <FiltrosErp
        caminho="/erp/emissao"
        campos={["busca", "mes", "seguradora", "produto", "imobiliaria", "tipo"]}
        avancados={["tipo"]}
        valores={{ ...f, mes }}
        placeholderBusca="Código O2 do documento · nosso nº do Corp · nome do titular"
        tipos={TIPOS_DOCUMENTO}
        resumo={<>{atraso ? `atraso de meses anteriores a ${rotuloMes}` : `efetivadas em ${rotuloMes}`} · {total.toLocaleString("pt-BR")} pendente(s)</>}
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cartao titulo={`Efetivadas em ${rotuloMes}`} valor={kpi?.efetivados} nota={kpi ? `${kpi.bitrix} do Bitrix · ${kpi.corp} do Corp` : "calculando"} />
        <Cartao titulo="Emitidas (já têm nº)" valor={kpi?.emitidos} nota={kpi && kpi.efetivados ? `${Math.round((kpi.emitidos / kpi.efetivados) * 100)}% das efetivadas do mês` : undefined} cor="text-green-700" />
        <Cartao titulo="Pendentes do mês" valor={kpi?.pendentes} nota="efetivadas no mês, sem nº" cor="text-orange-700" />
        <Link href={href({ atraso: "1", faixa: undefined })} className="block">
          <Cartao titulo="Atraso de meses anteriores" valor={atrasoTotal ?? 0} nota="ver todas · sem nº de apólice" cor="text-red-700" realce={atraso} />
        </Link>
      </section>

      <section className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Dias desde a efetivação:</span>
        {FAIXAS.map((x, i) => (
          <Link key={x.chave} href={href({ faixa: faixa === x.chave ? undefined : x.chave })} className={`rounded-full border px-3 py-1 font-medium ${x.cor} ${faixa === x.chave ? "ring-2 ring-o2-navy" : ""}`}>
            {x.rotulo} · {(contagens[i] as number).toLocaleString("pt-BR")}
          </Link>
        ))}
        <span className="mx-2 text-gray-300">|</span>
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Origem:</span>
        {[{ k: undefined, r: "todas" }, { k: "bitrix", r: "Bitrix" }, { k: "corp", r: "Corp" }].map((o) => (
          <Link key={o.r} href={href({ origem: o.k })} className={`rounded-full border px-3 py-1 font-medium ${origem === o.k ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 text-gray-700"}`}>
            {o.r}
          </Link>
        ))}
      </section>

      {linhas.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">Nenhuma proposta pendente de emissão neste recorte.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Código O2 do documento</th>
                <th className="px-3 py-2">Nosso nº do Corp</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Origem</th>
                <th className="px-3 py-2">Titular</th>
                <th className="px-3 py-2">Imobiliária</th>
                <th className="px-3 py-2">Seg.</th>
                <th className="px-3 py-2">Ramo</th>
                <th className="px-3 py-2">Efetivada em</th>
                <th className="px-3 py-2 text-right">Dias</th>
                <th className="px-3 py-2">Início vig.</th>
                <th className="px-3 py-2 text-right">Pr. líquido</th>
                <th className="px-3 py-2">Card</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {linhas.map((d) => {
                const dias = diasEntre(d.data_efetivacao, hoje);
                const tipo = nomeTipoDocumento(d.tipo, d.tipo_corp);
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/erp/documentos/${d.id}`} className="text-o2-navy hover:underline">{d.nosso_numero}</Link>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{d.nosso_numero_corp ?? <span className="text-gray-300" title="ainda não existe no Corp">—</span>}</td>
                    <td className="px-3 py-2"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${tipo.cor}`}>{tipo.nome}</span></td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${d.origem === "bitrix" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-700"}`}>{d.origem === "bitrix" ? "Bitrix" : "Corp"}</span>
                    </td>
                    <td className="px-3 py-2">{d.cliente ?? <span className="text-gray-400">sem titular ligado</span>}</td>
                    <td className="px-3 py-2">
                      {d.imobiliaria_id ? <Link href={`/admin/imobiliarias/${d.imobiliaria_id}`} className="hover:underline">{d.imobiliaria}</Link> : <span className="text-gray-400">{d.canal_venda ?? "—"}</span>}
                    </td>
                    <td className="px-3 py-2">{d.seguradora ?? "—"}</td>
                    <td className="px-3 py-2">{d.ramo ?? "—"}</td>
                    <td className="px-3 py-2" title={`data vinda de: ${d.fonte_data}`}>{formatarData(d.data_efetivacao)}<span className="block text-[10px] text-gray-400">{d.fonte_data}</span></td>
                    <td className="px-3 py-2 text-right"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${corDias(dias)}`}>{dias}</span></td>
                    <td className="px-3 py-2">{formatarData(d.vigencia_inicio)}</td>
                    <td className="px-3 py-2 text-right">{formatarReais(d.premio_liquido)}</td>
                    <td className="px-3 py-2">{d.card_url ? <a href={d.card_url} target="_blank" rel="noreferrer" className="text-o2-navy hover:underline">abrir</a> : <span className="text-gray-300">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {total > linhas.length && (
        <Link href={href({ limite: String(linhas.length + 100) })} className="inline-block rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy hover:bg-o2-navy hover:text-white">
          Mostrar mais ({linhas.length} de {total})
        </Link>
      )}
      <p className="text-xs text-gray-500">
        Efetivada = card concluído com sucesso no funil (data do card; sem card, a data da proposta do Corp). Emitida = tem nº de apólice ou de endosso (por enquanto o nº é a prova; a data de emissão e o anexo da apólice entram com os e-mails, faturas e boletos).
        Cotações em negociação ficam só no Workspace. Os números se atualizam a cada hora.
      </p>
    </main>
  );
}

function Cartao({ titulo, valor, nota, cor = "text-o2-navy", realce = false }: { titulo: string; valor: number | undefined; nota?: string; cor?: string; realce?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${realce ? "border-o2-navy ring-1 ring-o2-navy" : "border-gray-200"}`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{titulo}</div>
      <div className={`mt-1 text-2xl font-semibold ${cor}`}>{valor === undefined ? "—" : valor.toLocaleString("pt-BR")}</div>
      {nota && <div className="mt-0.5 text-[11px] text-gray-500">{nota}</div>}
    </div>
  );
}
