import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CADASTROS, ETAPAS } from "@/lib/erp/processo";

export const metadata = { title: { absolute: "ERP O2" } };
export const dynamic = "force-dynamic";

// Tela inicial do ERP O2: o processo da esquerda para a direita (Matheus 26/10), agora com os KPIs do mês corrente de cada
// etapa (27/10). Só tabelas prontas (erp_inicio_kpis_pronta, erp_emissao_kpis_pronta), recalculadas a cada hora pelo cron erp-faturas.
// Nunca inventa: etapa sem dado ou sem tela aparece como "em breve".

type Kpis = {
  faturas: { competencia: string; faturas: number; itens: number; boletos: number; boletos_divergentes: number; faturas_novas_no_mes: number; entradas: number; saidas: number; remanescentes: number };
  parcelas: { vencem: number; quitadas: number; vencidas_abertas: number; valor_vencidas_abertas: number };
  baixa: { recebida_n: number; recebida_valor: number; pendente_n: number; pendente_valor: number; ultima_baixa: string | null };
  apolices: { vigentes: number; canceladas_no_mes: number };
  sinistros: { abertos_seguradora_no_mes: number; em_andamento: number };
  renovacoes: { vencem: number };
  renovacoes_cadastradas: number;
};
type KpisEmissao = { efetivados: number; emitidos: number; pendentes: number; bitrix: number; corp: number };

const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR");
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const data = (d: string | null | undefined) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "—");
const dia = (d: Date) => d.toISOString().slice(0, 10);
const somar = (hoje: Date, k: number) => dia(new Date(hoje.getTime() + k * 86400000));

export default async function ErpInicio({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const hoje = new Date();
  const atual = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
  const pedido = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : null;
  const mes = pedido ?? dia(atual).slice(0, 7);
  const ini = `${mes}-01`;
  const meses = [0, 1, 2].map((k) => dia(new Date(Date.UTC(atual.getUTCFullYear(), atual.getUTCMonth() - k, 1))).slice(0, 7));

  const supabase = await createClient();
  const [{ data: atrasos }, { data: alertas }, { count: revisao }, { count: estornos }, { count: vencDiv }, { data: kRow }, { data: eRow }, { count: p5 }, { count: p10 }, { count: p15 }] = await Promise.all([
    supabase.from("erp_baixa_corp_atraso_pronto").select("mes, seguradora, situacao"),
    supabase.rpc("erp_contar_alertas_fatura"),
    supabase.from("erp_documentos").select("id", { count: "exact", head: true }).eq("revisao_pendente", true),
    supabase.from("erp_estornos_endosso_pronto").select("alerta", { count: "exact", head: true }),
    supabase.from("erp_vencimentos_pronto").select("parcela_id", { count: "exact", head: true }),
    supabase.from("erp_inicio_kpis_pronta").select("dados, calculado_em").eq("mes", ini).maybeSingle(),
    supabase.from("erp_emissao_kpis_pronta").select("dados").eq("mes", ini).maybeSingle(),
    supabase.from("erp_emissao_fila_pronta").select("id", { count: "exact", head: true }).lt("data_efetivacao", somar(hoje, -5)),
    supabase.from("erp_emissao_fila_pronta").select("id", { count: "exact", head: true }).lt("data_efetivacao", somar(hoje, -10)),
    supabase.from("erp_emissao_fila_pronta").select("id", { count: "exact", head: true }).lt("data_efetivacao", somar(hoje, -15)),
  ]);
  const k = (kRow?.dados ?? null) as Kpis | null;
  const e = (eRow?.dados ?? null) as KpisEmissao | null;

  const nAtraso = (atrasos ?? []).length;
  const mesesAtraso = [...new Set((atrasos ?? []).map((a: { mes: string }) => a.mes))].sort().reverse();
  const contagem = ((alertas ?? []) as { alerta: string; n: number }[]).reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.alerta]: Number(a.n) }), {});
  const avisos = [
    nAtraso > 0 && {
      cor: "border-red-200 bg-red-50 text-red-800",
      texto: `Baixa de comissão atrasada: ${nAtraso} combinações corretora × seguradora (${mesesAtraso.map((m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`).join(", ")}).`,
      href: "/erp/conferencia",
    },
    (contagem.fora_da_fatura ?? 0) + (contagem.sem_destino_seguradora ?? 0) > 0 && {
      cor: "border-orange-200 bg-orange-50 text-orange-800",
      texto: `Faturas: ${contagem.fora_da_fatura ?? 0} efetivados fora da fatura carregada e ${contagem.sem_destino_seguradora ?? 0} sem destino da seguradora há mais de 10 dias.`,
      href: "/erp/faturas",
    },
    (revisao ?? 0) > 0 && {
      cor: "border-blue-200 bg-blue-50 text-blue-800",
      texto: `${revisao} documentos vindos do Bitrix aguardando revisão do pré-cadastro.`,
      href: "/erp/documentos",
    },
  ].filter(Boolean) as { cor: string; texto: string; href: string }[];

  const rotuloMes = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
  const baixaAtrasada = k?.baixa.ultima_baixa ? `baixa do Corp até ${data(k.baixa.ultima_baixa)}` : "sem baixa registrada";

  // linhas de KPI de cada etapa; vazio = a etapa ainda não tem dado ou tela ("em breve")
  const linhas: Record<string, { texto: string; forte?: boolean }[]> = {};
  if (e) {
    linhas.emissao = [
      { texto: `${n(e.pendentes)} pendentes · ${n(e.emitidos)} emitidas · ${n(e.efetivados)} efetivadas`, forte: true },
      { texto: `pendentes há +5 dias: ${n(p5)} · +10: ${n(p10)} · +15: ${n(p15)} (todas as épocas)` },
    ];
  }
  if (k) {
    linhas.faturas = k.faturas.faturas
      ? [
          { texto: `${n(k.faturas.faturas)} faturas · ${n(k.faturas.itens)} apólices · ${brl(k.faturas.boletos)}`, forte: true },
          { texto: `entram ${n(k.faturas.entradas)} · saem ${n(k.faturas.saidas)} · ficam ${n(k.faturas.remanescentes)} (${n(k.faturas.faturas_novas_no_mes)} faturas novas, sem mês anterior)` },
          ...(k.faturas.boletos_divergentes ? [{ texto: `${n(k.faturas.boletos_divergentes)} boleto(s) não batem com as linhas` }] : []),
        ]
      : [{ texto: "nenhuma fatura carregada neste mês" }];
    linhas.apolices = [{ texto: `${n(k.apolices.vigentes)} vigentes · ${n(k.apolices.canceladas_no_mes)} canceladas no mês`, forte: true }];
    linhas.parcelas = [
      { texto: `${n(k.parcelas.vencem)} vencem no mês · ${n(k.parcelas.quitadas)} quitadas`, forte: true },
      { texto: `${n(k.parcelas.vencidas_abertas)} vencidas em aberto (${brl(k.parcelas.valor_vencidas_abertas)}) · ${baixaAtrasada}` },
      { texto: `${n(vencDiv)} vencimentos divergentes do Corp` },
    ];
    linhas.baixa = [
      { texto: `${brl(k.baixa.recebida_valor)} baixados (${n(k.baixa.recebida_n)}) · ${brl(k.baixa.pendente_valor)} pendentes (${n(k.baixa.pendente_n)})`, forte: true },
      { texto: `${baixaAtrasada} · ${n(estornos)} estornos a ver` },
    ];
    linhas.sinistro = [{ texto: `${n(k.sinistros.em_andamento)} em andamento · ${n(k.sinistros.abertos_seguradora_no_mes)} abertos na seguradora no mês`, forte: true }];
    if (k.renovacoes_cadastradas > 0) linhas.renovacao = [{ texto: `${n(k.renovacoes.vencem)} a vencer no mês`, forte: true }];
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 p-8">
      <div>
        <h1 className="text-xl font-semibold text-o2-navy">ERP O2</h1>
        <p className="text-sm text-gray-600">Sistema de gestão da O2 Seguros, separado do Workspace. Até dezembro/2026 roda ao lado do Corp; a partir de 2027 substitui o Corp.</p>
      </div>
      {avisos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Pedindo atenção</h2>
          {avisos.map((a) => (
            <Link key={a.texto} href={a.href} className={`block rounded-lg border p-3 text-sm hover:underline ${a.cor}`}>
              {a.texto}
            </Link>
          ))}
        </section>
      )}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">O processo em {rotuloMes}, da efetivação à renovação</h2>
          <div className="flex gap-1 text-xs">
            {meses.map((m) => (
              <Link key={m} href={m === meses[0] ? "/erp" : `/erp?mes=${m}`} className={`rounded-full border px-3 py-1 font-medium ${m === mes ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 text-gray-700"}`}>
                {m === meses[0] ? "mês atual" : `${m.slice(5, 7)}/${m.slice(0, 4)}`}
              </Link>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ETAPAS.map((et, i) => {
            const ls = linhas[et.chave];
            const corpo = (
              <>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Etapa {i + 1}</p>
                <p className="font-semibold text-o2-navy">{et.label}{et.externo ? " ↗" : ""}</p>
                {ls ? (
                  <div className="mt-1 space-y-0.5">
                    {ls.map((l) => (
                      <p key={l.texto} className={l.forte ? "text-sm font-medium text-gray-800" : "text-xs text-gray-500"}>{l.texto}</p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-gray-500">{et.href ? et.descricao : "em breve"}</p>
                )}
              </>
            );
            return et.href ? (
              <Link key={et.chave} href={et.href} target={et.externo ? "_blank" : undefined} className="rounded-xl border border-gray-200 bg-white p-3 transition hover:border-o2-coral hover:shadow-sm" title={et.descricao}>
                {corpo}
              </Link>
            ) : (
              <div key={et.chave} className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 opacity-70" title={et.descricao}>
                {corpo}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-gray-500">
          Números do mês escolhido, atualizados a cada hora{kRow?.calculado_em ? ` (última atualização ${new Date(kRow.calculado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })})` : ""}.
          Parcelas e Baixa dependem da baixa do Corp estar em dia. Cotações ficam no Workspace; o ERP começa na efetivação. Cadastros:{" "}
          {CADASTROS.map((c, i) => (
            <span key={c.href}>{i > 0 ? " · " : ""}<Link href={c.href} className="underline">{c.label}</Link></span>
          ))}
          .
        </p>
      </section>
    </main>
  );
}
