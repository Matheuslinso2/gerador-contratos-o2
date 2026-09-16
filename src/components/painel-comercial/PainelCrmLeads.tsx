"use client";

import { useMemo, useState } from "react";
import { ORDEM_ETAPAS_LEAD_ABERTAS, ETAPAS_LEAD, CAMINHOS_LEAD, type LinhaLead } from "@/lib/bitrix/crmLeadsConstantes";
import styles from "../../app/painel-comercial/painel-comercial.module.css";
import tabStyles from "./painel-crm-leads.module.css";

function fmtData(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={`${styles.kpiValue} ${styles.num}`}>{value}</div>
      <div className={styles.kpiSub}>{sub}</div>
    </div>
  );
}

function BarraProporcional({ label, value, max, formatted }: { label: string; value: number; max: number; formatted?: string }) {
  const pctLargura = Math.max(2, (value / Math.max(max, 1)) * 100);
  return (
    <div className={styles.barrow}>
      <div className={styles.rlabel}>{label}</div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${pctLargura}%` }} />
      </div>
      <div className={`${styles.rvalue} ${styles.num}`}>{formatted ?? value}</div>
    </div>
  );
}

type Aba = "prioridades" | "prospeccao" | "cadastro";

export default function PainelCrmLeads({ linhas, responsaveis, ultimaAtualizacao }: { linhas: LinhaLead[]; responsaveis: { id: number; nome: string }[]; ultimaAtualizacao: string }) {
  const [aba, setAba] = useState<Aba>("prioridades");
  const [responsavelId, setResponsavelId] = useState<number>(0); // 0 = Todos
  const [expandido, setExpandido] = useState(false);

  const linhasFiltradas = useMemo(() => (responsavelId ? linhas.filter((l) => l.responsavelId === responsavelId) : linhas), [linhas, responsavelId]);

  return (
    <>
      <div className={tabStyles.toolbar}>
        <nav className={tabStyles.tabs} aria-label="Visões do CRM Leads">
          <button type="button" className={aba === "prioridades" ? tabStyles.tabActive : tabStyles.tab} onClick={() => setAba("prioridades")}>
            1. Prioridades
          </button>
          <button type="button" className={aba === "prospeccao" ? tabStyles.tabActive : tabStyles.tab} onClick={() => setAba("prospeccao")}>
            2. Prospecção
          </button>
          <button type="button" className={aba === "cadastro" ? tabStyles.tabActive : tabStyles.tab} onClick={() => setAba("cadastro")}>
            3. Cadastro e caminhos
          </button>
        </nav>
        <label className={tabStyles.ownerLabel}>
          Responsável{" "}
          <select className={tabStyles.ownerSelect} value={responsavelId} onChange={(e) => setResponsavelId(Number(e.target.value))}>
            <option value={0}>Todos</option>
            {responsaveis.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.note} style={{ marginBottom: 16 }}>
        {linhasFiltradas.length} leads ativos · fotografia ao vivo em {fmtData(ultimaAtualizacao)} · campos vazios não comprovam ausência de trabalho
      </div>

      {aba === "prioridades" && <AbaPrioridades linhas={linhasFiltradas} expandido={expandido} setExpandido={setExpandido} />}
      {aba === "prospeccao" && <AbaProspeccao linhas={linhasFiltradas} />}
      {aba === "cadastro" && <AbaCadastro linhas={linhasFiltradas} />}
    </>
  );
}

function AbaPrioridades({ linhas, expandido, setExpandido }: { linhas: LinhaLead[]; expandido: boolean; setExpandido: (v: boolean) => void }) {
  const vencidas = linhas.filter((l) => l.prioridade === 1).length;
  const semPrazo = linhas.filter((l) => l.prioridade === 2).length;
  const programadas = linhas.filter((l) => l.prioridade === 3).length;

  const ordenadas = useMemo(
    () =>
      [...linhas].sort((a, b) => {
        if (a.prioridade !== b.prioridade) return a.prioridade - b.prioridade;
        const da = a.prazo ? new Date(a.prazo).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.prazo ? new Date(b.prazo).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db || a.id - b.id;
      }),
    [linhas]
  );
  const mostrar = expandido ? ordenadas : ordenadas.slice(0, 6);

  return (
    <>
      <div className={styles.kpis}>
        <Kpi label="Com atividade vencida" value={String(vencidas)} sub="Conferir execução e definir o retorno" />
        <Kpi label="Sem atividade com prazo" value={String(semPrazo)} sub="Sem vencida e sem atividade futura" />
        <Kpi label="Com atividade programada" value={String(programadas)} sub="Sem pendência vencida registrada" />
      </div>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Quem atender primeiro</h2>
        </div>
        <div className={styles.panel}>
          <div className={styles.tableWrap}>
            <table className={styles.data}>
              <thead>
                <tr>
                  <th>Lead / responsável</th>
                  <th>Situação</th>
                  <th>Direcionamento</th>
                </tr>
              </thead>
              <tbody>
                {mostrar.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <a href={l.link} target="_blank" rel="noopener noreferrer" className={tabStyles.link}>
                        {l.nome}
                      </a>
                      <div className={styles.note}>{l.responsavelNome}</div>
                    </td>
                    <td>
                      {l.prioridade === 1 ? "Atividade vencida" : l.prioridade === 2 ? "Sem atividade com prazo" : "Programado"}
                      <div className={styles.note}>{l.prazo ? fmtData(l.prazo) : "Prazo não registrado"}</div>
                    </td>
                    <td>
                      {l.prioridade === 1
                        ? "Conferir a execução e registrar o próximo passo"
                        : l.prioridade === 2
                          ? "Agendar contato com responsável e prazo"
                          : "Seguir o agendamento"}
                      <div className={styles.note}>{l.assunto}</div>
                    </td>
                  </tr>
                ))}
                {ordenadas.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: "var(--ink-faint)" }}>
                      Nenhum lead neste recorte.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {ordenadas.length > 6 && (
            <button type="button" className={tabStyles.verTodos} onClick={() => setExpandido(!expandido)}>
              {expandido ? "Mostrar apenas 6" : `Ver todos os ${ordenadas.length} leads`}
            </button>
          )}
        </div>
      </section>
    </>
  );
}

function AbaProspeccao({ linhas }: { linhas: LinhaLead[] }) {
  const decisor = linhas.filter((l) => l.decisorRegistrado).length;
  const emailEnviado = linhas.filter((l) => l.emailInicialEnviado).length;
  const max = Math.max(...ORDEM_ETAPAS_LEAD_ABERTAS.map((id) => linhas.filter((l) => l.stageId === id).length), 1);

  return (
    <>
      <div className={styles.kpis}>
        <Kpi label="Decisor registrado" value={String(decisor)} sub={`De ${linhas.length} leads ativos`} />
        <Kpi label="E-mail inicial marcado como enviado" value={String(emailEnviado)} sub="Contagem do campo, não do Gmail" />
        <Kpi label="Conversão entre etapas" value="Não apurado" sub="Depende do histórico de entradas e saídas" />
      </div>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Distribuição por etapa</h2>
        </div>
        <div className={styles.panel}>
          <div className={styles.barlist}>
            {ORDEM_ETAPAS_LEAD_ABERTAS.map((id) => {
              const doEstagio = linhas.filter((l) => l.stageId === id);
              const vencidas = doEstagio.filter((l) => l.prioridade === 1).length;
              return (
                <BarraProporcional
                  key={id}
                  label={ETAPAS_LEAD[id]}
                  value={doEstagio.length}
                  max={max}
                  formatted={`${doEstagio.length} (${vencidas} vencida${vencidas === 1 ? "" : "s"})`}
                />
              );
            })}
          </div>
        </div>
      </section>
      <div className={styles.note}>Contato efetivo, taxa de resposta, tempo até o primeiro contato, comparecimento e conversão por etapa: não apurados nesta consulta.</div>
    </>
  );
}

function AbaCadastro({ linhas }: { linhas: LinhaLead[] }) {
  const cadastro = linhas.filter((l) => l.cadastroConcluido).length;
  const max = Math.max(...CAMINHOS_LEAD.map((c) => linhas.filter((l) => l.caminho === c).length), 1);

  return (
    <>
      <div className={styles.kpis}>
        <Kpi label="Cadastro marcado como concluído" value={String(cadastro)} sub="Entre os leads ainda ativos" />
        <Kpi label="Proposta marcada como enviada" value="Não apurado" sub="Sem campo confiável no Bitrix ainda" />
        <Kpi label="Parceiros ativados" value="Não apurado" sub="Leads convertidos e emissões não consultados" />
      </div>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Caminho de atendimento</h2>
        </div>
        <div className={styles.panel}>
          <div className={styles.barlist}>
            {CAMINHOS_LEAD.map((c) => (
              <BarraProporcional key={c} label={c} value={linhas.filter((l) => l.caminho === c).length} max={max} />
            ))}
          </div>
        </div>
      </section>
      <div className={styles.note}>Ativação: primeira contratação/emissão confirmada. Contagem zero em um campo não comprova ausência de trabalho.</div>
    </>
  );
}
