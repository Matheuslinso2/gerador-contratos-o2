"use client";

import { useRef, useState } from "react";
import { ComLinks } from "./textoRobo";
import { PAINEIS_ROBO } from "@/lib/chat/paineis";

// Campo do Robô O2 DENTRO de cada painel (pedido do Matheus, 04/11/2026): não é outro chat, é uma caixa de
// pergunta no próprio painel. A pergunta vai para o mesmo robô do chat da equipe (mesmas ferramentas e mesmos
// níveis de acesso), mas com o foco neste painel e neste mês. Somente leitura.

type Troca = {
  id: string;
  pergunta: string;
  resposta?: string;
  erro?: boolean;
  pdfPermitido?: boolean;
  dadosPessoais?: boolean;
  logica?: string | null;
  fontes?: string[];
};

export default function RoboDoPainel({ painelId, competencia }: { painelId: string; competencia: string }) {
  const painel = PAINEIS_ROBO[painelId];
  const [texto, setTexto] = useState("");
  const [trocas, setTrocas] = useState<Troca[]>([]);
  const [pensando, setPensando] = useState(false);
  const [pdfs, setPdfs] = useState<Record<string, { estado: "gerando" | "pronto" | "erro"; url?: string }>>({});
  const entrada = useRef<HTMLInputElement>(null);
  if (!painel) return null;

  async function perguntar(pergunta: string) {
    const p = pergunta.trim();
    if (!p || pensando) return;
    const id = crypto.randomUUID();
    const anteriores = trocas.filter((t) => t.resposta).slice(-4);
    setTrocas((atual) => [{ id, pergunta: p }, ...atual]);
    setTexto("");
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
      const j = (await r.json().catch(() => ({}))) as { resposta?: string; pdfPermitido?: boolean; dadosPessoais?: boolean; logica?: string | null; fontes?: string[] };
      if (!r.ok || !j.resposta) throw new Error("falha");
      setTrocas((atual) =>
        atual.map((t) => (t.id === id ? { ...t, resposta: j.resposta, pdfPermitido: !!j.pdfPermitido, dadosPessoais: !!j.dadosPessoais, logica: j.logica ?? null, fontes: j.fontes ?? [] } : t))
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
        body: JSON.stringify({ pergunta: t.pergunta, resposta: t.resposta, logica: t.logica, fontes: t.fontes }),
      });
      const j = (await r.json().catch(() => ({}))) as { url?: string };
      if (!r.ok || !j.url) throw new Error("falha");
      setPdfs((p) => ({ ...p, [t.id]: { estado: "pronto", url: j.url } }));
    } catch {
      setPdfs((p) => ({ ...p, [t.id]: { estado: "erro" } }));
    }
  }

  return (
    <section data-robo-painel data-export-ignore="true" className="print:hidden rounded-2xl border border-o2-navy/15 bg-white p-4 text-o2-navy shadow-sm" aria-label={`Pergunte ao Robô O2 sobre ${painel.nome}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void perguntar(texto);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <label htmlFor={`robo-${painelId}`} className="text-sm font-semibold">
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
                    {t.dadosPessoais && <span>Tem dados pessoais: fica só em texto (sem PDF).</span>}
                    {t.pdfPermitido && (
                      <>
                        {!pdfs[t.id] && (
                          <button type="button" onClick={() => void gerarPdf(t)} className="font-semibold text-o2-blue underline">
                            Gerar relatório em PDF
                          </button>
                        )}
                        {pdfs[t.id]?.estado === "gerando" && <span>Gerando o PDF…</span>}
                        {pdfs[t.id]?.estado === "pronto" && (
                          <a href={pdfs[t.id].url} target="_blank" rel="noopener noreferrer" className="font-semibold text-o2-blue underline">
                            📄 Abrir o relatório (PDF)
                          </a>
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
    </section>
  );
}
