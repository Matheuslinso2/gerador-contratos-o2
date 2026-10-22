"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adicionarParticipante } from "../actions";

type Opcao = { id: string; nome: string; detalhe?: string };

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

// Participante vem sempre do cadastro único: uma imobiliária (unidade) ou um
// grupo/rede inteiro. Cada clique grava na hora.
export default function AdicionarParticipante({
  programaId,
  imobiliarias,
  grupos,
  incluidas,
}: {
  programaId: string;
  imobiliarias: Opcao[];
  grupos: Opcao[];
  incluidas: string[];
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, setPendente] = useState(false);
  const jaTem = useMemo(() => new Set(incluidas), [incluidas]);

  const termo = normalizar(busca);
  const resultados = termo.length < 2 ? [] : imobiliarias.filter((i) => normalizar(`${i.nome} ${i.detalhe ?? ""}`).includes(termo)).slice(0, 8);
  const gruposFiltrados = termo.length < 2 ? grupos : grupos.filter((g) => normalizar(g.nome).includes(termo));

  function adicionar(tipo: "imobiliaria" | "grupo", id: string) {
    setErro(null);
    setPendente(true);
    adicionarParticipante(programaId, tipo, id)
      .then(() => router.refresh())
      .catch((e) => setErro(e instanceof Error ? e.message : "Não consegui adicionar."))
      .finally(() => setPendente(false));
  }

  return (
    <div className="space-y-3">
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar imobiliária ou grupo pelo nome (mínimo 2 letras)"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
      />
      {erro && <p className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-700">{erro}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-semibold text-gray-600">Imobiliárias (unidade)</p>
          {termo.length < 2 ? (
            <p className="text-xs text-gray-500">Digite para buscar no cadastro.</p>
          ) : resultados.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhuma imobiliária com esse nome.</p>
          ) : (
            <ul className="space-y-1">
              {resultados.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-sm">
                  <span className="text-o2-navy">
                    {i.nome}
                    {i.detalhe && <span className="ml-1 text-xs text-gray-500">{i.detalhe}</span>}
                  </span>
                  {jaTem.has(i.id) ? (
                    <span className="text-xs text-gray-500">já incluída</span>
                  ) : (
                    <button type="button" disabled={pendente} onClick={() => adicionar("imobiliaria", i.id)} className="rounded-full bg-o2-navy px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                      Adicionar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-gray-600">Grupos e redes (todas as unidades juntas)</p>
          {gruposFiltrados.length === 0 ? (
            <p className="text-xs text-gray-500">Nenhum grupo com esse nome.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {gruposFiltrados.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-1.5 text-sm">
                  <span className="text-o2-navy">
                    {g.nome}
                    {g.detalhe && <span className="ml-1 text-xs text-gray-500">{g.detalhe}</span>}
                  </span>
                  {jaTem.has(g.id) ? (
                    <span className="text-xs text-gray-500">já incluído</span>
                  ) : (
                    <button type="button" disabled={pendente} onClick={() => adicionar("grupo", g.id)} className="rounded-full bg-o2-navy px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
                      Adicionar
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
