"use client";

import { useMemo, useState } from "react";
import { apenasDigitos } from "@/lib/pdfComSenha";
import { GRUPOS_VISUAIS } from "@/lib/gruposVisuaisImobiliarias";
import ImobiliariaCard, { type ImobiliariaAdminRow } from "./ImobiliariaCard";

function normalizar(valor: string | null | undefined): string {
  return (valor ?? "").toLowerCase();
}

export default function ListaImobiliarias({ imobiliarias }: { imobiliarias: ImobiliariaAdminRow[] }) {
  const [busca, setBusca] = useState("");

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return imobiliarias;
    const termoDigitos = apenasDigitos(termo);

    return imobiliarias.filter((i) => {
      if (normalizar(i.nome).includes(termo)) return true;
      if (normalizar(i.email).includes(termo)) return true;
      if (normalizar(i.creci).includes(termo)) return true;
      // Busca por CNPJ/telefone funciona digitando só números, com ou sem
      // máscara -- compara dígito a dígito em vez do texto formatado.
      if (termoDigitos && apenasDigitos(i.cnpj ?? "").includes(termoDigitos)) return true;
      if (termoDigitos && apenasDigitos(i.telefone ?? "").includes(termoDigitos)) return true;
      return false;
    });
  }, [imobiliarias, busca]);

  // Alguns CNPJs distintos são a mesma empresa/grupo econômico (GRUPOS_
  // VISUAIS, mesma fonte usada em Faturas) -- cada um continua sendo um
  // cadastro PRÓPRIO e completo (nada é fundido), só a listagem agrupa
  // pra não parecer duplicidade ao escanear ~170 contas. Preserva a ordem
  // original (created_at desc) tomando a posição da 1ª ocorrência de cada
  // grupo/cadastro solo.
  type Item = { chave: string; nomeGrupo: string | null; membros: ImobiliariaAdminRow[] };
  const itens = useMemo(() => {
    const porChave = new Map<string, Item>();
    const ordem: Item[] = [];
    for (const i of filtradas) {
      const grupo = GRUPOS_VISUAIS[apenasDigitos(i.cnpj ?? "")];
      const chave = grupo ? `grupo:${grupo.chave}` : `solo:${i.id}`;
      let item = porChave.get(chave);
      if (!item) {
        item = { chave, nomeGrupo: grupo?.nomeGrupo ?? null, membros: [] };
        porChave.set(chave, item);
        ordem.push(item);
      }
      item.membros.push(i);
    }
    return ordem;
  }, [filtradas]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, CNPJ, e-mail, CRECI ou telefone..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-o2-coral focus:outline-none"
        />
      </div>

      {busca && (
        <p className="text-xs text-gray-500">
          {filtradas.length} de {imobiliarias.length} cadastro(s)
        </p>
      )}

      {itens.map((item) =>
        item.membros.length > 1 ? (
          <details key={item.chave} className="group/grupo rounded-xl border border-o2-navy/10 bg-white open:pb-1" open>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-semibold text-o2-navy">
                {item.nomeGrupo} <span className="font-normal text-gray-400">· {item.membros.length} CNPJs</span>
              </span>
              <span className="text-xs text-gray-400 transition group-open/grupo:rotate-180">▾</span>
            </summary>
            <div className="space-y-2 px-3 pb-3">
              {item.membros.map((i) => (
                <ImobiliariaCard key={i.id} imobiliaria={i} />
              ))}
            </div>
          </details>
        ) : (
          <ImobiliariaCard key={item.membros[0].id} imobiliaria={item.membros[0]} />
        )
      )}
      {filtradas.length === 0 && (
        <p className="text-sm text-gray-500">
          {imobiliarias.length === 0 ? "Nenhuma imobiliária cadastrada ainda." : "Nenhum cadastro encontrado pra essa busca."}
        </p>
      )}
    </div>
  );
}
