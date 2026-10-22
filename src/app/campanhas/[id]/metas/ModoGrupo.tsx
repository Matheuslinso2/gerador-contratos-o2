"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { definirModoGrupo } from "./actions";
import type { GrupoNaCampanha } from "@/lib/campanhas/metasCampanha";

// Para cada grupo/rede com unidade na campanha: meta do grupo todo (uma linha
// somando todas as unidades do grupo) ou meta por filial (uma linha por
// unidade). Opcional, escolhido grupo a grupo.
export default function ModoGrupo({ campanhaId, grupos }: { campanhaId: string; grupos: GrupoNaCampanha[] }) {
  const router = useRouter();
  const [pendente, setPendente] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function trocar(g: GrupoNaCampanha, modo: "grupo" | "filial") {
    if (g.modo === modo) return;
    if (modo === "filial" && !confirm(`Voltar o grupo ${g.nome} para meta por filial? A meta do grupo todo será apagada.`)) return;
    setErro(null);
    setPendente(g.grupoId);
    try {
      await definirModoGrupo(campanhaId, g.grupoId, modo);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui mudar.");
    } finally {
      setPendente(null);
    }
  }

  if (!grupos.length) return null;
  return (
    <div className="space-y-1 rounded-lg bg-gray-50 p-3" data-export-ignore="true">
      <p className="text-xs font-semibold text-gray-600">Grupos e redes na campanha — meta do grupo todo ou por filial?</p>
      {erro && <p className="text-xs text-red-700">{erro}</p>}
      <div className="flex flex-wrap gap-2">
        {grupos.map((g) => (
          <div key={g.grupoId} className="flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs">
            <span className="font-medium text-o2-navy">{g.nome}</span>
            <span className="text-gray-400">({g.unidades} na campanha)</span>
            {(["grupo", "filial"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={pendente === g.grupoId}
                onClick={() => trocar(g, m)}
                className={`rounded-full px-2 py-0.5 ${g.modo === m ? "bg-o2-navy text-white" : "text-o2-navy hover:bg-gray-100"}`}
              >
                {m === "grupo" ? "Grupo todo" : "Por filial"}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
