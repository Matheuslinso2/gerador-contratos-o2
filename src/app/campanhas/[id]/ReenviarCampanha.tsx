"use client";

import { useMemo, useState } from "react";
import { ConfirmarDisparoButton } from "./ConfirmarDisparoButton";
import { reenviarCampanha } from "./actions";

type Grupo = { chave: string; rotulo: string; emails: number; abriu: boolean };

// Reenvio na mesma campanha (06/11/2026, correção do Matheus): em vez de criar uma campanha nova, o reenvio é uma nova
// rodada de envio desta campanha, e quem recebe é escolhido aqui -- uma, algumas ou todas as imobiliárias que já
// receberam (lista com busca, mesmo com 90).
export function ReenviarCampanha({ campanhaId, grupos, validadeExpirada }: { campanhaId: string; grupos: Grupo[]; validadeExpirada: boolean }) {
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return termo ? grupos.filter((g) => g.rotulo.toLowerCase().includes(termo)) : grupos;
  }, [busca, grupos]);
  const emailsEscolhidos = grupos.filter((g) => escolhidos.has(g.chave)).reduce((s, g) => s + g.emails, 0);
  const naoAbriram = grupos.filter((g) => !g.abriu).map((g) => g.chave);

  const alternar = (chave: string) =>
    setEscolhidos((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });

  return (
    <form action={reenviarCampanha} className="space-y-2 rounded-xl border border-o2-navy/10 bg-quadro p-4">
      <input type="hidden" name="campanha_id" value={campanhaId} />
      {[...escolhidos].map((chave) => (
        <input key={chave} type="hidden" name="grupo" value={chave} />
      ))}
      <p className="text-sm font-semibold text-o2-navy">Reenviar esta campanha</p>
      <p className="text-xs text-gray-500">
        Manda o mesmo e-mail de novo, na própria campanha (nova rodada de envio), só para as imobiliárias que você escolher. Nada muda no
        disparo original.
      </p>
      {validadeExpirada && (
        <p className="rounded-lg border border-yellow-300 bg-yellow-50 p-2 text-xs text-yellow-800">Atenção: o período de validade dessa campanha já passou.</p>
      )}

      <details className="rounded-lg border border-gray-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-sm text-o2-navy">
          {escolhidos.size === 0
            ? `Escolher imobiliárias (${grupos.length} receberam)`
            : `${escolhidos.size} escolhida(s) · ${emailsEscolhidos} e-mail(s)`}
        </summary>
        <div className="space-y-2 border-t border-gray-100 p-3">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar imobiliária"
            className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none"
          />
          <div className="flex flex-wrap gap-3 text-xs">
            <button type="button" className="font-medium text-o2-coral hover:underline" onClick={() => setEscolhidos(new Set(grupos.map((g) => g.chave)))}>
              Marcar todas ({grupos.length})
            </button>
            <button type="button" className="font-medium text-o2-coral hover:underline" onClick={() => setEscolhidos(new Set(naoAbriram))}>
              Só quem não abriu ({naoAbriram.length})
            </button>
            <button type="button" className="text-gray-500 hover:underline" onClick={() => setEscolhidos(new Set())}>
              Limpar
            </button>
          </div>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto">
            {visiveis.map((g) => (
              <li key={g.chave}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-gray-50">
                  <input type="checkbox" checked={escolhidos.has(g.chave)} onChange={() => alternar(g.chave)} />
                  <span className="flex-1">{g.rotulo}</span>
                  <span className="text-[11px] text-gray-400">
                    {g.emails} e-mail(s) · {g.abriu ? "abriu" : "não abriu"}
                  </span>
                </label>
              </li>
            ))}
            {!visiveis.length && <li className="px-1 py-1 text-xs text-gray-400">Nenhuma imobiliária encontrada.</li>}
          </ul>
          <p className="text-[11px] text-gray-400">
            Abertura é medida por imagem do e-mail — quem bloqueia imagens pode ter lido e aparecer como &quot;não abriu&quot;.
          </p>
        </div>
      </details>

      <ConfirmarDisparoButton
        className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        textoCarregando="Reenviando..."
        mensagemConfirmacao={`Reenviar pra ${escolhidos.size} imobiliária(s) (${emailsEscolhidos} e-mail(s))?${validadeExpirada ? " O período de validade da campanha já passou." : ""} Não dá pra desfazer depois de iniciado.`}
      >
        Reenviar para as escolhidas
      </ConfirmarDisparoButton>
    </form>
  );
}
