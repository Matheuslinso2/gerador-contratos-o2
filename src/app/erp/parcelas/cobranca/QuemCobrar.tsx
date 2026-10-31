import { createClient } from "@/lib/supabase/server";
import InfoLegenda from "@/components/InfoLegenda";

// "Quem cobrar" (Matheus 31/10): a cobrança é da IMOBILIÁRIA, não do segurado. Em geral a imobiliária cobra o inquilino no boleto do aluguel e paga o boleto do
// seguro; na fatura é sempre ela quem paga. Mostra, por imobiliária, o contato dela, o que está em aberto e o histórico de cobranças por e-mail (caixa da Nathalie).
type L = {
  imobiliaria_id: string | null; imobiliaria: string; email: string | null; email_faturas: string | null; email_repasses: string | null; telefone: string | null;
  parcelas: number; valor: number | string; maior_atraso: number; via_fatura: number; em_risco: number; emails_cobranca: number; ultima_cobranca: string | null; meses_cobranca: number;
};
const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const data = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const primeiro = (s: string | null) => (s ? s.split(";")[0].trim() : "");

export default async function QuemCobrar() {
  const supabase = await createClient();
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: dados } = await supabase.rpc("erp_retrato", { p_funcao: "erp_resumo_cobranca_imobs", p_de: hoje, p_ate: hoje });
  const linhas = ((dados ?? []) as L[]).map((l) => ({ ...l, valor: Number(l.valor) }));
  if (!linhas.length) return null;
  const totalParc = linhas.reduce((s, l) => s + l.parcelas, 0);
  const totalValor = linhas.reduce((s, l) => s + (l.valor as number), 0);
  return (
    <section className="space-y-2 rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-o2-navy">
        Quem cobrar (por imobiliária)
        <InfoLegenda titulo="Quem cobrar">
          A cobrança é feita à imobiliária, que em geral cobra o inquilino junto com o aluguel e paga o boleto do seguro; algumas deixam o boleto com o inquilino. Nas parcelas que vêm por fatura, quem paga é sempre a imobiliária. Cada linha reúne as parcelas em aberto (urgente, atenção ou risco de cancelamento) daquela imobiliária, com o contato dela (e-mail de faturas, e-mail de repasses, e-mail geral e telefone) e o histórico de cobranças enviadas por e-mail com assunto "em aberto", da caixa da Nathalie (quantidade, meses e última data). A linha "sem imobiliária ligada" reúne parcelas cujo documento ainda não tem imobiliária no ERP. Atualizado a cada 15 minutos.
        </InfoLegenda>
      </h2>
      <p className="text-[11px] text-gray-500">
        {linhas.length} imobiliárias com parcela em aberto · {totalParc.toLocaleString("pt-BR")} parcelas · {reais(totalValor)} · as 80 maiores por quantidade de parcelas.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="py-1.5 pr-3">Imobiliária</th>
              <th className="py-1.5 pr-3">Contato da imobiliária</th>
              <th className="py-1.5 pr-3 text-right">Parcelas</th>
              <th className="py-1.5 pr-3 text-right">Valor em aberto</th>
              <th className="py-1.5 pr-3 text-right">Maior atraso</th>
              <th className="py-1.5 pr-3 text-right">Por fatura</th>
              <th className="py-1.5 pr-3 text-right">Em risco</th>
              <th className="py-1.5">Cobranças por e-mail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map((l, i) => {
              const email = primeiro(l.email_faturas) || primeiro(l.email_repasses) || primeiro(l.email);
              const sem = !l.imobiliaria_id;
              const semContato = !email && !l.telefone;
              return (
                <tr key={l.imobiliaria_id ?? `sem-${i}`} className={sem ? "bg-amber-50/50" : undefined}>
                  <td className="py-1.5 pr-3 font-medium text-gray-900">{l.imobiliaria}</td>
                  <td className="py-1.5 pr-3 text-gray-700">
                    {sem ? (
                      <span className="text-gray-400">ligar à imobiliária do documento</span>
                    ) : semContato ? (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">sem contato cadastrado</span>
                    ) : (
                      <div className="space-y-0.5">
                        {email && <a href={`mailto:${email}`} className="block text-o2-navy underline">{email}{l.email_faturas ? " (faturas)" : l.email_repasses ? " (repasses)" : ""}</a>}
                        {l.telefone && <span className="block text-gray-600">{l.telefone}</span>}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{l.parcelas}</td>
                  <td className="py-1.5 pr-3 text-right">{reais(l.valor as number)}</td>
                  <td className="py-1.5 pr-3 text-right">{l.maior_atraso} d</td>
                  <td className="py-1.5 pr-3 text-right text-gray-600">{l.via_fatura || "—"}</td>
                  <td className="py-1.5 pr-3 text-right">{l.em_risco || "—"}</td>
                  <td className="py-1.5 text-gray-600">
                    {l.emails_cobranca > 0 ? `${l.emails_cobranca} e-mails em ${l.meses_cobranca} ${l.meses_cobranca === 1 ? "mês" : "meses"}, último em ${data(l.ultima_cobranca)}` : "nenhuma encontrada"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
