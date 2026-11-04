"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EditorCorpo } from "../../EditorCorpo";
import { restaurarPremiacaoDoCliente, salvarPremiacaoDoCliente } from "../parciaisActions";

// Premiação deste cliente (04/11/2026, só Campanha Elite): o bloco de premiação é a única parte do
// e-mail que pode ter exceção por cliente. Salvar/restaurar não envia nada e não mexe nos outros
// clientes nem no texto do modelo; depois de cada ação a página recarrega as prévias.
export default function PremiacaoCliente({
  campanhaId,
  participanteId,
  nome,
  personalizada,
  padraoHtml,
}: {
  campanhaId: string;
  participanteId: string;
  nome: string;
  personalizada: string | null;
  padraoHtml: string;
}) {
  const router = useRouter();
  const raiz = useRef<HTMLDivElement>(null);
  const [criando, setCriando] = useState(false);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();
  const campo = `premiacao_${participanteId}`;
  const inicial = personalizada ?? padraoHtml;
  const editando = !!personalizada || criando;

  // O editor só preenche o campo escondido depois de mexer; sem mexer, vale o conteúdo inicial.
  const conteudoAtual = () => {
    const escondido = raiz.current?.querySelector<HTMLInputElement>(`input[name="${campo}"]`);
    return escondido?.value?.trim() ? escondido.value : inicial;
  };

  function executar(acao: () => Promise<{ ok: boolean; mensagem: string }>, aoConcluir?: () => void) {
    setMensagem(null);
    iniciar(async () => {
      try {
        const r = await acao();
        setMensagem({ ok: r.ok, texto: r.mensagem });
        if (r.ok) {
          aoConcluir?.();
          router.refresh();
        }
      } catch (e) {
        setMensagem({ ok: false, texto: e instanceof Error ? e.message : "Não consegui concluir." });
      }
    });
  }

  const botao = "rounded-full border border-o2-navy/30 px-4 py-1.5 text-xs font-medium text-o2-navy transition hover:bg-white disabled:opacity-40";

  return (
    <div ref={raiz} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-o2-navy">Premiação de {nome}</span>
        {personalizada ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Premiação personalizada</span>
        ) : (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">Premiação padrão do modelo</span>
        )}
      </div>

      {editando ? (
        <>
          <p className="text-[11px] text-gray-500">
            Só este bloco muda para {nome}: o título passa a ser “Confira a premiação da sua campanha:” e o resto do e-mail continua o do modelo. Texto, emojis e formatação são livres.
          </p>
          <EditorCorpo key={personalizada ? "salva" : "nova"} name={campo} corpoInicialHtml={inicial} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={pendente} className={botao} onClick={() => executar(() => salvarPremiacaoDoCliente(campanhaId, participanteId, conteudoAtual()), () => setCriando(false))}>
              {pendente ? "Salvando…" : "Salvar premiação personalizada"}
            </button>
            {personalizada ? (
              <button type="button" disabled={pendente} className={botao} onClick={() => executar(() => restaurarPremiacaoDoCliente(campanhaId, participanteId))}>
                Restaurar premiação padrão
              </button>
            ) : (
              <button type="button" disabled={pendente} className={botao} onClick={() => setCriando(false)}>
                Cancelar
              </button>
            )}
          </div>
        </>
      ) : (
        <button type="button" className={botao} onClick={() => setCriando(true)}>
          Personalizar a premiação deste cliente
        </button>
      )}
      {mensagem && <p className={`text-xs ${mensagem.ok ? "text-green-700" : "text-red-700"}`}>{mensagem.texto}</p>}
    </div>
  );
}
