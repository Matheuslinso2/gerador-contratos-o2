import Link from "next/link";
import RascunhoAutomatico from "@/components/RascunhoAutomatico";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import PageHeader from "@/components/PageHeader";
import { IconReport } from "@/components/icons";
import { formatarData } from "@/lib/sinistros/regras";
import { salvarRegraSeguradora, salvarRegraProduto } from "./actions";
import InfoLegenda from "@/components/InfoLegenda";

export const dynamic = "force-dynamic";

// ERP O2 — Fase 1a: cadastro da regra de pagamento de comissão por seguradora
// (esgotamento × proporcional, limite de parcelas, prazo de pagamento, dia fixo).
// A previsão de comissão de cada parcela é recalculada a partir daqui.

type Seg = {
  id: string;
  nome: string;
  abreviacao: string;
  regra_comissao: "proporcional" | "esgotamento";
  esgotamento_ate_parcelas: number | null;
  prazo_pagamento_dias: number;
  dia_fixo_parcela: number | null;
  canal_demonstrativo: string | null;
  extrato_fonte: string | null;
  extrato_lido_erp: string | null;
  regra_confirmada_em: string | null;
  regra_observacao: string | null;
  docs: number;
};

type RegraProduto = {
  id: string;
  seguradora_id: string;
  produto: string;
  regra_comissao: "proporcional" | "esgotamento";
  esgotamento_ate_parcelas: number | null;
  confirmada_em: string | null;
  fonte: string | null;
  observacao: string | null;
  seguradora: { abreviacao: string } | null;
};

const PRODUTOS: Record<string, string> = {
  incendio: "Incêndio",
  fianca: "Fiança",
  capitalizacao: "Capitalização",
  condominio: "Condomínio",
  automovel: "Automóvel",
  vida: "Vida",
  saude: "Saúde",
  rc: "RC",
  portateis: "Portáteis",
  pet: "Pet",
  viagem: "Viagem",
  outros: "Outros",
};

const inputClass = "rounded-lg border border-gray-300 px-2 py-1 text-xs focus:border-o2-coral focus:outline-none";

export const metadata = { title: "Seguradoras" };

export default async function ErpSeguradorasPage({ searchParams }: { searchParams: Promise<{ erro?: string; sucesso?: string }> }) {
  const { erro, sucesso } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const [{ data: segs, error }, { data: contagem }, { data: regrasProd }] = await Promise.all([
    supabase
      .from("erp_seguradoras")
      .select("id, nome, abreviacao, regra_comissao, esgotamento_ate_parcelas, prazo_pagamento_dias, dia_fixo_parcela, canal_demonstrativo, extrato_fonte, extrato_lido_erp, regra_confirmada_em, regra_observacao")
      .eq("ativa", true)
      .order("nome"),
    supabase.rpc("erp_docs_por_seguradora_2026"),
    supabase
      .from("erp_comissao_regras")
      .select("id, seguradora_id, produto, regra_comissao, esgotamento_ate_parcelas, confirmada_em, fonte, observacao, seguradora:erp_seguradoras(abreviacao)")
      .is("ramo_id", null)
      .order("produto"),
  ]);
  if (error) throw new Error(error.message);
  const regrasProduto = ((regrasProd ?? []) as unknown as RegraProduto[]).sort((a, b) =>
    (a.seguradora?.abreviacao ?? "").localeCompare(b.seguradora?.abreviacao ?? "") || a.produto.localeCompare(b.produto)
  );
  const docsPor = new Map<string, number>(((contagem ?? []) as { seguradora_id: string; docs: number }[]).map((c) => [c.seguradora_id, Number(c.docs)]));
  const linhas: Seg[] = ((segs ?? []) as Omit<Seg, "docs">[])
    .map((s) => ({ ...s, docs: docsPor.get(s.id) ?? 0 }))
    .sort((a, b) => b.docs - a.docs || a.nome.localeCompare(b.nome));

  return (
    <>
      <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-6 p-8">
        <PageHeader
          icon={<IconReport />}
          titulo="ERP O2 — Seguradoras: regra de comissão"
          subtitulo="Como cada seguradora paga a comissão da O2. Esgotamento = comissão inteira nas primeiras parcelas até zerar; proporcional = mesma fração em cada parcela. O repasse à imobiliária é sempre proporcional."
        />
        <p className="text-xs text-gray-500">
          <Link href="/erp/documentos" className="underline">← Documentos</Link> · Ordenado por volume de documentos em 2026. Marque “confirmada” depois de conferir no Corp (aba Comissões) ou no demonstrativo.
        </p>
        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">Não salvou: {erro === "dados" ? "confira os números (limite 1–24, prazo 0–60, dia 1–28)." : erro}</p>}
        {sucesso && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-700">Regra salva. A previsão das parcelas é refeita na próxima recalculação.</p>}

        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">
            Regras por seguradora × produto
            <InfoLegenda titulo="Regras por seguradora × produto">
              Exceções à regra geral: como uma seguradora paga a comissão da O2 em um produto específico. Proporcional = a mesma fração da comissão em cada parcela; esgotamento = a comissão inteira nas primeiras parcelas, até zerar (o campo Esgot. até limita em quantas parcelas; vazio vale sempre). Vale a regra mais específica: quem não está nesta lista usa a regra geral da seguradora. Fonte e observação dizem de onde veio a regra; marque Confirmada depois de conferir no Corp (aba Comissões) ou no demonstrativo. A previsão de comissão das parcelas é refeita na próxima recalculação. O repasse à imobiliária é sempre proporcional. O formulário embaixo adiciona uma regra nova.
            </InfoLegenda>
          </h2>
          <p className="text-xs text-gray-500">
            Vale a regra mais específica. Conferido nos relatórios de agosto/2026: Incêndio e Fiança são proporcionais em todas; o esgotamento (“comissão antecipada”) apareceu no Auto da Tokio.
            Quem não está aqui usa a regra geral da seguradora (tabela abaixo).
          </p>
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-1 pr-3">Seguradora</th>
                <th className="py-1 pr-3">Produto</th>
                <th className="py-1 pr-3">Regra</th>
                <th className="py-1 pr-3">Esgot. até</th>
                <th className="py-1 pr-3">Fonte</th>
                <th className="py-1 pr-3">Observação</th>
                <th className="py-1 pr-3">Confirmada</th>
                <th className="py-1 pr-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {regrasProduto.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-1.5 pr-3 font-medium">{r.seguradora?.abreviacao ?? "todas"}</td>
                  <td className="py-1.5 pr-3">{PRODUTOS[r.produto] ?? r.produto}</td>
                  <td className="py-1.5 pr-3">
                    <select name="regra_comissao" form={`rp-${r.id}`} defaultValue={r.regra_comissao} className={inputClass}>
                      <option value="proporcional">Proporcional</option>
                      <option value="esgotamento">Esgotamento</option>
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <input name="esgotamento_ate_parcelas" form={`rp-${r.id}`} type="number" min={1} max={24} defaultValue={r.esgotamento_ate_parcelas ?? ""} placeholder="sempre" className={`${inputClass} w-20`} />
                  </td>
                  <td className="max-w-[260px] py-1.5 pr-3 text-gray-500">{r.fonte}</td>
                  <td className="py-1.5 pr-3">
                    <input name="observacao" form={`rp-${r.id}`} defaultValue={r.observacao ?? ""} className={`${inputClass} w-40`} />
                  </td>
                  <td className="py-1.5 pr-3">
                    <label className="flex items-center gap-1">
                      <input name="confirmada" form={`rp-${r.id}`} type="checkbox" defaultChecked={!!r.confirmada_em} />
                      <span className="text-gray-500">{r.confirmada_em ? formatarData(r.confirmada_em) : "não"}</span>
                    </label>
                  </td>
                  <td className="py-1.5 pr-3">
                    <form id={`rp-${r.id}`} action={salvarRegraProduto} className="flex gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="seguradora_id" value={r.seguradora_id} />
                      <input type="hidden" name="produto" value={r.produto} />
                      <button type="submit" className="rounded-lg border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy hover:bg-o2-navy hover:text-white">
                        Salvar
                      </button>
                      <button type="submit" name="excluir" value="1" className="rounded-lg border border-gray-300 px-2 py-1 text-xs text-gray-500 hover:border-red-400 hover:text-red-600">
                        Excluir
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={salvarRegraProduto} className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
            <RascunhoAutomatico chave="erp-regra-produto-nova" />
            <label className="flex flex-col gap-1 text-[11px] text-gray-500">
              Seguradora
              <select name="seguradora_id" className={inputClass} required defaultValue="">
                <option value="" disabled>
                  escolha
                </option>
                {linhas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.abreviacao} · {s.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-gray-500">
              Produto
              <select name="produto" className={inputClass} required defaultValue="">
                <option value="" disabled>
                  escolha
                </option>
                {Object.entries(PRODUTOS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-gray-500">
              Regra
              <select name="regra_comissao" className={inputClass} defaultValue="proporcional">
                <option value="proporcional">Proporcional</option>
                <option value="esgotamento">Esgotamento</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-gray-500">
              Esgot. até (parc.)
              <input name="esgotamento_ate_parcelas" type="number" min={1} max={24} placeholder="sempre" className={`${inputClass} w-24`} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-gray-500">
              Observação
              <input name="observacao" placeholder="ex.: conferido no extrato 03/08" className={`${inputClass} w-56`} />
            </label>
            <label className="flex items-center gap-1 pb-1 text-[11px] text-gray-500">
              <input name="confirmada" type="checkbox" /> confirmada
            </label>
            <button type="submit" className="rounded-lg bg-o2-navy px-3 py-1.5 text-xs font-medium text-white hover:bg-o2-indigo">
              Adicionar regra
            </button>
          </form>
        </section>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">
          Regra geral por seguradora
          <InfoLegenda titulo="Regra geral por seguradora">
            Uma linha por seguradora ativa, da que tem mais documentos em 2026 para a que tem menos (Docs 2026). Regra = proporcional ou esgotamento (veja o quadro acima); Paga em (dias) = prazo de pagamento da comissão, de 0 a 60 dias; Dia fixo = dia do mês (1 a 28) a ser usado na previsão da parcela, quando houver; Onde está o extrato e Lido pelo ERP indicam onde fica o extrato da seguradora e se o ERP já lê esse extrato (portal, Drive ou e-mail). Confirmada = a regra foi conferida no Corp ou no demonstrativo. Salvar grava a linha; a previsão das parcelas é refeita na próxima recalculação.
          </InfoLegenda>
        </h2>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2">Seguradora</th>
                <th className="px-3 py-2 text-right">Docs 2026</th>
                <th className="px-3 py-2">Regra</th>
                <th className="px-3 py-2">Esgot. até (parc.)</th>
                <th className="px-3 py-2">Paga em (dias)</th>
                <th className="px-3 py-2">Dia fixo</th>
                <th className="px-3 py-2">Onde está o extrato</th>
                <th className="px-3 py-2">Lido pelo ERP</th>
                <th className="px-3 py-2">Observação</th>
                <th className="px-3 py-2">Confirmada</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {linhas.map((s) => (
                <tr key={s.id} className="align-top">
                  <td className="px-3 py-2 font-medium">
                    {s.abreviacao} <span className="font-normal text-gray-500">{s.nome}</span>
                  </td>
                  <td className="px-3 py-2 text-right">{s.docs.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2">
                    <select name="regra_comissao" form={`f-${s.id}`} defaultValue={s.regra_comissao} className={inputClass}>
                      <option value="proporcional">Proporcional</option>
                      <option value="esgotamento">Esgotamento</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input name="esgotamento_ate_parcelas" form={`f-${s.id}`} type="number" min={1} max={24} defaultValue={s.esgotamento_ate_parcelas ?? ""} placeholder="sempre" className={`${inputClass} w-20`} />
                  </td>
                  <td className="px-3 py-2">
                    <input name="prazo_pagamento_dias" form={`f-${s.id}`} type="number" min={0} max={60} defaultValue={s.prazo_pagamento_dias} className={`${inputClass} w-16`} />
                  </td>
                  <td className="px-3 py-2">
                    <input name="dia_fixo_parcela" form={`f-${s.id}`} type="number" min={1} max={28} defaultValue={s.dia_fixo_parcela ?? ""} placeholder="—" className={`${inputClass} w-16`} />
                  </td>
                  <td className="px-3 py-2 max-w-xs text-gray-500">{s.extrato_fonte ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-500">{s.extrato_lido_erp ? ({ portal: "Sim (portal)", drive: "Sim (Drive)", gmail: "Sim (e-mail)", nao: "Ainda não" } as Record<string, string>)[s.extrato_lido_erp] ?? s.extrato_lido_erp : "—"}</td>
                  <td className="px-3 py-2">
                    <input name="regra_observacao" form={`f-${s.id}`} defaultValue={s.regra_observacao ?? ""} placeholder="ex.: conferido no doc 133210" className={`${inputClass} w-56`} />
                  </td>
                  <td className="px-3 py-2">
                    <label className="flex items-center gap-1">
                      <input name="regra_confirmada" form={`f-${s.id}`} type="checkbox" defaultChecked={!!s.regra_confirmada_em} />
                      <span className="text-gray-500">{s.regra_confirmada_em ? formatarData(s.regra_confirmada_em) : "não"}</span>
                    </label>
                  </td>
                  <td className="px-3 py-2">
                    <form id={`f-${s.id}`} action={salvarRegraSeguradora}>
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className="rounded-lg border border-o2-navy px-3 py-1 text-xs font-medium text-o2-navy hover:bg-o2-navy hover:text-white">
                        Salvar
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
