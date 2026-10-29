"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type Colega = { email: string; nome: string | null };
type Mensagem = { id: string; conversa_id: string; autor_email: string; texto: string; criado_em: string };
type Part = { conversa_id: string; email: string; lido_ate: string };

// O Robô O2 aparece como mais um contato; a conversa com ele fica só na tela (não grava no banco).
const ROBO: Colega = { email: "robo@o2.interno", nome: "Robô O2" };

function nomeDe(c: { email: string; nome?: string | null }) {
  if (c.nome) return c.nome;
  const l = c.email.split("@")[0].replace(/[._]/g, " ");
  return l.replace(/\b\w/g, (m) => m.toUpperCase());
}

export default function ChatFlutuante({ meuEmail }: { meuEmail: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [aberto, setAberto] = useState(false);
  const [colegas, setColegas] = useState<Colega[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [naoLidas, setNaoLidas] = useState<Record<string, number>>({}); // por e-mail do colega
  const [ativo, setAtivo] = useState<Colega | null>(null);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [roboMsgs, setRoboMsgs] = useState<Mensagem[]>([]);
  const [roboPensando, setRoboPensando] = useState(false);
  const colegaPorConversa = useRef<Record<string, string>>({});
  const conversaAbertaRef = useRef<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    conversaAbertaRef.current = conversaId;
  }, [conversaId]);

  const marcarLido = useCallback(
    async (cid: string, ate: string) => {
      await supabase
        .from("chat_participantes")
        .update({ lido_ate: ate })
        .eq("conversa_id", cid)
        .eq("email", meuEmail);
    },
    [supabase, meuEmail],
  );

  // Colegas, conversas existentes e contagem de não lidas.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data: eq }, { data: parts }] = await Promise.all([
        supabase.rpc("chat_equipe"),
        supabase.from("chat_participantes").select("conversa_id,email,lido_ate"),
      ]);
      if (!vivo) return;
      setColegas((eq as Colega[]) ?? []);
      const todas = (parts as Part[]) ?? [];
      const minhas = todas.filter((p) => p.email.toLowerCase() === meuEmail);
      for (const m of minhas) {
        const outro = todas.find((p) => p.conversa_id === m.conversa_id && p.email.toLowerCase() !== meuEmail);
        if (outro) colegaPorConversa.current[m.conversa_id] = outro.email.toLowerCase();
      }
      if (minhas.length) {
        const menor = minhas.map((m) => m.lido_ate).sort()[0];
        const { data: novas } = await supabase
          .from("chat_mensagens")
          .select("conversa_id,criado_em")
          .neq("autor_email", meuEmail)
          .gt("criado_em", menor)
          .limit(500);
        if (!vivo) return;
        const cont: Record<string, number> = {};
        for (const n of (novas as Pick<Mensagem, "conversa_id" | "criado_em">[]) ?? []) {
          const lido = minhas.find((m) => m.conversa_id === n.conversa_id)?.lido_ate;
          const quem = colegaPorConversa.current[n.conversa_id];
          if (lido && quem && n.criado_em > lido) cont[quem] = (cont[quem] ?? 0) + 1;
        }
        setNaoLidas(cont);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [supabase, meuEmail]);

  // Quem está online (Presence) e mensagens novas (Realtime).
  useEffect(() => {
    const canal = supabase.channel("chat-equipe", { config: { presence: { key: meuEmail } } });
    canal.on("presence", { event: "sync" }, () => {
      setOnline(new Set(Object.keys(canal.presenceState()).map((k) => k.toLowerCase())));
    });
    canal.on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_mensagens" }, (p) => {
      const m = p.new as Mensagem;
      const minha = m.autor_email.toLowerCase() === meuEmail;
      if (m.conversa_id === conversaAbertaRef.current) {
        setMensagens((atual) => (atual.some((x) => x.id === m.id) ? atual : [...atual, m]));
        if (!minha) void marcarLido(m.conversa_id, m.criado_em);
      } else if (!minha) {
        const quem = colegaPorConversa.current[m.conversa_id] ?? m.autor_email.toLowerCase();
        colegaPorConversa.current[m.conversa_id] = quem;
        setNaoLidas((n) => ({ ...n, [quem]: (n[quem] ?? 0) + 1 }));
      }
    });
    canal.subscribe(async (status) => {
      if (status === "SUBSCRIBED") await canal.track({ em: new Date().toISOString() });
    });
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [supabase, meuEmail, marcarLido]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens, roboMsgs, roboPensando, ativo]);

  const ehRobo = ativo?.email === ROBO.email;

  async function perguntarAoRobo(t: string) {
    const nova: Mensagem = { id: crypto.randomUUID(), conversa_id: "robo", autor_email: meuEmail, texto: t, criado_em: new Date().toISOString() };
    const historico = [...roboMsgs, nova];
    setRoboMsgs(historico);
    setRoboPensando(true);
    setErro(null);
    try {
      const r = await fetch("/api/chat/robo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mensagens: historico.map((m) => ({ role: m.autor_email === ROBO.email ? "assistant" : "user", content: m.texto })),
        }),
      });
      const j = (await r.json().catch(() => ({}))) as { resposta?: string };
      if (!r.ok || !j.resposta) throw new Error("falha");
      setRoboMsgs((atual) => [
        ...atual,
        { id: crypto.randomUUID(), conversa_id: "robo", autor_email: ROBO.email, texto: j.resposta!, criado_em: new Date().toISOString() },
      ]);
    } catch {
      setErro("O robô não conseguiu responder agora. Tente de novo.");
    } finally {
      setRoboPensando(false);
    }
  }

  async function abrirConversa(c: Colega) {
    setErro(null);
    setAtivo(c);
    if (c.email === ROBO.email) {
      setConversaId(null);
      return;
    }
    setMensagens([]);
    setConversaId(null);
    const { data: cid, error } = await supabase.rpc("chat_abrir_conversa", { p_outro: c.email });
    if (error || !cid) {
      setErro("Não consegui abrir a conversa. Tente de novo.");
      return;
    }
    const id = cid as string;
    colegaPorConversa.current[id] = c.email.toLowerCase();
    setConversaId(id);
    const { data } = await supabase
      .from("chat_mensagens")
      .select("id,conversa_id,autor_email,texto,criado_em")
      .eq("conversa_id", id)
      .order("criado_em", { ascending: false })
      .limit(100);
    const lista = ((data as Mensagem[]) ?? []).reverse();
    setMensagens((atual) => {
      const ids = new Set(lista.map((x) => x.id));
      return [...lista, ...atual.filter((x) => !ids.has(x.id))];
    });
    setNaoLidas((n) => ({ ...n, [c.email.toLowerCase()]: 0 }));
    const ultima = lista[lista.length - 1]?.criado_em;
    if (ultima) void marcarLido(id, ultima);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    if (ehRobo) {
      if (roboPensando) return;
      setTexto("");
      void perguntarAoRobo(t);
      return;
    }
    if (!conversaId) return;
    setTexto("");
    const { error } = await supabase
      .from("chat_mensagens")
      .insert({ conversa_id: conversaId, autor_email: meuEmail, texto: t });
    if (error) {
      setTexto(t);
      setErro("Mensagem não enviada. Tente de novo.");
    } else setErro(null);
  }

  const totalNaoLidas = Object.values(naoLidas).reduce((a, b) => a + b, 0);
  const ordenados = [...colegas].sort((a, b) => {
    const oa = online.has(a.email.toLowerCase()) ? 0 : 1;
    const ob = online.has(b.email.toLowerCase()) ? 0 : 1;
    return oa - ob || nomeDe(a).localeCompare(nomeDe(b), "pt-BR");
  });

  return (
    <div className="print:hidden">
      {aberto && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[28rem] w-[22rem] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl">
          <div className="flex items-center justify-between bg-o2-navy px-4 py-3 text-white">
            {ativo ? (
              <button
                type="button"
                onClick={() => {
                  setAtivo(null);
                  setConversaId(null);
                }}
                className="text-sm hover:underline"
              >
                ← {nomeDe(ativo)}
                <span
                  className={`ml-2 inline-block h-2 w-2 rounded-full ${ehRobo || online.has(ativo.email.toLowerCase()) ? "bg-green-400" : "bg-white/30"}`}
                />
              </button>
            ) : (
              <p className="text-sm font-semibold">Chat da equipe</p>
            )}
            <button
              type="button"
              onClick={() => setAberto(false)}
              aria-label="Fechar chat"
              className="text-lg leading-none text-white/70 hover:text-white"
            >
              ×
            </button>
          </div>

          {!ativo ? (
            <ul className="flex-1 overflow-y-auto">
              <li>
                <button
                  type="button"
                  onClick={() => void abrirConversa(ROBO)}
                  className="flex w-full items-center gap-3 border-b border-black/5 bg-o2-coral/5 px-4 py-2.5 text-left hover:bg-o2-coral/10"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-o2-coral text-xs text-white">✦</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-o2-navy">Robô O2</span>
                    <span className="block text-xs text-o2-cinza-medio">pergunte sobre apólices, imobiliárias, faturas…</span>
                  </span>
                </button>
              </li>
              {ordenados.length === 0 && <li className="p-4 text-sm text-o2-cinza-medio">Nenhum colega encontrado.</li>}
              {ordenados.map((c) => {
                const on = online.has(c.email.toLowerCase());
                const n = naoLidas[c.email.toLowerCase()] ?? 0;
                return (
                  <li key={c.email}>
                    <button
                      type="button"
                      onClick={() => void abrirConversa(c)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-o2-gray/60"
                    >
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${on ? "bg-green-500" : "bg-gray-300"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-o2-navy">{nomeDe(c)}</span>
                        <span className="block text-xs text-o2-cinza-medio">{on ? "online" : "offline"}</span>
                      </span>
                      {n > 0 && (
                        <span className="rounded-full bg-o2-coral px-2 py-0.5 text-xs font-semibold text-white">{n}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <>
              <div className="flex-1 space-y-2 overflow-y-auto bg-o2-gray/40 p-3">
                {ehRobo && roboMsgs.length === 0 && (
                  <p className="rounded-xl bg-white p-3 text-xs text-o2-cinza-escuro">
                    Pergunte em português, por exemplo: “quantas apólices vigentes a Ramiro Sá tem?”. Eu só consulto o que está no Workspace e no ERP e não altero nada.
                  </p>
                )}
                {(ehRobo ? roboMsgs : mensagens).map((m) => {
                  const minha = m.autor_email.toLowerCase() === meuEmail;
                  return (
                    <div key={m.id} className={`flex ${minha ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${minha ? "bg-o2-blue text-white" : "bg-white text-o2-navy"}`}
                      >
                        {m.texto}
                        <span className={`mt-0.5 block text-right text-[10px] ${minha ? "text-white/60" : "text-o2-cinza-medio"}`}>
                          {new Date(m.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                  );
                })}
                {ehRobo && roboPensando && <p className="text-xs text-o2-cinza-medio">Robô O2 está consultando…</p>}
                <div ref={fimRef} />
              </div>
              {erro && <p className="px-3 py-1 text-xs text-red-600">{erro}</p>}
              <form onSubmit={enviar} className="flex gap-2 border-t border-black/10 p-2">
                <input
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  maxLength={4000}
                  placeholder="Escreva uma mensagem…"
                  className="min-w-0 flex-1 rounded-full border border-black/15 px-3 py-2 text-sm outline-none focus:border-o2-blue"
                />
                <button
                  type="submit"
                  disabled={(ehRobo ? roboPensando : !conversaId) || !texto.trim()}
                  className="rounded-full bg-o2-coral px-4 text-sm font-medium text-white disabled:opacity-40"
                >
                  Enviar
                </button>
              </form>
            </>
          )}
          {erro && !ativo && <p className="px-3 py-1 text-xs text-red-600">{erro}</p>}
        </div>
      )}

      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-label="Abrir chat da equipe"
        className="fixed bottom-5 right-24 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-o2-navy text-white shadow-lg transition hover:scale-105"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-7 w-7">
          <path
            d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H10l-4 4v-4H5.5A1.5 1.5 0 014 14.5v-9z"
            strokeLinejoin="round"
          />
        </svg>
        {totalNaoLidas > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-o2-coral px-1.5 text-center text-xs font-semibold leading-5 text-white">
            {totalNaoLidas}
          </span>
        )}
      </button>
    </div>
  );
}
