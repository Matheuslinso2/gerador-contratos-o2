import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { pediuAtualizacao, retratoRecente } from "@/lib/retratoPaineis";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import AtualizarAgora from "@/components/AtualizarAgora";
import InfoLegenda from "@/components/InfoLegenda";
import { IconChart } from "@/components/icons";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { signOut } from "../../actions";
import { Aviso } from "../ui";
import BarrasMensais from "./BarrasMensais";

export const dynamic = "force-dynamic";

// Painel de KPIs de sinistro (Seguro Fiança) -- só equipe O2. Plano em
// entregaveis/modulo-sinistro/KPIs Sinistro - Planejamento.pdf (v1.1).
// Números vêm de kpis_sinistros() (supabase/schema_sinistros_kpis.sql):
// contagem/valores do histórico do Corp, carteira e prêmio ganho da produção
// do Corp, agrupado pelo grupo da imobiliária; processo, do módulo novo.

type Resumo = {
  avisados: number;
  avisados_ocupado: number;
  avisados_chaves: number;
  vigentes: number;
  premio_ganho: number;
  indenizado: number;
  avisado_valor: number;
  encerrados_indenizados: number;
  encerrados_sem_indenizacao: number;
  em_aberto: number;
  em_aberto_mais_90_dias: number;
  mediana_dias_ate_encerrar: number | null;
  ticket_medio: number;
  contratos_com_sinistro_24m: number;
  contratos_recorrentes_24m: number;
};
type Mes = { mes: string; avisados: number; indenizados: number; sem_indenizacao: number; valor_indenizado: number };
type Linha = {
  avisados: number;
  indenizados: number;
  sem_indenizacao: number;
  indenizado: number;
  em_aberto: number;
  vigentes: number | null;
  premio_ganho: number | null;
};
type Seguradora = Linha & { seguradora: string };
type Imobiliaria = Linha & { chave: string; nome: string; tipo: "grupo" | "imobiliaria" | "sem_vinculo"; recorrentes: number };
type Processo = {
  enviados: number;
  no_prazo: number;
  com_pendencia: number;
  devolucoes: number;
  abertos_na_seguradora: number;
  mediana_dias_ate_abrir: number | null;
  motivos_recusa: { motivo: string; n: number }[];
};
type Kpis = {
  referencia: string;
  inicio_janela: string;
  importado_em: string | null;
  resumo: Resumo;
  mensal: Mes[];
  por_seguradora: Seguradora[];
  por_imobiliaria: Imobiliaria[];
  processo: Processo;
};

const BASE_MINIMA = 20; // G5: abaixo disso não entra em taxa/semáforo
const AZUL = "#2E6FB7";
const LARANJA = "#F8540D";

const pct = (a: number, b: number | null | undefined) => (b ? `${((100 * a) / b).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—");
const milhoes = (v: number) =>
  v >= 1_000_000 ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi` : `R$ ${Math.round(v / 1000).toLocaleString("pt-BR")} mil`;

// Semáforo de risco (seção 6 do plano): frequência vs média da carteira e
// sinistralidade. Faixas iniciais, a calibrar.
function semaforo(l: Imobiliaria, freqCarteira: number): { rotulo: string; cls: string } | null {
  if (!l.vigentes || l.vigentes < BASE_MINIMA) return null;
  const freq = l.avisados / l.vigentes;
  const sin = l.premio_ganho ? l.indenizado / l.premio_ganho : 0;
  if (freq > 1.5 * freqCarteira || sin > 0.35) return { rotulo: "atenção", cls: "bg-red-100 text-red-700" };
  if (freq > freqCarteira || sin >= 0.2) return { rotulo: "acompanhar", cls: "bg-orange-100 text-orange-800" };
  return { rotulo: "ok", cls: "bg-green-100 text-green-800" };
}

const ORDENS = {
  indenizado: (a: Imobiliaria, b: Imobiliaria) => b.indenizado - a.indenizado,
  avisados: (a: Imobiliaria, b: Imobiliaria) => b.avisados - a.avisados,
  frequencia: (a: Imobiliaria, b: Imobiliaria) => taxaBase(b, b.avisados, b.vigentes) - taxaBase(a, a.avisados, a.vigentes),
  sinistralidade: (a: Imobiliaria, b: Imobiliaria) => taxaBase(b, b.indenizado, b.premio_ganho) - taxaBase(a, a.indenizado, a.premio_ganho),
  em_aberto: (a: Imobiliaria, b: Imobiliaria) => b.em_aberto - a.em_aberto,
};
// Ordenação por taxa: base pequena (ou sem denominador) vai pro fim.
function taxa(a: number, b: number | null) {
  return b && b > 0 ? a / b : -1;
}
function taxaBase(l: Imobiliaria, a: number, b: number | null) {
  return l.vigentes && l.vigentes >= BASE_MINIMA ? taxa(a, b) : -1;
}

export default async function PainelSinistrosPage({
  searchParams,
}: {
  searchParams: Promise<{ atualizar?: string; ordem?: string; todos?: string }>;
}) {
  const { atualizar, ordem, todos } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.email) && !isColaboradorO2(user.email)) redirect("/sinistros");

  // Retrato de até 10 min (kpis_sinistros leva ~2,5 s).
  let kpis: Kpis | null = null;
  let atualizadoEm: string | null = null;
  let erro: string | null = null;
  if (!pediuAtualizacao(atualizar)) {
    const { data } = await supabase.from("sinistros_kpis_retrato").select("dados, atualizado_em").eq("id", 1).maybeSingle();
    if (data && retratoRecente(data.atualizado_em)) {
      kpis = data.dados as Kpis;
      atualizadoEm = data.atualizado_em;
    }
  }
  if (!kpis) {
    const { data, error } = await supabase.rpc("kpis_sinistros");
    if (error) {
      erro = error.message;
      const { data: antigo } = await supabase.from("sinistros_kpis_retrato").select("dados, atualizado_em").eq("id", 1).maybeSingle();
      if (antigo) {
        kpis = antigo.dados as Kpis;
        atualizadoEm = antigo.atualizado_em;
      }
    } else {
      kpis = data as Kpis;
      atualizadoEm = new Date().toISOString();
      await supabase.from("sinistros_kpis_retrato").upsert({ id: 1, dados: kpis, atualizado_em: atualizadoEm });
    }
  }

  return (
    <>
      <AppHeader userEmail={user.email} logoutAction={signOut} />
      <main className="mx-auto max-w-7xl flex-1 space-y-6 p-8">
        <Link href="/sinistros" className="text-sm text-gray-500 hover:text-o2-navy hover:underline">
          ← Fila de sinistros
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader
            icon={<IconChart />}
            titulo="Sinistros — KPIs"
            subtitulo={kpis ? `Seguro Fiança · últimos 12 meses (${formatarData(kpis.inicio_janela)} a ${formatarData(kpis.referencia)})` : "Seguro Fiança"}
          />
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {atualizadoEm && <span>calculado {new Date(atualizadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</span>}
            <AtualizarAgora />
          </div>
        </div>
        {erro && <Aviso tipo="erro">Não foi possível recalcular agora ({erro}). {kpis ? "Mostrando o último retrato salvo." : ""}</Aviso>}
        {kpis && <Painel kpis={kpis} ordem={(ordem as keyof typeof ORDENS) || "indenizado"} todos={todos === "1"} />}
      </main>
    </>
  );
}

function Cartao({ rotulo, valor, linhas, legenda, destaque }: { rotulo: string; valor: string; linhas: string[]; legenda: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 ${destaque ? "border-o2-coral" : "border-gray-200"}`}>
      <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {rotulo}
        <InfoLegenda titulo={rotulo}>{legenda}</InfoLegenda>
      </p>
      <p className="mt-1 text-2xl font-bold text-o2-navy">{valor}</p>
      {linhas.map((l) => (
        <p key={l} className="text-xs text-gray-500">
          {l}
        </p>
      ))}
    </div>
  );
}

function Painel({ kpis, ordem, todos }: { kpis: Kpis; ordem: keyof typeof ORDENS; todos: boolean }) {
  const r = kpis.resumo;
  const encerrados = r.encerrados_indenizados + r.encerrados_sem_indenizacao;
  const freqCarteira = r.vigentes ? r.avisados / r.vigentes : 0;
  const imobs = [...kpis.por_imobiliaria].sort(ORDENS[ordem] ?? ORDENS.indenizado);
  const visiveis = todos ? imobs : imobs.slice(0, 30);
  const p = kpis.processo;

  return (
    <div className="space-y-8">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          rotulo="Sinistros avisados"
          valor={r.avisados.toLocaleString("pt-BR")}
          linhas={[`${r.avisados_ocupado} imóvel ocupado · ${r.avisados_chaves} entrega de chaves`, `${milhoes(r.avisado_valor)} avisados`]}
          legenda="Sinistros de fiança com aviso nos últimos 12 meses (data de aviso no Corp; sem ela, a data da ocorrência). O tipo vem da descrição do Corp e pode não somar o total."
        />
        <Cartao
          rotulo="Frequência"
          valor={pct(r.avisados, r.vigentes)}
          linhas={[`sobre ${r.vigentes.toLocaleString("pt-BR")} apólices vigentes hoje`]}
          legenda="Sinistros avisados em 12 meses ÷ apólices de fiança vigentes na data de referência (produção do Corp)."
        />
        <Cartao
          rotulo="Indenizado"
          valor={milhoes(r.indenizado)}
          linhas={[`${r.encerrados_indenizados} sinistros · ticket médio ${formatarReais(r.ticket_medio)}`]}
          legenda="Valor indenizado dos sinistros ENCERRADOS como indenizados nos últimos 12 meses. O Corp só exporta o total de cada sinistro, então o valor entra no mês do encerramento e os sinistros em aberto ainda não somam (fica subestimado)."
        />
        <Cartao
          rotulo="Sinistralidade"
          valor={pct(r.indenizado, r.premio_ganho)}
          linhas={[`sobre ${milhoes(r.premio_ganho)} de prêmio ganho`]}
          destaque
          legenda="Indenizado em 12 meses ÷ prêmio ganho em 12 meses (decidido em 19/10/2026): cada apólice contribui com a parte do prêmio correspondente aos meses em que esteve vigente na janela."
        />
        <Cartao
          rotulo="Em aberto"
          valor={r.em_aberto.toLocaleString("pt-BR")}
          linhas={[`${r.em_aberto_mais_90_dias} avisados há mais de 90 dias`]}
          legenda="Sinistros pendentes ou em andamento no Corp hoje (qualquer data de aviso)."
        />
        <Cartao
          rotulo="Desfecho"
          valor={pct(r.encerrados_indenizados, encerrados)}
          linhas={[`indenizados de ${encerrados} encerrados`, `${r.encerrados_sem_indenizacao} sem indenização`]}
          legenda="Dos sinistros encerrados em 12 meses, quantos foram indenizados. 'Sem indenização' inclui o locatário que quitou ou fez acordo (a maioria, pelo histórico) — não é sinônimo de negativa."
        />
        <Cartao
          rotulo="Tempo até encerrar"
          valor={r.mediana_dias_ate_encerrar != null ? `${Math.round(r.mediana_dias_ate_encerrar)} dias` : "—"}
          linhas={["mediana, do aviso ao encerramento"]}
          legenda="Mediana de dias entre o aviso e o encerramento no Corp, nos sinistros encerrados em 12 meses. Casos longos ainda abertos (acordo/judicial) não entram."
        />
        <Cartao
          rotulo="Recorrência"
          valor={pct(r.contratos_recorrentes_24m, r.contratos_com_sinistro_24m)}
          linhas={[`${r.contratos_recorrentes_24m} de ${r.contratos_com_sinistro_24m} contratos com 2+ sinistros`]}
          legenda="Nos últimos 24 meses: contratos (Nosso Nº do Corp) que tiveram 2 ou mais sinistros ÷ contratos com algum sinistro. Típico de locatário que quita, volta a atrasar e reabre."
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-o2-navy">Sinistros avisados por mês</h2>
          <BarrasMensais pontos={kpis.mensal.map((m) => ({ mes: m.mes, valores: { avisados: m.avisados } }))} series={[{ chave: "avisados", rotulo: "Avisados", cor: AZUL }]} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-o2-navy">Encerrados por mês</h2>
          <BarrasMensais
            pontos={kpis.mensal.map((m) => ({ mes: m.mes, valores: { ind: m.indenizados, sem: m.sem_indenizacao } }))}
            series={[
              { chave: "ind", rotulo: "Indenizados", cor: AZUL },
              { chave: "sem", rotulo: "Sem indenização", cor: LARANJA },
            ]}
          />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-o2-navy">Valor indenizado por mês do encerramento</h2>
          <BarrasMensais
            pontos={kpis.mensal.map((m) => ({ mes: m.mes, valores: { v: m.valor_indenizado } }))}
            series={[{ chave: "v", rotulo: "Indenizado", cor: AZUL }]}
            formato="reais"
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Por seguradora (12 meses)</h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-o2-navy text-left text-xs text-white">
              <tr>
                <th className="px-3 py-2">Seguradora</th>
                <th className="px-3 py-2 text-right">Apólices vigentes</th>
                <th className="px-3 py-2 text-right">Avisados</th>
                <th className="px-3 py-2 text-right">Frequência</th>
                <th className="px-3 py-2 text-right">Indenizado</th>
                <th className="px-3 py-2 text-right">Prêmio ganho</th>
                <th className="px-3 py-2 text-right">Sinistralidade</th>
                <th className="px-3 py-2 text-right">% sem indenização</th>
                <th className="px-3 py-2 text-right">Em aberto</th>
              </tr>
            </thead>
            <tbody>
              {kpis.por_seguradora.map((s) => (
                <tr key={s.seguradora} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-medium text-o2-navy">{s.seguradora}</td>
                  <td className="px-3 py-2 text-right">{s.vigentes?.toLocaleString("pt-BR") ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{s.avisados}</td>
                  <td className="px-3 py-2 text-right">{s.vigentes && s.vigentes >= BASE_MINIMA ? pct(s.avisados, s.vigentes) : "—"}</td>
                  <td className="px-3 py-2 text-right">{milhoes(s.indenizado)}</td>
                  <td className="px-3 py-2 text-right">{s.premio_ganho ? milhoes(s.premio_ganho) : "—"}</td>
                  <td className="px-3 py-2 text-right font-semibold">{s.premio_ganho && s.premio_ganho > 50_000 ? pct(s.indenizado, s.premio_ganho) : "—"}</td>
                  <td className="px-3 py-2 text-right">{pct(s.sem_indenizacao, s.indenizados + s.sem_indenizacao)}</td>
                  <td className="px-3 py-2 text-right">{s.em_aberto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-o2-navy">
            Por imobiliária / grupo (12 meses)
            <InfoLegenda titulo="Como o quadro é montado">
              Cada sinistro é ligado à apólice pelo Nosso Nº do Corp e, pela apólice, ao produtor (imobiliária). Quando o produtor já foi confirmado no
              cadastro, entra a imobiliária do Workspace — e, se ela fizer parte de um grupo, tudo é somado no grupo. Produtor ainda não confirmado
              aparece com o nome do Corp e a marca &quot;sem vínculo&quot;. Taxas e semáforo só com {BASE_MINIMA}+ apólices vigentes. Semáforo de risco:
              atenção = frequência acima de 1,5× a média da carteira ou sinistralidade acima de 35%; acompanhar = frequência acima da média ou
              sinistralidade de 20% a 35%.
            </InfoLegenda>
          </h2>
          <div className="flex flex-wrap gap-1 text-xs">
            {(
              [
                ["indenizado", "Indenizado"],
                ["avisados", "Avisados"],
                ["frequencia", "Frequência"],
                ["sinistralidade", "Sinistralidade"],
                ["em_aberto", "Em aberto"],
              ] as const
            ).map(([k, rot]) => (
              <Link
                key={k}
                href={`/sinistros/painel?ordem=${k}${todos ? "&todos=1" : ""}`}
                className={`rounded-full border px-3 py-1 ${ordem === k ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 text-gray-600 hover:border-o2-navy"}`}
              >
                {rot}
              </Link>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-o2-navy text-left text-xs text-white">
              <tr>
                <th className="px-3 py-2">Imobiliária / grupo</th>
                <th className="px-3 py-2 text-right">Apólices vigentes</th>
                <th className="px-3 py-2 text-right">Avisados</th>
                <th className="px-3 py-2 text-right">Frequência</th>
                <th className="px-3 py-2 text-right">Indenizado</th>
                <th className="px-3 py-2 text-right">Prêmio ganho</th>
                <th className="px-3 py-2 text-right">Sinistralidade</th>
                <th className="px-3 py-2 text-right">Em aberto</th>
                <th className="px-3 py-2 text-right">Recorrentes</th>
                <th className="px-3 py-2">Risco</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const s = semaforo(l, freqCarteira);
                const baseOk = !!l.vigentes && l.vigentes >= BASE_MINIMA;
                return (
                  <tr key={l.chave} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <span className="font-medium text-o2-navy">{l.nome}</span>
                      {l.tipo === "grupo" && <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">grupo</span>}
                      {l.tipo === "sem_vinculo" && <span className="ml-1 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">sem vínculo</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{l.vigentes?.toLocaleString("pt-BR") ?? "—"}</td>
                    <td className="px-3 py-2 text-right">{l.avisados}</td>
                    <td className="px-3 py-2 text-right">{baseOk ? pct(l.avisados, l.vigentes) : <span className="text-xs text-gray-400">base pequena</span>}</td>
                    <td className="px-3 py-2 text-right">{l.indenizado ? milhoes(l.indenizado) : "—"}</td>
                    <td className="px-3 py-2 text-right">{l.premio_ganho ? milhoes(l.premio_ganho) : "—"}</td>
                    <td className="px-3 py-2 text-right font-semibold">{baseOk && l.premio_ganho ? pct(l.indenizado, l.premio_ganho) : "—"}</td>
                    <td className="px-3 py-2 text-right">{l.em_aberto || "—"}</td>
                    <td className="px-3 py-2 text-right">{l.recorrentes || "—"}</td>
                    <td className="px-3 py-2">{s ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>{s.rotulo}</span> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!todos && imobs.length > visiveis.length && (
          <Link href={`/sinistros/painel?ordem=${ordem}&todos=1`} className="text-sm text-o2-blue underline">
            Ver todas as {imobs.length}
          </Link>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-o2-navy">
          Processo — sinistros abertos pelo Workspace
          <InfoLegenda titulo="Processo">
            Indicadores do módulo novo (no ar desde 19/10/2026), com os sinistros enviados pelo Workspace nos últimos 12 meses. Ficam significativos à medida
            que as imobiliárias passam a avisar por aqui.
          </InfoLegenda>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Cartao rotulo="Enviados" valor={String(p.enviados)} linhas={[`${p.abertos_na_seguradora} já abertos na seguradora`]} legenda="Avisos enviados pelo Workspace (sem rascunhos e cancelados)." />
          <Cartao rotulo="Avisos no prazo" valor={pct(p.no_prazo, p.enviados)} linhas={["10 dias do 2º vencimento / 15 da entrega das chaves"]} legenda="Avisos enviados dentro do prazo calculado pelo sistema." />
          <Cartao
            rotulo="Com pendência"
            valor={pct(p.com_pendencia, p.enviados)}
            linhas={[`${p.devolucoes} devolução(ões) no total`]}
            legenda="Sinistros que a O2 precisou devolver à imobiliária ao menos uma vez. O inverso é o 'aprovado de primeira'."
          />
          <Cartao
            rotulo="Aviso → abertura"
            valor={p.mediana_dias_ate_abrir != null ? `${Math.round(p.mediana_dias_ate_abrir)} dias` : "—"}
            linhas={["mediana até o nº na seguradora"]}
            legenda="Dias entre o envio pela imobiliária e o registro do número do sinistro na seguradora (inclui o tempo de pendência)."
          />
        </div>
        {p.motivos_recusa.length > 0 && (
          <p className="text-xs text-gray-600">
            Motivos de recusa de documento mais comuns: {p.motivos_recusa.map((m) => `${m.motivo} (${m.n})`).join(" · ")}
          </p>
        )}
      </section>

      <p className="text-xs text-gray-400">
        Fonte: exportações do Corp importadas em {kpis.importado_em ? formatarData(kpis.importado_em.slice(0, 10)) : "—"} (scripts/sinistros/importar-corp.mjs) ·
        produção do Corp (apólices e prêmio). Para atualizar os números do Corp, exporte de novo a Consulta de sinistros e a Grade e rode a importação.
      </p>
    </div>
  );
}
