"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sincronizarPasso } from "./actions";
import type { ResultadoSincronizacao } from "@/lib/prospeccaoSync";

const LIMITE_VOLTAS_SEGURANCA = 30; // evita loop infinito em caso de bug

export default function BotaoSincronizar() {
  const router = useRouter();
  const [forcarTudo, setForcarTudo] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function iniciar() {
    setRodando(true);
    setErro(null);
    setStatus("Sincronizando...");

    let totalArquivos = 0;
    let totalLinhas = 0;
    let totalErros = 0;
    let ultimaEstatistica = 0;
    let volta = 0;
    let forcarNestaVolta = forcarTudo;

    try {
      while (volta < LIMITE_VOLTAS_SEGURANCA) {
        volta++;
        const resultado: ResultadoSincronizacao = await sincronizarPasso(forcarNestaVolta);
        // Só a primeira volta força tudo — as planilhas já processadas
        // nessa volta ficam com a data de modificação em dia, então as
        // próximas voltas já continuam sozinhas de onde pararam.
        forcarNestaVolta = false;

        totalArquivos += resultado.arquivos_processados.length;
        totalLinhas += resultado.linhas_gravadas;
        totalErros += resultado.erros.length;
        if (resultado.estatisticas_calculadas) ultimaEstatistica = resultado.estatisticas_calculadas;

        setStatus(
          `Sincronizando... ${totalArquivos} planilha(s) processada(s), ` +
            `${resultado.arquivos_pendentes} restante(s)`
        );

        if (resultado.arquivos_pendentes === 0) break;
        if (resultado.arquivos_processados.length === 0) break; // nada avançou, evita loop parado
      }

      setStatus(
        `Concluído: ${totalArquivos} planilha(s) atualizada(s), ${totalLinhas} linha(s) gravada(s)` +
          (ultimaEstatistica ? `, ${ultimaEstatistica} estatística(s) recalculada(s)` : "") +
          (totalErros ? `, ${totalErros} erro(s) (veja os Vercel Runtime Logs)` : ".")
      );
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha inesperada ao sincronizar.");
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input
          type="checkbox"
          checked={forcarTudo}
          onChange={(e) => setForcarTudo(e.target.checked)}
          disabled={rodando}
        />
        Forçar recarregar tudo (ignora o que já está sincronizado — use só se mudou algo na
        lógica de extração, ou se ficou faltando algum dado)
      </label>

      <button
        type="button"
        onClick={iniciar}
        disabled={rodando}
        className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
      >
        {rodando ? "Sincronizando..." : "Sincronizar agora"}
      </button>

      {status && <p className="text-sm text-gray-600">{status}</p>}
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </div>
  );
}
