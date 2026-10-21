"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

// Barra única de filtros do painel Produção: período (mês a mês, com atalhos),
// produto, seguradora e imobiliária/grupo. Tudo vai para a URL e o servidor
// recalcula TODOS os quadros com o recorte (pedido do Matheus: selecionar uma
// imobiliária deixa todos os KPIs exclusivos dela).

export type OpcaoImob = { id: string; nome: string; tipo: "grupo" | "imobiliaria"; tipo_grupo: string | null; grupo_id: string | null; premio: number; n: number };

const PRODUTOS = [
  { valor: "fianca", rotulo: "Seguro Fiança" },
  { valor: "capitalizacao", rotulo: "Capitalização" },
  { valor: "re", rotulo: "Ramos Elementares" },
  { valor: "automovel", rotulo: "Automóvel" },
];

export type Filtros = { de: string; ate: string; produtos: string[]; seguradoras: string[]; grupos: string[]; imobs: string[] };

function somarMeses(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export default function FiltrosProducao({
  filtros,
  mesAtual,
  opcoesImob,
  seguradoras,
}: {
  filtros: Filtros;
  mesAtual: string;
  opcoesImob: OpcaoImob[];
  seguradoras: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendente, iniciar] = useTransition();
  const [de, setDe] = useState(filtros.de);
  const [ate, setAte] = useState(filtros.ate);
  const [produtos, setProdutos] = useState<string[]>(filtros.produtos);
  const [segs, setSegs] = useState<string[]>(filtros.seguradoras);
  const [sel, setSel] = useState<string[]>([...filtros.grupos.map((g) => `g:${g}`), ...filtros.imobs.map((i) => `i:${i}`)]);
  const [busca, setBusca] = useState("");

  const ultimoFechado = somarMeses(mesAtual, -1);
  const anoAtual = mesAtual.slice(0, 4);
  const atalhos: { rotulo: string; de: string; ate: string }[] = [
    { rotulo: "Mês atual", de: mesAtual, ate: mesAtual },
    { rotulo: "Últimos 12 meses", de: somarMeses(ultimoFechado, -11), ate: ultimoFechado },
    { rotulo: `${anoAtual} até agora`, de: `${anoAtual}-01`, ate: mesAtual },
    { rotulo: `1º sem/${anoAtual}`, de: `${anoAtual}-01`, ate: `${anoAtual}-06` },
    { rotulo: String(Number(anoAtual) - 1), de: `${Number(anoAtual) - 1}-01`, ate: `${Number(anoAtual) - 1}-12` },
    { rotulo: "Desde 2015", de: "2015-01", ate: mesAtual },
  ];

  const porChave = useMemo(() => new Map(opcoesImob.map((o) => [`${o.tipo === "grupo" ? "g" : "i"}:${o.id}`, o])), [opcoesImob]);
  const sugestoes = useMemo(() => {
    const q = busca
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();
    if (!q) return [];
    return opcoesImob
      .filter((o) =>
        o.nome
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 12);
  }, [busca, opcoesImob]);

  function aplicar(novo?: Partial<{ de: string; ate: string; sel: string[]; produtos: string[]; segs: string[] }>) {
    const f = { de, ate, sel, produtos, segs, ...novo };
    const p = new URLSearchParams();
    let [d, a] = [f.de, f.ate];
    if (d > a) [d, a] = [a, d];
    p.set("de", d);
    p.set("ate", a);
    if (f.produtos.length) p.set("p", f.produtos.join(","));
    if (f.segs.length) p.set("s", f.segs.join(","));
    const g = f.sel.filter((k) => k.startsWith("g:")).map((k) => k.slice(2));
    const i = f.sel.filter((k) => k.startsWith("i:")).map((k) => k.slice(2));
    if (g.length) p.set("g", g.join(","));
    if (i.length) p.set("i", i.join(","));
    iniciar(() => router.push(`${pathname}?${p.toString()}`));
  }

  const alternar = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-3">
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
        <div className="flex flex-wrap gap-1">
          {atalhos.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => {
                setDe(a.de);
                setAte(a.ate);
                aplicar({ de: a.de, ate: a.ate });
              }}
              className={`rounded-full border px-3 py-1 text-xs ${
                de === a.de && ate === a.ate ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 text-gray-600 hover:border-o2-navy"
              }`}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Produto</span>
        {PRODUTOS.map((p) => (
          <button
            key={p.valor}
            type="button"
            onClick={() => setProdutos(alternar(produtos, p.valor))}
            className={`rounded-full border px-3 py-1 text-xs ${
              produtos.includes(p.valor) ? "border-o2-coral bg-o2-coral text-white" : "border-gray-300 text-gray-600 hover:border-o2-coral"
            }`}
          >
            {p.rotulo}
          </button>
        ))}
        {!produtos.length && <span className="text-xs text-gray-400">(todos)</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Seguradora</span>
        <select
          value=""
          onChange={(e) => e.target.value && setSegs(alternar(segs, e.target.value))}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-o2-navy"
        >
          <option value="">{segs.length ? "adicionar…" : "todas"}</option>
          {seguradoras
            .filter((s) => !segs.includes(s))
            .map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
        </select>
        {segs.map((s) => (
          <button key={s} type="button" onClick={() => setSegs(segs.filter((x) => x !== s))} className="rounded-full bg-o2-navy/10 px-2.5 py-0.5 text-xs text-o2-navy">
            {s} ✕
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Imobiliária / grupo</span>
          <div className="relative">
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="buscar pelo nome…"
              className="w-64 rounded-md border border-gray-300 px-2 py-1 text-xs"
            />
            {sugestoes.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-72 w-96 overflow-auto rounded-lg border border-gray-200 bg-white text-xs shadow-lg">
                {sugestoes.map((o) => {
                  const chave = `${o.tipo === "grupo" ? "g" : "i"}:${o.id}`;
                  return (
                    <li key={chave}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!sel.includes(chave)) setSel([...sel, chave]);
                          setBusca("");
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
                          {o.tipo === "imobiliaria" && o.grupo_id && (
                            <span className="ml-1 rounded-full bg-gray-100 px-1.5 text-[10px] text-gray-600">unidade</span>
                          )}
                        </span>
                        <span className="text-gray-400">{o.n.toLocaleString("pt-BR")}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {!sel.length && <span className="text-xs text-gray-400">(todas — visão macro)</span>}
          {sel.map((k) => (
            <button key={k} type="button" onClick={() => setSel(sel.filter((x) => x !== k))} className="rounded-full bg-o2-coral/10 px-2.5 py-0.5 text-xs font-medium text-o2-coral">
              {porChave.get(k)?.nome ?? "?"} ✕
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => aplicar()}
          disabled={pendente}
          className="rounded-full bg-o2-navy px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {pendente ? "Calculando…" : "Aplicar filtros"}
        </button>
        {(produtos.length > 0 || segs.length > 0 || sel.length > 0) && (
          <button
            type="button"
            onClick={() => {
              setProdutos([]);
              setSegs([]);
              setSel([]);
              aplicar({ produtos: [], segs: [], sel: [] });
            }}
            className="text-xs text-gray-500 underline"
          >
            limpar filtros
          </button>
        )}
      </div>
    </section>
  );
}
