import SubmitButton from "@/components/SubmitButton";
import { alertaRenovacao, diasEntre, formatarData, formatarReais, hojeSP } from "@/lib/sinistros/regras";
import { registrarNoHistorico } from "../actions";
import { excluirEventoInterno, marcarRenovacaoSinalizada, salvarDespejoAcordo, salvarEventoInterno } from "../operacao";
import { botaoPrimario, botaoSecundario, cartao, inputClass, labelClass } from "../ui";
import UploadDocumento from "./UploadDocumento";
import type { Documento, RegistroHistorico } from "./blocos";

/* eslint-disable @typescript-eslint/no-explicit-any -- linha do Supabase sem tipos gerados */

// Especificação "Tela de visualização de sinistro acionado" (22/10/2026).

// ---------- Pastas dos anexos ----------

export const PASTAS = ["Contratos", "Boletos — Aluguel", "Boletos — Condomínio", "Boletos — IPTU", "Boletos — Contas de consumo", "Ação de despejo", "Outros"] as const;
const PASTA_DO_TIPO: Record<string, string> = {
  contrato_locacao: "Contratos",
  contrato_administracao: "Contratos",
  procuracao_ad_judicia: "Contratos",
  boletos_aluguel: "Boletos — Aluguel",
  boletos_condominio: "Boletos — Condomínio",
  iptu: "Boletos — IPTU",
  contas_consumo: "Boletos — Contas de consumo",
};
export function pastaDoDocumento(d: Documento & { pasta?: string | null }) {
  return d.pasta || PASTA_DO_TIPO[d.tipo] || "Outros";
}

const PILULA: Record<string, string> = {
  enviado: "bg-blue-100 text-blue-800",
  aprovado: "bg-green-100 text-green-800",
  recusado: "bg-red-100 text-red-700",
};

export function AnexosPorPasta({ s, docs, interno }: { s: any; docs: Documento[]; interno: boolean }) {
  const podeIncluir = s.etapa !== "encerrado" && s.etapa !== "cancelado";
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Anexos</h2>
      <p className="text-xs text-gray-500">
        Tudo o que foi enviado no acionamento e o que for incluído depois. {interno ? "" : "Documento novo vai para validação da O2."}
      </p>
      <div className="grid gap-2 md:grid-cols-2">
        {PASTAS.map((pasta) => {
          const daPasta = docs.filter((d) => pastaDoDocumento(d) === pasta);
          return (
            <details key={pasta} className={`${cartao} p-3`} open={daPasta.length > 0}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-o2-navy">
                <span>
                  📁 {pasta} <span className="text-xs font-normal text-gray-400">({daPasta.length})</span>
                </span>
              </summary>
              <ul className="mt-2 space-y-1 text-xs">
                {daPasta.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    {d.url ? (
                      <a href={d.url} target="_blank" rel="noreferrer" className="font-medium text-o2-blue underline">
                        {d.nome_arquivo}
                      </a>
                    ) : (
                      <span>{d.nome_arquivo}</span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 font-semibold ${PILULA[d.situacao] ?? ""}`}>
                      {d.situacao === "enviado" ? "aguardando validação" : d.situacao === "aprovado" ? "aceito" : interno ? "recusado" : "pendente"}
                    </span>
                    <span className="text-gray-400">{formatarData(d.enviado_em.slice(0, 10))}</span>
                  </li>
                ))}
                {!daPasta.length && <li className="text-gray-400">Vazia.</li>}
              </ul>
              {podeIncluir && (
                <div className="mt-2 flex justify-end">
                  <UploadDocumento id={s.id} tipo="outros" pasta={pasta} rotulo="+ Incluir arquivo" />
                </div>
              )}
            </details>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Cabeçalho ----------

const PASSOS_EXTERNOS = ["Sinistro acionado", "Análise da seguradora", "Em andamento", "Finalizado"];
function passoExterno(etapa: string) {
  if (etapa === "encerrado") return 4;
  if (etapa === "em_indenizacao" || etapa === "acordo_judicial") return 3;
  if (etapa === "na_seguradora") return 2;
  return 0; // ainda na validação da O2 (pré-análise / pendência)
}

export function dataDoAvisoSinistro(s: any): string | null {
  return s.autorizado_em?.slice(0, 10) ?? s.enviado_em?.slice(0, 10) ?? s.data_abertura_seguradora ?? null;
}

// Histórico EXTERNO em linha do tempo: Sinistro acionado (data do aviso) →
// Análise da seguradora → Em andamento → Finalizado.
export function LinhaDoTempoExterna({ s, primeiraIndenizacao }: { s: any; primeiraIndenizacao: string | null }) {
  const atual = passoExterno(s.etapa);
  const datas = [dataDoAvisoSinistro(s), s.data_abertura_seguradora, primeiraIndenizacao ?? s.acordo_data ?? null, s.encerrado_em?.slice(0, 10) ?? null];
  return (
    <div>
      {s.etapa === "cancelado" ? (
        <p className="text-sm font-semibold text-gray-600">Cancelado{s.motivo_encerramento ? ` — ${s.motivo_encerramento}` : ""}</p>
      ) : (
        <ol className="flex gap-1">
          {PASSOS_EXTERNOS.map((p, i) => {
            const n = i + 1;
            const feito = n < atual || (n === 4 && atual === 4);
            const agora = n === atual && n !== 4;
            return (
              <li key={p} className="flex-1">
                <div className={`h-1.5 rounded-full ${feito ? "bg-o2-navy" : agora ? "bg-o2-coral" : "bg-gray-200"}`} />
                <p className={`mt-1 text-[11px] font-semibold uppercase ${feito || agora ? "text-o2-navy" : "text-gray-400"}`}>{p}</p>
                <p className="text-[11px] text-gray-500">{n <= atual && datas[i] ? formatarData(datas[i]) : ""}</p>
              </li>
            );
          })}
        </ol>
      )}
      {atual === 0 && s.etapa !== "cancelado" && <p className="mt-1 text-xs text-orange-700">Aguardando a validação da documentação pela O2.</p>}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{rotulo}</dt>
      <dd className="text-sm text-o2-navy">{children}</dd>
    </div>
  );
}

function situacaoVigencia(s: any) {
  const fim = s.vigencia_fim as string | null;
  if (!fim) return { texto: "não informada", cor: "text-gray-500" };
  const dias = diasEntre(hojeSP(), fim);
  const faixa = `${formatarData(s.vigencia_inicio)} a ${formatarData(fim)}`;
  if (dias < 0) return { texto: `${faixa} · encerrada`, cor: "text-red-700" };
  if (dias <= 20) return { texto: `${faixa} · vence em ${dias} dia(s)`, cor: "text-orange-700" };
  return { texto: `${faixa} · vigente`, cor: "text-green-800" };
}

function SimNao({ name, valor }: { name: string; valor: boolean | null }) {
  return (
    <span className="flex gap-3 text-sm">
      <label className="flex items-center gap-1">
        <input type="radio" name={name} value="sim" defaultChecked={valor === true} className="accent-o2-coral" /> Sim
      </label>
      <label className="flex items-center gap-1">
        <input type="radio" name={name} value="nao" defaultChecked={valor === false} className="accent-o2-coral" /> Não
      </label>
    </span>
  );
}

export function CabecalhoSinistro({
  s,
  saldo,
  primeiraIndenizacao,
  interno,
  ctx,
}: {
  s: any;
  saldo: number | null;
  primeiraIndenizacao: string | null;
  interno: boolean;
  ctx: string | null;
}) {
  const vig = situacaoVigencia(s);
  const alerta = alertaRenovacao(s);
  const desocupado = s.tipo === "chaves_sem_danos" || s.tipo === "chaves_com_danos";
  return (
    <section className={`${cartao} space-y-4`}>
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <Campo rotulo="Nº do aviso">
          <span className="text-lg font-bold">{s.numero_sinistro_seguradora ?? "—"}</span>
        </Campo>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Status</p>
          <LinhaDoTempoExterna s={s} primeiraIndenizacao={primeiraIndenizacao} />
        </div>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Campo rotulo="Data da ocorrência">{formatarData(s.data_ocorrencia ?? s.data_primeiro_vencimento)}</Campo>
        <Campo rotulo="Data do aviso">{formatarData(dataDoAvisoSinistro(s))}</Campo>
        <Campo rotulo="Imóvel">
          {s.tipo === "ocupado" ? "Ocupado" : desocupado ? `Desocupado${s.data_entrega_chaves ? ` — chaves em ${formatarData(s.data_entrega_chaves)}` : ""}` : "—"}
        </Campo>
        <Campo rotulo="Vigência">
          <span className={vig.cor}>{vig.texto}</span>
        </Campo>
        <Campo rotulo="Saldo de LMI">
          {saldo == null ? (
            <span className="text-gray-500">LMI não informado</span>
          ) : (
            <span className={saldo < 0 ? "font-semibold text-red-700" : "font-semibold text-green-800"}>{formatarReais(saldo)}</span>
          )}
        </Campo>
      </dl>

      {interno && alerta && (
        <form action={marcarRenovacaoSinalizada} className="flex flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm">
          <input type="hidden" name="id" value={s.id} />
          {ctx && <input type="hidden" name="ctx" value={ctx} />}
          <span className="flex-1 font-semibold text-red-800">⚠ {alerta.texto}</span>
          <label className="flex items-center gap-2 font-semibold text-o2-navy">
            <input type="checkbox" required className="accent-o2-coral" /> Setor de renovação foi sinalizado?
          </label>
          <SubmitButton className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white" textoCarregando="…">
            Confirmar
          </SubmitButton>
        </form>
      )}
      {interno && s.renovacao_sinalizada_em && !alerta && s.tipo === "ocupado" && (
        <p className="text-xs text-gray-500">
          Setor de renovação sinalizado em {formatarData(s.renovacao_sinalizada_em.slice(0, 10))}
          {s.renovacao_sinalizada_por ? ` por ${s.renovacao_sinalizada_por}` : ""}.
        </p>
      )}

      {interno ? (
        <form action={salvarDespejoAcordo} className="grid gap-3 border-t border-gray-100 pt-3 md:grid-cols-2">
          <input type="hidden" name="id" value={s.id} />
          {ctx && <input type="hidden" name="ctx" value={ctx} />}
          <div className="space-y-1">
            <p className="text-sm font-semibold text-o2-navy">Há ação de despejo em andamento?</p>
            <SimNao name="despejo" valor={s.despejo ?? null} />
            <input name="despejo_processo" defaultValue={s.despejo_processo ?? ""} placeholder="Nº do processo judicial (se sim)" className={inputClass} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-o2-navy">Há acordo em andamento?</p>
            <SimNao name="acordo_em_andamento" valor={s.acordo_em_andamento ?? null} />
            <textarea name="acordo_tratativa" rows={1} defaultValue={s.acordo_tratativa ?? ""} placeholder="Tratativa com o escritório (se sim)" className={inputClass} />
          </div>
          <div className="flex justify-end md:col-span-2">
            <SubmitButton className={botaoSecundario} textoCarregando="Salvando…">
              Salvar despejo / acordo
            </SubmitButton>
          </div>
        </form>
      ) : (
        (s.despejo != null || s.acordo_em_andamento != null) && (
          <dl className="grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2">
            <Campo rotulo="Ação de despejo em andamento?">{s.despejo ? `Sim${s.despejo_processo ? ` — processo ${s.despejo_processo}` : ""}` : s.despejo === false ? "Não" : "—"}</Campo>
            <Campo rotulo="Acordo em andamento?">{s.acordo_em_andamento ? "Sim" : s.acordo_em_andamento === false ? "Não" : "—"}</Campo>
          </dl>
        )
      )}
    </section>
  );
}

// ---------- Chat lateral ----------

const QUEM: Record<string, { nome: string; cor: string; lado: string }> = {
  o2: { nome: "O2 Seguros", cor: "bg-blue-50 border-blue-200", lado: "mr-6" },
  imobiliaria: { nome: "Imobiliária", cor: "bg-orange-50 border-orange-200", lado: "ml-6" },
  sistema: { nome: "Sistema", cor: "bg-gray-50 border-gray-200", lado: "mx-3" },
};

export function ChatLateral({ s, historico, interno, ctx }: { s: any; historico: RegistroHistorico[]; interno: boolean; ctx: string | null }) {
  // Conversa = tudo o que a imobiliária enxerga, do mais antigo ao mais novo.
  const msgs = historico.filter((h) => h.visivel_imobiliaria).slice().reverse();
  const podeEscrever = s.etapa !== "cancelado";
  return (
    <aside className="flex max-h-[44rem] flex-col rounded-xl border border-gray-200 bg-white lg:sticky lg:top-4">
      <h2 className="border-b border-gray-100 px-3 py-2 text-sm font-semibold uppercase tracking-wide text-o2-navy">
        Chat do sinistro {s.numero_sinistro_seguradora ? `· aviso ${s.numero_sinistro_seguradora}` : `· SIN-${s.codigo}`}
      </h2>
      <ol className="flex-1 space-y-2 overflow-y-auto p-3">
        {msgs.map((m) => {
          const q = QUEM[m.autor_tipo] ?? QUEM.sistema;
          return (
            <li key={m.id} className={`rounded-lg border p-2 text-sm ${q.cor} ${q.lado}`}>
              <p className="text-[11px] text-gray-500">
                <b className="text-o2-navy">{q.nome}</b> ·{" "}
                {new Date(m.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                {interno && m.autor_email ? ` · ${m.autor_email}` : ""}
              </p>
              <p className="whitespace-pre-wrap text-gray-800">{m.texto}</p>
            </li>
          );
        })}
        {!msgs.length && <li className="text-xs text-gray-400">Nenhuma mensagem ainda.</li>}
      </ol>
      {podeEscrever && (
        <form action={registrarNoHistorico} className="space-y-2 border-t border-gray-100 p-3">
          <input type="hidden" name="id" value={s.id} />
          {interno && (
            <>
              <input type="hidden" name="referente" value="imobiliaria" />
              <input type="hidden" name="visivel_imobiliaria" value="on" />
            </>
          )}
          {ctx && <input type="hidden" name="ctx" value={ctx} />}
          <textarea name="texto" rows={2} required placeholder={interno ? "Mensagem para a imobiliária" : "Mensagem para a O2 Seguros"} className={inputClass} />
          <div className="flex items-center justify-between gap-2">
            {interno ? (
              <label className="flex items-center gap-1 text-xs text-gray-600">
                <input type="checkbox" name="enviar_email" defaultChecked className="accent-o2-coral" /> avisar por e-mail
              </label>
            ) : (
              <span className="text-xs text-gray-500">A O2 é avisada por e-mail.</span>
            )}
            <SubmitButton className={botaoPrimario} textoCarregando="Enviando…">
              Enviar
            </SubmitButton>
          </div>
        </form>
      )}
    </aside>
  );
}

// ---------- Histórico do andamento INTERNO ----------

export function HistoricoInterno({ s, historico, ctx }: { s: any; historico: RegistroHistorico[]; ctx: string | null }) {
  const eventos = historico
    .filter((h) => !h.visivel_imobiliaria)
    .map((h) => ({ ...h, data: (h as RegistroHistorico & { data_evento?: string | null }).data_evento ?? h.criado_em.slice(0, 10) }))
    .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.criado_em.localeCompare(a.criado_em)));
  const ocultos = (
    <>
      <input type="hidden" name="id" value={s.id} />
      {ctx && <input type="hidden" name="ctx" value={ctx} />}
    </>
  );
  return (
    <section className="space-y-3">
      <form action={salvarEventoInterno} className={`${cartao} grid gap-2 p-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end`}>
        {ocultos}
        <div>
          <label className={labelClass}>Data *</label>
          <input type="date" name="data_evento" required defaultValue={hojeSP()} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Descrição do evento *</label>
          <input name="texto" required placeholder="Ex.: ligação para o escritório, retorno da seguradora…" className={inputClass} />
        </div>
        <SubmitButton className={botaoPrimario} textoCarregando="…">
          Inserir evento
        </SubmitButton>
      </form>
      <ol className="max-h-[32rem] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-200 bg-white">
        {eventos.map((e) => {
          const editavel = e.autor_tipo === "o2";
          const ed = e as typeof e & { editado_em?: string | null; editado_por?: string | null };
          return (
            <li key={e.id} className="px-3 py-2 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500">
                    <b className="text-o2-navy">{formatarData(e.data)}</b> · {e.autor_tipo === "o2" ? e.autor_email ?? "O2" : "Sistema"}
                    {ed.editado_em ? ` · editado${ed.editado_por ? ` por ${ed.editado_por}` : ""}` : ""}
                  </p>
                  <p className="whitespace-pre-wrap text-gray-800">{e.texto}</p>
                </div>
                {editavel && (
                  <details className="text-xs">
                    <summary className="cursor-pointer list-none text-o2-blue">editar</summary>
                    <form action={salvarEventoInterno} className="mt-1 flex flex-wrap gap-1">
                      {ocultos}
                      <input type="hidden" name="evento_id" value={e.id} />
                      <input type="date" name="data_evento" required defaultValue={e.data} className="rounded border border-gray-300 px-1 py-0.5" />
                      <input name="texto" required defaultValue={e.texto} className="w-64 rounded border border-gray-300 px-1 py-0.5" />
                      <button className="rounded-full bg-o2-navy px-3 py-0.5 font-semibold text-white">Salvar</button>
                    </form>
                    <form action={excluirEventoInterno} className="mt-1">
                      {ocultos}
                      <input type="hidden" name="evento_id" value={e.id} />
                      <button className="text-red-600 hover:underline">excluir evento</button>
                    </form>
                  </details>
                )}
              </div>
            </li>
          );
        })}
        {!eventos.length && <li className="px-3 py-2 text-xs text-gray-400">Nenhum evento interno.</li>}
      </ol>
    </section>
  );
}
