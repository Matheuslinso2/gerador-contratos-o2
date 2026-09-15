import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import SubmitButton from "@/components/SubmitButton";
import { IconReport } from "@/components/icons";
import ExportarQuadro from "@/components/ExportarQuadro";
import { rotuloProdutoCampanha } from "@/lib/campanhas/produtos";
import { adicionarLinhaProducao, atualizarLinhaProducao, removerLinhaProducao } from "./actions";

export const dynamic = "force-dynamic";

const numInputClass = "w-full rounded-lg border border-gray-300 px-2 py-1.5 text-right text-sm focus:border-o2-coral focus:outline-none";

function formatarMoeda(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type LinhaProducao = {
  id: string;
  imobiliaria_id: string;
  quantidade_apolices: number;
  premio_liquido: number;
  comissao_gerada: number;
  repasse_gerado: number;
  imobiliarias: { nome: string } | null;
};

export default async function ProducaoCampanhaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { id } = await params;
  const { erro } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: campanha } = await supabase.from("campanhas").select("id, nome, produto, status").eq("id", id).single();
  if (!campanha) redirect("/campanhas");

  const [{ data: enviosData }, { data: producaoData }] = await Promise.all([
    supabase.from("campanhas_envios").select("imobiliaria_id").eq("campanha_id", id).not("imobiliaria_id", "is", null),
    supabase
      .from("campanhas_producao")
      .select("id, imobiliaria_id, quantidade_apolices, premio_liquido, comissao_gerada, repasse_gerado, imobiliarias(nome)")
      .eq("campanha_id", id),
  ]);

  const linhas = (producaoData ?? []) as unknown as LinhaProducao[];
  const idsImpactados = [...new Set((enviosData ?? []).map((e) => e.imobiliaria_id as string))];
  const idsJaNoQuadro = new Set(linhas.map((l) => l.imobiliaria_id));
  const idsDisponiveis = idsImpactados.filter((imobId) => !idsJaNoQuadro.has(imobId));

  const { data: imobiliariasDisponiveis } = idsDisponiveis.length
    ? await supabase.from("imobiliarias").select("id, nome").in("id", idsDisponiveis).order("nome")
    : { data: [] };

  const rotuloProduto = rotuloProdutoCampanha(campanha.produto);

  const totais = linhas.reduce(
    (acc, l) => ({
      apolices: acc.apolices + l.quantidade_apolices,
      premio: acc.premio + l.premio_liquido,
      comissao: acc.comissao + l.comissao_gerada,
      repasse: acc.repasse + l.repasse_gerado,
    }),
    { apolices: 0, premio: 0, comissao: 0, repasse: 0 }
  );

  const dadosExcel = linhas.map((l) => ({
    Imobiliária: l.imobiliarias?.nome ?? "—",
    Produto: rotuloProduto,
    "Qtde. apólices": l.quantidade_apolices,
    "Prêmio líquido": l.premio_liquido,
    "Comissão gerada": l.comissao_gerada,
    "Repasse gerado": l.repasse_gerado,
    Resultado: l.comissao_gerada - l.repasse_gerado,
  }));

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto max-w-5xl flex-1 space-y-6 p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <PageHeader icon={<IconReport />} titulo={`Produção — ${campanha.nome}`} subtitulo={`Preenchimento manual, por imobiliária impactada · Produto: ${rotuloProduto}`} />
          <ExportarQuadro
            quadroId="quadro-producao-campanha"
            nomeArquivo={`producao-${campanha.nome}`}
            dadosExcel={dadosExcel}
            nomeAbaExcel="Produção"
          />
        </div>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        {idsImpactados.length === 0 && (
          <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
            Essa campanha ainda não tem destinatários confirmados — volte em "Destinatários" ou dispare a campanha antes de lançar produção.
          </p>
        )}

        {idsDisponiveis.length > 0 && (
          <form action={adicionarLinhaProducao} className="flex flex-wrap items-end gap-3 rounded-xl border border-o2-navy/10 bg-quadro p-4 shadow-sm">
            <input type="hidden" name="campanha_id" value={id} />
            <div className="min-w-[220px] flex-1">
              <label className="mb-1 block text-xs font-medium text-gray-600">Imobiliária</label>
              <select name="imobiliaria_id" required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none">
                <option value="">Selecione...</option>
                {(imobiliariasDisponiveis ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-28">
              <label className="mb-1 block text-xs font-medium text-gray-600">Apólices</label>
              <input name="quantidade_apolices" type="number" min="0" step="1" defaultValue={0} className={numInputClass} />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-gray-600">Prêmio líquido</label>
              <input name="premio_liquido" type="number" min="0" step="0.01" defaultValue={0} className={numInputClass} />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-gray-600">Comissão</label>
              <input name="comissao_gerada" type="number" min="0" step="0.01" defaultValue={0} className={numInputClass} />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-gray-600">Repasse</label>
              <input name="repasse_gerado" type="number" min="0" step="0.01" defaultValue={0} className={numInputClass} />
            </div>
            <SubmitButton className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90" textoCarregando="Adicionando...">
              Adicionar
            </SubmitButton>
          </form>
        )}

        <div id="quadro-producao-campanha" className="overflow-x-auto rounded-2xl border border-o2-navy/10 bg-white shadow-sm">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-o2-navy/10 bg-quadro text-xs uppercase tracking-wide text-o2-navy">
                <th className="p-3 text-left">Imobiliária</th>
                <th className="p-3 text-left">Produto</th>
                <th className="p-3 text-right">Apólices</th>
                <th className="p-3 text-right">Prêmio líquido</th>
                <th className="p-3 text-right">Comissão gerada</th>
                <th className="p-3 text-right">Repasse gerado</th>
                <th className="p-3 text-right">Resultado</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {linhas.map((l) => {
                const resultado = l.comissao_gerada - l.repasse_gerado;
                return (
                  <tr key={l.id}>
                    <td colSpan={8} className="p-0">
                      <form action={atualizarLinhaProducao} className="grid grid-cols-8 items-center gap-2 p-2.5">
                        <input type="hidden" name="campanha_id" value={id} />
                        <input type="hidden" name="linha_id" value={l.id} />
                        <span className="truncate font-medium text-o2-navy" title={l.imobiliarias?.nome ?? ""}>
                          {l.imobiliarias?.nome ?? "—"}
                        </span>
                        <span className="text-xs text-gray-500">{rotuloProduto}</span>
                        <input name="quantidade_apolices" type="number" min="0" step="1" defaultValue={l.quantidade_apolices} className={numInputClass} />
                        <input name="premio_liquido" type="number" min="0" step="0.01" defaultValue={l.premio_liquido} className={numInputClass} />
                        <input name="comissao_gerada" type="number" min="0" step="0.01" defaultValue={l.comissao_gerada} className={numInputClass} />
                        <input name="repasse_gerado" type="number" min="0" step="0.01" defaultValue={l.repasse_gerado} className={numInputClass} />
                        <span className={`text-right text-sm font-semibold ${resultado < 0 ? "text-red-600" : "text-o2-navy"}`}>{formatarMoeda(resultado)}</span>
                        <span className="flex justify-end gap-2" data-export-ignore="true">
                          <button
                            type="submit"
                            className="rounded-full border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white"
                          >
                            Salvar
                          </button>
                          <button
                            type="submit"
                            formAction={removerLinhaProducao}
                            className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                          >
                            Remover
                          </button>
                        </span>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {!linhas.length && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-sm text-gray-500">
                    Nenhuma produção lançada ainda.
                  </td>
                </tr>
              )}
            </tbody>
            {linhas.length > 0 && (
              <tfoot>
                <tr className="border-t border-o2-navy/10 bg-quadro text-sm font-semibold text-o2-navy">
                  <td className="p-3" colSpan={2}>
                    Total ({linhas.length} imobiliária{linhas.length > 1 ? "s" : ""})
                  </td>
                  <td className="p-3 text-right">{totais.apolices}</td>
                  <td className="p-3 text-right">{formatarMoeda(totais.premio)}</td>
                  <td className="p-3 text-right">{formatarMoeda(totais.comissao)}</td>
                  <td className="p-3 text-right">{formatarMoeda(totais.repasse)}</td>
                  <td className="p-3 text-right">{formatarMoeda(totais.comissao - totais.repasse)}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <Link href={`/campanhas/${id}`} className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar pra campanha
        </Link>
      </main>
    </>
  );
}
