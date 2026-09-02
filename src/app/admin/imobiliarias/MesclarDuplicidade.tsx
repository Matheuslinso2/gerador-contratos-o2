"use client";

import { useState } from "react";
import { mesclarImobiliariasAction } from "./actions";

export type ImobiliariaDuplicadaLinha = {
  id: string;
  nome: string;
  email: string | null;
  created_at: string;
  contratos: number;
  auditorias: number;
  faturasEsperadas: number;
  membros: number;
};

export default function MesclarDuplicidade({ cnpj, linhas }: { cnpj: string; linhas: ImobiliariaDuplicadaLinha[] }) {
  const [manterId, setManterId] = useState(linhas[0].id);

  return (
    <div className="space-y-3 rounded-xl border border-yellow-300 bg-yellow-50 p-4">
      <p className="text-sm font-medium text-yellow-900">
        CNPJ {cnpj} — {linhas.length} cadastros duplicados
      </p>
      <div className="space-y-2">
        {linhas.map((l) => (
          <label key={l.id} className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-white p-3 text-sm">
            <input
              type="radio"
              name={`manter-${cnpj}`}
              checked={manterId === l.id}
              onChange={() => setManterId(l.id)}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-o2-navy">{l.nome}</span> — cadastrado em{" "}
              {new Date(l.created_at).toLocaleDateString("pt-BR")}
              <br />
              login: {l.email || "sem login"} · {l.contratos} contrato(s) · {l.auditorias} auditoria(s) · {l.faturasEsperadas}{" "}
              fatura(s) esperada(s) · {l.membros} membro(s)
            </span>
          </label>
        ))}
      </div>
      <form action={mesclarImobiliariasAction}>
        <input type="hidden" name="manter_id" value={manterId} />
        {linhas
          .filter((l) => l.id !== manterId)
          .map((l) => (
            <input key={l.id} type="hidden" name="remover_id" value={l.id} />
          ))}
        <button
          type="submit"
          onClick={(e) => {
            if (
              !confirm(
                "Mesclar esses cadastros? Os dados dos outros (contratos, auditorias, faturas, membros) migram pro escolhido, e os registros extras são apagados. Não dá pra desfazer."
              )
            ) {
              e.preventDefault();
            }
          }}
          className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          Mesclar no selecionado
        </button>
      </form>
    </div>
  );
}
