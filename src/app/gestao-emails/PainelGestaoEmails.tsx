"use client";

import { useState, useTransition } from "react";
import { arquivarAction, marcarPendenteAction, desmarcarPendenteAction, gerarRascunhoIAAction } from "./actions";

export type CategoriaEmail = "gestao_macro" | "api_seguradoras" | "contabil_pf" | "demanda_direta";
export type StatusEmail = "urgente" | "aguardando_acao" | "em_andamento" | "informativo";

export type ItemPainelEmail = {
  id: string;
  threadId: string;
  remetente: string;
  assunto: string;
  dataFormatada: string;
  categoria: CategoriaEmail;
  status: StatusEmail | null;
  resumoExecutivo: string | null;
  acaoExigida: string | null;
  pendente: boolean;
};

const LABEL_CATEGORIA: Record<CategoriaEmail, string> = {
  gestao_macro: "Gestão Macro",
  api_seguradoras: "API Seguradoras",
  contabil_pf: "Contábil PF",
  demanda_direta: "Demanda Direta",
};

const LABEL_STATUS: Record<StatusEmail, string> = {
  urgente: "Urgente",
  aguardando_acao: "Aguardando minha ação",
  em_andamento: "Em andamento",
  informativo: "Informativo",
};

const COR_STATUS: Record<StatusEmail, string> = {
  urgente: "bg-red-100 text-red-700",
  aguardando_acao: "bg-yellow-100 text-yellow-800",
  em_andamento: "bg-blue-100 text-blue-700",
  informativo: "bg-gray-100 text-gray-600",
};

function urlThreadGmail(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
}

function CardEmail({ item }: { item: ItemPainelEmail }) {
  const [pendente, setPendente] = useState(item.pendente);
  const [arquivado, setArquivado] = useState(false);
  const [rascunhoCriado, setRascunhoCriado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (arquivado) return null;

  function executar(acao: () => Promise<void>) {
    setErro(null);
    startTransition(async () => {
      try {
        await acao();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Falha ao executar a ação.");
      }
    });
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-o2-navy">{item.remetente}</p>
          <p className="text-sm text-gray-700">{item.assunto}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-o2-navy/10 px-2.5 py-0.5 text-xs font-medium text-o2-navy">
            {LABEL_CATEGORIA[item.categoria]}
          </span>
          {item.status && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${COR_STATUS[item.status]}`}>
              {LABEL_STATUS[item.status]}
            </span>
          )}
        </div>
      </div>

      {item.resumoExecutivo && <p className="mt-2 text-sm text-gray-600">{item.resumoExecutivo}</p>}
      {item.acaoExigida && (
        <p className="mt-1 text-sm">
          <span className="font-medium text-gray-500">Ação exigida:</span> <span className="text-gray-700">{item.acaoExigida}</span>
        </p>
      )}
      <p className="mt-1 text-xs text-gray-400">{item.dataFormatada}</p>

      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => executar(async () => { await arquivarAction(item.id); setArquivado(true); })}
          className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
        >
          Arquivar
        </button>
        <a
          href={urlThreadGmail(item.threadId)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
        >
          Responder
        </a>
        <button
          type="button"
          disabled={isPending || rascunhoCriado}
          onClick={() =>
            executar(async () => {
              await gerarRascunhoIAAction({
                messageId: item.id,
                resumoExecutivo: item.resumoExecutivo,
                acaoExigida: item.acaoExigida,
              });
              setRascunhoCriado(true);
            })
          }
          className="rounded-full border border-o2-coral px-3 py-1 text-xs font-medium text-o2-coral transition hover:bg-o2-coral/10 disabled:opacity-50"
        >
          {rascunhoCriado ? "Rascunho criado ✓" : "IA Responder"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            executar(async () => {
              if (pendente) {
                await desmarcarPendenteAction(item.id);
              } else {
                await marcarPendenteAction(item.id);
              }
              setPendente(!pendente);
            })
          }
          className={`rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
            pendente ? "border-o2-navy bg-o2-navy text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"
          }`}
        >
          {pendente ? "Remover de Pendentes" : "Adicionar a Pendentes"}
        </button>
      </div>
    </div>
  );
}

export default function PainelGestaoEmails({ itens }: { itens: ItemPainelEmail[] }) {
  const alertas = itens.filter((i) => i.pendente || i.status === "urgente" || i.status === "aguardando_acao");

  const porCategoria = new Map<CategoriaEmail, ItemPainelEmail[]>();
  for (const item of itens) {
    porCategoria.set(item.categoria, [...(porCategoria.get(item.categoria) ?? []), item]);
  }

  if (!itens.length) {
    return (
      <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        Nenhum e-mail da sua responsabilidade direta nos últimos dias. Caixa limpa.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-o2-coral">
          🚨 Alertas de Ações Pendentes {alertas.length > 0 && `(${alertas.length})`}
        </h2>
        {alertas.length ? (
          <div className="space-y-3">
            {alertas.map((item) => (
              <CardEmail key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">Nada urgente ou aguardando sua ação no momento.</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-o2-navy">📥 Feed de E-mails Filtrados</h2>
        <div className="space-y-6">
          {[...porCategoria.entries()].map(([categoria, lista]) => (
            <div key={categoria}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {LABEL_CATEGORIA[categoria]}
              </h3>
              <div className="space-y-3">
                {lista.map((item) => (
                  <CardEmail key={item.id} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
