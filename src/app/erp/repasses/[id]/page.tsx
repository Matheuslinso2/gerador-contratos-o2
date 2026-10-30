import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarData, formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros } from "@/lib/erp/filtros";
import { DESCONTO_PCT, linhasDoMes, mesAnterior, mesRepasse, rotuloMes, totais } from "@/lib/erp/repasse";
import InfoLegenda from "@/components/InfoLegenda";
import BotaoVerDocumento from "../../BotaoVerDocumento";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repasse da imobiliária" };

// Relatório da imobiliária no formato do Corp (Prg. 316): uma linha por parcela, total, desconto e líquido; ao lado a
// evolução dos últimos 4 meses. Fase 1: simulação, só leitura.
export default async function ErpRepasseImobiliariaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const f = lerFiltros(await searchParams);
  const { mes } = mesRepasse(f.mes);
  const sb = await createClient();
  const { data: imob } = await sb.from("imobiliarias").select("id, nome, codigo_produtor_corp, email_repasses").eq("id", id).maybeSingle();
  if (!imob) notFound();
  const meses = [0, 1, 2, 3].map((n) => mesAnterior(mes, n));
  const porMes = await Promise.all(meses.map((m) => linhasDoMes(sb, m, id)));
  const linhas = porMes[0].filter((l) => l.repasse !== 0);
  const semRepasse = porMes[0].length - linhas.length;
  const t = totais(linhas);
  const emails = Array.isArray(imob.email_repasses) ? (imob.email_repasses as string[]).join(", ") : "";

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <Link href={`/erp/repasses?mes=${mes}`} className="text-xs text-gray-500 hover:underline">
          ← Repasses de {rotuloMes(mes)}
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-o2-navy">
          {imob.nome}
          <InfoLegenda titulo="Relatório da imobiliária">
            Uma linha por parcela com comissão recebida no mês anterior, no mesmo formato do relatório de repasse do Corp. No fim, o total, o desconto de 18% e o líquido. É uma simulação: nada é gravado nem enviado.
          </InfoLegenda>
        </h1>
        <p className="text-sm text-gray-600">
          Cód. do produtor no Corp: {imob.codigo_produtor_corp ?? "—"} · e-mail do repasse: {emails || "—"} · previsão 15/{rotuloMes(mes)} (comissão recebida em{" "}
          {rotuloMes(mesAnterior(mes))}) · simulação, nada gravado.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Abrir</th>
              <th className="px-3 py-2">Segurado <InfoLegenda titulo="Segurado">Cliente titular do seguro.</InfoLegenda></th>
              <th className="px-3 py-2">Seg. <InfoLegenda titulo="Seguradora">Seguradora do documento.</InfoLegenda></th>
              <th className="px-3 py-2">Ramo <InfoLegenda titulo="Ramo">Ramo do seguro.</InfoLegenda></th>
              <th className="px-3 py-2">Nº da apólice <InfoLegenda titulo="Nº da apólice">Número da apólice na seguradora; clique para abrir o documento.</InfoLegenda></th>
              <th className="px-3 py-2">Tipo <InfoLegenda titulo="Tipo">Se o documento é novo, renovação ou endosso, como está cadastrado. Todos entram na conta se tiverem percentual de repasse.</InfoLegenda></th>
              <th className="px-3 py-2">Parc. <InfoLegenda titulo="Parcela">Número da parcela sobre o total de parcelas do documento.</InfoLegenda></th>
              <th className="px-3 py-2">Recebida em <InfoLegenda titulo="Recebida em">Data em que a comissão desta parcela foi recebida e baixada. O mês dela define em qual repasse a parcela entra.</InfoLegenda></th>
              <th className="px-3 py-2 text-right">% Part. <InfoLegenda titulo="Percentual de participação">Parte da parcela que pertence a esta imobiliária. É 100% quando ela é a única e menos quando o seguro é dividido.</InfoLegenda></th>
              <th className="px-3 py-2 text-right">Vl. Base <InfoLegenda titulo="Valor base">Valor da parcela sobre o qual o repasse é calculado: o prêmio da parcela, não a comissão.</InfoLegenda></th>
              <th className="px-3 py-2 text-right">% Rep. <InfoLegenda titulo="Percentual de repasse">Percentual combinado com a imobiliária para este documento, vindo do cadastro do Corp.</InfoLegenda></th>
              <th className="px-3 py-2 text-right">Vl. Repasse <InfoLegenda titulo="Valor do repasse">Valor base × percentual de repasse × percentual de participação, arredondado em centavos.</InfoLegenda></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map((l) => (
              <tr key={l.comissao_id} className={l.pro_labore_direto ? "bg-blue-50/50" : ""}>
                <td className="px-3 py-1">
                  <BotaoVerDocumento id={l.documento_id} />
                </td>
                <td className="px-3 py-1">{l.segurado}</td>
                <td className="px-3 py-1">{l.seg_abrev}</td>
                <td className="px-3 py-1">{l.ramo}</td>
                <td className="px-3 py-1">
                  <Link href={`/erp/documentos/${l.documento_id}`} className="text-o2-navy hover:underline">
                    {l.apolice}
                  </Link>
                </td>
                <td className="px-3 py-1">{l.tipo_documento}</td>
                <td className="px-3 py-1">{l.parcela}</td>
                <td className="px-3 py-1">{formatarData(l.recebida_em)}</td>
                <td className="px-3 py-1 text-right">{l.pct_part.toLocaleString("pt-BR")}%</td>
                <td className="px-3 py-1 text-right">{formatarReais(l.base)}</td>
                <td className="px-3 py-1 text-right">{l.pct_rep.toLocaleString("pt-BR")}%</td>
                <td className="px-3 py-1 text-right font-medium">{formatarReais(l.repasse)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-gray-50 text-sm">
            <tr>
              <td colSpan={11} className="px-3 py-1 text-right">Total em reais ({linhas.length} parcelas) <InfoLegenda titulo="Total em reais" alinhar="direita">Soma do valor do repasse de todas as parcelas listadas.</InfoLegenda></td>
              <td className="px-3 py-1 text-right">{formatarReais(t.bruto)}</td>
            </tr>
            <tr>
              <td colSpan={11} className="px-3 py-1 text-right">Desconto ({DESCONTO_PCT},00 %) <InfoLegenda titulo="Desconto de 18%" alinhar="direita">5% de ISS e 13% de impostos federais, aplicados sobre o total. Valor fixo e premiação não têm esse desconto.</InfoLegenda></td>
              <td className="px-3 py-1 text-right">−{formatarReais(t.desconto)}</td>
            </tr>
            <tr>
              <td colSpan={11} className="px-3 py-1 text-right font-semibold">Total líquido <InfoLegenda titulo="Total líquido" alinhar="direita">Total em reais menos o desconto de 18%: o que seria pago à imobiliária.</InfoLegenda></td>
              <td className="px-3 py-1 text-right font-semibold">{formatarReais(t.liquido)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {semRepasse > 0 && <p className="text-xs text-gray-500">{semRepasse} parcela(s) recebida(s) deste mês estão com % de repasse zerado (sem repasse) e não aparecem acima.</p>}
      {linhas.some((l) => l.pro_labore_direto) && (
        <p className="text-xs text-blue-800">
          Linhas azuis: a seguradora × imobiliária tem pró-labore pago direto (regra ainda a confirmar). Esse pró-labore quita o repasse na fonte; por ora a linha segue na soma,
          sinalizada.
        </p>
      )}
      <div>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-o2-navy">
          Evolução mês a mês
          <InfoLegenda titulo="Evolução mês a mês">Os últimos quatro meses de repasse desta imobiliária, calculados do mesmo jeito: quantidade de parcelas, total bruto e líquido. Clique no mês para ver a conta dele.</InfoLegenda>
        </h2>
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Repasse de</th>
                <th className="px-3 py-2 text-right">Parcelas</th>
                <th className="px-3 py-2 text-right">Bruto</th>
                <th className="px-3 py-2 text-right">Líquido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {meses.map((m, i) => {
                const l = porMes[i].filter((x) => x.repasse !== 0);
                const tt = totais(l);
                return (
                  <tr key={m}>
                    <td className="px-3 py-1">
                      <Link href={`/erp/repasses/${id}?mes=${m}`} className="text-o2-navy hover:underline">
                        {rotuloMes(m)}
                      </Link>
                    </td>
                    <td className="px-3 py-1 text-right">{l.length}</td>
                    <td className="px-3 py-1 text-right">{formatarReais(tt.bruto)}</td>
                    <td className="px-3 py-1 text-right">{formatarReais(tt.liquido)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
