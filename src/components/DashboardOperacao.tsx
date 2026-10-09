import { montarDashboardOperacao, type ParMeses } from "@/lib/dashboardOperacao";
import { Cartao, variacaoRitmo, type Tom } from "./kpiUi";

// "Operação e marketing do mês" -- 2º quadro da aba Painel de KPIs (pedido
// do Matheus, 09/10/2026). Origem dos números: lib/dashboardOperacao.ts.

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function nomeMes(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return `${MESES[mes - 1][0].toUpperCase()}${MESES[mes - 1].slice(1)}/${ano}`;
}

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function dataCurta(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date(iso));
}

function Indisponivel({ rotulo }: { rotulo: string }) {
  return <Cartao rotulo={rotulo} valor="—" linhas={["indisponível agora"]} />;
}

export default async function DashboardOperacao() {
  const d = await montarDashboardOperacao();
  const mesAtual = nomeMes(d.competenciaAtual).split("/")[0];
  const mesAnt = nomeMes(d.competenciaAnterior).split("/")[0];
  const abrev = mesAnt.slice(0, 3);

  const rAtual = (n: number) => n / d.diaAtual;
  const rAnt = (n: number) => n / d.diasMesAnterior;

  // Cartão de contagem comparando o RITMO por dia (o mês atual está em andamento).
  // "desde": data em que o registro/captura começou -- se for depois do início do
  // mês anterior, esse mês não tem base completa e a comparação não é feita.
  function contagem(rotulo: string, par: ParMeses | null, opcoes: { comInicio?: boolean; desde?: string | null; nota?: string } = {}) {
    if (!par) return <Indisponivel rotulo={rotulo} />;
    const inicioAnterior = new Date(`${d.competenciaAnterior}-01T00:00:00-03:00`);
    const semBaseAnterior = !!opcoes.comInicio && (!opcoes.desde || new Date(opcoes.desde) > inicioAnterior);
    const linhas = semBaseAnterior
      ? [`Sem registro completo em ${abrev}`, opcoes.desde ? `Contagem começou em ${dataCurta(opcoes.desde)}` : "Ainda sem nenhum registro"]
      : [`${abrev}: ${inteiro.format(par.anterior)} (mês fechado)`, `Ritmo: ${decimal.format(rAtual(par.atual))}/dia vs ${decimal.format(rAnt(par.anterior))}/dia`];
    if (opcoes.nota) linhas.push(opcoes.nota);
    return <Cartao rotulo={rotulo} valor={inteiro.format(par.atual)} linhas={linhas} variacao={semBaseAnterior ? undefined : variacaoRitmo(rAtual(par.atual), rAnt(par.anterior))} />;
  }

  // Abertos: o que importa é a TAXA de abertura (abertos ÷ enviados).
  function cartaoAbertos() {
    if (!d.abertos || !d.enviados) return <Indisponivel rotulo="E-mails abertos" />;
    const taxaAtual = d.enviados.atual > 0 ? d.abertos.atual / d.enviados.atual : null;
    const taxaAnt = d.enviados.anterior > 0 ? d.abertos.anterior / d.enviados.anterior : null;
    const pct = (t: number | null) => (t === null ? "—" : `${decimal.format(t * 100)}%`);
    let variacao: { texto: string; tom: Tom } | undefined;
    if (taxaAtual !== null && taxaAnt !== null) {
      const pp = (taxaAtual - taxaAnt) * 100;
      variacao = { texto: `${pp >= 0 ? "+" : "−"}${decimal.format(Math.abs(pp))} p.p.`, tom: Math.abs(pp) < 1 ? "neutro" : pp > 0 ? "bom" : "ruim" };
    }
    return (
      <Cartao
        rotulo="E-mails abertos"
        valor={inteiro.format(d.abertos.atual)}
        linhas={[`${pct(taxaAtual)} dos enviados`, `${abrev}: ${inteiro.format(d.abertos.anterior)} (${pct(taxaAnt)})`]}
        variacao={variacao}
      />
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
      <div>
        <h2 className="text-base font-semibold text-o2-navy">Operação e marketing do mês</h2>
        <p className="text-xs text-o2-cinza-medio">
          {mesAtual} (até {String(d.diaAtual).padStart(2, "0")}/{d.competenciaAtual.slice(5)}) comparado a {mesAnt} (fechado)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {contagem("Contratos auditados", d.auditados)}
        {contagem("Campanhas disparadas", d.campanhas)}
        {contagem("E-mails de campanhas enviados", d.enviados)}
        {cartaoAbertos()}
        {contagem("Cálculos de multa rescisória", d.calculadora, { comInicio: true, desde: d.calculadora?.desde })}
        {contagem("Visitas no site", d.visitas, { nota: "soma dos visitantes únicos de cada dia" })}
        {contagem("Leads do site", d.leads, { comInicio: true, desde: d.leads?.desde })}
      </div>

      <p className="border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-o2-cinza-medio">
        <b>Contratos auditados:</b> auditorias de contas reais + auditorias da página pública. <b>Campanhas:</b> disparadas no mês; e-mails contam os enviados no mês e os
        &ldquo;abertos&rdquo; vêm do aviso de abertura do próprio e-mail (leitores que bloqueiam imagens não aparecem). <b>Cálculos de multa:</b> 1 por abertura da
        calculadora em que saiu um resultado; antes de 09/10/2026 a ferramenta não guardava nenhum registro. <b>Visitas:</b> medidas pelo Cloudflare no site
        o2seguros.com.br (inclui robôs). <b>Leads do site:</b> formulários do site gravados no Workspace (captura começou em 02/10/2026).
      </p>
    </section>
  );
}
