"use client";

import { useState } from "react";
import { ConfirmarDisparoButton } from "./ConfirmarDisparoButton";
import { reenviarCampanha } from "./actions";

// Pedido do Matheus, 02/10/2026: reenviar uma campanha já concluída. O
// disparo vira uma campanha nova (ver reenviarCampanha) -- métricas de
// abertura/clique do reenvio ficam separadas das do disparo original.
export function ReenviarCampanha({
  campanhaId,
  totalTodos,
  totalNaoAbriram,
  validadeExpirada,
}: {
  campanhaId: string;
  totalTodos: number;
  totalNaoAbriram: number;
  validadeExpirada: boolean;
}) {
  const [publico, setPublico] = useState<"todos" | "nao_abriram">("todos");
  const total = publico === "todos" ? totalTodos : totalNaoAbriram;

  return (
    <form action={reenviarCampanha} className="space-y-2 rounded-xl border border-o2-navy/10 bg-quadro p-4">
      <input type="hidden" name="campanha_id" value={campanhaId} />
      <p className="text-sm font-semibold text-o2-navy">Reenviar esta campanha</p>
      <p className="text-xs text-gray-500">
        Manda o mesmo e-mail de novo e cria uma campanha nova (com métricas próprias), sem mexer nesta.
      </p>
      {validadeExpirada && (
        <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-2 text-xs text-yellow-800">
          Atenção: o período de validade dessa campanha já passou.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-0.5 block text-xs text-gray-500">Pra quem</label>
          <select
            name="publico"
            value={publico}
            onChange={(e) => setPublico(e.target.value as "todos" | "nao_abriram")}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
          >
            <option value="todos">Todos que receberam ({totalTodos})</option>
            <option value="nao_abriram">Só quem não abriu ({totalNaoAbriram})</option>
          </select>
        </div>
        <ConfirmarDisparoButton
          className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90"
          textoCarregando="Reenviando..."
          mensagemConfirmacao={`Reenviar pra ${total} e-mail(s)?${validadeExpirada ? " O período de validade da campanha já passou." : ""} Não dá pra desfazer depois de iniciado.`}
        >
          Reenviar campanha
        </ConfirmarDisparoButton>
      </div>
      {publico === "nao_abriram" && (
        <p className="text-xs text-gray-400">
          Abertura é medida por imagem do e-mail — quem bloqueia imagens pode ter lido e aparecer como &quot;não abriu&quot;.
        </p>
      )}
    </form>
  );
}
