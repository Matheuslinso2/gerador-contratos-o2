import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PageHeader from "@/components/PageHeader";
import RascunhoAutomatico from "@/components/RascunhoAutomatico";
import { IconReport } from "@/components/icons";
import { formatarData } from "@/lib/sinistros/regras";
import { CORRETORAS } from "@/lib/erp/filtros";
import { entradasNibo, compararDias, TOLERANCIA_CAIXA, type DiaCaixa, type ExtratoDia } from "@/lib/erp/caixaNibo";
import { podeVerBaixas } from "@/lib/erp/acessoBaixas";
import { avaliarBaixaAutomatica, bancoDoExtrato, type SituacaoBanco } from "@/lib/erp/baixaAutomatica";
import { salvarNotaBaixa, criarSaldoCobrar, fecharSaldoCobrar } from "./actions";

export const dynamic = "force-dynamic";

// ERP O2 — Gestão das baixas (aba lateral de Baixas, 29/10/2026): um bloco por seguradora de cada empresa (CNPJ), com os extratos
// do mês, a situação da baixa, previsto × extrato × baixado, a conferência com o banco (Nibo), o motivo da diferença, o histórico
// de falhas da seguradora, anotações e o saldo a cobrar. A BAIXA AUTOMÁTICA está prevista e DESLIGADA: a tela só mostra
// "seria baixado automaticamente" (modo teste) quando o extrato bate com o banco e todas as linhas estão ligadas às parcelas.

type Resumo = {
  id: string; seguradora_id: string; corretora_id: string | null; seguradora: string; seg_abrev: string; corretora: string | null; mes: string; tipo: string; origem: string;
  arquivo_nome: string | null; data_recebimento: string | null; total_extrato: number | null; soma_linhas: number; linhas: number; conta_fecha: boolean;
  n_cheia: number; n_pro_labore: number; n_estorno: number; n_divergente: number; n_nao_encontrada: number;
  valor_cheia: number; valor_pro_labore: number; valor_tratar: number; valor_a_baixar: number; pro_labore_pago_direto: number; tratar_em_aberto: number;
  liquido_sem_desconto: number; baixa_aprovada_em: string | null; baixa_aprovada_por_email: string | null;
};
type Nota = { id: string; seguradora_id: string; corretora_id: string | null; extrato_id: string | null; texto: string; por_email: string | null; created_at: string };
type Saldo = { id: string; seguradora_id: string; corretora_id: string | null; valor: number | string; motivo: string; situacao: string; aberto_em: string; fechado_em: string | null };

const NOME_CURTO: Record<string, string> = {
  ALFA: "Alfa", ALLI: "Allianz", AZUL: "Azul", BRAD: "Bradesco", BRAS: "Brasilcap", HDI: "HDI", ICAT: "Icatu", KLIN: "Klini",
  MAPF: "Mapfre", PORT: "Porto Seguro", POTT: "Pottencial", SUHA: "Suhai", SULA: "Sulamérica", TOKI: "Tokio Marine", TOO: "Too", YELU: "Yelum", ZURI: "Zurich",
};
const brl = (v: number | string | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const somaMes = (mes: string, delta: number) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
const mesTexto = (m: string) => {
  const [a, mm] = m.slice(0, 7).split("-");
  return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(mm) - 1]}/${a}`;
};
const BANCO_TXT: Record<SituacaoBanco, { t: string; cor: string }> = {
  bate: { t: "bate com o banco", cor: "bg-green-100 text-green-800" },
  diferente: { t: "banco difere", cor: "bg-orange-100 text-orange-800" },
  sem_banco: { t: "sem entrada no banco", cor: "bg-red-100 text-red-700" },
};

type ExtratoVisao = Resumo & {
  banco: SituacaoBanco; bancoDia: DiaCaixa | null; auto: { seria: boolean; faltas: string[] };
  situacao: "baixada" | "a_baixar_manual" | "automatica_teste" | "so_total";
};
type Bloco = {
  chave: string; seguradora_id: string; corretora_id: string | null; corretora: string; seg: string; nome: string;
  extratos: ExtratoVisao[]; bancoSemExtrato: DiaCaixa[]; pendentes: number; seriamAuto: number; aTratar: number;
  historico: { extratos: number; limpos: number; valorTratar: number; estornos: number; proLabore: number; meses: number } | null;
  notas: Nota[]; saldos: Saldo[]; saldoAberto: number; ativa: boolean;
};

export default async function GestaoBaixasPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!podeVerBaixas(user?.email)) redirect("/erp");

  const mesAtual = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
  const mesSel = sp.mes && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : mesAtual;
  const [aSel, mSel] = mesSel.split("-").map(Number);
  const desdeMes = `${mesSel}-01`;
  const fimMes = new Date(Date.UTC(aSel, mSel, 0)).toISOString().slice(0, 10);
  const ateBanco = new Date(Date.UTC(aSel, mSel, 4)).toISOString().slice(0, 10);
  const desdeHist = `${somaMes(mesSel, -5)}-01`;

  const [{ data: resumoBruto }, { data: histBruto }, entradas, { data: notasBrutas }, { data: saldosBrutos }, { data: cfgBruta }] = await Promise.all([
    supabase.from("erp_baixa_assistida_resumo").select("*").eq("mes", desdeMes).neq("tipo", "resumo_mensal").order("data_recebimento"),
    supabase.from("erp_baixa_assistida_resumo").select("seguradora_id, corretora_id, mes, tipo, linhas, n_estorno, n_divergente, n_nao_encontrada, n_pro_labore").gte("mes", desdeHist).lte("mes", desdeMes).neq("tipo", "resumo_mensal").limit(5000),
    entradasNibo(supabase, desdeMes, ateBanco),
    supabase.from("erp_gestao_baixas_notas").select("*").order("created_at", { ascending: false }).limit(1500),
    supabase.from("erp_saldo_cobrar_seguradora").select("*").eq("situacao", "aberto").order("aberto_em"),
    supabase.from("erp_baixa_automatica_config").select("seguradora_id, corretora_id, ativa"),
  ]);
  const resumos = (resumoBruto ?? []) as Resumo[];
  const notas = (notasBrutas ?? []) as Nota[];
  const saldos = (saldosBrutos ?? []) as Saldo[];
  const ativaDe = new Map(((cfgBruta ?? []) as { seguradora_id: string; corretora_id: string; ativa: boolean }[]).map((c) => [`${c.seguradora_id}|${c.corretora_id}`, c.ativa]));

  // banco × extrato por dia de pagamento (mesma comparação da conferência do mês)
  const extratosDia: ExtratoDia[] = resumos.map((e) => {
    const total = Number(e.total_extrato ?? 0), soma = Number(e.soma_linhas ?? 0), liq = Number(e.liquido_sem_desconto ?? 0);
    const leituraErrada = soma > 0 && total > soma * 5;
    return { seg: e.seg_abrev, corretora: e.corretora, dia: String(e.data_recebimento), liquido: leituraErrada ? liq * (soma / total) : liq, bruto: leituraErrada ? soma : total || soma, linhas: Number(e.linhas) };
  });
  const porDia = compararDias(extratosDia, entradas);

  const histPor = new Map<string, { extratos: number; limpos: number; valorTratar: number; estornos: number; proLabore: number; meses: Set<string> }>();
  for (const h of (histBruto ?? []) as { seguradora_id: string; corretora_id: string | null; mes: string; n_estorno: number; n_divergente: number; n_nao_encontrada: number; n_pro_labore: number }[]) {
    const k = `${h.seguradora_id}|${h.corretora_id}`;
    const x = histPor.get(k) ?? { extratos: 0, limpos: 0, valorTratar: 0, estornos: 0, proLabore: 0, meses: new Set<string>() };
    x.extratos += 1;
    const problemas = Number(h.n_estorno) + Number(h.n_divergente) + Number(h.n_nao_encontrada);
    if (problemas === 0) x.limpos += 1; else x.meses.add(h.mes.slice(0, 7));
    x.estornos += Number(h.n_estorno);
    x.proLabore += Number(h.n_pro_labore);
    histPor.set(k, x);
  }

  const blocos = new Map<string, Bloco>();
  const bloco = (seguradora_id: string, corretora_id: string | null, corretora: string, seg: string, nomeLongo: string): Bloco => {
    const chave = `${corretora}|${seg}`;
    let b = blocos.get(chave);
    if (!b) {
      const h = histPor.get(`${seguradora_id}|${corretora_id}`);
      b = {
        chave, seguradora_id, corretora_id, corretora, seg, nome: NOME_CURTO[seg] ?? nomeLongo, extratos: [], bancoSemExtrato: [], pendentes: 0, seriamAuto: 0, aTratar: 0,
        historico: h ? { extratos: h.extratos, limpos: h.limpos, valorTratar: h.valorTratar, estornos: h.estornos, proLabore: h.proLabore, meses: h.meses.size } : null,
        notas: notas.filter((n) => n.seguradora_id === seguradora_id && n.corretora_id === corretora_id),
        saldos: saldos.filter((s) => s.seguradora_id === seguradora_id && s.corretora_id === corretora_id),
        saldoAberto: 0, ativa: ativaDe.get(`${seguradora_id}|${corretora_id}`) ?? false,
      };
      b.saldoAberto = Math.round(b.saldos.reduce((t, s) => t + Number(s.valor), 0) * 100) / 100;
      blocos.set(chave, b);
    }
    return b;
  };

  for (const e of resumos) {
    if (!e.corretora) continue;
    const b = bloco(e.seguradora_id, e.corretora_id, e.corretora, e.seg_abrev, e.seguradora);
    const { situacao: banco, dia } = bancoDoExtrato(porDia.get(`${e.corretora}|${e.seg_abrev}|${mesSel}`), e.data_recebimento);
    const auto = avaliarBaixaAutomatica(e, banco);
    const situacao: ExtratoVisao["situacao"] = e.baixa_aprovada_em ? "baixada" : e.linhas === 0 ? "so_total" : auto.seria ? "automatica_teste" : "a_baixar_manual";
    b.extratos.push({ ...e, banco, bancoDia: dia, auto, situacao });
    if (situacao === "a_baixar_manual" || situacao === "so_total") b.pendentes += 1;
    if (situacao === "automatica_teste") b.seriamAuto += 1;
    if (!e.baixa_aprovada_em && Number(e.tratar_em_aberto) > 0) b.aTratar += 1;
  }
  // dinheiro que entrou no banco do mês sem extrato lido
  const semExtrato: { corretora: string; seg: string; dia: DiaCaixa }[] = [];
  for (const [k, dias] of porDia) {
    const [corretora, seg, mes] = k.split("|");
    if (mes !== mesSel) continue;
    for (const d of dias) if (d.extrato === 0 && d.banco > 0.005) semExtrato.push({ corretora, seg, dia: d });
  }
  const idsSeg = new Map(resumos.map((r) => [r.seg_abrev, { id: r.seguradora_id, nome: r.seguradora }]));
  const idsCorr = new Map(resumos.filter((r) => r.corretora).map((r) => [r.corretora!, r.corretora_id]));
  for (const s of semExtrato) {
    const sg = idsSeg.get(s.seg);
    if (!sg) continue;
    bloco(sg.id, idsCorr.get(s.corretora) ?? null, s.corretora, s.seg, sg.nome).bancoSemExtrato.push(s.dia);
  }
  // seguradoras com saldo a cobrar em aberto aparecem mesmo sem extrato no mês
  for (const sd of saldos) {
    const r = resumos.find((x) => x.seguradora_id === sd.seguradora_id);
    const corr = CORRETORAS.find((c) => idsCorr.get(c) === sd.corretora_id);
    if (r && corr) bloco(r.seguradora_id, sd.corretora_id, corr, r.seg_abrev, r.seguradora);
  }

  const lista = [...blocos.values()].sort((a, b) => CORRETORAS.indexOf(a.corretora) - CORRETORAS.indexOf(b.corretora) || a.nome.localeCompare(b.nome));
  const total = {
    pendentes: lista.reduce((t, b) => t + b.pendentes, 0),
    seriamAuto: lista.reduce((t, b) => t + b.seriamAuto, 0),
    aTratar: lista.reduce((t, b) => t + b.aTratar, 0),
    bancoSemExtrato: lista.reduce((t, b) => t + b.bancoSemExtrato.length, 0),
    saldo: Math.round(lista.reduce((t, b) => t + b.saldoAberto, 0) * 100) / 100,
  };

  return (
    <main className="mx-auto w-full max-w-[1500px] flex-1 space-y-5 p-2">
      <PageHeader
        icon={<IconReport />}
        titulo="ERP O2 — Gestão das baixas de comissão"
        subtitulo="Um bloco por seguradora de cada empresa: extratos do mês, o que já foi baixado, o que bateu com o previsto e com o banco, e o que precisa de ação."
      />
      {sp.erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">Não deu certo: {sp.erro}</p>}

      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <Link href={`/erp/baixas/gestao?mes=${somaMes(mesSel, -1)}`} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-gray-700 hover:bg-gray-50" title="mês anterior">◀</Link>
            <span className="min-w-[88px] text-center font-semibold text-o2-navy">{mesTexto(desdeMes)}</span>
            <Link href={`/erp/baixas/gestao?mes=${somaMes(mesSel, 1)}`} className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-gray-700 hover:bg-gray-50" title="próximo mês">▶</Link>
            {mesSel !== mesAtual && <Link href="/erp/baixas/gestao" className="text-xs text-o2-navy underline">voltar ao mês atual</Link>}
          </div>
          <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            <b>Baixa automática: desligada (modo teste).</b> A tela só mostra “seria baixado automaticamente”; a baixa continua pela aprovação em <Link href="/erp/baixas#extratos-pendentes" className="underline">Conferência do mês</Link>.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Cartao rotulo="A baixar à mão" valor={total.pendentes} cor={total.pendentes ? "text-red-700" : "text-gray-700"} sub="extratos que dependem de ação humana" />
          <Cartao rotulo="Seriam automáticos" valor={total.seriamAuto} cor="text-green-700" sub="no padrão: banco bate e linhas ligadas" />
          <Cartao rotulo="Com linhas a tratar" valor={total.aTratar} cor={total.aTratar ? "text-orange-700" : "text-gray-700"} sub="estorno, divergente ou não encontrada" />
          <Cartao rotulo="Banco sem extrato" valor={total.bancoSemExtrato} cor={total.bancoSemExtrato ? "text-red-700" : "text-gray-700"} sub="dias com entrada e sem extrato lido" />
          <Cartao rotulo="Saldo a cobrar" valor={brl(total.saldo)} cor={total.saldo ? "text-o2-navy" : "text-gray-700"} sub="que as seguradoras ainda devem" />
        </div>
      </section>

      {lista.length === 0 && <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">Nenhum extrato neste mês.</p>}

      {CORRETORAS.map((empresa) => {
        const doEmpresa = lista.filter((b) => b.corretora === empresa);
        if (!doEmpresa.length) return null;
        return (
          <section key={empresa} className="space-y-3">
            <h2 className="rounded-lg bg-o2-navy px-3 py-2 text-sm font-bold text-white">{empresa === "O2 Corretora" ? "O2 Corretora de Seguros : 20001784000180" : "O2 Capitalização e Seguros : 54493758000138"}</h2>
            {doEmpresa.map((b) => (
              <BlocoSeguradora key={b.chave} b={b} mes={mesSel} />
            ))}
          </section>
        );
      })}

      <p className="text-[11px] leading-relaxed text-gray-500">
        <b>Padrão correto para baixa automática</b>: o valor do pagamento do dia bate com o banco (Nibo) dentro de R$ {TOLERANCIA_CAIXA.toLocaleString("pt-BR")}, todas as linhas estão ligadas a uma parcela do ERP, nenhuma linha diverge do previsto, não há estorno nem linha em tratativa e a soma das linhas fecha com o total do extrato.
        A <b>tolerância</b> deixa a baixa passar, mas a diferença que a seguradora deve fica registrada em <b>Saldo a cobrar</b> até ser recebida ou perdoada. Transferências entre as duas empresas no Nibo não são receita e não entram aqui.
      </p>
    </main>
  );
}

function Cartao({ rotulo, valor, sub, cor }: { rotulo: string; valor: number | string; sub: string; cor: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">{rotulo}</div>
      <div className={`text-xl font-bold ${cor}`}>{valor}</div>
      <div className="text-[11px] text-gray-500">{sub}</div>
    </div>
  );
}

function BlocoSeguradora({ b, mes }: { b: Bloco; mes: string }) {
  const ancora = `bloco-${b.chave.replace(/\W/g, "")}`;
  const precisaAcao = b.pendentes > 0 || b.aTratar > 0 || b.bancoSemExtrato.length > 0 || b.saldoAberto !== 0;
  const hist = b.historico;
  const ocultos = { seguradora_id: b.seguradora_id, corretora_id: b.corretora_id ?? "", mes, ancora };
  return (
    <details id={ancora} open={precisaAcao} className="group rounded-xl border border-gray-200 bg-white open:border-o2-navy/40">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm hover:bg-gray-50">
        <span className="font-bold text-o2-navy">{b.nome}</span>
        <span className="text-xs text-gray-500">· {b.corretora}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">{b.extratos.length} extrato(s)</span>
        {b.pendentes > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">{b.pendentes} a baixar à mão</span>}
        {b.seriamAuto > 0 && <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">{b.seriamAuto} seria(m) automático(s)</span>}
        {b.aTratar > 0 && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-800">{b.aTratar} com linhas a tratar</span>}
        {b.bancoSemExtrato.length > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">banco sem extrato: {b.bancoSemExtrato.length} dia(s)</span>}
        {b.saldoAberto !== 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800">saldo a cobrar {brl(b.saldoAberto)}</span>}
        <span className="ml-auto text-[11px] text-gray-400">{b.ativa ? "automático ligado" : "automático desligado (teste)"}</span>
      </summary>

      <div className="space-y-3 border-t border-gray-100 p-4">
        <div className="grid gap-3 text-xs lg:grid-cols-2">
          <div className="rounded-lg bg-gray-50 p-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Histórico desta seguradora (últimos 6 meses, calculado)</h3>
            {hist && hist.extratos > 0 ? (
              <p className="mt-1 text-gray-700">
                {hist.extratos} extrato(s) lidos; <b>{hist.limpos}</b> sem nenhuma linha a tratar ({Math.round((hist.limpos / hist.extratos) * 100)}%).
                {hist.meses > 0 ? ` Meses com problema: ${hist.meses}.` : " Nenhum mês com problema."}
                {hist.estornos > 0 ? ` ${hist.estornos} estorno(s).` : ""}
                {hist.proLabore > 0 ? ` ${hist.proLabore} linha(s) com pró-labore pago direto.` : ""}
              </p>
            ) : (
              <p className="mt-1 text-gray-500">Sem histórico de extratos lidos.</p>
            )}
            <ul className="mt-2 space-y-1">
              {b.notas.filter((n) => !n.extrato_id).slice(0, 4).map((n) => (
                <li key={n.id} className="rounded bg-white px-2 py-1 text-gray-700"><span className="text-gray-400">{formatarData(n.created_at.slice(0, 10))} · {n.por_email?.split("@")[0] ?? "—"}:</span> {n.texto}</li>
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
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Saldo a cobrar da seguradora</h3>
            {b.saldos.length === 0 ? (
              <p className="mt-1 text-gray-500">Nada em aberto.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {b.saldos.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 rounded bg-white px-2 py-1 text-gray-700">
                    <b className="tabular-nums">{brl(s.valor)}</b> <span>{s.motivo}</span> <span className="text-gray-400">desde {formatarData(s.aberto_em)}</span>
                    <span className="ml-auto flex gap-1">
                      {(["recebido", "perdoado"] as const).map((sit) => (
                        <form key={sit} action={fecharSaldoCobrar}>
                          <input type="hidden" name="id" value={s.id} /><input type="hidden" name="situacao" value={sit} /><input type="hidden" name="mes" value={mes} /><input type="hidden" name="ancora" value={ancora} />
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

        {b.extratos.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-1.5">Crédito</th>
                  <th className="px-2 py-1.5">Extrato</th>
                  <th className="px-2 py-1.5 text-right">Total (bruto)</th>
                  <th className="px-2 py-1.5 text-right" title="Soma das linhas que batem com o previsto (cheias + pró-labore conferido)">Bateu com o previsto</th>
                  <th className="px-2 py-1.5 text-right" title="Estorno, divergente e não encontrada">A tratar</th>
                  <th className="px-2 py-1.5">Banco (Nibo)</th>
                  <th className="px-2 py-1.5">Baixa</th>
                  <th className="px-2 py-1.5">Motivo / anotação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {b.extratos.map((e) => {
                  const notasDoExtrato = notasPorExtrato(b.notas, e.id);
                  return (
                    <tr key={e.id} className="align-top">
                      <td className="whitespace-nowrap px-2 py-1.5">{formatarData(e.data_recebimento)}</td>
                      <td className="px-2 py-1.5">
                        <Link href={`/erp/baixas?extrato=${e.id}&mes=${mes}&corretora=${encodeURIComponent(e.corretora ?? "")}&detalhe=1#extrato-${e.id}`} className="text-o2-navy hover:underline">{e.arquivo_nome ?? e.origem}</Link>
                        <div className="text-[10px] text-gray-400">{e.origem} · {e.linhas} linha(s)</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{brl(e.total_extrato)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-green-800">{brl(Number(e.valor_cheia) + Number(e.valor_pro_labore))}<div className="text-[10px] text-gray-400">{e.n_cheia + e.n_pro_labore} de {e.linhas} linhas</div></td>
                      <td className={`whitespace-nowrap px-2 py-1.5 text-right tabular-nums ${Number(e.valor_tratar) ? "font-semibold text-orange-700" : "text-gray-400"}`}>{Number(e.valor_tratar) ? brl(e.valor_tratar) : "—"}{e.n_estorno + e.n_divergente + e.n_nao_encontrada > 0 && <div className="text-[10px] font-normal text-gray-500">{e.n_estorno + e.n_divergente + e.n_nao_encontrada} linha(s)</div>}</td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${BANCO_TXT[e.banco].cor}`}>{BANCO_TXT[e.banco].t}</span>
                        {e.bancoDia && e.banco !== "bate" && <div className="mt-0.5 text-[10px] text-gray-500">banco {brl(e.bancoDia.banco)} × extrato {brl(e.bancoDia.extrato)}</div>}
                      </td>
                      <td className="px-2 py-1.5">
                        {e.situacao === "baixada" && <span className="text-green-800">baixada em {formatarData(e.baixa_aprovada_em!.slice(0, 10))}<div className="text-[10px] text-gray-500">por {e.baixa_aprovada_por_email?.split("@")[0] ?? "—"}</div></span>}
                        {e.situacao === "automatica_teste" && <span className="rounded bg-green-50 px-1.5 py-0.5 font-medium text-green-800">seria baixado automaticamente <span className="font-normal text-gray-500">(teste)</span></span>}
                        {(e.situacao === "a_baixar_manual" || e.situacao === "so_total") && <span className="font-medium text-red-700">baixar à mão</span>}
                      </td>
                      <td className="min-w-[220px] px-2 py-1.5 text-gray-700">
                        {e.auto.faltas.length > 0 && !e.baixa_aprovada_em && <ul className="list-disc pl-4 text-[11px] text-gray-600">{e.auto.faltas.map((f, i) => <li key={i}>{f}</li>)}</ul>}
                        {e.pro_labore_pago_direto > 0 && <div className="text-[11px] text-teal-800">pró-labore pago direto: {brl(e.pro_labore_pago_direto)}</div>}
                        {notasDoExtrato.map((n) => <div key={n.id} className="mt-0.5 rounded bg-gray-50 px-1.5 py-0.5 text-[11px]">{n.texto} <span className="text-gray-400">· {n.por_email?.split("@")[0]}</span></div>)}
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[11px] text-o2-navy underline">anotar</summary>
                          <form action={salvarNotaBaixa} className="mt-1 flex gap-1">
                            <RascunhoAutomatico />
                            <Ocultos {...ocultos} />
                            <input type="hidden" name="extrato_id" value={e.id} />
                            <input name="texto" className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-0.5" placeholder="motivo da diferença" />
                            <button className="rounded bg-o2-navy px-2 py-0.5 text-white">ok</button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {b.bancoSemExtrato.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            <b>Entrou no banco sem extrato lido neste mês:</b>{" "}
            {b.bancoSemExtrato.map((d) => `${formatarData(d.dia)} ${brl(d.banco)}`).join(" · ")}. Pode ser extrato ainda não recebido (e-mail, portal ou Drive), premiação sem apólice ou transferência entre as empresas.
          </div>
        )}
      </div>
    </details>
  );
}

function notasPorExtrato(notas: Nota[], extratoId: string) {
  return notas.filter((n) => n.extrato_id === extratoId).slice(0, 3);
}

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
