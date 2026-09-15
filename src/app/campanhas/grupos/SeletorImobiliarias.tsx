"use client";

import { useMemo, useState } from "react";

type ImobiliariaOpcao = { id: string; nome: string; cnpj: string | null };

// Filtro client-side (não recarrega a página) -- diferente da busca de
// src/app/campanhas/[id]/destinatarios/page.tsx (que é por GET), aqui
// precisa manter marcado quem já foi selecionado numa busca anterior
// enquanto o usuário troca o termo pra achar mais gente. Com ~500
// imobiliárias no total, filtrar tudo no cliente é leve e evita esse
// problema (checkbox escondido via CSS mantém o estado, diferente de
// reconstruir a lista a cada busca).
export function SeletorImobiliarias({
  imobiliarias,
  selecionadosIniciais,
}: {
  imobiliarias: ImobiliariaOpcao[];
  selecionadosIniciais: Set<string>;
}) {
  const [busca, setBusca] = useState("");

  const termo = busca.trim().toLowerCase();
  const visiveis = useMemo(() => {
    if (!termo) return imobiliarias;
    return imobiliarias.filter((i) => i.nome.toLowerCase().includes(termo) || (i.cnpj ?? "").includes(termo));
  }, [imobiliarias, termo]);

  return (
    <div className="space-y-3">
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar por nome ou CNPJ..."
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none"
      />
      <p className="text-xs text-gray-500">
        {visiveis.length} de {imobiliarias.length} imobiliária(s) na busca atual — o que estiver marcado continua marcado mesmo trocando a busca.
      </p>
      <div className="max-h-[420px] divide-y divide-gray-200 overflow-y-auto rounded-xl border border-o2-navy/10 bg-white shadow-sm">
        {imobiliarias.map((imob) => (
          <label
            key={imob.id}
            className={`flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[#e8f0fe] ${visiveis.includes(imob) ? "" : "hidden"}`}
          >
            <input type="checkbox" name="imob" value={imob.id} defaultChecked={selecionadosIniciais.has(imob.id)} />
            <span className="flex-1">
              <span className="font-medium text-o2-navy">{imob.nome}</span>
              {imob.cnpj && <span className="ml-2 text-xs text-gray-400">{imob.cnpj}</span>}
            </span>
          </label>
        ))}
        {!visiveis.length && <p className="px-4 py-8 text-center text-sm text-gray-500">Nenhuma imobiliária encontrada pra essa busca.</p>}
      </div>
    </div>
  );
}
