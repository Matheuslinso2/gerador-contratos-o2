import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros, limitesMes } from "@/lib/erp/filtros";
import FiltrosErp from "../FiltrosErp";
import BotaoVerDocumento from "../BotaoVerDocumento";
import InfoLegenda from "@/components/InfoLegenda";
import PainelResumoAba from "@/app/erp/PainelResumoAba";
import NavegadorMes from "@/app/erp/NavegadorMes";
import { periodoDoMes } from "@/lib/erp/periodo";
import PaginaErp from "../PaginaErp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parcelas" };

// Etapa "Parcelas" — 1ª parte: conferência dos vencimentos (Matheus 26/10: no Corp muitas apólices estão com a
// programação das parcelas deslocada, o que erra a previsão de receita e a baixa de comissão). Compara o vencimento
// de cada parcela no Corp com o vencimento em que a seguradora COBROU a mesma parcela na fatura. Tabela pronta
// (erp_vencimentos_pronto), refeita a cada leitura das faturas.
type Linha = {
  parcela_id: string;
  documento_id: string;
  nosso_numero: number | null;
  nosso_numero_corp: number | null;
  seguradora: string | null;
  imobiliaria: string | null;
  apolice: string | null;
  parcela_n: number | null;
  parcelas_total: number | null;
  venc_corp: string;
  venc_seguradora: string;
  dif_meses: number;
  comissao_prevista: number | null;
  gerado_em: string;
  venc_apolice?: string | null; // vencimento conforme a apólice (PDF lido); preenchido na tela
};

export default async function ErpParcelasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = lerFiltros(await searchParams);
  const supabase = await createClient();
  // período padrão do ERP: mês corrente; "do mês" = cobrado no mês, "herdadas" = parcelas em conferência cobradas em meses anteriores
  const periodo = periodoDoMes(f.mes);
  const m = limitesMes(periodo.mes);
  const base = () => {
    let b = supabase.from("erp_vencimentos_pronto").select("*");
    if (f.seguradora) b = b.eq("seguradora", f.seguradora);
    if (f.imobiliaria) b = b.ilike("imobiliaria", `%${f.imobiliaria.replace(/[%_,()]/g, "")}%`);
    return b;
  };
  const [{ data }, { data: herdBruta }] = await Promise.all([
    base().gte("venc_seguradora", m.de).lte("venc_seguradora", m.ate).order("venc_seguradora", { ascending: false }).order("imobiliaria").limit(3000),
    base().lt("venc_seguradora", m.de).order("venc_seguradora", { ascending: false }).order("imobiliaria").limit(500),
  ]);
  const linhas = (data ?? []) as Linha[];
  const herdadas = (herdBruta ?? []) as Linha[];
  // Vencimento CONFORME A APÓLICE (Matheus, 03/11/2026): data lida do PDF da apólice, por documento e número da parcela. Sem PDF lido fica em branco.
  const idsDocs = [...new Set([...linhas.slice(0, 500), ...herdadas.slice(0, 500)].map((l) => l.documento_id))];
  const vencApolice = new Map<string, string>();
  for (let i = 0; i < idsDocs.length; i += 150) {
    const { data: pdf } = await supabase.from("erp_apolice_parcelas_pdf").select("documento_id, n, vencimento_pdf").in("documento_id", idsDocs.slice(i, i + 150));
    for (const p of pdf ?? []) if (p.vencimento_pdf) vencApolice.set(`${p.documento_id}:${p.n}`, p.vencimento_pdf as string);
  }
  for (const l of [...linhas, ...herdadas]) l.venc_apolice = vencApolice.get(`${l.documento_id}:${l.parcela_n}`) ?? null;
  const mesesEntre = (de: string, ate: string) => (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 + (Number(ate.slice(5, 7)) - Number(de.slice(5, 7)));
  const total = linhas.reduce((s, l) => s + Number(l.comissao_prevista ?? 0), 0);
  const porMes = new Map<string, { n: number; v: number }>();
  for (const l of linhas) {
    const k = l.venc_seguradora.slice(0, 7);
    const a = porMes.get(k) ?? { n: 0, v: 0 };
    porMes.set(k, { n: a.n + 1, v: a.v + Number(l.comissao_prevista ?? 0) });
  }

  const tabela = (ls: Linha[]) => (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Abrir</th>
                <th className="px-3 py-2">Código O2 do documento</th>
                <th className="px-3 py-2">Nosso nº do Corp</th>
                <th className="px-3 py-2">Seg.</th>
                <th className="px-3 py-2">Nº da apólice</th>
                <th className="px-3 py-2">Imobiliária</th>
                <th className="px-3 py-2">Parcela</th>
                <th className="px-3 py-2">Vencimento conforme apólice</th>
                <th className="px-3 py-2">Cobrado pela seguradora</th>
                <th className="px-3 py-2">Diferença</th>
                <th className="px-3 py-2 text-right">Comissão prevista</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ls.slice(0, 500).map((l) => (
                <tr key={l.parcela_id}>
                  <td className="px-3 py-1"><BotaoVerDocumento id={l.documento_id} /></td>
                  <td className="px-3 py-1">
                    <Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">
                      {l.nosso_numero}
                    </Link>
                  </td>
                  <td className="px-3 py-1">{l.nosso_numero_corp ?? "—"}</td>
                  <td className="px-3 py-1">{l.seguradora}</td>
                  <td className="px-3 py-1">{l.apolice}</td>
                  <td className="px-3 py-1">{l.imobiliaria ?? "—"}</td>
                  <td className="px-3 py-1">
                    {l.parcela_n}
                    {l.parcelas_total ? `/${l.parcelas_total}` : ""}
                  </td>
                  <td className="px-3 py-1">{l.venc_apolice ? <>{formatarData(l.venc_apolice)} <span className="text-green-700" title="Data lida do PDF da apólice">✓ verificado</span></> : <>{formatarData(l.venc_corp)} <span className="text-gray-400" title="Dado já disponível; a apólice desta parcela ainda não foi lida e vai confirmar ou corrigir">a verificar</span></>}</td>
                  <td className="px-3 py-1 font-medium">{formatarData(l.venc_seguradora)}</td>
                  <td className="px-3 py-1">{(() => { const d = mesesEntre(l.venc_seguradora, l.venc_apolice ?? l.venc_corp); return d === 0 ? "mesmo mês da fatura" : d > 0 ? `${d} mês(es) depois da fatura` : `${-d} mês(es) antes da fatura`; })()}</td>
                  <td className="px-3 py-1 text-right">{l.comissao_prevista === null ? "—" : formatarReais(Number(l.comissao_prevista))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ls.length > 500 && <p className="p-3 text-xs text-gray-500">Mostrando 500 de {ls.length}; use os filtros ou baixe o CSV para ver tudo.</p>}
        </div>
      );
  
  return (
    <PaginaErp>
      <NavegadorMes caminho="/erp/parcelas" mes={f.mes} params={{ seguradora: f.seguradora, imobiliaria: f.imobiliaria }} />
      <PainelResumoAba funcao="erp_resumo_parcelas" titulo="Parcelas" mes={periodo.mes} legendas={{"Parcelas por mês de vencimento, por situação":"Parcelas que vencem em cada mês, do mês escolhido e dos três anteriores (marcados como herdados), separadas por situação: paga, a vencer, atenção ou urgente, risco de cancelamento e aguardando comissão.","Herdadas abertas por seguradora":"Parcelas de meses anteriores ao mês escolhido que continuam em aberto (urgentes, em atenção, em risco de cancelamento ou aguardando comissão), por seguradora (as 8 maiores).","Em risco de cancelamento por seguradora":"Parcelas em risco de cancelamento, do mês e herdadas, por seguradora (as 8 maiores). Só aparece onde a regra de cancelamento da seguradora está cadastrada.","Prova de pagamento das parcelas do mês":"Quantas das parcelas que vencem no mês escolhido têm prova de pagamento (linha de extrato ou comissão recebida) e quantas ainda não têm."}} />
      <div>
        <div className="flex gap-3 text-sm">
          <span className="border-b-2 border-o2-navy font-semibold text-o2-navy">Conferência dos vencimentos</span>
          <Link href="/erp/parcelas/cobranca" className="text-gray-500 hover:text-o2-navy hover:underline">Cobrança e inadimplência</Link>
        </div>
        <h1 className="mt-2 text-xl font-semibold text-o2-navy">Parcelas · conferência dos vencimentos<InfoLegenda titulo="Conferência dos vencimentos">O vencimento de cada parcela no ERP é conferido contra a apólice (PDF), a fatura da seguradora e a regra do calendário, nessa ordem de prioridade. Esta lista mostra as parcelas em que o vencimento do ERP está em outro mês do que a seguradora cobrou na fatura (Tokio, Porto, Pottencial, Too e Yelum) e que ainda pedem conferência. A lista é refeita a cada leitura das faturas. O filtro de mês vale pelo vencimento cobrado pela seguradora, e a tela mostra 500 parcelas.</InfoLegenda></h1>
        <p className="text-sm text-gray-600">
          O ERP confere o vencimento de cada parcela com a apólice, a fatura da seguradora e a regra do calendário. Aqui ficam as parcelas em que o vencimento do ERP
          está em outro mês do que a seguradora cobrou na fatura. Fonte: faturas Tokio, Porto, Pottencial, Too e Yelum.
        </p>
      </div>
      <FiltrosErp
        caminho="/erp/parcelas"
        campos={["seguradora", "imobiliaria"]}
        valores={f}
        resumo={
          <>
            {linhas.length.toLocaleString("pt-BR")} parcelas em conferência · comissão prevista nelas {formatarReais(total)}
            {linhas[0] ? ` · atualizado em ${new Date(linhas[0].gerado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}` : ""}
          </>
        }
      />
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="self-center"><InfoLegenda titulo="Cobrado em (por mês)">Agrupa as parcelas em conferência pelo mês em que a seguradora cobrou. Cada cartão mostra quantas parcelas são e a soma da comissão prevista delas.</InfoLegenda></span>{[...porMes.entries()].sort().reverse().map(([m, x]) => (
          <span key={m} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5">
            cobrado em {m.slice(5)}/{m.slice(0, 4)}: <b>{x.n}</b> parcelas · {formatarReais(x.v)}
          </span>
        ))}
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-o2-navy">Parcelas em conferência<InfoLegenda titulo="Parcelas em conferência">Cada linha é uma parcela. Vencimento conforme apólice é a data da parcela no PDF da apólice ("verificado"); enquanto a apólice não foi lida, vale o dado já disponível, marcado "a verificar", que a leitura da apólice vai confirmar ou corrigir; Cobrado pela seguradora é o vencimento dessa mesma parcela na fatura da seguradora; Diferença diz quantos meses o vencimento da apólice está adiantado ou atrasado em relação à fatura. Comissão prevista é a comissão esperada daquela parcela. Parcela mostra o número da parcela e o total quando se sabe. Abrir leva ao documento no ERP.</InfoLegenda></p>
      {tabela(linhas)}
      <p className="text-xs font-semibold uppercase tracking-wide text-o2-navy">Herdadas de meses anteriores<span className="ml-1 text-xs font-normal normal-case tracking-normal text-gray-400">(parcelas em conferência cobradas antes de {periodo.rotulo})</span></p>
      {herdadas.length === 0 ? <p className="text-xs text-gray-500">Nenhuma parcela herdada em conferência.</p> : tabela(herdadas)}
    </PaginaErp>
  );
}
