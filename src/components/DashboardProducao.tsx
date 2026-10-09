import { Cartao, variacaoRitmo, type Tom } from "./kpiUi";
import { montarDashboardProducao, somarMes, type LinhaProduto, type NumerosMes } from "@/lib/dashboardProducao";

// Dashboard "Produção do mês" da página inicial -- só pra login
// @o2seguros.com.br (a página decide). Ver lib/dashboardProducao.ts pra
// origem dos números: tudo vem dos retratos que os painéis já salvam.

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function rotuloCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number);
  return `${MESES[mes - 1][0].toUpperCase()}${MESES[mes - 1].slice(1)}/${ano}`;
}

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const horaCurta = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function reaisCompacto(valor: number): string {
  return valor >= 10_000 ? `R$ ${decimal.format(valor / 1000)} mil` : reais.format(valor);
}

function conversao(n: NumerosMes | null): number | null {
  return n && n.concluidas > 0 ? n.efetivadas / n.concluidas : null;
}

function pct(valor: number | null): string {
  return valor === null ? "—" : `${decimal.format(valor * 100)}%`;
}

const CORES_MIX: Record<string, string> = { fianca: "#00447E", ramos: "#1D9E75", capitalizacao: "#EF9F27", auto: "#F8540D" };

function Celula({ atual, anterior }: { atual: string; anterior: string }) {
  return (
    <td className="px-2 py-2 text-right tabular-nums">
      <div className="text-o2-navy">{atual}</div>
      <div className="text-[11px] text-o2-cinza-medio">{anterior}</div>
    </td>
  );
}

function LinhaTabela({ p, rotuloAnterior }: { p: LinhaProduto; rotuloAnterior: string }) {
  const a = p.atual;
  const b = p.anterior;
  const ant = (texto: string | null) => (b ? `${rotuloAnterior} ${texto}` : `${rotuloAnterior} —`);
  return (
    <tr className="border-t border-gray-100">
      <td className="px-2 py-2 text-left font-medium text-o2-navy">
        {p.nome}
        {p.produto === "ramos" && <span className="ml-1 text-[11px] font-normal text-o2-cinza-medio">(novos)</span>}
      </td>
      <Celula atual={a ? inteiro.format(a.cotacoes) : "—"} anterior={ant(b && inteiro.format(b.cotacoes))} />
      <Celula atual={a ? inteiro.format(a.efetivadas) : "—"} anterior={ant(b && inteiro.format(b.efetivadas))} />
      <Celula atual={pct(conversao(a))} anterior={ant(b && pct(conversao(b)))} />
      <Celula atual={a ? reais.format(a.comissao) : "—"} anterior={ant(b && reais.format(b.comissao))} />
      <Celula atual={a ? inteiro.format(a.emAndamento) : "—"} anterior={ant(b && inteiro.format(b.emAndamento))} />
    </tr>
  );
}

export default async function DashboardProducao() {
  const dados = await montarDashboardProducao();
  const atual = somarMes(dados.produtos, "atual");
  const anterior = somarMes(dados.produtos, "anterior");

  const rotuloAtual = rotuloCompetencia(dados.competenciaAtual);
  const rotuloAnterior = rotuloCompetencia(dados.competenciaAnterior);
  const nomeMesAnterior = rotuloAnterior.split("/")[0].slice(0, 3);
  const diaTexto = `${String(dados.diaAtual).padStart(2, "0")}/${dados.competenciaAtual.slice(5)}`;

  if (!atual) {
    return (
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-o2-navy">Produção do mês</h2>
        <p className="mt-2 text-sm text-o2-cinza-medio">Ainda não há retrato dos painéis em {rotuloAtual}. Abra um painel (ou aguarde a atualização das 6h) e volte aqui.</p>
      </section>
    );
  }

  const ritmo = (n: number, dias: number) => n / dias;
  const rAtual = (n: number) => ritmo(n, dados.diaAtual);
  const rAnt = (n: number) => ritmo(n, dados.diasMesAnterior);

  const convAtual = conversao(atual);
  const convAnt = anterior ? conversao(anterior) : null;
  const deltaConv =
    convAtual !== null && convAnt !== null
      ? (() => {
          const pp = (convAtual - convAnt) * 100;
          const tom: Tom = Math.abs(pp) < 1 ? "neutro" : pp > 0 ? "bom" : "ruim";
          return { texto: `${pp >= 0 ? "+" : "−"}${decimal.format(Math.abs(pp))} p.p.`, tom };
        })()
      : undefined;

  const emAnd = anterior ? atual.emAndamento - anterior.emAndamento : null;

  const totalCotacoes = atual.cotacoes;
  const mix = dados.produtos.filter((p) => p.atual && p.atual.cotacoes > 0 && totalCotacoes > 0);

  const incompletos = dados.produtos.filter((p) => !p.atual).map((p) => p.nome);
  const semAnterior = dados.produtos.filter((p) => !p.anterior).map((p) => p.nome);

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-o2-navy">Produção do mês</h2>
          <p className="text-xs text-o2-cinza-medio">
            {rotuloAtual} (até {diaTexto}) comparado a {rotuloAnterior} (fechado)
          </p>
        </div>
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] text-o2-cinza-medio">
          Painéis atualizados em {horaCurta.format(new Date(atual.atualizadoEm))}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Cartao
          rotulo="Cotações recebidas"
          valor={inteiro.format(atual.cotacoes)}
          linhas={
            anterior
              ? [`${nomeMesAnterior}: ${inteiro.format(anterior.cotacoes)} (mês fechado)`, `Ritmo: ${decimal.format(rAtual(atual.cotacoes))}/dia vs ${decimal.format(rAnt(anterior.cotacoes))}/dia`]
              : ["Sem retrato do mês anterior"]
          }
          variacao={anterior ? variacaoRitmo(rAtual(atual.cotacoes), rAnt(anterior.cotacoes)) : undefined}
        />
        <Cartao
          rotulo="Efetivadas"
          valor={inteiro.format(atual.efetivadas)}
          linhas={
            anterior
              ? [`${nomeMesAnterior}: ${inteiro.format(anterior.efetivadas)} (mês fechado)`, `Ritmo: ${decimal.format(rAtual(atual.efetivadas))}/dia vs ${decimal.format(rAnt(anterior.efetivadas))}/dia`]
              : ["Sem retrato do mês anterior"]
          }
          variacao={anterior ? variacaoRitmo(rAtual(atual.efetivadas), rAnt(anterior.efetivadas)) : undefined}
        />
        <Cartao
          rotulo="Conversão global"
          valor={pct(convAtual)}
          linhas={[`${nomeMesAnterior}: ${pct(convAnt)}`, `${inteiro.format(atual.efetivadas)} de ${inteiro.format(atual.concluidas)} concluídas`]}
          variacao={deltaConv}
        />
        <Cartao
          rotulo="Comissão efetivada"
          valor={reaisCompacto(atual.comissao)}
          linhas={
            anterior
              ? [`${nomeMesAnterior}: ${reaisCompacto(anterior.comissao)}`, `Ritmo: ${reaisCompacto(rAtual(atual.comissao))}/dia vs ${reaisCompacto(rAnt(anterior.comissao))}/dia`]
              : ["Sem retrato do mês anterior"]
          }
          variacao={anterior ? variacaoRitmo(rAtual(atual.comissao), rAnt(anterior.comissao)) : undefined}
        />
        <Cartao
          rotulo="Em andamento hoje"
          valor={inteiro.format(atual.emAndamento)}
          linhas={anterior ? [`Fim de ${nomeMesAnterior}: ${inteiro.format(anterior.emAndamento)}`, "cotações ainda abertas"] : ["cotações ainda abertas"]}
          variacao={emAnd === null ? undefined : { texto: `${emAnd >= 0 ? "+" : "−"}${inteiro.format(Math.abs(emAnd))} cotações`, tom: "neutro" }}
        />
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-o2-navy">
          Por produto — {rotuloAtual.split("/")[0]} (até {diaTexto}) vs {rotuloAnterior.split("/")[0]}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead>
              <tr className="text-[11.5px] font-normal text-o2-cinza-medio">
                <th className="px-2 py-1.5 text-left font-normal">Produto</th>
                <th className="px-2 py-1.5 text-right font-normal">Cotações</th>
                <th className="px-2 py-1.5 text-right font-normal">Efetivadas</th>
                <th className="px-2 py-1.5 text-right font-normal">Conversão</th>
                <th className="px-2 py-1.5 text-right font-normal">Comissão efetivada</th>
                <th className="px-2 py-1.5 text-right font-normal">Em andamento</th>
              </tr>
            </thead>
            <tbody>
              {dados.produtos.map((p) => (
                <LinhaTabela key={p.produto} p={p} rotuloAnterior={nomeMesAnterior} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {mix.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[13px] font-semibold text-o2-navy">De onde vêm as cotações de {rotuloAtual.split("/")[0].toLowerCase()}</h3>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100">
            {mix.map((p) => (
              <div key={p.produto} style={{ width: `${(p.atual!.cotacoes / totalCotacoes) * 100}%`, background: CORES_MIX[p.produto] }} />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-o2-cinza-medio">
            {mix.map((p) => (
              <span key={p.produto} className="inline-flex items-center gap-1.5">
                <i className="inline-block h-2 w-2 rounded-sm" style={{ background: CORES_MIX[p.produto] }} />
                {p.nome} {Math.round((p.atual!.cotacoes / totalCotacoes) * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-o2-cinza-medio">
        Todos os números vêm das fotos que cada painel já guarda (nada é buscado de novo no Bitrix). {rotuloAtual.split("/")[0]} está parcial ({dados.diaAtual} de{" "}
        {dados.diasMesAtual} dias), por isso o volume é comparado pelo <b>ritmo por dia</b>; as taxas (%) comparam direto. Conversão = efetivadas ÷ concluídas
        (efetivadas + recusadas/perdidas), a mesma conta de cada painel. Cada painel mantém a própria base: na Fiança, recusadas, perdidas e efetivadas contam pelo mês
        em que aconteceram; em Capitalização e Auto, pelo mês em que o card foi criado. Ramos Elementares considera só os <b>novos</b> (renovações ficam de fora).
        {incompletos.length > 0 && <> <b>Atenção:</b> sem retrato de {rotuloAtual} em {incompletos.join(", ")} — o total está incompleto.</>}
        {semAnterior.length > 0 && <> Sem retrato de {rotuloAnterior} em {semAnterior.join(", ")}.</>}
      </p>
    </section>
  );
}
