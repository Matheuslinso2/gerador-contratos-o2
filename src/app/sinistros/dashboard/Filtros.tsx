"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Barra de filtros do dashboard (planejamento v2, seção 3): uma linha só,
// vale para a tela inteira, fica na URL. Imobiliária/grupo recorta TODOS os
// números (pedido do Matheus, 19/10/2026).
export type OpcaoGrupo = { chave: string; nome: string; tipo: "grupo" | "imobiliaria" | "sem_vinculo" };
export type Atalho = { chave: string; rotulo: string };

const TIPOS = [
  { valor: "ocupado", rotulo: "Imóvel ocupado" },
  { valor: "chaves", rotulo: "Entrega de chaves" },
  { valor: "nao_informado", rotulo: "Não informado" },
];
const SITUACOES = [
  { valor: "em_aberto", rotulo: "Em aberto" },
  { valor: "indenizado", rotulo: "Indenizado" },
  { valor: "sem_indenizacao", rotulo: "Encerrado sem indenização" },
];

const campo = "w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm focus:border-o2-coral focus:outline-none";
const rotulo = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500";

export default function Filtros({
  atalhos,
  periodoAtual,
  seguradoras,
  grupos,
}: {
  atalhos: Atalho[];
  periodoAtual: { chave: string; inicio: string; fim: string; rotulo: string };
  seguradoras: string[];
  grupos: OpcaoGrupo[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pendente, iniciar] = useTransition();
  const [personalizado, setPersonalizado] = useState(periodoAtual.chave === "personalizado");
  const [de, setDe] = useState(periodoAtual.inicio.slice(0, 7));
  const [ate, setAte] = useState(periodoAtual.fim.slice(0, 7));
  const [busca, setBusca] = useState("");
  const [abertoImob, setAbertoImob] = useState(false);
  const caixaImob = useRef<HTMLDivElement>(null);

  const segSel = params.getAll("seg");
  const imobSel = params.get("imob");
  const tipoSel = params.get("tipo") ?? "";
  const sitSel = params.get("sit") ?? "";
  const grupoSel = grupos.find((g) => g.chave === imobSel);

  function aplicar(mudar: (q: URLSearchParams) => void) {
    const q = new URLSearchParams(params.toString());
    q.delete("atualizar");
    mudar(q);
    iniciar(() => router.push(`${pathname}?${q.toString()}`));
  }

  const sugestoes = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const base = t ? grupos.filter((g) => g.nome.toLowerCase().includes(t)) : grupos;
    // Grupos primeiro, depois imobiliárias confirmadas, depois sem vínculo.
    const ordem = { grupo: 0, imobiliaria: 1, sem_vinculo: 2 };
    return [...base].sort((a, b) => ordem[a.tipo] - ordem[b.tipo] || a.nome.localeCompare(b.nome)).slice(0, 40);
  }, [busca, grupos]);

  const ativos: { rotulo: string; limpar: (q: URLSearchParams) => void }[] = [];
  if (grupoSel) ativos.push({ rotulo: `${grupoSel.tipo === "grupo" ? "Grupo" : "Imobiliária"}: ${grupoSel.nome}`, limpar: (q) => q.delete("imob") });
  for (const s of segSel) ativos.push({ rotulo: `Seguradora: ${s}`, limpar: (q) => { const resto = q.getAll("seg").filter((x) => x !== s); q.delete("seg"); resto.forEach((x) => q.append("seg", x)); } });
  if (tipoSel) ativos.push({ rotulo: `Tipo: ${TIPOS.find((t) => t.valor === tipoSel)?.rotulo ?? tipoSel}`, limpar: (q) => q.delete("tipo") });
  if (sitSel) ativos.push({ rotulo: `Situação: ${SITUACOES.find((s) => s.valor === sitSel)?.rotulo ?? sitSel}`, limpar: (q) => q.delete("sit") });

  return (
    <div className={`space-y-2 rounded-xl border border-gray-200 bg-white p-3 ${pendente ? "opacity-70" : ""}`}>
      <div className="grid gap-2 md:grid-cols-[1.3fr_0.8fr_1fr_1.5fr_0.9fr_0.9fr]">
        <div>
          <label className={rotulo}>Período</label>
          <select
            className={campo}
            value={personalizado ? "personalizado" : periodoAtual.chave}
            onChange={(e) => {
              if (e.target.value === "personalizado") return setPersonalizado(true);
              setPersonalizado(false);
              aplicar((q) => { q.set("periodo", e.target.value); q.delete("de"); q.delete("ate"); });
            }}
          >
            {atalhos.map((a) => (
              <option key={a.chave} value={a.chave}>{a.rotulo}</option>
            ))}
            <option value="personalizado">Personalizado (de/até)…</option>
          </select>
        </div>
        <div>
          <label className={rotulo}>Produto</label>
          <select className={campo} value="fianca" onChange={() => {}}>
            <option value="fianca">Seguro Fiança</option>
            <option disabled>Capitalização (em breve)</option>
            <option disabled>Seguro Incêndio / RE (em breve)</option>
            <option disabled>Automóvel (em breve)</option>
          </select>
        </div>
        <div>
          <label className={rotulo}>Seguradora</label>
          <details className="relative">
            <summary className={`${campo} cursor-pointer list-none truncate`}>{segSel.length ? `${segSel.length} selecionada(s)` : "Todas"}</summary>
            <div className="absolute z-20 mt-1 max-h-64 w-64 overflow-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
              {seguradoras.map((s) => (
                <label key={s} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-gray-50">
                  <input
                    type="checkbox"
                    className="accent-o2-coral"
                    checked={segSel.includes(s)}
                    onChange={(e) =>
                      aplicar((q) => {
                        const atuais = new Set(q.getAll("seg"));
                        if (e.target.checked) atuais.add(s);
                        else atuais.delete(s);
                        q.delete("seg");
                        atuais.forEach((x) => q.append("seg", x));
                      })
                    }
                  />
                  {s}
                </label>
              ))}
            </div>
          </details>
        </div>
        <div ref={caixaImob} className="relative">
          <label className={rotulo}>Imobiliária / grupo</label>
          <input
            className={campo}
            placeholder={grupoSel ? grupoSel.nome : "🔍 Todas — digite para buscar"}
            value={busca}
            onFocus={() => setAbertoImob(true)}
            onBlur={() => setTimeout(() => setAbertoImob(false), 150)}
            onChange={(e) => { setBusca(e.target.value); setAbertoImob(true); }}
          />
          {abertoImob && (
            <ul className="absolute z-20 mt-1 max-h-72 w-full min-w-72 overflow-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {sugestoes.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">Nada encontrado.</li>}
              {sugestoes.map((g) => (
                <li key={g.chave}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setBusca(""); setAbertoImob(false); aplicar((q) => q.set("imob", g.chave)); }}
                  >
                    <span className="truncate">{g.nome}</span>
                    {g.tipo === "grupo" && <span className="rounded-full bg-blue-100 px-2 text-[10px] font-semibold text-blue-800">grupo</span>}
                    {g.tipo === "sem_vinculo" && <span className="rounded-full bg-gray-200 px-2 text-[10px] font-semibold text-gray-600">sem vínculo</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <label className={rotulo}>Tipo</label>
          <select className={campo} value={tipoSel} onChange={(e) => aplicar((q) => (e.target.value ? q.set("tipo", e.target.value) : q.delete("tipo")))}>
            <option value="">Todos</option>
            {TIPOS.map((t) => (
              <option key={t.valor} value={t.valor}>{t.rotulo}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={rotulo}>Situação</label>
          <select className={campo} value={sitSel} onChange={(e) => aplicar((q) => (e.target.value ? q.set("sit", e.target.value) : q.delete("sit")))}>
            <option value="">Todas</option>
            {SITUACOES.map((s) => (
              <option key={s.valor} value={s.valor}>{s.rotulo}</option>
            ))}
          </select>
        </div>
      </div>

      {personalizado && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <div>
            <label className={rotulo}>De</label>
            <input type="month" min="2019-01" className={campo} value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div>
            <label className={rotulo}>Até</label>
            <input type="month" min="2019-01" className={campo} value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
          <button
            type="button"
            className="rounded-full bg-o2-navy px-4 py-2 font-semibold text-white"
            onClick={() => aplicar((q) => { q.delete("periodo"); q.set("de", de); q.set("ate", ate); })}
          >
            Aplicar
          </button>
        </div>
      )}

      {(ativos.length > 0 || pendente) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {ativos.map((a) => (
            <button key={a.rotulo} type="button" onClick={() => aplicar(a.limpar)} className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-800 hover:bg-blue-200">
              × {a.rotulo}
            </button>
          ))}
          {ativos.length > 1 && (
            <button type="button" className="text-gray-500 hover:underline" onClick={() => aplicar((q) => ["seg", "imob", "tipo", "sit"].forEach((k) => q.delete(k)))}>
              limpar filtros
            </button>
          )}
          {pendente && <span className="text-gray-500">Atualizando…</span>}
        </div>
      )}
    </div>
  );
}
