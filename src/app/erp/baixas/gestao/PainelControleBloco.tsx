import RascunhoAutomatico from "@/components/RascunhoAutomatico";
import InfoLegenda from "@/components/InfoLegenda";
import { createClient } from "@/lib/supabase/server";
import { formatarData } from "@/lib/sinistros/regras";
import { salvarNotaBaixa, criarSaldoCobrar, fecharSaldoCobrar } from "./actions";

// Gestão das baixas: painel de CONTROLE de um bloco (seguradora × empresa): histórico de falhas calculado, anotações sobre o padrão da
// seguradora e saldo a cobrar (a tolerância deixa a baixa passar, mas a diferença que a seguradora deve fica registrada até ser
// recebida ou perdoada). Servidor: busca os próprios dados, então um bloco lento não trava os outros.
const brl = (v: number | string | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const somaMes = (mes: string, delta: number) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + delta, 1)).toISOString().slice(0, 7);
};

type Nota = { id: string; extrato_id: string | null; texto: string; por_email: string | null; created_at: string };
type Saldo = { id: string; valor: number | string; motivo: string; aberto_em: string };

function Ocultos(p: { seguradora_id: string; corretora_id: string; mes: string; ancora: string }) {
  return (
    <>
      <input type="hidden" name="seguradora_id" value={p.seguradora_id} />
      <input type="hidden" name="corretora_id" value={p.corretora_id} />
      <input type="hidden" name="mes" value={p.mes} />
      <input type="hidden" name="ancora" value={p.ancora} />
    </>
  );
}

export default async function PainelControleBloco({ seg, corretora, mes, ancora, ativa }: { seg: string; corretora: string; mes: string; ancora: string; ativa?: boolean }) {
  const supabase = await createClient();
  const [{ data: s }, { data: c }] = await Promise.all([
    supabase.from("erp_seguradoras").select("id").eq("abreviacao", seg).maybeSingle(),
    supabase.from("erp_corretoras").select("id").eq("apelido", corretora).maybeSingle(),
  ]);
  const seguradora_id = (s as { id: string } | null)?.id;
  const corretora_id = (c as { id: string } | null)?.id;
  if (!seguradora_id || !corretora_id) return null;

  const desdeHist = `${somaMes(mes, -5)}-01`;
  const [{ data: notasB }, { data: saldosB }, { data: histB }] = await Promise.all([
    supabase.from("erp_gestao_baixas_notas").select("id, extrato_id, texto, por_email, created_at").eq("seguradora_id", seguradora_id).eq("corretora_id", corretora_id).order("created_at", { ascending: false }).limit(60),
    supabase.from("erp_saldo_cobrar_seguradora").select("id, valor, motivo, aberto_em").eq("seguradora_id", seguradora_id).eq("corretora_id", corretora_id).eq("situacao", "aberto").order("aberto_em"),
    supabase.from("erp_baixa_assistida_resumo").select("mes, n_estorno, n_divergente, n_nao_encontrada, n_pro_labore").eq("seguradora_id", seguradora_id).eq("corretora_id", corretora_id).gte("mes", desdeHist).lte("mes", `${mes}-01`).neq("tipo", "resumo_mensal").limit(500),
  ]);
  const notas = (notasB ?? []) as Nota[];
  const saldos = (saldosB ?? []) as Saldo[];
  const hist = (histB ?? []) as { mes: string; n_estorno: number; n_divergente: number; n_nao_encontrada: number; n_pro_labore: number }[];
  const limpos = hist.filter((h) => Number(h.n_estorno) + Number(h.n_divergente) + Number(h.n_nao_encontrada) === 0).length;
  const mesesRuins = new Set(hist.filter((h) => Number(h.n_estorno) + Number(h.n_divergente) + Number(h.n_nao_encontrada) > 0).map((h) => h.mes.slice(0, 7))).size;
  const estornos = hist.reduce((t, h) => t + Number(h.n_estorno), 0);
  const proLabore = hist.reduce((t, h) => t + Number(h.n_pro_labore), 0);
  const saldoTotal = Math.round(saldos.reduce((t, x) => t + Number(x.valor), 0) * 100) / 100;
  const ocultos = { seguradora_id, corretora_id, mes, ancora };

  return (
    <div className="grid gap-3 border-t border-gray-100 p-3 text-xs lg:grid-cols-2">
      <div className="rounded-lg bg-gray-50 p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Histórico desta seguradora (6 meses, calculado) <InfoLegenda titulo="Histórico desta seguradora">Olha os extratos dos últimos 6 meses desta seguradora nesta empresa: quantos foram lidos, quantos vieram sem nenhuma linha a tratar (estorno, diferente do previsto ou não encontrada), em quantos meses houve problema e quantos estornos e linhas de pró-labore pago direto apareceram. Embaixo ficam suas anotações sobre o padrão da seguradora.</InfoLegenda></h3>
        {hist.length > 0 ? (
          <p className="mt-1 text-gray-700">
            {hist.length} extrato(s) lidos; <b>{limpos}</b> sem nenhuma linha a tratar ({Math.round((limpos / hist.length) * 100)}%).
            {mesesRuins > 0 ? ` Meses com problema: ${mesesRuins}.` : " Nenhum mês com problema."}
            {estornos > 0 ? ` ${estornos} estorno(s).` : ""}
            {proLabore > 0 ? ` ${proLabore} linha(s) com pró-labore pago direto.` : ""}
          </p>
        ) : (
          <p className="mt-1 text-gray-500">Sem extratos lidos nos últimos 6 meses.</p>
        )}
        <p className="mt-1 text-[11px] text-gray-500">Baixa automática: {ativa ? "ligada" : "desligada (modo teste: só mostra “seria baixado automaticamente”)"}.</p>
        <ul className="mt-2 space-y-1">
          {notas.filter((n) => !n.extrato_id).slice(0, 4).map((n) => (
            <li key={n.id} className="rounded bg-white px-2 py-1 text-gray-700"><span className="text-gray-400">{formatarData(n.created_at.slice(0, 10))} · {n.por_email?.split("@")[0] ?? "—"}:</span> {n.texto}</li>
          ))}
          {notas.filter((n) => n.extrato_id).slice(0, 3).map((n) => (
            <li key={n.id} className="rounded bg-white px-2 py-1 text-gray-600"><span className="text-gray-400">extrato · {formatarData(n.created_at.slice(0, 10))} · {n.por_email?.split("@")[0] ?? "—"}:</span> {n.texto}</li>
          ))}
        </ul>
        <form action={salvarNotaBaixa} className="mt-2 flex gap-2">
          <RascunhoAutomatico />
          <Ocultos {...ocultos} />
          <input name="texto" placeholder="Anotar o padrão desta seguradora (ex.: paga R$ 5 a menos; premiação sem apólice…)" className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1" />
          <button className="rounded bg-o2-navy px-3 py-1 text-white">Anotar</button>
        </form>
      </div>

      <div className="rounded-lg bg-gray-50 p-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Saldo a cobrar da seguradora<InfoLegenda titulo="Saldo a cobrar">A tolerância de até R$ 6 por parcela deixa a baixa passar, mas a diferença que a seguradora ainda deve não pode se perder. Aqui você registra o valor e o motivo; ele fica em aberto até ser marcado como recebido ou perdoado. O total aparece no cartão no topo da tela.</InfoLegenda>{saldoTotal !== 0 ? ` · ${brl(saldoTotal)}` : ""}</h3>
        {saldos.length === 0 ? (
          <p className="mt-1 text-gray-500">Nada em aberto.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {saldos.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 rounded bg-white px-2 py-1 text-gray-700">
                <b className="tabular-nums">{brl(x.valor)}</b> <span>{x.motivo}</span> <span className="text-gray-400">desde {formatarData(x.aberto_em)}</span>
                <span className="ml-auto flex gap-1">
                  {(["recebido", "perdoado"] as const).map((sit) => (
                    <form key={sit} action={fecharSaldoCobrar}>
                      <input type="hidden" name="id" value={x.id} /><input type="hidden" name="situacao" value={sit} /><input type="hidden" name="mes" value={mes} /><input type="hidden" name="ancora" value={ancora} />
                      <button className="rounded border border-gray-300 px-2 py-0.5 text-[11px] hover:bg-gray-50">{sit === "recebido" ? "recebido" : "perdoar"}</button>
                    </form>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        <form action={criarSaldoCobrar} className="mt-2 flex flex-wrap gap-2">
          <RascunhoAutomatico />
          <Ocultos {...ocultos} />
          <input name="valor" placeholder="Valor (R$)" inputMode="decimal" className="w-24 rounded border border-gray-300 px-2 py-1" />
          <input name="motivo" placeholder="Motivo (ex.: R$ 5 a menos em todas as parcelas)" className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1" />
          <button className="rounded border border-o2-navy px-3 py-1 text-o2-navy">Registrar</button>
        </form>
      </div>
    </div>
  );
}
