"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Barra de filtros das abas do Power BI (equivalente ao painel lateral de
// filtros do PBI). Tudo vai para a URL; o servidor recalcula os quadros.
// Listas separadas por "|" (nomes do Corp podem ter vírgula).

export type CampoFiltro = { chave: string; rotulo: string; opcoes: { valor: string; rotulo: string }[] };

const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function Multi({ campo, selecionados, mudar }: { campo: CampoFiltro; selecionados: string[]; mudar: (v: string[]) => void }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const visiveis = useMemo(
    () => (busca ? campo.opcoes.filter((o) => normal(o.rotulo).includes(normal(busca))) : campo.opcoes).slice(0, 200),
    [busca, campo.opcoes]
  );
  const resumo = selecionados.length === 0 ? "Todos" : selecionados.length === 1 ? (campo.opcoes.find((o) => o.valor === selecionados[0])?.rotulo ?? selecionados[0]) : `${selecionados.length} selecionados`;
  return (
    <div className="relative">
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">{campo.rotulo}</label>
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        className={`mt-0.5 w-44 truncate rounded-lg border px-2.5 py-1.5 text-left text-sm ${selecionados.length ? "border-o2-blue bg-blue-50 text-o2-navy" : "border-gray-300 bg-white text-gray-700"}`}
      >
        {resumo}
      </button>
      {aberto && (
        <div className="absolute z-20 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
          {campo.opcoes.length > 8 && (
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar…"
              className="mb-2 w-full rounded border border-gray-300 px-2 py-1 text-sm"
            />
          )}
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {visiveis.map((o) => (
              <label key={o.valor} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={selecionados.includes(o.valor)}
                  onChange={(e) => mudar(e.target.checked ? [...selecionados, o.valor] : selecionados.filter((x) => x !== o.valor))}
                />
                <span className="truncate">{o.rotulo}</span>
              </label>
            ))}
            {!visiveis.length && <p className="px-1.5 py-1 text-sm text-gray-400">Nada encontrado.</p>}
          </div>
          <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-xs">
            <button type="button" className="text-gray-500 hover:underline" onClick={() => mudar([])}>
              Limpar
            </button>
            <button type="button" className="font-semibold text-o2-blue hover:underline" onClick={() => setAberto(false)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FiltrosCorp({
  meses,
  mes,
  campos,
  periodo,
}: {
  meses?: string[];
  mes?: string;
  campos: CampoFiltro[];
  periodo?: { de: string; ate: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pendente, iniciar] = useTransition();
  const [valores, setValores] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(campos.map((c) => [c.chave, (params.get(c.chave) ?? "").split("|").filter(Boolean)]))
  );

  function ir(troca: Record<string, string | null>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(troca)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    iniciar(() => router.push(`${pathname}?${q.toString()}`, { scroll: false }));
  }

  function mudar(chave: string, v: string[]) {
    setValores((atual) => ({ ...atual, [chave]: v }));
  }

  const algumFiltro = Object.values(valores).some((v) => v.length);
  const rotulo = (m: string) => {
    const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return `${nomes[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
  };

  return (
    <div className={`flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3 ${pendente ? "opacity-60" : ""}`}>
      {meses && mes && (
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Referência</label>
          <select value={mes} onChange={(e) => ir({ mes: e.target.value })} className="mt-0.5 rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
            {[...meses].reverse().map((m) => (
              <option key={m} value={m}>
                {rotulo(m)}
              </option>
            ))}
          </select>
        </div>
      )}
      {periodo && meses && (
        <>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">De</label>
            <select value={periodo.de} onChange={(e) => ir({ de: e.target.value })} className="mt-0.5 rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
              {meses.map((m) => (
                <option key={m} value={m}>
                  {rotulo(m)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Até</label>
            <select value={periodo.ate} onChange={(e) => ir({ ate: e.target.value })} className="mt-0.5 rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
              {meses.map((m) => (
                <option key={m} value={m}>
                  {rotulo(m)}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      {campos.map((c) => (
        <Multi key={c.chave} campo={c} selecionados={valores[c.chave] ?? []} mudar={(v) => mudar(c.chave, v)} />
      ))}
      {campos.length > 0 && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => ir(Object.fromEntries(campos.map((c) => [c.chave, (valores[c.chave] ?? []).join("|") || null])))}
            className="rounded-lg bg-o2-navy px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Aplicar
          </button>
          {algumFiltro && (
            <button
              type="button"
              onClick={() => {
                setValores(Object.fromEntries(campos.map((c) => [c.chave, []])));
                ir(Object.fromEntries(campos.map((c) => [c.chave, null])));
              }}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}
    </div>
  );
}
