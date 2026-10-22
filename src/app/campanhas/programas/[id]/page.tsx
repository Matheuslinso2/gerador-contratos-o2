import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin, isColaboradorO2 } from "@/lib/admin";
import { signOut } from "../../../actions";
import AppHeader from "@/components/AppHeader";
import PageHeader from "@/components/PageHeader";
import InfoLegenda from "@/components/InfoLegenda";
import SubmitButton from "@/components/SubmitButton";
import { Cartao } from "@/components/kpiUi";
import { IconMail } from "@/components/icons";
import {
  DIAS_APROVADA_PARADA,
  STATUS_PROGRAMA,
  metricaInfo,
  montarDesempenhoPrograma,
  rotuloProdutoPrograma,
  type ParticipanteRow,
  type Programa,
} from "@/lib/campanhas/programas";
import { ROTULO_STATUS_CAMPANHA } from "@/lib/campanhas/rotulos";
import CamposPrograma from "../CamposPrograma";
import { arquivarPrograma, atualizarPrograma, gerarParciais } from "../actions";
import ExcluirProgramaButton from "./ExcluirProgramaButton";
import AdicionarParticipante from "./AdicionarParticipante";
import LinhaParticipante from "./LinhaParticipante";

export const dynamic = "force-dynamic";

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const umaCasa = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export default async function ProgramaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const { id } = await params;
  const { erro, ok } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdmin(user?.email) && !isColaboradorO2(user?.email)) redirect("/");

  const { data: programaData } = await supabase.from("campanhas_programas").select("*").eq("id", id).maybeSingle();
  if (!programaData) notFound();
  const programa = programaData as Programa;

  const [{ data: participantesData }, { data: imobsData }, { data: gruposData }, { data: comunicacoesData }] = await Promise.all([
    supabase
      .from("campanhas_programas_participantes")
      .select("id, imobiliaria_id, grupo_id, meta, observacao, custo_premiacao")
      .eq("programa_id", id)
      .order("created_at"),
    supabase.from("imobiliarias").select("id, nome, apelido, grupo_id").order("nome"),
    supabase.from("imobiliaria_grupos").select("id, nome, tipo").order("nome"),
    supabase.from("campanhas").select("id, nome, status, created_at, disparada_em").eq("programa_id", id).order("created_at", { ascending: false }),
  ]);
  const participantes = (participantesData ?? []) as ParticipanteRow[];

  // Leitura da produção com a credencial do servidor (o acesso já foi
  // conferido acima): funil resolvido pela base única + Corp.
  let desempenho: Awaited<ReturnType<typeof montarDesempenhoPrograma>> | null = null;
  let erroCalculo: string | null = null;
  try {
    desempenho = await montarDesempenhoPrograma(createServiceClient(), programa, participantes);
  } catch (e) {
    erroCalculo = e instanceof Error ? e.message : "Falha ao calcular a produção.";
  }

  const metrica = metricaInfo(programa.metrica);
  const fmt = (n: number | null) => (n === null ? "—" : metrica.moeda ? brl.format(n) : umaCasa.format(n));
  const imobs = (imobsData ?? []) as { id: string; nome: string; apelido: string | null; grupo_id: string | null }[];
  const grupos = (gruposData ?? []) as { id: string; nome: string; tipo: string | null }[];
  const unidadesPorGrupo = new Map<string, number>();
  for (const i of imobs) if (i.grupo_id) unidadesPorGrupo.set(i.grupo_id, (unidadesPorGrupo.get(i.grupo_id) ?? 0) + 1);
  const incluidas = participantes.map((p) => p.imobiliaria_id ?? p.grupo_id).filter((x): x is string => !!x);
  const t = desempenho?.totais;

  return (
    <>
      <AppHeader userEmail={user?.email} logoutAction={signOut} />
      <main className="mx-auto w-full min-w-0 max-w-[1500px] flex-1 space-y-6 p-8">
        <Link href="/campanhas/programas" className="text-sm font-medium text-o2-navy hover:underline">
          ← Voltar para os programas
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <PageHeader
            icon={<IconMail />}
            titulo={programa.nome}
            subtitulo={`${dataBr(programa.inicio)} a ${dataBr(programa.fim)} · ${programa.produtos.map(rotuloProdutoPrograma).join(" + ")} · meta em ${metrica.rotulo.toLowerCase()}`}
          />
          <span className="rounded-full bg-o2-navy px-3 py-1 text-xs font-medium text-white">{STATUS_PROGRAMA[programa.status] ?? programa.status}</span>
        </div>

        {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        {ok && <p className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">{ok}</p>}
        {erroCalculo && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">Não consegui calcular a produção agora: {erroCalculo}</p>}

        {(programa.objetivo || programa.premiacao_descricao) && (
          <div className="grid gap-3 md:grid-cols-2">
            {programa.objetivo && (
              <div className="rounded-xl bg-gray-50 p-4 text-sm text-o2-navy">
                <div className="text-xs text-gray-500">Objetivo</div>
                {programa.objetivo}
              </div>
            )}
            {programa.premiacao_descricao && (
              <div className="rounded-xl bg-gray-50 p-4 text-sm text-o2-navy">
                <div className="text-xs text-gray-500">Premiação</div>
                {programa.premiacao_descricao}
              </div>
            )}
          </div>
        )}

        {desempenho && t && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-o2-navy">
              Resumo do programa
              <InfoLegenda titulo="Resumo do programa">
                Realizado = produção do funil (Bitrix e planilhas, com a imobiliária ligada pela base única) dentro do período, até hoje. A meta total soma as metas individuais; o % considera só quem tem meta. Projeção = ritmo atual (realizado ÷ dias corridos) estendido até o fim. Conferência Corp = documentos novos não cancelados emitidos no período pelo código de produtor da imobiliária. Resultado = comissão − repasse do Corp − custo da premiação (geral + individuais).
              </InfoLegenda>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Cartao
                rotulo="Prazo"
                valor={desempenho.diasRestantes > 0 ? `${desempenho.diasRestantes} dias` : "Encerrado"}
                linhas={[`${desempenho.diasDecorridos} de ${desempenho.diasTotais} dias corridos`, programa.data_apuracao ? `Apuração em ${dataBr(programa.data_apuracao)}` : "Sem data de apuração"]}
              />
              <Cartao
                rotulo="Meta × realizado"
                valor={t.percentual === null ? "Sem metas" : `${inteiro.format(t.percentual)}%`}
                linhas={[`Realizado: ${fmt(t.realizado)}`, `Meta total: ${t.meta ? fmt(t.meta) : "—"}`, `Projeção no fim: ${fmt(t.projecao)}`]}
              />
              <Cartao
                rotulo="Participantes no ritmo"
                valor={`${t.noRitmoOuAtingida} de ${t.participantesComMeta}`}
                linhas={[`${desempenho.linhas.length} participante(s) no total`, `${t.participantesComAlerta} com alerta`, `${inteiro.format(t.oportunidades)} cotação(ões) em aberto`]}
              />
              <Cartao
                rotulo="Conferência Corp"
                valor={`${inteiro.format(t.corp.documentos)} doc.`}
                linhas={[`Prêmio líquido: ${brl.format(t.corp.premio)}`, `Funil: ${inteiro.format(t.funil.contratacoes)} contratação(ões)`]}
              />
              <Cartao
                rotulo="Resultado financeiro"
                valor={brl.format(t.resultado)}
                linhas={[`Comissão: ${brl.format(t.corp.comissao)}`, `Repasse: ${brl.format(t.corp.repasse)}`, `Premiação: ${brl.format(t.custoPremiacao)}`]}
              />
            </div>
          </section>
        )}

        <section className="space-y-3 rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-o2-navy">
            Participantes e metas
            <InfoLegenda titulo="Participantes e metas" alinhar="esquerda">
              Meta individual, definida uma a uma. Base = média por mês da mesma métrica nos 6 meses antes do início (só referência para definir a meta). Realizado = funil no período. Faltam e ritmo por semana = quanto falta e quanto precisa por semana até o fim. Farol: no ritmo (projeção ≥ meta), atenção (≥ 80%), em risco (abaixo). Em andamento = cotações abertas (em análise ou aprovadas) das unidades. Corp = documentos novos e prêmio no período; comissão e repasse também do Corp. Resultado = comissão − repasse − custo da premiação da linha.
            </InfoLegenda>
          </h2>
          {desempenho && desempenho.linhas.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="py-2 pr-3">Participante</th>
                    <th className="py-2 pr-3 text-right">Base/mês</th>
                    <th className="py-2 pr-3 text-right">Meta</th>
                    <th className="py-2 pr-3 text-right">Realizado</th>
                    <th className="py-2 pr-3 text-right">%</th>
                    <th className="py-2 pr-3 text-right">Faltam</th>
                    <th className="py-2 pr-3 text-right">Ritmo/sem.</th>
                    <th className="py-2 pr-3 text-right">Projeção</th>
                    <th className="py-2 pr-3">Farol</th>
                    <th className="py-2 pr-3 text-right">Em andamento</th>
                    <th className="py-2 pr-3 text-right">Corp (doc · prêmio)</th>
                    <th className="py-2 pr-3 text-right">Comissão</th>
                    <th className="py-2 pr-3 text-right">Repasse</th>
                    <th className="py-2 pr-3 text-right">Custo prêmio</th>
                    <th className="py-2 pr-3 text-right">Resultado</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {desempenho.linhas.map((l) => (
                    <LinhaParticipante key={l.participanteId} linha={l} moeda={metrica.moeda} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Nenhum participante ainda. Adicione imobiliárias ou grupos abaixo.</p>
          )}

          <div className="border-t pt-4">
            <h3 className="mb-2 text-xs font-semibold text-gray-600">
              Adicionar participante
              <InfoLegenda titulo="Quem pode participar">
                Sempre do cadastro único de imobiliárias. Imobiliária = acompanha só aquela unidade. Grupo/rede = soma todas as unidades do grupo numa meta só. Uma mesma unidade não pode entrar das duas formas, para a produção não contar duas vezes.
              </InfoLegenda>
            </h3>
            <AdicionarParticipante
              programaId={id}
              imobiliarias={imobs.map((i) => ({ id: i.id, nome: i.apelido || i.nome, detalhe: i.apelido ? i.nome : undefined }))}
              grupos={grupos.map((g) => ({ id: g.id, nome: g.nome, detalhe: `${unidadesPorGrupo.get(g.id) ?? 0} unidade(s)` }))}
              incluidas={incluidas}
            />
          </div>
        </section>

        {desempenho && desempenho.linhas.length > 0 && (
          <section className="space-y-3 rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-o2-navy">
              Oportunidades em aberto
              <InfoLegenda titulo="Oportunidades em aberto">
                Cotações das unidades de cada participante que ainda não fecharam: aprovadas (mais perto da contratação) primeiro, depois em análise, das mais antigas para as mais novas. Valor = prêmio cotado (ou valor do título, na Capitalização). O link abre o card no Bitrix. É a lista de onde o comercial pode tirar as contratações que faltam para a meta.
              </InfoLegenda>
            </h2>
            {desempenho.linhas.every((l) => l.oportunidades.length === 0) ? (
              <p className="text-sm text-gray-500">Nenhuma cotação em aberto nos participantes.</p>
            ) : (
              <div className="space-y-2">
                {desempenho.linhas
                  .filter((l) => l.oportunidades.length > 0)
                  .map((l) => (
                    <details key={l.participanteId} className="rounded-lg bg-white px-3 py-2">
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
                                <td className="py-1 pr-3">{rotuloProdutoPrograma(o.produto)}</td>
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
          </section>
        )}

        <section id="parciais" className="space-y-3 rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-o2-navy">
            Parcial por e-mail
            <InfoLegenda titulo="Parcial automática">
              Gera um e-mail de parcial para cada participante COM meta, com os números de hoje: meta, realizado, quanto falta, barra de progresso, dias até o fim, cotações em andamento e a premiação. Cada imobiliária recebe só os próprios números (grupo: todas as unidades recebem o do grupo). Os números ficam fixos no momento da geração; para a próxima parcial, gere de novo. Os e-mails vão para Comunicações do programa como rascunho (para revisar e disparar em Campanhas) ou já agendados, se você escolher data e hora.
            </InfoLegenda>
          </h2>
          <form action={gerarParciais.bind(null, id)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Remetente (nome da pessoa, opcional)</label>
              <input name="remetente_nome" maxLength={40} placeholder="Ex: Henrique" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Agendar o envio (opcional)</label>
              <input name="agendado_para" type="datetime-local" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none" />
            </div>
            <SubmitButton className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white" textoCarregando="Gerando...">
              Gerar parciais
            </SubmitButton>
          </form>
          <p className="text-xs text-gray-500">Sem data: ficam como rascunho para revisar. Com data: são enviadas sozinhas na hora marcada.</p>
        </section>

        <section className="space-y-3 rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-o2-navy">
            Comunicações do programa
            <InfoLegenda titulo="Comunicações">
              E-mails de Campanhas ligados a este programa (boas-vindas, parciais, encerramento). Para ligar um e-mail novo, escolha este programa no campo “Programa” ao criar a campanha.
            </InfoLegenda>
          </h2>
          {(comunicacoesData ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">Nenhum e-mail ligado ainda.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {(comunicacoesData ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3">
                  <Link href={`/campanhas/${c.id}`} className="text-o2-navy hover:underline">
                    {c.nome}
                  </Link>
                  <span className="text-xs text-gray-500">{ROTULO_STATUS_CAMPANHA[c.status] ?? c.status}</span>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/campanhas/nova?programa=${id}`} className="inline-block text-sm font-medium text-o2-coral hover:underline">
            + Novo e-mail para este programa
          </Link>
        </section>

        <details className="rounded-2xl border border-o2-navy/10 bg-quadro p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-semibold text-o2-navy">Editar dados do programa</summary>
          <form action={atualizarPrograma.bind(null, id)} className="mt-4 space-y-6">
            <CamposPrograma programa={programa} />
            <div className="flex justify-end">
              <SubmitButton className="rounded-full bg-o2-coral px-6 py-2 text-sm font-medium text-white" textoCarregando="Salvando...">
                Salvar alterações
              </SubmitButton>
            </div>
          </form>
          <div className="mt-6 flex flex-wrap gap-4 border-t pt-4 text-sm">
            <form action={arquivarPrograma.bind(null, id, !programa.arquivado_em)}>
              <button type="submit" className="text-o2-navy underline">
                {programa.arquivado_em ? "Desarquivar programa" : "Arquivar programa"}
              </button>
            </form>
            <ExcluirProgramaButton programaId={id} nome={programa.nome} />
          </div>
        </details>
      </main>
    </>
  );
}
