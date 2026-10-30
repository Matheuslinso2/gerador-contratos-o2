import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros } from "@/lib/erp/filtros";
import { DESCONTO_PCT, arredonda, mesAnterior, mesRepasse, rotuloMes } from "@/lib/erp/repasse";
import InfoLegenda from "@/components/InfoLegenda";
import FiltrosErp from "../../FiltrosErp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repasses · preparo" };

type Linha = {
  imobiliaria_id: string;
  imobiliaria: string;
  parcelas: number;
  bruto: number;
  sem_repasse: number;
  pro_labore_direto: number;
  baixa_divergente: number;
  previstas_sem_baixa: number;
  comissao_prevista_sem_baixa: number;
  inadimplentes: number;
  sem_email_repasse: boolean;
  sem_codigo_corp: boolean;
};

// Preparo do repasse do mês (Matheus 30/10): antes de “programar”, a equipe confere o que impede o repasse de estar certo — baixa não dada,
// baixa divergente, inadimplência, pró-labore a confirmar e falta de cadastro. Só leitura; “repasse conferido e pronto para pagamento” vem depois.
export default async function ErpRepassesPreparoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = lerFiltros(await searchParams);
  const { mes } = mesRepasse(f.mes);
  const sb = await createClient();
  const { data } = await sb.rpc("erp_repasse_preparo", { p_mes_repasse: `${mes}-01` }).order("imobiliaria").limit(1000);
  const busca = f.imobiliaria?.toLowerCase();
  const linhas = ((data ?? []) as Linha[])
    .map((l) => ({ ...l, bruto: Number(l.bruto), comissao_prevista_sem_baixa: Number(l.comissao_prevista_sem_baixa) }))
    .filter((l) => !busca || l.imobiliaria.toLowerCase().includes(busca))
    .map((l) => ({ ...l, pendencias: l.previstas_sem_baixa + l.baixa_divergente + l.inadimplentes + l.pro_labore_direto + (l.sem_email_repasse ? 1 : 0) + (l.sem_codigo_corp ? 1 : 0) }))
    .sort((a, b) => b.bruto - a.bruto);
  const soma = (k: keyof Linha) => linhas.reduce((s, l) => s + Number(l[k]), 0);
  const prontas = linhas.filter((l) => l.pendencias === 0 && l.parcelas > 0).length;

  const chip = (n: number, txt: string, cor: string) => (n > 0 ? <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 ${cor}`}>{txt}</span> : null);

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <Link href={`/erp/repasses?mes=${mes}`} className="text-xs text-gray-500 hover:underline">
          ← Simulação do mês {rotuloMes(mes)}
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-o2-navy">
          Preparo do repasse · {rotuloMes(mes)}
          <InfoLegenda titulo="Preparo do repasse">
            Lista, por imobiliária, o que precisa ser resolvido antes de programar o repasse de {rotuloMes(mes)}: comissões do mês anterior ainda sem baixa, baixas com valor diferente do esperado,
            parcelas em atraso avisadas pela seguradora, pró-labore pago direto ainda a confirmar e falta de cadastro (e-mail do repasse, código do produtor no Corp). Imobiliária sem nenhuma pendência
            está pronta para ser conferida. É só leitura: nada é gravado.
          </InfoLegenda>
        </h1>
      </div>
      <FiltrosErp
        caminho="/erp/repasses/preparo"
        campos={["mes", "imobiliaria"]}
        valores={f}
        resumo={
          <>
            {linhas.length} imobiliárias · {prontas} sem pendência · bruto da simulação {formatarReais(arredonda(soma("bruto")))} · comissão de {rotuloMes(mesAnterior(mes))} ainda sem baixa{" "}
            {formatarReais(arredonda(soma("comissao_prevista_sem_baixa")))} ({soma("previstas_sem_baixa").toLocaleString("pt-BR")} parcelas)
          </>
        }
      />
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Imobiliária</th>
              <th className="px-3 py-2 text-right">Parcelas</th>
              <th className="px-3 py-2 text-right">
                Bruto <InfoLegenda titulo="Bruto">Repasse da simulação do mês, antes do desconto de {DESCONTO_PCT}%.</InfoLegenda>
              </th>
              <th className="px-3 py-2">
                Pendências{" "}
                <InfoLegenda titulo="Pendências">
                  Sem baixa: comissões previstas para {rotuloMes(mesAnterior(mes))} que ainda não foram baixadas; o repasse delas só nasce com a baixa. Divergente: baixa com valor diferente do esperado.
                  Em atraso: parcelas avisadas pela seguradora como não pagas. Pró-labore: parcelas em que a seguradora paga direto à imobiliária (regra a confirmar). Cadastro: falta e-mail do repasse ou código
                  do produtor no Corp.
                </InfoLegenda>
              </th>
              <th className="px-3 py-2">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map((l) => (
              <tr key={l.imobiliaria_id}>
                <td className="px-3 py-1.5">
                  <Link href={`/erp/repasses/${l.imobiliaria_id}?mes=${mes}`} className="text-o2-navy hover:underline">
                    {l.imobiliaria}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-right">{l.parcelas}</td>
                <td className="px-3 py-1.5 text-right">{formatarReais(l.bruto)}</td>
                <td className="px-3 py-1.5 text-gray-700">
                  {chip(l.previstas_sem_baixa, `${l.previstas_sem_baixa} sem baixa (${formatarReais(l.comissao_prevista_sem_baixa)})`, "bg-amber-50 text-amber-800")}
                  {chip(l.baixa_divergente, `${l.baixa_divergente} divergente(s)`, "bg-amber-50 text-amber-800")}
                  {chip(l.inadimplentes, `${l.inadimplentes} em atraso`, "bg-red-50 text-red-800")}
                  {chip(l.pro_labore_direto, `${l.pro_labore_direto} pró-labore a confirmar`, "bg-blue-50 text-blue-800")}
                  {chip(l.sem_email_repasse ? 1 : 0, "sem e-mail do repasse", "bg-gray-100 text-gray-700")}
                  {chip(l.sem_codigo_corp ? 1 : 0, "sem código no Corp", "bg-gray-100 text-gray-700")}
                </td>
                <td className="px-3 py-1.5">{l.parcelas === 0 ? <span className="text-gray-400">sem repasse no mês</span> : l.pendencias === 0 ? <span className="text-green-700">sem pendência</span> : <span className="text-amber-700">conferir</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Próximos passos já combinados: “Programar repasses” (você aprova) → “repasse conferido e pronto para pagamento” → pagamento confirmado pelo lançamento do Nibo que bate com o valor programado. Esses botões ainda não existem
        nesta tela.
      </p>
    </main>
  );
}
