import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { dadosDeCabecalhoPorId, tipoDoCabecalho, TIPOS_DOCUMENTO } from "@/lib/erp/documentos";
import { lerFiltros } from "@/lib/erp/filtros";
import InfoLegenda from "@/components/InfoLegenda";
import type { ReactNode } from "react";
import FiltrosErp from "../FiltrosErp";
import BotaoVerDocumento from "../BotaoVerDocumento";
import PainelResumoAba from "@/app/erp/PainelResumoAba";
import NavegadorMes from "../NavegadorMes";
import { periodoDoMes } from "@/lib/erp/periodo";

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

// Situação / motivo da proposta pendente (1/11): classificação COM PROVA (e-mail de controle da seguradora, parecer de crédito...) em erp_proposta_acompanhamento.
// Nada sai desta lista sozinho: a proposta fica aqui até virar apólice; o motivo só sinaliza para o Matheus decidir. Sem prova = "sem informação".
const MOTIVOS: Record<string, { rotulo: string; cor: string }> = {
  emitida_sem_anexo_apolice: { rotulo: "Emitida, sem anexo da apólice (buscar no portal)", cor: "bg-indigo-50 text-indigo-800 border-indigo-300" },
  emitida_pela_seguradora: { rotulo: "Emitida pela seguradora (falta o nº no ERP)", cor: "bg-blue-50 text-blue-800 border-blue-200" },
  credito_aprovado_aguardando: { rotulo: "Crédito aprovado, aguardando emissão", cor: "bg-green-50 text-green-800 border-green-200" },
  recusada_pela_seguradora: { rotulo: "Recusada pela seguradora", cor: "bg-red-50 text-red-800 border-red-200" },
  pendencia_cadastral: { rotulo: "Pendência cadastral", cor: "bg-orange-50 text-orange-800 border-orange-200" },
  cancelada: { rotulo: "Cancelada", cor: "bg-gray-100 text-gray-800 border-gray-300" },
  retransmitida: { rotulo: "Retransmitida", cor: "bg-purple-50 text-purple-800 border-purple-200" },
  cliente_nao_pagou_1o_boleto: { rotulo: "Cliente não pagou o 1º boleto", cor: "bg-red-50 text-red-800 border-red-200" },
  negocio_desfeito: { rotulo: "Negócio desfeito", cor: "bg-red-50 text-red-800 border-red-200" },
  erro_de_processo: { rotulo: "Erro de processo", cor: "bg-red-50 text-red-800 border-red-200" },
  aguardando_seguradora: { rotulo: "Aguardando a seguradora", cor: "bg-yellow-50 text-yellow-800 border-yellow-200" },
  sem_informacao: { rotulo: "Sem informação", cor: "bg-white text-gray-600 border-gray-300" },
};
type Acomp = { documento_id: string; motivo: string; evidencia_resumo: string | null; evidencia_tipo: string | null; data_evidencia: string | null; confianca: string | null; detalhes: { seguradora?: string | null } | null };

// Situação de prazo (Matheus 01/11): compara os dias desde a efetivação com a cadência REAL efetivação→emissão (erp_prazo_emissao_ref, por seguradora×produto,
// cai para a seguradora; só vale com n >= 10). fonte_inicio: 'card' (SUCESSO do card) ou 'proposta_corp' (dt_proposta). Sem referência = "sem referência", nunca chute.
type Ref = { fonte_inicio: string; seguradora: string; produto: string; nivel: string; n: number; mediana_dias: number; p75_dias: number; p90_dias: number; pct_ate_7_dias: number; utilizavel: boolean; n_minimo: number; calculada_em: string };
const PRAZOS = {
  no_prazo: { rotulo: "no prazo", cor: "bg-green-50 text-green-800 border-green-200" },
  atencao: { rotulo: "atenção", cor: "bg-yellow-50 text-yellow-800 border-yellow-200" },
  atrasada: { rotulo: "atrasada", cor: "bg-orange-50 text-orange-800 border-orange-200" },
  muito_atrasada: { rotulo: "muito atrasada", cor: "bg-red-50 text-red-800 border-red-200" },
  sem_ref: { rotulo: "sem referência", cor: "bg-white text-gray-600 border-gray-300" },
} as const;
type ChavePrazo = keyof typeof PRAZOS;

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
  const motivo = um("motivo") && MOTIVOS[um("motivo")!] ? um("motivo") : undefined;
  const prazoSel = (Object.keys(PRAZOS) as ChavePrazo[]).find((k) => k === um("prazo"));
  const todas = !f.mes && !atraso; // sem mês escolhido: TODAS as pendentes (a proposta fica na tela até virar apólice, qualquer que seja o mês da efetivação)

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const hoje = new Date();
  const per = periodoDoMes(f.mes); // período padrão do ERP: abre no mês corrente; mês fechado congela (retrato)
  const mes = per.mes;
  const refDia = per.fechado ? per.ate : dia(hoje); // data de referência da idade das pendências (mês fechado = fim do mês)
  const refData = new Date(`${refDia}T12:00:00Z`);
  const ini = `${mes}-01`;
  const [a, m] = mes.split("-").map(Number);
  const fim = dia(new Date(Date.UTC(a, m, 1)));

  // situação/motivo de cada pendente (tabela pequena: no máximo ~1.000 linhas); alimenta a coluna, o filtro e os chips por motivo
  const { data: acompRows } = await supabase.from("erp_proposta_acompanhamento").select("documento_id,motivo,evidencia_resumo,evidencia_tipo,data_evidencia,confianca,detalhes").limit(2000);
  const acompPorDoc = new Map(((acompRows ?? []) as Acomp[]).map((x) => [x.documento_id, x]));
  const contaMotivo: Record<string, number> = {};
  for (const x of (acompRows ?? []) as Acomp[]) contaMotivo[x.motivo] = (contaMotivo[x.motivo] ?? 0) + 1;
  // por seguradora dentro de cada motivo (tooltip do botão): "quantas, por seguradora"
  const porSegMotivo: Record<string, Record<string, number>> = {};
  for (const x of (acompRows ?? []) as Acomp[]) { const sg = x.detalhes?.seguradora; if (!sg) continue; ((porSegMotivo[x.motivo] ??= {})[sg] = (porSegMotivo[x.motivo][sg] ?? 0) + 1); }
  const idsDoMotivo = motivo ? ((acompRows ?? []) as Acomp[]).filter((x) => x.motivo === motivo).map((x) => x.documento_id) : null;

  // referências de prazo (tabela pequena, recalculada com a fila): seguradora×produto primeiro, depois a seguradora; só n >= n_minimo
  const { data: refRows } = await supabase.from("erp_prazo_emissao_ref").select("*").limit(2000);
  const refs = new Map(((refRows ?? []) as Ref[]).map((r) => [`${r.fonte_inicio}|${r.seguradora}|${r.produto}`, r]));
  const refDe = (l: { seguradora: string | null; produto: string | null; fonte_data: string }): Ref | null => {
    if (!l.seguradora) return null;
    const fi = l.fonte_data === "card" ? "card" : "proposta_corp";
    const a1 = refs.get(`${fi}|${l.seguradora}|${l.produto ?? "*"}`);
    if (a1?.utilizavel) return a1;
    const a2 = refs.get(`${fi}|${l.seguradora}|*`);
    return a2?.utilizavel ? a2 : null;
  };
  const prazoDe = (l: Linha, dias: number): { chave: ChavePrazo; ref: Ref | null } => {
    const r = refDe(l);
    if (!r) return { chave: "sem_ref", ref: null };
    return { chave: dias <= r.mediana_dias ? "no_prazo" : dias <= r.p75_dias ? "atencao" : dias <= r.p90_dias ? "atrasada" : "muito_atrasada", ref: r };
  };

  // escopo: pendentes efetivadas no mês escolhido, ou todo o atraso (meses anteriores ao escolhido)
  const base = (esc: "mes" | "herd") => {
    let q = supabase.from("erp_emissao_fila_pronta").select("*", { count: "exact" });
    if (idsDoMotivo) q = q.in("id", idsDoMotivo.length ? idsDoMotivo : ["00000000-0000-0000-0000-000000000000"]);
    // "do mês" = efetivadas no mês escolhido; "herdada" = efetivada antes do mês e ainda sem nº (herança rotulada e separada)
    q = esc === "herd" ? q.lt("data_efetivacao", ini) : q.gte("data_efetivacao", ini).lt("data_efetivacao", fim);
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
    let q = supabase.from("erp_emissao_fila_pronta").select("id", { count: "exact", head: true }).lte("data_efetivacao", per.ate);
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
  const [{ data: kpiRow }, { count: atrasoTotal }, mesRes, herdRes, { count: mais60 }, ...contagens] = await Promise.all([
    supabase.from("erp_emissao_kpis_pronta").select("dados").eq("mes", ini).maybeSingle(),
    supabase.from("erp_emissao_fila_pronta").select("id", { count: "exact", head: true }).lt("data_efetivacao", ini),
    base("mes").order("data_efetivacao", { ascending: true }).range(0, 999),
    base("herd").order("data_efetivacao", { ascending: true }).range(0, 999),
    supabase.from("erp_emissao_fila_pronta").select("id", { count: "exact", head: true }).lt("data_efetivacao", ini).lt("data_efetivacao", somarDias(refData, -60)),
    ...FAIXAS.map((x) => contarFaixa(x.chave)),
  ]);
  const kpi = (kpiRow?.dados ?? null) as Kpis | null;
  // todas as pendentes do recorte (até 1.000 por seção) recebem a situação de prazo; o filtro de prazo e o KPI por seguradora usam o conjunto inteiro
  const comPrazo = (xs: Linha[]) => xs.map((l) => ({ l, ...prazoDe(l, diasEntre(l.data_efetivacao, refData)) }));
  const mesTodas = comPrazo((mesRes.data ?? []) as Linha[]);
  const herdTodas = comPrazo((herdRes.data ?? []) as Linha[]);
  const contaPrazo: Record<ChavePrazo, number> = { no_prazo: 0, atencao: 0, atrasada: 0, muito_atrasada: 0, sem_ref: 0 };
  const porSegPrazo = new Map<string, Record<ChavePrazo, number>>();
  const refsUsadas = new Map<string, Ref>();
  for (const x of [...mesTodas, ...herdTodas]) {
    contaPrazo[x.chave]++;
    const sg = x.l.seguradora ?? "(sem seguradora)";
    const o = porSegPrazo.get(sg) ?? { no_prazo: 0, atencao: 0, atrasada: 0, muito_atrasada: 0, sem_ref: 0 };
    o[x.chave]++; porSegPrazo.set(sg, o);
    if (x.ref) refsUsadas.set(`${x.ref.fonte_inicio}|${x.ref.seguradora}|${x.ref.produto}`, x.ref);
  }
  const filtraPrazo = (xs: ReturnType<typeof comPrazo>) => (prazoSel ? xs.filter((x) => x.chave === prazoSel) : xs);
  const mesFiltradas = filtraPrazo(mesTodas);
  const herdFiltradas = filtraPrazo(herdTodas);
  const prazoPorId = new Map([...mesTodas, ...herdTodas].map((x) => [x.l.id, x]));
  const mesLinhas = mesFiltradas.slice(0, limite).map((x) => x.l);
  const herdLinhas = herdFiltradas.slice(0, limite).map((x) => x.l);
  const linhas = [...mesLinhas, ...herdLinhas];
  const total = mesFiltradas.length + herdFiltradas.length;
  // cabeçalho padrão (Matheus 28/10): tipo, titular, produto, seguradora e vigência
  const cab = await dadosDeCabecalhoPorId(supabase, linhas.map((l) => l.id));
  // endosso de cobrança sem parcelas: avisa "parcelas a informar" (as parcelas nascem quando o card traz valor, nº de parcelas e 1º vencimento)
  const idsComParcela = new Set<string>();
  {
    const idsEnd = linhas.filter((l) => l.tipo === "C" && l.tipo_corp === "END").map((l) => l.id);
    if (idsEnd.length) {
      const { data: pp } = await supabase.from("erp_parcelas").select("documento_id").in("documento_id", idsEnd);
      for (const x of (pp ?? []) as { documento_id: string }[]) idsComParcela.add(x.documento_id);
    }
  }

  const href = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...f, origem, faixa, motivo, prazo: prazoSel, atraso: atraso ? "1" : undefined, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `/erp/emissao${p.size ? `?${p}` : ""}`;
  };
  const rotuloMes = new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 p-8">
      <NavegadorMes caminho="/erp/emissao" mes={f.mes} params={{ ...f, origem, faixa, motivo, prazo: prazoSel } as Record<string, string | undefined>} />
      <PainelResumoAba mes={f.mes} funcao="erp_resumo_emissao" titulo="Emissão" legendas={{"Efetivadas, emitidas e pendentes por mês":"Para cada mês: quantas propostas foram efetivadas, quantas já viraram apólice (emitidas) e quantas ainda estão pendentes de emissão. Fonte: o mesmo quadro mensal da aba.","Pendentes por seguradora":"As seguradoras com mais propostas aguardando emissão agora (as 10 maiores).","Pendência por faixa de dias desde a efetivação":"Há quantos dias cada proposta pendente foi efetivada. As faixas mais longas são as que mais pedem atenção."}} />
      <PageHeader
        icon={<IconReport />}
        titulo="ERP O2 — Emissão"
        subtitulo="Propostas: cotações que o cliente autorizou e a operação já transmitiu à seguradora. Cada uma fica aqui, pendente, até virar apólice (ou endosso emitido). O nº da apólice prova a emissão. Corp e Bitrix na mesma lista."
      />

      <FiltrosErp
        caminho="/erp/emissao"
        campos={["busca", "mes", "produto", "imobiliaria", "tipo", "seguradora"]}
        avancados={["seguradora"]}
        valores={{ ...f, mes }}
        placeholderBusca="Código O2 do documento · nosso nº do Corp · nome do titular"
        tipos={TIPOS_DOCUMENTO}
        resumo={
          <>
            {per.fechado ? `${rotuloMes} (mês fechado: pendências que já existiam até ${formatarData(per.ate)})` : rotuloMes} · do mês e herdadas de meses anteriores · {total.toLocaleString("pt-BR")} pendente(s)
            <InfoLegenda titulo="Lista de propostas pendentes">
              A lista abaixo mostra as propostas efetivadas ainda sem Nº da apólice (ou do endosso), da mais antiga para a mais nova. O mês do filtro é o mês da efetivação; com o atraso ligado, mostra as efetivadas em meses anteriores ao escolhido. Os demais filtros (produto, imobiliária, tipo, seguradora e busca) recortam a lista. Dias = hoje menos a data de efetivação. A data de efetivação vem do cartão concluído no Bitrix; sem cartão, da proposta do Corp (a fonte da data aparece embaixo dela). Atualizada a cada hora.
            </InfoLegenda>
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Cartao titulo={`Efetivadas em ${rotuloMes}`} valor={kpi?.efetivados} nota={kpi ? `${kpi.bitrix} do Bitrix · ${kpi.corp} do Corp` : "calculando"} info="Propostas efetivadas no mês escolhido: cotação concluída com sucesso no funil do Bitrix (vale a data do cartão) ou, quando não há cartão, proposta do Corp. A nota separa quantas vieram de cada fonte. Cotações ainda em negociação não entram: ficam no Workspace." />
        <Cartao titulo="Emitidas (já têm nº)" valor={kpi?.emitidos} nota={kpi && kpi.efetivados ? `${Math.round((kpi.emitidos / kpi.efetivados) * 100)}% das efetivadas do mês` : undefined} cor="text-green-700" info="Das efetivadas do mês, quantas já têm Nº da apólice (ou Nº do endosso). Por enquanto esse número é a prova de que a seguradora emitiu. A porcentagem é emitidas dividido por efetivadas." />
        <Cartao titulo="Pendentes do mês" valor={kpi?.pendentes} nota="efetivadas no mês, sem nº" cor="text-orange-700" info="Propostas efetivadas no mês escolhido que ainda não têm Nº da apólice (nem do endosso): seguem em Emissão até virarem apólice." />
        <div className="relative">
          <div className="block">
            <Cartao titulo="Herdadas de meses anteriores" valor={atrasoTotal ?? 0} nota={`${(mais60 ?? 0).toLocaleString("pt-BR")} há mais de 60 dias`} cor="text-red-700" />
          </div>
          <span className="absolute bottom-2 right-2">
            <InfoLegenda titulo="Atraso de meses anteriores" alinhar="direita">
              Propostas efetivadas antes do mês escolhido que continuam sem Nº da apólice (ou do endosso), de qualquer época anterior. Não muda com os filtros de produto, imobiliária ou seguradora. Clique no cartão para ver a lista.
            </InfoLegenda>
          </span>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Dias desde a efetivação:</span>
        <InfoLegenda titulo="Dias desde a efetivação">
          Divide as propostas pendentes do recorte atual (mês ou atraso) pelo tempo desde a efetivação: até 5 dias, 6 a 10, 11 a 15 e mais de 15. O número em cada botão respeita os filtros de produto, tipo, imobiliária, seguradora e origem. Clique para filtrar a lista; clique de novo para limpar.
        </InfoLegenda>
        {FAIXAS.map((x, i) => (
          <Link key={x.chave} href={href({ faixa: faixa === x.chave ? undefined : x.chave })} className={`rounded-full border px-3 py-1 font-medium ${x.cor} ${faixa === x.chave ? "ring-2 ring-o2-navy" : ""}`}>
            {x.rotulo} · {(contagens[i] as number).toLocaleString("pt-BR")}
          </Link>
        ))}
        <span className="mx-2 text-gray-300">|</span>
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Situação / motivo:</span>
        <InfoLegenda titulo="Situação / motivo">
          Por que a proposta ainda não virou apólice, quando há PROVA (e-mail de controle da seguradora, parecer de crédito, cancelamento ou retransmissão). Sem prova aparece "sem informação": nunca é chute. A proposta continua nesta lista até emitir; o motivo só sinaliza para você decidir o que fazer.
        </InfoLegenda>
        {Object.entries(MOTIVOS).filter(([k]) => (contaMotivo[k] ?? 0) > 0).map(([k, v]) => (
          <Link key={k} href={href({ motivo: motivo === k ? undefined : k })} title={porSegMotivo[k] ? `Por seguradora: ${Object.entries(porSegMotivo[k]).map(([sg, n]) => `${sg} ${n}`).join(" · ")}` : undefined} className={`rounded-full border px-3 py-1 font-medium ${v.cor} ${motivo === k ? "ring-2 ring-o2-navy" : ""}`}>
            {v.rotulo} · {(contaMotivo[k] ?? 0).toLocaleString("pt-BR")}
          </Link>
        ))}
        <span className="mx-2 text-gray-300">|</span>
        <span className="text-[11px] uppercase tracking-wide text-gray-500">Origem:</span>
        <InfoLegenda titulo="Origem">
          Bitrix = proposta que veio de um cartão concluído no Bitrix. Corp = proposta que veio do cadastro do Corp. Todas = as duas na mesma lista.
        </InfoLegenda>
        {[{ k: undefined, r: "todas" }, { k: "bitrix", r: "Bitrix" }, { k: "corp", r: "Corp" }].map((o) => (
          <Link key={o.r} href={href({ origem: o.k })} className={`rounded-full border px-3 py-1 font-medium ${origem === o.k ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 text-gray-700"}`}>
            {o.r}
          </Link>
        ))}
      </section>

      <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">Situação de prazo:</span>
          <InfoLegenda titulo="Situação de prazo">
            Compara os dias desde a efetivação com o que costuma levar para emitir na MESMA seguradora e produto (cadência real das apólices já emitidas: data de emissão do PDF, e-mail ou Corp menos a data de efetivação). No prazo = até a mediana; atenção = entre a mediana e o percentil 75; atrasada = entre o 75 e o 90; muito atrasada = acima do 90. Sem referência quando há menos de 10 apólices emitidas no grupo (e na seguradora inteira): nunca é chute. Nada sai da lista sozinho.
          </InfoLegenda>
          {(Object.keys(PRAZOS) as ChavePrazo[]).map((k) => (
            <Link key={k} href={href({ prazo: prazoSel === k ? undefined : k })} className={`rounded-full border px-3 py-1 font-medium ${PRAZOS[k].cor} ${prazoSel === k ? "ring-2 ring-o2-navy" : ""}`}>
              {PRAZOS[k].rotulo} · {contaPrazo[k].toLocaleString("pt-BR")}
            </Link>
          ))}
        </div>
        {porSegPrazo.size > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr><th className="px-2 py-1">Seguradora</th><th className="px-2 py-1 text-right">No prazo</th><th className="px-2 py-1 text-right">Atenção</th><th className="px-2 py-1 text-right">Atrasadas</th><th className="px-2 py-1 text-right">Muito atrasadas</th><th className="px-2 py-1 text-right">Sem referência</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...porSegPrazo.entries()].sort((x, y) => (y[1].atrasada + y[1].muito_atrasada) - (x[1].atrasada + x[1].muito_atrasada)).map(([sg, o]) => (
                  <tr key={sg}>
                    <td className="px-2 py-1 font-medium">{sg}</td>
                    <td className="px-2 py-1 text-right">{o.no_prazo}</td>
                    <td className="px-2 py-1 text-right">{o.atencao}</td>
                    <td className="px-2 py-1 text-right font-medium text-orange-700">{o.atrasada}</td>
                    <td className="px-2 py-1 text-right font-semibold text-red-700">{o.muito_atrasada}</td>
                    <td className="px-2 py-1 text-right text-gray-500">{o.sem_ref}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details className="text-[11px] text-gray-600">
          <summary className="cursor-pointer font-medium text-o2-navy">De onde vem cada referência de prazo ({refsUsadas.size})</summary>
          <p className="mt-1">Dias entre a efetivação e a emissão das apólices já emitidas. Início = “card” (etapa SUCESSO do card no Bitrix) ou “proposta do Corp” (data da proposta). Usa-se a referência da mesma origem da data da proposta pendente. Só vale com n ≥ 10. Calculada em {refsUsadas.size ? formatarData([...refsUsadas.values()][0].calculada_em.slice(0, 10)) : "—"} e recalculada a cada hora junto com a fila.</p>
          <table className="mt-1 w-full">
            <thead className="text-left uppercase text-gray-500"><tr><th className="pr-2">Início</th><th className="pr-2">Seguradora</th><th className="pr-2">Produto</th><th className="pr-2 text-right">n</th><th className="pr-2 text-right">Mediana</th><th className="pr-2 text-right">P75</th><th className="pr-2 text-right">P90</th><th className="text-right">% até 7 dias</th></tr></thead>
            <tbody>
              {[...refsUsadas.values()].sort((x, y) => x.fonte_inicio.localeCompare(y.fonte_inicio) || x.seguradora.localeCompare(y.seguradora) || x.produto.localeCompare(y.produto)).map((r) => (
                <tr key={`${r.fonte_inicio}${r.seguradora}${r.produto}`}>
                  <td className="pr-2">{r.fonte_inicio === "card" ? "card (SUCESSO)" : "proposta do Corp"}</td><td className="pr-2">{r.seguradora}</td><td className="pr-2">{r.produto === "*" ? "todos (nível seguradora)" : r.produto}</td>
                  <td className="pr-2 text-right">{r.n.toLocaleString("pt-BR")}</td><td className="pr-2 text-right">{r.mediana_dias} d</td><td className="pr-2 text-right">{r.p75_dias} d</td><td className="pr-2 text-right">{r.p90_dias} d</td><td className="text-right">{r.pct_ate_7_dias}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      {[{ lista: mesLinhas, herd: false, total: mesFiltradas.length }, { lista: herdLinhas, herd: true, total: herdFiltradas.length }].map(({ lista, herd, total: totalSecao }) => (
      <section key={herd ? "herdadas" : "do-mes"} className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">
          {herd ? `Herdadas de meses anteriores (efetivadas antes de ${rotuloMes})` : `Do mês: efetivadas em ${rotuloMes}`} · {totalSecao.toLocaleString("pt-BR")}
          <InfoLegenda titulo={herd ? "Herdadas de meses anteriores" : "Do mês"}>
            {herd ? "Propostas efetivadas ANTES do mês escolhido que continuam sem Nº da apólice. Cada linha diz de que mês veio e há quantos dias está pendente; as de mais de 60 dias ficam com destaque vermelho: são as apólices paradas que precisam de uma resposta (veja a coluna Situação / motivo). Nada sai daqui sozinho." : "Propostas efetivadas no mês escolhido que ainda não têm Nº da apólice."}
          </InfoLegenda>
        </h2>
      {lista.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">{herd ? "Nenhuma proposta herdada neste recorte." : "Nenhuma proposta pendente efetivada neste mês."}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Abrir</th>
                <th className="px-3 py-2">Tipo de documento</th>
                <th className="px-3 py-2">Titular do seguro</th>
                <th className="px-3 py-2">Produto</th>
                <th className="px-3 py-2">Seguradora</th>
                <th className="px-3 py-2">Vigência</th>
                <th className="px-3 py-2">Efetivada em</th>
                <th className="px-3 py-2 text-right">Dias</th>
                <th className="px-3 py-2">Prazo esperado</th>
                <th className="px-3 py-2">Situação de prazo</th>
                <th className="px-3 py-2">Código O2 do documento</th>
                <th className="px-3 py-2">Origem</th>
                <th className="px-3 py-2">Imobiliária</th>
                <th className="px-3 py-2 text-right">Pr. líquido</th>
                <th className="px-3 py-2">Situação / motivo</th>
                <th className="px-3 py-2">Card</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map((d) => {
                const dias = diasEntre(d.data_efetivacao, refData);
                const c = cab.get(d.id);
                const tipo = tipoDoCabecalho({ tipo: d.tipo, tipo_corp: d.tipo_corp, situacao: "proposta", modo_cobranca: c?.modo_cobranca ?? null });
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2"><BotaoVerDocumento id={d.id} /></td>
                    <td className="px-3 py-2">
                      <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${tipo.cor}`}>{tipo.nome}</span>
                      {tipo.detalhe ? <span className="ml-1 text-[10px] text-gray-500">{tipo.detalhe}</span> : null}
                      {d.tipo === "C" && d.tipo_corp === "END" && !idsComParcela.has(d.id) ? <span className="mt-0.5 block w-fit rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800">parcelas a informar</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {(c?.titular ?? d.cliente) ? <span className="font-medium text-gray-900">{c?.titular ?? d.cliente}</span> : <span className="text-gray-400">titular não ligado</span>}
                      {c?.inquilino && c.inquilino !== (c.titular ?? d.cliente) ? <span className="block text-[10px] text-gray-500">inquilino: {c.inquilino}</span> : null}
                    </td>
                    <td className="px-3 py-2">{c?.produto_nome ?? d.ramo ?? "—"}</td>
                    <td className="px-3 py-2">{c?.seguradora_nome ?? d.seguradora ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{c?.vigencia_inicio || c?.vigencia_fim ? `${formatarData(c?.vigencia_inicio ?? null)} a ${formatarData(c?.vigencia_fim ?? null)}` : formatarData(d.vigencia_inicio)}</td>
                    <td className="px-3 py-2" title={`data vinda de: ${d.fonte_data}`}>{formatarData(d.data_efetivacao)}<span className="block text-[10px] text-gray-400">{d.fonte_data}</span>{herd ? <span className="block text-[10px] font-medium text-orange-700">herdada de {d.data_efetivacao.slice(5, 7)}/{d.data_efetivacao.slice(0, 4)}</span> : null}</td>
                    <td className="px-3 py-2 text-right"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${corDias(dias)} ${dias > 60 ? "font-bold ring-2 ring-red-500" : ""}`} title={dias > 60 ? "Mais de 60 dias sem virar apólice" : undefined}>{dias}</span></td>
                    {(() => {
                      const pz = prazoPorId.get(d.id);
                      const r = pz?.ref ?? null;
                      const k = pz?.chave ?? "sem_ref";
                      return (
                        <>
                          <td className="whitespace-nowrap px-3 py-2" title={r ? `Referência: ${r.nivel === "seguradora_produto" ? `${r.seguradora} ${r.produto}` : `${r.seguradora} (todos os produtos)`}, início = ${r.fonte_inicio === "card" ? "card (SUCESSO)" : "proposta do Corp"}, n = ${r.n}, p90 ${r.p90_dias} d` : "Menos de 10 apólices emitidas com esta origem de data: sem referência"}>
                            {r ? <>{r.mediana_dias} d<span className="text-gray-400"> mediana · {r.p75_dias} d p75</span><span className="block text-[10px] text-gray-400">{r.nivel === "seguradora" ? "da seguradora" : "do produto"} · {r.fonte_inicio === "card" ? "card" : "proposta Corp"} · n {r.n.toLocaleString("pt-BR")}</span></> : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-3 py-2"><span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${PRAZOS[k].cor}`}>{PRAZOS[k].rotulo}</span></td>
                        </>
                      );
                    })()}
                    <td className="px-3 py-2 font-medium">
                      <Link href={`/erp/documentos/${d.id}`} className="text-o2-navy hover:underline">{d.nosso_numero}</Link>
                      <span className="block text-[10px] font-normal text-gray-400">{d.nosso_numero_corp ? `Corp ${d.nosso_numero_corp}` : "ainda não existe no Corp"}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${d.origem === "bitrix" ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-700"}`}>{d.origem === "bitrix" ? "Bitrix" : "Corp"}</span>
                    </td>
                    <td className="px-3 py-2">
                      {d.imobiliaria_id ? <Link href={`/admin/imobiliarias/${d.imobiliaria_id}`} className="hover:underline">{d.imobiliaria}</Link> : <span className="text-gray-400">{d.canal_venda ?? "—"}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{formatarReais(d.premio_liquido)}</td>
                    <td className="px-3 py-2">
                      {(() => {
                        const ac = acompPorDoc.get(d.id); const mt = MOTIVOS[ac?.motivo ?? "sem_informacao"] ?? MOTIVOS.sem_informacao;
                        return (
                          <span title={ac?.evidencia_resumo ?? undefined}>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${mt.cor}`}>{mt.rotulo}</span>
                            {ac?.confianca === "provavel" && <span className="ml-1 text-[10px] text-orange-700">provável — confirmar</span>}
                            {ac?.evidencia_resumo && ac.motivo !== "sem_informacao" && <span className="block text-[10px] text-gray-400">{ac.evidencia_resumo}{ac.data_evidencia ? ` · ${formatarData(ac.data_evidencia.slice(0, 10))}` : ""} · nível 5</span>}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2">{d.card_url ? <a href={d.card_url} target="_blank" rel="noreferrer" className="text-o2-navy hover:underline">abrir</a> : <span className="text-gray-300">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </section>
      ))}
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

function Cartao({ titulo, valor, nota, cor = "text-o2-navy", realce = false, info }: { titulo: string; valor: number | undefined; nota?: string; cor?: string; realce?: boolean; info?: ReactNode }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${realce ? "border-o2-navy ring-1 ring-o2-navy" : "border-gray-200"}`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{titulo}{info ? <InfoLegenda titulo={titulo}>{info}</InfoLegenda> : null}</div>
      <div className={`mt-1 text-2xl font-semibold ${cor}`}>{valor === undefined ? "—" : valor.toLocaleString("pt-BR")}</div>
      {nota && <div className="mt-0.5 text-[11px] text-gray-500">{nota}</div>}
    </div>
  );
}
