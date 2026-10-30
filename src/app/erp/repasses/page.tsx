import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatarReais } from "@/lib/sinistros/regras";
import { lerFiltros } from "@/lib/erp/filtros";
import { DESCONTO_PCT, linhasDoMes, mesAnterior, mesRepasse, repasseRetidoPossivel, rotuloMes, totais } from "@/lib/erp/repasse";
import InfoLegenda from "@/components/InfoLegenda";
import FiltrosErp from "../FiltrosErp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repasses" };

// Etapa "Repasses" — FASE 1, SÓ LEITURA: simula o repasse do mês por imobiliária, sem gravar nada (Matheus 26-29/10).
// Comissão recebida em M-1 → repasse de M, previsão dia 15. Conta: base da parcela × % de repasse × % de participação,
// soma por imobiliária, −18% no total. Vale o % de repasse do documento para qualquer tipo (novo, renovação, endosso).
export default async function ErpRepassesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = lerFiltros(await searchParams);
  const { mes } = mesRepasse(f.mes);
  const sb = await createClient();
  const [todas, retido] = await Promise.all([linhasDoMes(sb, mes), repasseRetidoPossivel(sb, mes)]);

  const busca = f.imobiliaria?.toLowerCase();
  const porImob = new Map<string, { id: string; nome: string; linhas: typeof todas }>();
  for (const l of todas) {
    if (busca && !l.imobiliaria.toLowerCase().includes(busca)) continue;
    const a = porImob.get(l.imobiliaria_id) ?? { id: l.imobiliaria_id, nome: l.imobiliaria, linhas: [] };
    a.linhas.push(l);
    porImob.set(l.imobiliaria_id, a);
  }
  const lista = [...porImob.values()]
    .map((g) => {
      const com = g.linhas.filter((l) => l.repasse !== 0);
      return {
        ...g,
        parcelas: com.length,
        semRepasse: g.linhas.length - com.length,
        direto: com.filter((l) => l.pro_labore_direto).length,
        divergentes: com.filter((l) => l.conferencia === "divergente").length,
        ...totais(com),
      };
    })
    .filter((g) => g.parcelas > 0)
    .sort((a, b) => b.bruto - a.bruto);
  const geral = totais(lista.map((g) => ({ repasse: g.bruto })));
  const nParcelas = lista.reduce((s, g) => s + g.parcelas, 0);

  return (
    <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 p-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-o2-navy">
          Repasses · simulação do mês {rotuloMes(mes)}
          <InfoLegenda titulo="Simulação do mês">
            Mostra quanto a O2 pagaria a cada imobiliária no mês escolhido, com previsão para o dia 15. Entram as comissões recebidas e baixadas no mês anterior. É só uma conta na tela: nada é gravado,
            pago ou enviado. Vale o percentual de repasse que está no documento, seja seguro novo, renovação ou endosso. Venda direta da O2, sem imobiliária, não entra.
          </InfoLegenda>
        </h1>
        <Link href={`/erp/repasses/comparacao?mes=${mes}`} className="text-xs text-o2-navy underline">Comparação ERP × Corp (repasses gerados pelas baixas do ERP) →</Link>
        <p className="text-sm text-gray-600">
          Comissão recebida em {rotuloMes(mesAnterior(mes))} → repasse com previsão para 15/{rotuloMes(mes)}. Linha = base da parcela × % de repasse × % de participação; soma por
          imobiliária e desconto de {DESCONTO_PCT}% no total. <b>Só leitura:</b> nada é gravado nem enviado. Vale o % de repasse que está no documento, seja seguro novo,
          renovação ou endosso (depois se decide quem recebe o quê). Venda direta da O2, sem imobiliária, fica de fora.
        </p>
      </div>
      <FiltrosErp
        caminho="/erp/repasses"
        campos={["mes", "imobiliaria"]}
        valores={f}
        resumo={
          <>
            {lista.length.toLocaleString("pt-BR")} imobiliárias · {nParcelas.toLocaleString("pt-BR")} parcelas · bruto {formatarReais(geral.bruto)} · −{DESCONTO_PCT}%{" "}
            {formatarReais(geral.desconto)} · líquido {formatarReais(geral.liquido)}
          </>
        }
      />
      {retido && retido.linhas > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <b>Comissão recebida:</b>{" "}
          <InfoLegenda titulo="Comissão recebida">
            São linhas do extrato em que a O2 já recebeu a comissão da seguradora, mas ainda ninguém ligou a uma parcela. Sem essa ligação (a baixa), o repasse da imobiliária não é criado e ela pode ficar sem receber. O valor é só a
            comissão recebida; não dá para saber ainda de qual imobiliária é cada linha.
          </InfoLegenda>{" "} {retido.truncado ? "pelo menos " : ""}
          {retido.linhas.toLocaleString("pt-BR")} linhas de extrato recebidas em {rotuloMes(mesAnterior(mes))} ({formatarReais(retido.valor)} de comissão) ainda estão sem parcela
          identificada. Enquanto não houver a baixa, o repasse delas não nasce e a imobiliária pode ficar sem receber.{" "}
          <Link href="/erp/baixas" className="underline">
            Ir para a baixa de comissão
          </Link>
        </div>
      )}
      {lista.length === 0 ? (
        <p className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600">
          Sem comissão recebida e baixada em {rotuloMes(mesAnterior(mes))}: o repasse de {rotuloMes(mes)} ainda não pode ser gerado (a baixa é o gatilho).
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Imobiliária <InfoLegenda titulo="Imobiliária">Cada linha é uma imobiliária que tem repasse no mês. Clique no nome para ver a conta parcela por parcela.</InfoLegenda></th>
                <th className="px-3 py-2 text-right">Parcelas <InfoLegenda titulo="Parcelas">Quantidade de parcelas com comissão recebida no mês anterior e repasse maior que zero.</InfoLegenda></th>
                <th className="px-3 py-2 text-right">Bruto <InfoLegenda titulo="Bruto">Soma do repasse de todas as parcelas da imobiliária, antes do desconto. Cada parcela vale a base da parcela × percentual de repasse × percentual de participação.</InfoLegenda></th>
                <th className="px-3 py-2 text-right">−{DESCONTO_PCT}% <InfoLegenda titulo="Desconto de 18%">Desconto de 18% (5% de ISS e 13% de impostos federais) sobre o total bruto da imobiliária. Valor fixo e premiação não entram no desconto, mas ainda não existem nesta fase.</InfoLegenda></th>
                <th className="px-3 py-2 text-right">Líquido <InfoLegenda titulo="Líquido">Bruto menos o desconto de 18%: o valor que seria pago à imobiliária.</InfoLegenda></th>
                <th className="px-3 py-2">Atenção <InfoLegenda titulo="Atenção">Avisos da imobiliária: parcelas com pró-labore pago direto pela seguradora (regra ainda a confirmar, a linha segue na soma), baixas com valor diferente do esperado e parcelas com repasse zerado, que não entram na soma.</InfoLegenda></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lista.map((g) => (
                <tr key={g.id}>
                  <td className="px-3 py-1.5">
                    <Link href={`/erp/repasses/${g.id}?mes=${mes}`} className="text-o2-navy hover:underline">
                      {g.nome}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-right">{g.parcelas}</td>
                  <td className="px-3 py-1.5 text-right">{formatarReais(g.bruto)}</td>
                  <td className="px-3 py-1.5 text-right text-gray-500">{formatarReais(g.desconto)}</td>
                  <td className="px-3 py-1.5 text-right font-medium">{formatarReais(g.liquido)}</td>
                  <td className="px-3 py-1.5 text-gray-600">
                    {g.direto > 0 && <span className="mr-2 rounded bg-blue-50 px-1.5 py-0.5 text-blue-800">{g.direto} c/ pró-labore direto (a confirmar)</span>}
                    {g.divergentes > 0 && <span className="mr-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">{g.divergentes} baixa(s) divergente(s)</span>}
                    {g.semRepasse > 0 && <span className="text-gray-400">{g.semRepasse} s/ repasse (0%)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Ainda não entram: acúmulo de meses anteriores não pagos, valor fixo, premiação (RP), estorno por endosso e dados bancários da imobiliária (próximas fases). O pró-labore
        pago direto pela seguradora quita o repasse na fonte; as regras ainda estão “a confirmar”, por isso a linha aparece sinalizada, sem ser retirada da soma.
      </p>
    </main>
  );
}
