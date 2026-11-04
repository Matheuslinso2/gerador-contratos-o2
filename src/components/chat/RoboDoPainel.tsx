"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ComLinks } from "./textoRobo";
import { PAINEIS_ROBO } from "@/lib/chat/paineis";
import { createClient } from "@/lib/supabase/browser";

// Campo do Robô O2 DENTRO de cada painel (pedido do Matheus, 04/11/2026): não é outro chat, é uma caixa de
// pergunta no próprio painel. A pergunta vai para o mesmo robô do chat da equipe (mesmas ferramentas e mesmos
// níveis de acesso), mas com o foco neste painel e neste mês. Somente leitura.
//
// Quando a resposta cita cards, aparece o menu "Cards da resposta" (Todos os cards ou só alguns) e a lista de
// uma linha por card. Cada lista ou PDF ganha um protocolo (RO2-AAAAMMDD-XXXXXX) com o caminho guardado no banco.

type CardLista = {
  id: number;
  produto: string;
  produtoRotulo: string;
  nome: string;
  papelNome: string;
  etapa: string;
  etapaAoVivo: boolean;
  funil: string | null;
  seguradora: string | null;
  imobiliaria: string | null;
  endereco: string | null;
  premio: number | null;
  comissao: number | null;
  repasse: number | null;
  valores: "efetivado" | "previsto" | "sem_valor";
  url: string;
  atualizadoEm: string;
};

type Troca = {
  id: string;
  pergunta: string;
  resposta?: string;
  erro?: boolean;
  pdfPermitido?: boolean;
  dadosPessoais?: boolean;
  logica?: string | null;
  fontes?: string[];
  cards?: CardLista[];
  conversa?: { role: "user" | "assistant"; content: string }[];
};

const brl = (v: number | null) => (v === null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Um único botão, fechado: ao abrir, já lista TODOS os cards citados nas perguntas feitas neste painel (04/11/2026).
function ListaCardsSolicitados({ trocas, painelId, competencia }: { trocas: Troca[]; painelId: string; competencia: string }) {
  // Todos os cards de todas as respostas, sem repetir (o mais recente primeiro).
  const cards = useMemo(() => {
    const vistos = new Set<string>();
    const lista: CardLista[] = [];
    for (const t of trocas) for (const c of t.cards ?? []) {
      const k = `${c.produto}:${c.id}`;
      if (!vistos.has(k)) {
        vistos.add(k);
        lista.push(c);
      }
    }
    return lista;
  }, [trocas]);
  const [aberto, setAberto] = useState(false);
  const [protocolo, setProtocolo] = useState<string | null>(null);
  const registrado = useRef<string>("");
  const chave = cards.map((c) => `${c.produto}:${c.id}`).join(",");

  // Ao abrir, registra o protocolo (e o caminho) dessa lista; reabrir com a mesma lista não gera outro.
  async function aoAbrir() {
    const novoEstado = !aberto;
    setAberto(novoEstado);
    if (!novoEstado || registrado.current === chave) return;
    registrado.current = chave;
    setProtocolo(null);
    const ultima = trocas.find((t) => t.cards?.length && t.conversa);
    try {
      const r = await fetch("/api/chat/robo/protocolo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          painel: { id: painelId, competencia },
          conversa: ultima?.conversa,
          logica: ultima?.logica,
          fontes: ultima?.fontes,
          cardsSelecionados: cards.map((c) => ({ id: c.id, produto: c.produto })),
          todosOsCards: true,
          totalCardsDaResposta: cards.length,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { protocolo?: string };
      if (r.ok && j.protocolo) setProtocolo(j.protocolo);
    } catch {
      /* a lista aparece mesmo sem protocolo */
    }
  }

  if (!cards.length) return null;
  return (
    <div className="mt-3 rounded-xl border border-o2-navy/15 bg-white p-3">
      <button type="button" onClick={() => void aoAbrir()} aria-expanded={aberto} className="rounded-full border border-o2-navy/30 px-4 py-1.5 text-xs font-semibold text-o2-navy hover:bg-o2-navy/5">
        {cards.length === 1 ? "Card solicitado (1)" : `Cards solicitados (${cards.length})`} {aberto ? "▴" : "▾"}
      </button>
      {aberto && (
        <div className="mt-3">
          {protocolo && (
            <p className="mb-2 text-[11px] text-gray-500">
              Protocolo <strong className="select-all text-o2-navy">{protocolo}</strong> · pedido por você; o caminho desta lista ficou guardado.
            </p>
          )}
          {cards.length === 1 ? (
            <DetalheCard c={cards[0]} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[11.5px]">
                <thead className="text-[10px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="p-1.5">Card</th>
                    <th className="p-1.5">Produto</th>
                    <th className="p-1.5">Nome</th>
                    <th className="p-1.5">Etapa (SPA)</th>
                    <th className="p-1.5">Seguradora</th>
                    <th className="p-1.5">Imobiliária</th>
                    <th className="p-1.5">Endereço</th>
                    <th className="p-1.5 text-right">Prêmio</th>
                    <th className="p-1.5 text-right">Comissão</th>
                    <th className="p-1.5 text-right">Repasse</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map((c) => (
                    <tr key={`${c.produto}:${c.id}`} className="border-t border-gray-100 align-top">
                      <td className="p-1.5">
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-o2-blue underline">
                          #{c.id}
                        </a>
                      </td>
                      <td className="p-1.5">{c.produtoRotulo}</td>
                      <td className="p-1.5">
                        {c.nome}
                        <span className="block text-[10px] text-gray-400">{c.papelNome}</span>
                      </td>
                      <td className="p-1.5">
                        {c.etapa}
                        {!c.etapaAoVivo && <span className="block text-[10px] text-amber-700">cópia do banco</span>}
                      </td>
                      <td className="p-1.5">{c.seguradora ?? "—"}</td>
                      <td className="p-1.5">{c.imobiliaria ?? "—"}</td>
                      <td className="p-1.5">{c.endereco ?? "—"}</td>
                      <td className="p-1.5 text-right tabular-nums">{brl(c.premio)}</td>
                      <td className="p-1.5 text-right tabular-nums">{brl(c.comissao)}</td>
                      <td className="p-1.5 text-right tabular-nums">{brl(c.repasse)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-[10px] text-gray-400">
                Etapa lida no Bitrix em {hora(cards[0].atualizadoEm)}. Valores: efetivado quando o card já virou proposta; previsto nos demais; “—” quando o card não guarda o valor. O repasse só existe por card em Ramos Elementares.
              </p>
            </div>
          )}
          <p className="mt-1 text-[10px] text-gray-400">Lista com nome de pessoa fica só na tela (sem PDF).</p>
        </div>
      )}
    </div>
  );
}

function DetalheCard({ c }: { c: CardLista }) {
  const campos: [string, string][] = [
    ["Card", `#${c.id} (abrir no Bitrix)`],
    ["Produto", c.produtoRotulo],
    [`Nome (${c.papelNome})`, c.nome],
    ["Etapa atual no SPA", `${c.etapa}${c.etapaAoVivo ? "" : " (cópia do banco)"}`],
    ["Seguradora", c.seguradora ?? "—"],
    ["Imobiliária", c.imobiliaria ?? "—"],
    ["Endereço", c.endereco ?? "—"],
    [`Prêmio${c.valores === "previsto" ? " (previsto)" : c.valores === "efetivado" ? " (efetivado)" : ""}`, brl(c.premio)],
    ["Comissão da corretora", brl(c.comissao)],
    ["Repasse", brl(c.repasse)],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
      {campos.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[10px] uppercase tracking-wide text-gray-500">{k}</dt>
          <dd className="font-medium">
            {k === "Card" ? (
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-o2-blue underline">
                {v}
              </a>
            ) : (
              v
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function RoboDoPainel({ painelId, competencia }: { painelId: string; competencia: string }) {
  const painel = PAINEIS_ROBO[painelId];
  const supabase = useMemo(() => createClient(), []);
  const [texto, setTexto] = useState("");
  const [trocas, setTrocas] = useState<Troca[]>([]);
  const [pensando, setPensando] = useState(false);
  const [pdfs, setPdfs] = useState<Record<string, { estado: "gerando" | "pronto" | "erro"; url?: string; protocolo?: string | null }>>({});
  const [ehMatheus, setEhMatheus] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  // Regra do Matheus (04/11/2026): o Robô do painel já nasce RECOLHIDO (dropdown); abre só quando a pessoa quiser. As perguntas e respostas ficam guardadas na tela enquanto recolhido.
  const [aberto, setAberto] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => setEhMatheus(data.user?.email?.toLowerCase() === "matheus@o2seguros.com.br"));
  }, [supabase]);

  if (!painel) return null;

  async function perguntar(pergunta: string) {
    const p = pergunta.trim();
    if (!p || pensando) return;
    const id = crypto.randomUUID();
    const anteriores = trocas.filter((t) => t.resposta).slice(-4);
    setTrocas((atual) => [{ id, pergunta: p }, ...atual]);
    setTexto("");
    setAviso(null);
    setPensando(true);
    try {
      const mensagens = [
        ...anteriores.flatMap((t) => [
          { role: "user" as const, content: t.pergunta },
          { role: "assistant" as const, content: t.resposta! },
        ]),
        { role: "user" as const, content: p },
      ];
      const r = await fetch("/api/chat/robo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensagens, painel: { id: painelId, competencia } }),
      });
      const j = (await r.json().catch(() => ({}))) as { resposta?: string; pdfPermitido?: boolean; dadosPessoais?: boolean; logica?: string | null; fontes?: string[]; cards?: CardLista[] };
      if (!r.ok || !j.resposta) throw new Error("falha");
      setTrocas((atual) =>
        atual.map((t) =>
          t.id === id
            ? { ...t, resposta: j.resposta, pdfPermitido: !!j.pdfPermitido, dadosPessoais: !!j.dadosPessoais, logica: j.logica ?? null, fontes: j.fontes ?? [], cards: j.cards ?? [], conversa: [...mensagens, { role: "assistant" as const, content: j.resposta! }] }
            : t
        )
      );
    } catch {
      setTrocas((atual) => atual.map((t) => (t.id === id ? { ...t, erro: true } : t)));
    } finally {
      setPensando(false);
    }
  }

  async function gerarPdf(t: Troca) {
    setPdfs((p) => ({ ...p, [t.id]: { estado: "gerando" } }));
    try {
      const r = await fetch("/api/chat/robo/relatorio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta: t.pergunta, resposta: t.resposta, logica: t.logica, fontes: t.fontes, painel: { id: painelId, competencia }, conversa: t.conversa?.slice(0, -1) }),
      });
      const j = (await r.json().catch(() => ({}))) as { url?: string; protocolo?: string | null };
      if (!r.ok || !j.url) throw new Error("falha");
      setPdfs((p) => ({ ...p, [t.id]: { estado: "pronto", url: j.url, protocolo: j.protocolo } }));
    } catch {
      setPdfs((p) => ({ ...p, [t.id]: { estado: "erro" } }));
    }
  }

  // Só o Matheus (por enquanto): cola o protocolo e a pergunta original volta para o campo, para refazer a pesquisa (mesmo padrão ou trocando imobiliária/época).
  async function carregarProtocolo() {
    const c = codigo.trim().toUpperCase();
    if (!c) return;
    setAviso(null);
    const r = await fetch(`/api/chat/robo/protocolo?codigo=${encodeURIComponent(c)}`);
    const j = (await r.json().catch(() => ({}))) as { pergunta?: string; erro?: string; painel_id?: string; competencia?: string; email?: string };
    if (!r.ok || !j.pergunta) {
      setAviso(j.erro ?? "Não consegui abrir esse protocolo.");
      return;
    }
    setTexto(j.pergunta);
    setAviso(`Protocolo ${c}: pergunta original de ${j.email ?? "?"} (${j.painel_id ?? "painel"}, ${j.competencia ?? "mês"}) carregada no campo. Altere o que quiser (outra imobiliária, outro mês) e clique em Perguntar.`);
    entrada.current?.focus();
  }

  return (
    <section data-robo-painel data-export-ignore="true" className="print:hidden rounded-2xl border border-o2-navy/15 bg-white p-4 text-o2-navy shadow-sm" aria-label={`Pergunte ao Robô O2 sobre ${painel.nome}`}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={`robo-corpo-${painelId}`}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold"
      >
        <span>
          Robô O2 · pergunte sobre {painel.nome}
          {!aberto && trocas.length > 0 && <span className="ml-2 rounded-full bg-o2-navy/10 px-2 py-0.5 text-[11px] font-medium">{trocas.length} {trocas.length === 1 ? "pergunta" : "perguntas"}</span>}
          {!aberto && pensando && <span className="ml-2 text-[11px] font-medium text-gray-500">consultando…</span>}
        </span>
        <span aria-hidden="true">{aberto ? "▴" : "▾"}</span>
      </button>
      <div id={`robo-corpo-${painelId}`} hidden={!aberto} className="mt-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perguntar(texto);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <label htmlFor={`robo-${painelId}`} className="sr-only">
          Pergunte ao Robô O2 sobre {painel.nome}
        </label>
        <input
          id={`robo-${painelId}`}
          ref={entrada}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Ex.: resuma o mês e diga o que chama atenção"
          maxLength={500}
          className="min-w-[220px] flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm outline-none focus:border-o2-coral"
        />
        <button type="submit" disabled={pensando || !texto.trim()} className="rounded-full bg-o2-coral px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pensando ? "Consultando…" : "Perguntar"}
        </button>
      </form>

      {ehMatheus && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-gray-500">Refazer por protocolo:</span>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="RO2-20261104-ABC234" className="w-52 rounded-full border border-gray-300 px-3 py-1 text-xs outline-none focus:border-o2-coral" />
          <button type="button" onClick={() => void carregarProtocolo()} disabled={!codigo.trim()} className="rounded-full border border-o2-navy/30 px-3 py-1 font-semibold text-o2-navy disabled:opacity-50">
            Carregar
          </button>
        </div>
      )}
      {aviso && <p className="mt-1 text-xs text-gray-600">{aviso}</p>}

      {!trocas.length && (
        <div className="mt-2 flex flex-wrap gap-2">
          {painel.sugestoes.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void perguntar(s)}
              disabled={pensando}
              className="rounded-full border border-o2-navy/20 px-3 py-1 text-xs text-o2-navy hover:bg-o2-navy/5 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {trocas.length > 0 && (
        <div className="mt-3 space-y-3">
          {trocas.map((t) => (
            <div key={t.id} className="rounded-xl bg-gray-50 p-3 text-sm">
              <p className="text-xs font-semibold text-gray-500">{t.pergunta}</p>
              {t.erro ? (
                <p className="mt-1 text-red-700">O robô não conseguiu responder agora. Tente de novo.</p>
              ) : t.resposta ? (
                <>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                    <ComLinks texto={t.resposta} escuro={false} />
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
                    {t.dadosPessoais && !t.cards?.length && <span>Tem dados pessoais: fica só em texto (sem PDF).</span>}
                    {t.pdfPermitido && (
                      <>
                        {!pdfs[t.id] && (
                          <button type="button" onClick={() => void gerarPdf(t)} className="font-semibold text-o2-blue underline">
                            Gerar relatório em PDF
                          </button>
                        )}
                        {pdfs[t.id]?.estado === "gerando" && <span>Gerando o PDF…</span>}
                        {pdfs[t.id]?.estado === "pronto" && (
                          <>
                            <a href={pdfs[t.id].url} target="_blank" rel="noopener noreferrer" className="font-semibold text-o2-blue underline">
                              📄 Abrir o relatório (PDF)
                            </a>
                            {pdfs[t.id].protocolo && (
                              <span>
                                Protocolo <strong className="select-all text-o2-navy">{pdfs[t.id].protocolo}</strong>
                              </span>
                            )}
                          </>
                        )}
                        {pdfs[t.id]?.estado === "erro" && <span className="text-red-700">Não consegui gerar o PDF.</span>}
                      </>
                    )}
                    {t.fontes && t.fontes.length > 0 && <span title={t.fontes.join(" · ")}>Fontes consultadas: {t.fontes.length}</span>}
                  </div>
                </>
              ) : (
                <p className="mt-1 text-gray-500">Consultando os dados do painel…</p>
              )}
            </div>
          ))}
        </div>
      )}

      <ListaCardsSolicitados trocas={trocas} painelId={painelId} competencia={competencia} />
      </div>
    </section>
  );
}
