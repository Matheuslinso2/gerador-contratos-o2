"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { OpcaoImob } from "./FiltrosProducao";

// Seletor da aba "Imobiliária 360": UMA imobiliária ou grupo + período. Vai
// tudo para a URL (?g= ou ?i=, de, ate) e o servidor monta a visão.

function somarMeses(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
const semAcento = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export default function Seletor360({
  de: deInicial,
  ate: ateInicial,
  alvo,
  mesAtual,
  opcoes,
}: {
  de: string;
  ate: string;
  alvo: string | null; // "g:<uuid>" | "i:<uuid>"
  mesAtual: string;
  opcoes: OpcaoImob[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendente, iniciar] = useTransition();
  const [de, setDe] = useState(deInicial);
  const [ate, setAte] = useState(ateInicial);
  const [busca, setBusca] = useState("");

  const anoAtual = mesAtual.slice(0, 4);
  const atalhos = [
    { rotulo: "Mês atual", de: mesAtual, ate: mesAtual },
    { rotulo: "Últimos 12 meses", de: somarMeses(mesAtual, -11), ate: mesAtual },
    { rotulo: `${anoAtual} até agora`, de: `${anoAtual}-01`, ate: mesAtual },
    { rotulo: String(Number(anoAtual) - 1), de: `${Number(anoAtual) - 1}-01`, ate: `${Number(anoAtual) - 1}-12` },
    { rotulo: "Desde 2015", de: "2015-01", ate: mesAtual },
  ];
  const sugestoes = useMemo(() => {
    const q = semAcento(busca);
    if (!q) return [];
    return opcoes.filter((o) => semAcento(o.nome).includes(q)).slice(0, 12);
  }, [busca, opcoes]);

  function ir(novo: Partial<{ de: string; ate: string; alvo: string | null }>) {
    const f = { de, ate, alvo, ...novo };
    let [d, a] = [f.de, f.ate];
    if (d > a) [d, a] = [a, d];
    const p = new URLSearchParams({ de: d, ate: a });
    if (f.alvo) p.set(f.alvo.slice(0, 1), f.alvo.slice(2));
    iniciar(() => router.push(`${pathname}?${p.toString()}`));
  }

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative">
          <label className="text-xs text-gray-500">
            Imobiliária ou grupo
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="buscar pelo nome…"
              className="mt-1 block w-80 rounded-md border border-gray-300 px-2 py-1 text-sm"
            />
          </label>
          {sugestoes.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-72 w-96 overflow-auto rounded-lg border border-gray-200 bg-white text-xs shadow-lg">
              {sugestoes.map((o) => {
                const chave = `${o.tipo === "grupo" ? "g" : "i"}:${o.id}`;
                return (
                  <li key={chave}>
                    <button
                      type="button"
                      onClick={() => {
                        setBusca("");
                        ir({ alvo: chave });
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-o2-gray/50"
                    >
                      <span>
                        {o.nome}
                        {o.tipo === "grupo" && (
                          <span className="ml-1 rounded-full bg-blue-100 px-1.5 text-[10px] font-semibold text-blue-800">
                            {o.tipo_grupo === "rede_filiais" ? "rede" : "grupo"}
                          </span>
                        )}
                        {o.tipo === "imobiliaria" && o.grupo_id && <span className="ml-1 rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-600">unidade</span>}
                      </span>
                      <span className="text-gray-400">{o.n.toLocaleString("pt-BR")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <label className="text-xs text-gray-500">
          De
          <input
            type="month"
            value={de}
            min="2015-01"
            max={mesAtual}
            onChange={(e) => setDe(e.target.value)}
            className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-sm text-o2-navy"
          />
        </label>
        <label className="text-xs text-gray-500">
          Até
          <input
            type="month"
            value={ate}
            min="2015-01"
            max={mesAtual}
            onChange={(e) => setAte(e.target.value)}
            className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-sm text-o2-navy"
          />
        </label>
        <button
          type="button"
          onClick={() => ir({})}
          disabled={pendente}
          className="rounded-full bg-o2-navy px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pendente ? "Calculando…" : "Aplicar período"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {atalhos.map((a) => (
          <button
            key={a.rotulo}
            type="button"
            onClick={() => {
              setDe(a.de);
              setAte(a.ate);
              ir({ de: a.de, ate: a.ate });
            }}
            className={`rounded-full border px-3 py-1 text-xs ${
              de === a.de && ate === a.ate ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 text-gray-600 hover:border-o2-navy"
            }`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
    </section>
  );
}
