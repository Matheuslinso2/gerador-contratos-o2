import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros } from "@/lib/erp/filtros";
import FiltrosErp from "../../FiltrosErp";
import BotaoVerDocumento from "../../BotaoVerDocumento";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parcelas · cobrança" };

// Parcelas · COBRANÇA E INADIMPLÊNCIA (Matheus 29/10): status padronizados por seguradora e produto, a partir do estudo de prazo entre o vencimento
// da parcela e o recebimento da comissão (erp_prazos_comissao). Parcela vencida e paga → a seguradora paga a comissão em até N dias (N = prazo normal
// da seguradora/ramo). Sem a comissão (nem linha de extrato) depois do prazo, a parcela está em aberto e a urgência da cobrança sobe com o atraso.
// "Risco de cancelamento" só aparece onde a regra de cancelamento da seguradora estiver cadastrada (erp_regras_cancelamento): nenhuma regra foi inventada.
const STATUS: Record<string, { rotulo: string; cor: string; ordem: number }> = {
  risco_cancelamento: { rotulo: "RISCO DE CANCELAMENTO", cor: "bg-red-700 text-white", ordem: 0 },
  urgente: { rotulo: "Em aberto — URGENTE", cor: "bg-red-100 text-red-800", ordem: 1 },
  atencao: { rotulo: "Em aberto — atenção", cor: "bg-orange-100 text-orange-800", ordem: 2 },
  aguardando_comissao: { rotulo: "Vencida — dentro do prazo da seguradora", cor: "bg-yellow-100 text-yellow-800", ordem: 3 },
  vence_em_breve: { rotulo: "Vence em até 5 dias", cor: "bg-blue-100 text-blue-800", ordem: 4 },
  a_vencer: { rotulo: "A vencer", cor: "bg-gray-100 text-gray-700", ordem: 5 },
  paga: { rotulo: "Paga (comissão recebida)", cor: "bg-green-100 text-green-800", ordem: 6 },
};
const SITUACOES = Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.rotulo]));

type Linha = {
  parcela_id: string; documento_id: string; nosso_numero_corp: number | null; apolice: string | null; cliente: string | null; parcela_texto: string | null;
  venc_parcela: string; valor: number; corretora: string | null; seg: string; ramo: string | null; produto: string | null; dias: number;
  prazo_normal: number; limite: number; dias_cancelamento: number | null; status: string; urgencia: number;
};
type Resumo = { seg: string; produto: string; status: string; urgencia: number; parcelas: number; valor: number };

export default async function ParcelasCobrancaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = lerFiltros(await searchParams);
  const supabase = await createClient();
  const seg = f.seguradora ? (f.seguradora === "ALF" ? "ALFA" : f.seguradora) : null;

  let q = supabase.from("erp_parcelas_cobranca").select("*");
  if (seg) q = q.eq("seg", seg);
  if (f.produto) q = q.eq("produto", f.produto);
  if (f.situacao && STATUS[f.situacao]) q = q.eq("status", f.situacao);
  else q = q.gte("urgencia", 1); // por padrão: só o que está em aberto ou perto de vencer (vencida e dentro do prazo, atenção, urgente, risco)
  const [{ data }, { data: resumoBruto }, { data: ligBruta }] = await Promise.all([
    q.order("urgencia", { ascending: false }).order("dias", { ascending: false }).limit(300),
    supabase.rpc("erp_cobranca_resumo", { p_seg: seg, p_produto: f.produto ?? null }),
    supabase.rpc("erp_extratos_ligacao", { p_de: new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10), p_ate: new Date().toISOString().slice(0, 10) }),
  ]);
  const linhas = (data ?? []) as Linha[];
  const resumo = ((resumoBruto ?? []) as Resumo[]).map((r) => ({ ...r, parcelas: Number(r.parcelas), valor: Number(r.valor) }));

  // matriz seguradora × status (parcelas e comissão em aberto)
  const segs = [...new Set(resumo.map((r) => r.seg))].sort();
  const ordemStatus = Object.entries(STATUS).sort((a, b) => a[1].ordem - b[1].ordem).map(([k]) => k).filter((k) => k !== "paga" && k !== "a_vencer");
  const cel = (s: string, st: string) => resumo.filter((r) => r.seg === s && r.status === st).reduce((a, r) => ({ n: a.n + r.parcelas, v: a.v + r.valor }), { n: 0, v: 0 });
  const totalAberto = resumo.filter((r) => r.urgencia >= 2).reduce((a, r) => ({ n: a.n + r.parcelas, v: a.v + r.valor }), { n: 0, v: 0 });

  // seguradoras com extrato pouco ligado às parcelas: o status "em aberto" delas é provisório (trava herdada da conclusão de inadimplência)
  const lig = new Map<string, { l: number; g: number }>();
  for (const x of (ligBruta ?? []) as { seg_abrev: string; linhas: number | string; ligadas: number | string }[]) {
    const k = x.seg_abrev === "ALF" ? "ALFA" : x.seg_abrev;
    const a = lig.get(k) ?? { l: 0, g: 0 };
    lig.set(k, { l: a.l + Number(x.linhas), g: a.g + Number(x.ligadas) });
  }
  const provisorias = segs.filter((s) => { const a = lig.get(s); return !a || a.l === 0 || a.g / a.l < 0.9; });

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <div className="flex gap-3 text-sm">
          <Link href="/erp/parcelas" className="text-gray-500 hover:text-o2-navy hover:underline">Conferência dos vencimentos</Link>
          <span className="border-b-2 border-o2-navy font-semibold text-o2-navy">Cobrança e inadimplência</span>
        </div>
        <h1 className="mt-2 text-xl font-semibold text-o2-navy">Parcelas · cobrança e inadimplência</h1>
        <p className="text-sm text-gray-600">
          Cada parcela recebe um status pelo prazo que a seguradora costuma levar para pagar a comissão depois do vencimento. Se a comissão não chegou (nem linha no
          extrato) depois desse prazo, a parcela está em aberto e a urgência de cobrança sobe com os dias de atraso. Janela: vencimentos dos últimos 180 dias e dos
          próximos 30.
        </p>
      </div>

      <FiltrosErp
        caminho="/erp/parcelas/cobranca"
        campos={["seguradora", "produto", "situacao"]}
        valores={f}
        situacoes={SITUACOES}
        resumo={<>Parcelas em aberto há mais que o prazo normal: <b>{totalAberto.n.toLocaleString("pt-BR")}</b> · comissão {formatarReais(totalAberto.v)}</>}
      />

      {provisorias.length > 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          Status provisório em: <b>{provisorias.join(", ")}</b>. O extrato dessas seguradoras ainda está pouco ligado às parcelas (menos de 90%), então parte do "em aberto" pode
          ser só falta de leitura do extrato. Confira com a seguradora antes de cobrar o cliente.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Seguradora</th>
              {ordemStatus.map((k) => (<th key={k} className="px-3 py-2 text-right">{STATUS[k].rotulo}</th>))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {segs.map((s) => (
              <tr key={s}>
                <td className="px-3 py-1.5 font-medium">{s}</td>
                {ordemStatus.map((k) => {
                  const c = cel(s, k);
                  return <td key={k} className="px-3 py-1.5 text-right">{c.n ? <Link href={`/erp/parcelas/cobranca?seguradora=${s === "ALFA" ? "ALF" : s}&situacao=${k}`} className="hover:underline">{c.n} · {formatarReais(c.v)}</Link> : <span className="text-gray-300">—</span>}</td>;
                })}
              </tr>
            ))}
            {!segs.length && <tr><td className="px-3 py-3 text-gray-500" colSpan={ordemStatus.length + 1}>Nenhuma parcela na janela.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Abrir</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Seguradora · produto</th>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Nº da apólice</th>
              <th className="px-3 py-2">Parcela</th>
              <th className="px-3 py-2">Vencimento</th>
              <th className="px-3 py-2 text-right">Dias</th>
              <th className="px-3 py-2 text-right">Prazo normal / limite</th>
              <th className="px-3 py-2 text-right">Comissão</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map((l) => (
              <tr key={l.parcela_id}>
                <td className="px-3 py-1.5"><BotaoVerDocumento id={l.documento_id} /></td>
                <td className="px-3 py-1.5"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[l.status]?.cor ?? "bg-gray-100"}`}>{STATUS[l.status]?.rotulo ?? l.status}</span></td>
                <td className="px-3 py-1.5">{l.seg}<span className="block text-[10px] text-gray-500">{l.produto ?? l.ramo ?? "—"}</span></td>
                <td className="px-3 py-1.5">{l.cliente ?? "—"}</td>
                <td className="px-3 py-1.5">{l.apolice ?? "—"}</td>
                <td className="px-3 py-1.5">{l.parcela_texto ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{formatarData(l.venc_parcela)}</td>
                <td className="px-3 py-1.5 text-right">{l.dias > 0 ? l.dias : `em ${-l.dias}`}</td>
                <td className="px-3 py-1.5 text-right text-gray-500">{l.prazo_normal} / {l.limite} dias{l.dias_cancelamento ? ` · cancela em ${l.dias_cancelamento}` : ""}</td>
                <td className="px-3 py-1.5 text-right">{formatarReais(Number(l.valor))}</td>
              </tr>
            ))}
            {!linhas.length && <tr><td className="px-3 py-3 text-gray-500" colSpan={10}>Nada neste filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-500">
        Mostra as 300 mais urgentes do filtro. "Prazo normal" e "limite" vêm do estudo dos últimos 16 meses de comissões recebidas (mediana e percentil 90 por seguradora e ramo).
        O prazo normal e o limite já incluem uma tolerância de 2 dias (1 por questões operacionais do banco e 1 para não cobrar o cliente no dia seguinte e ele já ter pago).
        "Risco de cancelamento" aparece onde a regra da seguradora está cadastrada: 1ª parcela não paga em Alfa e Yelum (Incêndio), Suhai (Auto) e Tokio (Fiança); mais de 30 dias na Too (Fiança) e de 20 dias na Allianz (Residência).
      </p>
    </main>
  );
}
