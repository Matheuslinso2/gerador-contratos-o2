import { createServiceClient } from "@/lib/supabase/service";
import InfoLegenda from "@/components/InfoLegenda";
import SubmitButton from "@/components/SubmitButton";
import ExportarQuadro from "@/components/ExportarQuadro";
import { Cartao } from "@/components/kpiUi";
import {
  DIAS_APROVADA_PARADA,
  DIAS_SEM_COTACAO_ALERTA,
  METRICAS_META,
  ROTULO_FAROL,
  metricaInfo,
  montarDesempenhoCampanha,
  produtosBaseDaCampanha,
  rotuloProdutoBase,
} from "@/lib/campanhas/desempenho";
import { participantesDaCampanha } from "@/lib/campanhas/metasCampanha";
import { imobiliariasDaCampanha } from "@/lib/campanhas/imobiliariasDaCampanha";
import { ROTULO_STATUS_ENVIO, type ResumoStatusEnvio } from "@/lib/campanhas/producaoStatus";
import { salvarConfigMetas } from "./actions";
import LinhaMeta from "./LinhaMeta";
import ModoGrupo from "./ModoGrupo";

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const umaCasa = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const inputClass = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none";

type CampanhaMinima = {
  id: string;
  nome: string;
  imobiliarias_selecionadas: string[] | null;
  valido_de: string | null;
  valido_ate: string | null;
  meta_metrica: string | null;
  premiacao_descricao: string | null;
  custo_premiacao_geral: number | null;
  data_apuracao: string | null;
};

// "Produção gerada" da campanha (22/10/2026): substitui o quadro de
// preenchimento manual (nunca usado) por produção automática -- funil
// (Bitrix/planilhas pela base única) conferido com o Corp -- mais meta,
// responsável da O2, custo da premiação e resultado por imobiliária.
export default async function ProducaoCampanha({
  campanha,
  produtosCampanha,
  statusPorImobiliaria,
  responsaveis,
}: {
  campanha: CampanhaMinima;
  produtosCampanha: string[];
  statusPorImobiliaria: Map<string, ResumoStatusEnvio>;
  responsaveis: string[];
}) {
  const db = createServiceClient();
  const produtosBase = produtosBaseDaCampanha(produtosCampanha);
  const temPeriodo = !!campanha.valido_de && !!campanha.valido_ate;
  const metrica = metricaInfo(campanha.meta_metrica ?? "contratacoes");
  const fmt = (n: number | null) => (n === null ? "—" : metrica.moeda ? brl.format(n) : umaCasa.format(n));

  const idsImobs = await imobiliariasDaCampanha(db, campanha);
  const { participantes, grupos } = await participantesDaCampanha(db, campanha.id, idsImobs);

  const falha: { mensagem: string | null } = { mensagem: null };
  const desempenho =
    temPeriodo && produtosBase.length && participantes.length
      ? await montarDesempenhoCampanha(
          db,
          {
            nome: campanha.nome,
            produtos: produtosBase,
            metrica: metrica.valor,
            inicio: campanha.valido_de as string,
            fim: campanha.valido_ate as string,
            premiacao_descricao: campanha.premiacao_descricao,
            custo_premiacao_geral: Number(campanha.custo_premiacao_geral) || 0,
          },
          participantes
        ).catch((e: unknown) => {
          falha.mensagem = e instanceof Error ? e.message : "Falha ao calcular a produção.";
          return null;
        })
      : null;
  const t = desempenho?.totais;

  const formConfig = (
    <details open={!campanha.meta_metrica} className="rounded-xl border border-o2-navy/10 bg-quadro p-4" data-export-ignore="true">
      <summary className="cursor-pointer text-sm font-semibold text-o2-navy">
        Meta, período e premiação{campanha.meta_metrica ? ` — meta em ${metrica.rotulo.toLowerCase()}` : " (sem meta definida)"}
      </summary>
      <form action={salvarConfigMetas.bind(null, campanha.id)} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            O que a meta mede
            <InfoLegenda titulo="Métrica da meta">
              Contratações = cotações convertidas (Fiança convertida, Capitalização paga, Ramos Elementares efetivado), contadas no mês da efetivação. Cotações = recebidas no período. Prêmio e comissão = soma das contratações do período. &quot;Sem meta&quot; mostra só a produção.
            </InfoLegenda>
          </label>
          <select name="meta_metrica" defaultValue={campanha.meta_metrica ?? ""} className={inputClass}>
            <option value="">Sem meta</option>
            {METRICAS_META.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.rotulo}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Início da campanha</label>
          <input name="valido_de" type="date" defaultValue={campanha.valido_de ?? ""} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Fim da campanha</label>
          <input name="valido_ate" type="date" defaultValue={campanha.valido_ate ?? ""} className={inputClass} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-600">Premiação (opcional)</label>
          <input name="premiacao_descricao" defaultValue={campanha.premiacao_descricao ?? ""} placeholder="Ex: troféu O2 Elite + vídeo de marketing" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Custo geral da premiação (R$)
            <InfoLegenda titulo="Custo geral">Custos que não são de uma imobiliária só (ex: produção do troféu, evento). O de cada imobiliária vai na linha dela.</InfoLegenda>
          </label>
          <input name="custo_premiacao_geral" inputMode="decimal" defaultValue={campanha.custo_premiacao_geral ? String(campanha.custo_premiacao_geral).replace(".", ",") : ""} placeholder="0,00" className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">Apuração (opcional)</label>
          <input name="data_apuracao" type="date" defaultValue={campanha.data_apuracao ?? ""} className={inputClass} />
        </div>
        <div className="flex items-end justify-end sm:col-span-2 lg:col-span-2">
          <SubmitButton className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white" textoCarregando="Salvando...">
            Salvar meta e período
          </SubmitButton>
        </div>
      </form>
      <p className="mt-2 text-xs text-gray-500">O período também aparece em destaque nos próximos e-mails da campanha.</p>
    </details>
  );

  if (!produtosBase.length)
    return (
      <div className="space-y-3">
        {formConfig}
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
          Campanha sem produto com produção por imobiliária (institucional ou automóvel): não há produção para acompanhar.
        </p>
      </div>
    );
  if (!temPeriodo)
    return (
      <div className="space-y-3">
        {formConfig}
        <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">Defina o início e o fim da campanha (acima) para acompanhar a produção.</p>
      </div>
    );
  if (!participantes.length)
    return (
      <div className="space-y-3">
        {formConfig}
        <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">Essa campanha ainda não tem imobiliárias — selecione os destinatários em “Resumo do envio”.</p>
      </div>
    );

  const dadosExcel = (desempenho?.linhas ?? []).map((l) => ({
    Imobiliária: l.nome,
    "Status do e-mail": l.imobiliariaId ? ROTULO_STATUS_ENVIO[statusPorImobiliaria.get(l.imobiliariaId)?.chave ?? "aguardando"] : "—",
    Responsável: l.responsavelEmail ?? "",
    "Base/mês": Number(l.base.toFixed(1)),
    Meta: l.meta ?? "",
    Realizado: l.realizado,
    "%": l.percentual === null ? "" : Math.round(l.percentual),
    Faltam: l.faltam ?? "",
    Projeção: l.projecao === null ? "" : Number(l.projecao.toFixed(1)),
    Farol: ROTULO_FAROL[l.farol],
    "Em andamento": l.funil.emAndamento,
    "Corp documentos": l.corp.documentos,
    "Corp prêmio": Math.round(l.corp.premio),
    Comissão: Math.round(l.corp.comissao),
    Repasse: Math.round(l.corp.repasse),
    "Custo premiação": l.custoPremiacao,
    Resultado: Math.round(l.resultado),
    Alertas: l.alertas.map((a) => a.texto).join(" | "),
  }));

  return (
    <div className="space-y-4">
      {formConfig}
      {falha.mensagem && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">Não consegui calcular a produção agora: {falha.mensagem}</p>}

      {desempenho && t && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Cartao
              rotulo="Prazo"
              valor={desempenho.diasRestantes > 0 ? `${desempenho.diasRestantes} dias` : "Encerrada"}
              linhas={[`${dataBr(campanha.valido_de as string)} a ${dataBr(campanha.valido_ate as string)}`, `${desempenho.diasDecorridos} de ${desempenho.diasTotais} dias corridos`]}
            />
            <Cartao
              rotulo="Meta × realizado"
              valor={t.percentual === null ? "Sem metas" : `${inteiro.format(t.percentual)}%`}
              linhas={[`Realizado: ${fmt(t.realizado)}`, `Meta total: ${t.meta ? fmt(t.meta) : "—"}`, `Projeção no fim: ${fmt(t.projecao)}`]}
            />
            <Cartao
              rotulo="No ritmo"
              valor={`${t.noRitmoOuAtingida} de ${t.participantesComMeta}`}
              linhas={[`${t.participantesComAlerta} com alerta`, `${inteiro.format(t.oportunidades)} cotação(ões) em aberto`]}
            />
            <Cartao rotulo="Conferência Corp" valor={`${inteiro.format(t.corp.documentos)} doc.`} linhas={[`Prêmio líquido: ${brl.format(t.corp.premio)}`, `Funil: ${inteiro.format(t.funil.contratacoes)} contratação(ões)`]} />
            <Cartao
              rotulo="Resultado financeiro"
              valor={brl.format(t.resultado)}
              linhas={[`Comissão: ${brl.format(t.corp.comissao)}`, `Repasse: ${brl.format(t.corp.repasse)}`, `Premiação: ${brl.format(t.custoPremiacao)}`]}
            />
          </div>

          <ModoGrupo campanhaId={campanha.id} grupos={grupos} />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              Produtos: {produtosBase.map(rotuloProdutoBase).join(" + ")} · realizado pelo funil (Bitrix e planilhas), conferido com o Corp
              <InfoLegenda titulo="Como ler o quadro">
                Base = média por mês da métrica nos 6 meses antes do início (só referência para a meta). Meta = individual, definida uma a uma. Realizado = funil no período (contratação no mês da efetivação). Faltam e ritmo por semana até o fim. Farol: no ritmo (projeção ≥ meta), atenção (≥ 80%), em risco (abaixo). Em andamento = cotações abertas. Corp = documentos novos não cancelados do código de produtor; comissão e repasse do Corp. Resultado = comissão − repasse − custo da premiação da linha. Alertas: sem cotação há {DIAS_SEM_COTACAO_ALERTA}+ dias, aprovada parada há {DIAS_APROVADA_PARADA}+ dias, ritmo abaixo de 70% da própria base.
              </InfoLegenda>
            </p>
            <ExportarQuadro quadroId="quadro-producao-campanha" nomeArquivo={`producao-${campanha.nome}`} dadosExcel={dadosExcel} nomeAbaExcel="Produção" />
          </div>

          <div id="quadro-producao-campanha" className="overflow-x-auto rounded-2xl border border-o2-navy/10 bg-white shadow-sm">
            <table className="w-full min-w-[1400px] text-sm">
              <thead>
                <tr className="border-b border-o2-navy/10 bg-quadro text-left text-xs uppercase tracking-wide text-o2-navy">
                  <th className="p-2">Imobiliária</th>
                  <th className="p-2">E-mail</th>
                  <th className="p-2">Responsável O2</th>
                  <th className="p-2 text-right">Base/mês</th>
                  <th className="p-2 text-right">Meta</th>
                  <th className="p-2 text-right">Realizado</th>
                  <th className="p-2 text-right">%</th>
                  <th className="p-2 text-right">Faltam</th>
                  <th className="p-2 text-right">Ritmo/sem.</th>
                  <th className="p-2 text-right">Projeção</th>
                  <th className="p-2">Farol</th>
                  <th className="p-2 text-right">Em andamento</th>
                  <th className="p-2 text-right">Corp (doc · prêmio)</th>
                  <th className="p-2 text-right">Comissão</th>
                  <th className="p-2 text-right">Repasse</th>
                  <th className="p-2 text-right">Custo prêmio</th>
                  <th className="p-2 text-right">Resultado</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {desempenho.linhas.map((l) => (
                  <LinhaMeta
                    key={l.participanteId}
                    campanhaId={campanha.id}
                    linha={l}
                    moeda={metrica.moeda}
                    statusEnvio={l.imobiliariaId ? (statusPorImobiliaria.get(l.imobiliariaId) ?? null) : null}
                    responsaveis={responsaveis}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {desempenho.linhas.some((l) => l.oportunidades.length > 0) && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-o2-navy">
                Oportunidades em aberto
                <InfoLegenda titulo="Oportunidades em aberto">
                  Cotações das imobiliárias da campanha que ainda não fecharam: aprovadas primeiro, depois em análise, das mais antigas para as mais novas. O link abre o card no Bitrix.
                </InfoLegenda>
              </h3>
              {desempenho.linhas
                .filter((l) => l.oportunidades.length > 0)
                .map((l) => (
                  <details key={l.participanteId} className="rounded-lg border border-o2-navy/10 bg-white px-3 py-2">
                    <summary className="cursor-pointer text-sm text-o2-navy">
                      <b>{l.nome}</b> — {l.oportunidades.length} em aberto ({l.oportunidades.filter((o) => o.status === "Aprovado").length} aprovada(s))
                      {l.faltam !== null && l.faltam > 0 && <span className="ml-2 text-xs text-gray-500">faltam {fmt(l.faltam)} para a meta</span>}
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-gray-500">
                            <th className="py-1 pr-3">Produto</th>
                            <th className="py-1 pr-3">Situação</th>
                            <th className="py-1 pr-3">Entrou em</th>
                            <th className="py-1 pr-3 text-right">Dias</th>
                            <th className="py-1 pr-3 text-right">Valor</th>
                            <th className="py-1">Card</th>
                          </tr>
                        </thead>
                        <tbody>
                          {l.oportunidades.map((o, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-1 pr-3">{rotuloProdutoBase(o.produto)}</td>
                              <td className="py-1 pr-3">
                                <span className={`rounded-full px-2 py-0.5 text-xs ${o.status === "Aprovado" ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>{o.status}</span>
                              </td>
                              <td className="py-1 pr-3">{dataBr(o.entrada)}</td>
                              <td className={`py-1 pr-3 text-right tabular-nums ${o.status === "Aprovado" && o.dias >= DIAS_APROVADA_PARADA ? "font-semibold text-red-700" : ""}`}>{o.dias}</td>
                              <td className="py-1 pr-3 text-right tabular-nums">{o.valor ? brl.format(o.valor) : "—"}</td>
                              <td className="py-1">
                                {o.link ? (
                                  <a href={o.link} target="_blank" rel="noreferrer" className="text-o2-coral hover:underline">
                                    abrir no Bitrix
                                  </a>
                                ) : (
                                  <span className="text-xs text-gray-400">planilha</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                ))}
            </div>
          )}
        </>
      )}
      <p className="text-xs text-gray-400">Faltou alguma imobiliária? Ela entra no quadro ao ser incluída nos destinatários da campanha ou de um e-mail desta campanha.</p>
    </div>
  );
}
