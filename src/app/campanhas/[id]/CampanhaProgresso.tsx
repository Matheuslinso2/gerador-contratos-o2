"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSpinner } from "@/components/icons";

// Caminho principal de envio (a rede de segurança é o cron
// enviar-campanhas): enquanto essa tela fica aberta, processa um lote a
// cada poucos segundos via POST autenticado, chamando router.refresh() pra
// puxar os contadores atualizados do Server Component pai. Se a aba fechar
// antes da fila esvaziar, o cron (ver vercel.json) retoma sozinho.
export function CampanhaProgresso({ campanhaId, status }: { campanhaId: string; status: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const processando = useRef(false);

  useEffect(() => {
    if (status !== "enviando") return;
    let parado = false;

    async function processarEAtualizar() {
      if (parado || processando.current) return;
      processando.current = true;
      try {
        const resp = await fetch(`/api/campanhas/${campanhaId}/processar-lote`, { method: "POST" });
        const dados = await resp.json();
        setErro(resp.ok ? null : (dados.erro ?? "Falha ao processar o lote."));
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      } finally {
        processando.current = false;
        if (!parado) router.refresh();
      }
    }

    processarEAtualizar();
    const intervalo = setInterval(processarEAtualizar, 4000);
    return () => {
      parado = true;
      clearInterval(intervalo);
    };
  }, [status, campanhaId, router]);

  if (status !== "enviando") return null;

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-o2-coral/30 bg-orange-50 p-3 text-sm text-o2-coral">
      <span className="inline-flex items-center gap-2">
        <IconSpinner className="h-4 w-4" />
        Enviando — pode deixar esta aba aberta pra acompanhar em tempo real, ou fechar (o envio continua sozinho).
      </span>
      {erro && <span className="text-xs text-red-600">Erro no último lote: {erro}</span>}
    </div>
  );
}
