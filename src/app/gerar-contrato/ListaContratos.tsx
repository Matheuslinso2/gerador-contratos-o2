"use client";

import { useMemo, useState } from "react";

type Contrato = {
  id: string;
  locador: string;
  locatario: string;
  endereco_imovel: string;
  texto_gerado: string;
  laudo_modo: string | null;
  laudo_arquivo_nome: string | null;
};

export default function ListaContratos({
  contratos,
  destaque,
}: {
  contratos: Contrato[];
  destaque?: string;
}) {
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return contratos;
    return contratos.filter((c) =>
      `${c.locador} ${c.locatario} ${c.endereco_imovel}`.toLowerCase().includes(termo)
    );
  }, [contratos, busca]);

  return (
    <div className="space-y-3">
      {contratos.length > 3 && (
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por locador, locatário ou endereço..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
        />
      )}

      {filtrados.map((c) => (
        <details
          key={c.id}
          open={c.id === destaque}
          className={`rounded-xl border bg-white p-3 ${
            c.id === destaque ? "border-green-400 ring-1 ring-green-300" : "border-o2-navy/10"
          }`}
        >
          <summary className="cursor-pointer font-medium text-o2-navy">
            {c.locador} × {c.locatario} — {c.endereco_imovel}
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <a
              href={`/api/contratos/${c.id}/docx`}
              className="inline-block rounded-full bg-o2-coral px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
            >
              Baixar contrato em Word (.docx)
            </a>
            {c.laudo_modo === "arquivo_embutido" && (
              <a
                href={`/api/contratos/${c.id}/pdf`}
                className="inline-block rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-gray/40"
              >
                Baixar contrato completo com laudo (PDF)
              </a>
            )}
            {(c.laudo_modo === "arquivo_separado" || c.laudo_modo === "arquivo_embutido") && (
              <a
                href={`/api/contratos/${c.id}/laudo`}
                className="inline-block rounded-full border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Baixar laudo de vistoria (original{c.laudo_arquivo_nome ? `: ${c.laudo_arquivo_nome}` : ""})
              </a>
            )}
          </div>
          <pre className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{c.texto_gerado}</pre>
        </details>
      ))}

      {!filtrados.length && contratos.length > 0 && (
        <p className="text-sm text-gray-500">Nenhum contrato encontrado para essa busca.</p>
      )}
      {!contratos.length && <p className="text-sm text-gray-500">Nenhum contrato gerado ainda.</p>}
    </div>
  );
}
