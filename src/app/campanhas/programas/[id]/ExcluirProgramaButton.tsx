"use client";

import { useTransition } from "react";
import { excluirPrograma } from "../actions";

export default function ExcluirProgramaButton({ programaId, nome }: { programaId: string; nome: string }) {
  const [pendente, iniciar] = useTransition();
  return (
    <button
      type="button"
      disabled={pendente}
      onClick={() => {
        if (!confirm(`Excluir o programa "${nome}"? As metas, participantes e anotações serão apagados. Os e-mails ligados continuam em Campanhas.`)) return;
        iniciar(() => excluirPrograma(programaId));
      }}
      className="text-red-700 underline disabled:opacity-50"
    >
      Excluir programa (apaga metas e participantes)
    </button>
  );
}
