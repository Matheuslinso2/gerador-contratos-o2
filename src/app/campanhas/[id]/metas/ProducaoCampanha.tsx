import { createServiceClient } from "@/lib/supabase/service";
import InfoLegenda from "@/components/InfoLegenda";
import SubmitButton from "@/components/SubmitButton";
import ExportarQuadro from "@/components/ExportarQuadro";
import { Cartao } from "@/components/kpiUi";
import {
  DIAS_APROVADA_PARADA,
  DIAS_SEM_COTACAO_ALERTA,
  FATOR_ABAIXO_BASE,
  FATOR_ATENCAO_FAROL,
  METRICAS_META,
  ROTULO_FAROL,
  metricaInfo,
  montarDesempenhoCampanha,
  produtosBaseDaCampanha,
  rotuloProdutoBase,
  valorDaMetrica,
} from "@/lib/campanhas/desempenho";
import { resolverPretendentes } from "@/lib/campanhas/pretendentes";
import { participantesDaCampanha } from "@/lib/campanhas/metasCampanha";
import { imobiliariasDaCampanha } from "@/lib/campanhas/imobiliariasDaCampanha";
import { ROTULO_STATUS_ENVIO, normalizarBusca, type ResumoStatusEnvio } from "@/lib/campanhas/producaoStatus";
import { DIAS_SEM_CONTATO_ALERTA, resumirContatos, ultimosContatosPorImobiliaria, type ContatosImobiliaria } from "@/lib/campanhas/contatosBitrix";
import { FiltroProducao } from "../FiltroProducao";

// Mesmo rótulo do seletor de responsável da linha ("livia.x@..." -> "Livia").
const rotuloResponsavel = (email: string) => {
  const parte = email.split("@")[0].split(/[._-]/)[0];
  return parte.charAt(0).toUpperCase() + parte.slice(1);
};
import { salvarConfigMetas } from "./actions";
import LinhaMeta from "./LinhaMeta";
import RolagemSuperior from "@/components/RolagemSuperior";
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

  // Nome do pretendente das oportunidades (título do card / locatário). Falha
  // aqui deixa "—" e mantém o link do card; nunca derruba o quadro.
  if (desempenho) await resolverPretendentes(db, desempenho.linhas.flatMap((l) => l.oportunidades)).catch(() => undefined);
  const periodo = campanha.valido_de && campanha.valido_ate ? `${dataBr(campanha.valido_de).slice(0, 5)}–${dataBr(campanha.valido_ate)}` : "";
  const pct = (f: number) => `${Math.round(f * 100)}%`;

  // Últimos contatos (Bitrix: ligações, WhatsApp, e-mails, reuniões + e-mails
  // da campanha enviados pelo Workspace). Falha no Bitrix não derruba o quadro.
  const idsContato = [...new Set((desempenho?.linhas ?? []).flatMap((l) => l.unidadeIds))];
  const emailsCampanha = new Map<string, string>();
  for (const id of idsContato) {
    const ultimo = (statusPorImobiliaria.get(id)?.emails ?? [])
      .map((e) => e.enviadoEm)
      .filter((d): d is string => !!d)
      .sort()
      .pop();
    if (ultimo) emailsCampanha.set(id, ultimo);
  }
  const contatosPorImob: Map<string, ContatosImobiliaria> | null = idsContato.length
    ? await ultimosContatosPorImobiliaria(db, idsContato, emailsCampanha).catch(() => null)
    : null;
  // Contador olha primeiro o responsável da imobiliária na campanha.
  const contatosDaLinha = (l: { unidadeIds: string[]; responsavelEmail: string | null }) =>
    contatosPorImob
      ? resumirContatos(
          l.unidadeIds.map((id) => contatosPorImob.get(id)).filter((c): c is ContatosImobiliaria => !!c),
          l.responsavelEmail
        )
      : null;
  const semContato = (desempenho?.linhas ?? []).filter((l) => {
    const c = contatosDaLinha(l);
    return c && (c.diasSemContato === null || c.diasSemContato > DIAS_SEM_CONTATO_ALERTA);
  }).length;

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
    "Responsável O2": l.responsavelEmail ?? "",
    "Gestor da conta": l.gestorContaEmail ?? "",
    "Último contato": contatosDaLinha(l)?.ultimo?.slice(0, 10) ?? "",
    "Dias sem contato": contatosDaLinha(l)?.diasSemContato ?? "",
    "Base/mês": Number(l.base.toFixed(1)),
    "Meta total": l.meta ?? "",
    "Meta mensal": l.metaMensal === null ? "" : Number(l.metaMensal.toFixed(1)),
    Realizado: l.realizado,
    "Realizado no mês": l.realizadoMes,
    "Renovações (fora da meta)": valorDaMetrica(l.funil.renovacoes, metrica.valor),
    "%": l.percentual === null ? "" : Math.round(l.percentual),
    Faltam: l.faltam ?? "",
    "Ritmo necessário/sem.": l.ritmoSemana === null ? "" : Number(l.ritmoSemana.toFixed(1)),
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
              linhas={[`Realizado: ${fmt(t.realizado)} (no mês: ${fmt(t.realizadoMes)})`, `Meta total: ${t.meta ? fmt(t.meta) : "—"}${t.meta ? ` · ≈ ${fmt(t.metaMensal)}/mês` : ""}`, `Projeção no fim: ${fmt(t.projecao)}`, "Só contratos novos"]}
            />
            <Cartao
              rotulo="No ritmo"
              valor={`${t.noRitmoOuAtingida} de ${t.participantesComMeta}`}
              linhas={[`${t.participantesComAlerta} com alerta`, contatosPorImob ? `${semContato} sem contato há ${DIAS_SEM_CONTATO_ALERTA}+ dias` : "contatos do Bitrix indisponíveis agora", `${inteiro.format(t.oportunidades)} cotação(ões) em aberto`]}
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
                Base = média por mês da métrica nos 6 meses antes do início (só referência para a meta). Meta = individual, definida uma a uma, e conta só contratos NOVOS (renovações aparecem à parte, fora da meta). Realizado = funil no período (contratação no mês da efetivação). Faltam e ritmo por semana até o fim. Farol: no ritmo (projeção ≥ meta), atenção (≥ {pct(FATOR_ATENCAO_FAROL)}), em risco (abaixo). Em andamento = cotações abertas. Corp = documentos novos não cancelados do código de produtor; comissão e repasse do Corp. Resultado = comissão − repasse − custo da premiação da linha. Alertas: sem cotação há {DIAS_SEM_COTACAO_ALERTA}+ dias, aprovada parada há {DIAS_APROVADA_PARADA}+ dias, ritmo abaixo de {pct(FATOR_ABAIXO_BASE)} da própria base.
              </InfoLegenda>
            </p>
            <ExportarQuadro quadroId="quadro-producao-campanha" nomeArquivo={`producao-${campanha.nome}`} dadosExcel={dadosExcel} nomeAbaExcel="Produção" />
          </div>

          <FiltroProducao
            quadroId="producao-filtravel"
            linhas={desempenho.linhas.map((l) => ({
              nomeNormalizado: normalizarBusca(`${l.nome} ${l.unidades.join(" ")}`),
              status: (l.imobiliariaId ? statusPorImobiliaria.get(l.imobiliariaId)?.chave : undefined) ?? "aguardando",
              responsavel: l.responsavelEmail ?? "",
            }))}
            opcoesResponsavel={[
              ...[...new Set(desempenho.linhas.map((l) => l.responsavelEmail).filter((e): e is string => !!e))].sort().map((email) => ({
                valor: email,
                rotulo: rotuloResponsavel(email),
                total: desempenho.linhas.filter((l) => l.responsavelEmail === email).length,
              })),
              { valor: "__sem__", rotulo: "Sem responsável", total: desempenho.linhas.filter((l) => !l.responsavelEmail).length },
            ].filter((o) => o.total > 0)}
            opcoesStatus={(Object.keys(ROTULO_STATUS_ENVIO) as (keyof typeof ROTULO_STATUS_ENVIO)[])
              .map((chave) => ({
                valor: chave,
                rotulo: ROTULO_STATUS_ENVIO[chave],
                total: desempenho.linhas.filter((l) => ((l.imobiliariaId ? statusPorImobiliaria.get(l.imobiliariaId)?.chave : undefined) ?? "aguardando") === chave).length,
              }))
              .filter((o) => o.total > 0)}
          />

          <div id="producao-filtravel" className="space-y-4">
          <RolagemSuperior alvoId="quadro-producao-campanha" />
          <div id="quadro-producao-campanha" className="overflow-x-auto rounded-2xl border border-o2-navy/10 bg-white shadow-sm">
            <table className="w-full min-w-[1400px] text-sm">
              <thead>
                <tr className="border-b border-o2-navy/10 bg-quadro text-left text-xs uppercase tracking-wide text-o2-navy">
                  <th className="p-2">Imobiliária</th>
                  <th className="p-2">E-mail</th>
                  <th className="p-2">
                    Último contato
                    <InfoLegenda titulo="Último contato">
                      Contatos com a imobiliária nos últimos 90 dias: ligações, WhatsApp, e-mails e reuniões registrados no Bitrix (na empresa e nos negócios dela) e os contatos feitos por fora do Bitrix lançados aqui em &quot;+ Registrar contato&quot; (telefone ou WhatsApp particular, visita). O contador de dias olha o último contato do RESPONSÁVEL da imobiliária; sem responsável, o último de qualquer pessoa da equipe. Os contatos do responsável aparecem em destaque. O e-mail automático da campanha aparece à parte e não conta como contato. Fica vermelho quando passa de {DIAS_SEM_CONTATO_ALERTA} dias.
                    </InfoLegenda>
                  </th>
                  <th className="p-2">
                    Responsável O2
                    <InfoLegenda titulo="Responsável O2">Quem da O2 acompanha a imobiliária nesta campanha (contatos, cobrança de meta).</InfoLegenda>
                  </th>
                  <th className="p-2">
                    Gestor da conta
                    <InfoLegenda titulo="Gestor da conta">Quem da O2 é o gestor da conta da imobiliária. Fica só dentro desta campanha e é separado do Responsável O2.</InfoLegenda>
                  </th>
                  <th className="p-2 text-right">
                    Base/mês
                    <InfoLegenda titulo="Base/mês">Média por mês da métrica nos 6 meses antes do início da campanha, só contratos novos. Serve de referência para definir a meta.</InfoLegenda>
                  </th>
                  <th className="p-2 text-right">
                    Meta
                    <InfoLegenda titulo="Meta total × mensal">
                      A meta que você digita é a TOTAL do período da campanha ({periodo}). A mensal exibida é a total dividida pelo número de meses do período ({desempenho.mesesDoPeriodo}) — é só uma referência, o farol e a projeção usam a meta total. Conta só contratos novos; renovações ficam fora da meta.
                    </InfoLegenda>
                  </th>
                  <th className="p-2 text-right">
                    Realizado
                    <InfoLegenda titulo="Realizado">
                      Total acumulado desde o início da campanha até hoje (só contratos novos), na métrica da meta. Abaixo, &quot;no mês&quot; mostra só o mês corrente, dentro do período.
                    </InfoLegenda>
                  </th>
                  <th className="p-2 text-right">%</th>
                  <th className="p-2 text-right">
                    Faltam
                    <InfoLegenda titulo="Faltam">Meta total menos o realizado. Zera quando a meta é atingida.</InfoLegenda>
                  </th>
                  <th className="p-2 text-right">
                    Ritmo necessário/sem.
                    <InfoLegenda titulo="Ritmo necessário por semana">
                      Quanto precisa ser feito por semana, daqui até o fim da campanha, para atingir a meta: faltam ÷ semanas restantes. Não é o ritmo atual, é o que falta cumprir.
                    </InfoLegenda>
                  </th>
                  <th className="p-2 text-right">
                    Projeção
                    <InfoLegenda titulo="Projeção">
                      Realizado ÷ dias decorridos × dias totais do período: mantém o ritmo médio até agora e projeta o resultado no fim da campanha.
                    </InfoLegenda>
                  </th>
                  <th className="p-2">
                    Farol
                    <InfoLegenda titulo="Farol">
                      Meta atingida: realizado ≥ meta. No ritmo: projeção ≥ meta. Atenção: projeção ≥ {pct(FATOR_ATENCAO_FAROL)} da meta. Em risco: abaixo disso. Não atingida: prazo acabou sem bater a meta. Sem meta: não há meta definida. Não iniciada: a campanha ainda não começou.
                    </InfoLegenda>
                  </th>
                  <th className="p-2 text-right">
                    Renovações (fora da meta)
                    <InfoLegenda titulo="Renovações">
                      Renovações fechadas no período, na mesma métrica da meta. Aparecem à parte e NÃO entram em meta, realizado, projeção nem farol.
                    </InfoLegenda>
                  </th>
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
                    metrica={metrica.valor}
                    periodo={periodo}
                    statusEnvio={l.imobiliariaId ? (statusPorImobiliaria.get(l.imobiliariaId) ?? null) : null}
                    responsaveis={responsaveis}
                    contatos={contatosDaLinha(l)}
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
                  Cotações das imobiliárias da campanha que ainda não fecharam: aprovadas primeiro, depois em análise, das mais antigas para as mais novas. Pretendente = nome do card no Bitrix (ou do locatário, nas planilhas); &quot;—&quot; quando a origem não informa o nome. Renovações aparecem marcadas e não contam na meta. O link abre o card no Bitrix.
                </InfoLegenda>
              </h3>
              {desempenho.linhas
                .filter((l) => l.oportunidades.length > 0)
                .map((l) => (
                  <details
                    key={l.participanteId}
                    data-filtro-nome={normalizarBusca(`${l.nome} ${l.unidades.join(" ")}`)}
                    data-filtro-status={(l.imobiliariaId ? statusPorImobiliaria.get(l.imobiliariaId)?.chave : undefined) ?? "aguardando"}
                    data-filtro-responsavel={l.responsavelEmail ?? ""}
                    className="rounded-lg border border-o2-navy/10 bg-white px-3 py-2"
                  >
                    <summary className="cursor-pointer text-sm text-o2-navy">
                      <b>{l.nome}</b> — {l.oportunidades.length} em aberto ({l.oportunidades.filter((o) => o.status === "Aprovado").length} aprovada(s))
                      {l.faltam !== null && l.faltam > 0 && <span className="ml-2 text-xs text-gray-500">faltam {fmt(l.faltam)} para a meta</span>}
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-gray-500">
                            <th className="py-1 pr-3">Pretendente</th>
                            <th className="py-1 pr-3">Produto</th>
                            <th className="py-1 pr-3">Tipo</th>
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
                              <td className="py-1 pr-3 font-medium text-o2-navy">{o.pretendente ?? "—"}</td>
                              <td className="py-1 pr-3">{rotuloProdutoBase(o.produto)}</td>
                              <td className="py-1 pr-3 text-xs text-gray-600">{o.tipo === "renovacao" ? "Renovação" : "Novo"}</td>
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
          </div>
        </>
      )}
      <p className="text-xs text-gray-400">Faltou alguma imobiliária? Ela entra no quadro ao ser incluída nos destinatários da campanha ou de um e-mail desta campanha.</p>
    </div>
  );
}
