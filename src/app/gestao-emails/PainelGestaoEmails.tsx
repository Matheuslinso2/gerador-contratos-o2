"use client";

import { useState, useTransition } from "react";
import { arquivarAction, marcarPendenteAction, desmarcarPendenteAction, gerarRascunhoIAAction } from "./actions";

export type CategoriaEmail = "gestao_macro" | "api_seguradoras" | "contabil_pf" | "demanda_direta";
export type StatusEmail = "urgente" | "aguardando_acao" | "em_andamento" | "informativo";

export type ItemPainelEmail = {
  id: string;
  threadId: string;
  remetenteNome: string;
  remetenteEmail: string;
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

// Cada categoria com uma cor oficial da marca só dela (navy, azul, cinza
// escuro, laranja -- as 4 mais fáceis de distinguir entre si no manual,
// evitando dois tons escuros parecidos) + um ícone próprio, porque cor
// sozinha nunca deveria ser o único jeito de diferenciar (também ajuda quem
// tem dificuldade de discriminar cor).
const COR_CATEGORIA: Record<CategoriaEmail, { badge: string; texto: string }> = {
  gestao_macro: { badge: "bg-o2-navy/10 text-o2-navy", texto: "text-o2-navy" },
  api_seguradoras: { badge: "bg-o2-blue/10 text-o2-blue", texto: "text-o2-blue" },
  contabil_pf: { badge: "bg-o2-cinza-escuro/10 text-o2-cinza-escuro", texto: "text-o2-cinza-escuro" },
  demanda_direta: { badge: "bg-o2-coral/10 text-o2-coral", texto: "text-o2-coral" },
};

function IconeCategoria({ categoria }: { categoria: CategoriaEmail }) {
  const props = { viewBox: "0 0 24 24", fill: "none", className: "h-3 w-3 flex-shrink-0" };
  switch (categoria) {
    case "gestao_macro":
      return (
        <svg {...props}>
          <path d="M4 20.5V5l8-2 8 2v15.5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M9 20.5v-5h6v5M9 9.5h.01M15 9.5h.01M9 13h.01M15 13h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "api_seguradoras":
      return (
        <svg {...props}>
          <path d="M8 9V6.5a2 2 0 012-2h4a2 2 0 012 2V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <rect x="5" y="9" width="14" height="9.5" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M9.5 13.2h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "contabil_pf":
      return (
        <svg {...props}>
          <path d="M6.5 3.5h11v17l-2.5-1.7-2 1.7-2-1.7-2 1.7-2.5-1.7z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M9 8.5h6M9 12h6M9 15.5h3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "demanda_direta":
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="2" />
          <path d="M5.5 20c0-3.3 2.9-5.8 6.5-5.8s6.5 2.5 6.5 5.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

const LABEL_STATUS: Record<StatusEmail, string> = {
  urgente: "Urgente",
  aguardando_acao: "Aguardando minha ação",
  em_andamento: "Em andamento",
  informativo: "Informativo",
};

// Mesma cor usada na etiqueta de status e na borda esquerda do card -- é o
// que dá a hierarquia de urgência num piscar de olhos, antes de ler nada.
const COR_STATUS: Record<StatusEmail, { badge: string; borda: string }> = {
  urgente: { badge: "bg-red-100 text-red-700", borda: "border-l-red-500" },
  aguardando_acao: { badge: "bg-amber-100 text-amber-800", borda: "border-l-amber-400" },
  em_andamento: { badge: "bg-o2-blue/10 text-o2-blue", borda: "border-l-o2-blue" },
  informativo: { badge: "bg-gray-100 text-gray-500", borda: "border-l-gray-200" },
};

function urlThreadGmail(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${threadId}`;
}

function IconeAlerta() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-o2-coral">
      <path
        d="M12 3.5c-4 0-6 3-6 7v3.3L4.3 16.8A.8.8 0 005 18h14a.8.8 0 00.7-1.2L18 13.8V10.5c0-4-2-7-6-7z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9.7 20.2a2.5 2.5 0 004.6 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconeFeed() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-o2-navy">
      <path d="M4.5 11.5L6.7 5h10.6l2.2 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path
        d="M4.5 11.5v5.8A1.7 1.7 0 006.2 19h11.6a1.7 1.7 0 001.7-1.7v-5.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M4.5 11.5h4.7l1 2h3.6l1-2h4.7" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// Pra itens que ainda pedem uma decisão minha, o próximo passo mais provável
// é responder -- pra itens que eu só preciso acompanhar/arquivar, o próximo
// passo mais provável é tirar da caixa. O botão "primário" (sólido) muda
// conforme isso, em vez de deixar os 4 botões brigando pela mesma atenção.
function acaoPrimaria(status: StatusEmail | null): "responder_ia" | "arquivar" {
  return status === "urgente" || status === "aguardando_acao" ? "responder_ia" : "arquivar";
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

  const corStatus = item.status ? COR_STATUS[item.status] : COR_STATUS.informativo;
  const corCategoria = COR_CATEGORIA[item.categoria];
  const primaria = acaoPrimaria(item.status);

  const classeBotaoSecundario =
    "rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50";

  return (
    <div className={`rounded-xl border border-gray-200 border-l-4 bg-white p-4 shadow-sm ${corStatus.borda}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-o2-navy">{item.remetenteNome}</p>
          <p className="truncate text-xs text-gray-400">{item.remetenteEmail}</p>
          <p className="mt-1 text-sm text-gray-800">{item.assunto}</p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${corCategoria.badge}`}>
            <IconeCategoria categoria={item.categoria} />
            {LABEL_CATEGORIA[item.categoria]}
          </span>
          {item.status && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${corStatus.badge}`}>
              {LABEL_STATUS[item.status]}
            </span>
          )}
        </div>
      </div>

      {item.resumoExecutivo && <p className="mt-2.5 text-sm text-gray-600">{item.resumoExecutivo}</p>}

      {item.acaoExigida && (
        <div className={`mt-2.5 rounded-lg border-l-2 bg-o2-gray/40 px-3 py-2 ${corStatus.borda}`}>
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Ação exigida</p>
          <p className="text-sm text-gray-700">{item.acaoExigida}</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
        <p className="text-xs text-gray-400">{item.dataFormatada}</p>
        {erro && <p className="text-xs text-red-600">{erro}</p>}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => executar(async () => { await arquivarAction(item.id); setArquivado(true); })}
          className={
            primaria === "arquivar"
              ? "rounded-full bg-o2-navy px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              : classeBotaoSecundario
          }
        >
          Arquivar
        </button>
        <a href={urlThreadGmail(item.threadId)} target="_blank" rel="noopener noreferrer" className={classeBotaoSecundario}>
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
          className={
            primaria === "responder_ia" && !rascunhoCriado
              ? "rounded-full bg-o2-coral px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              : "rounded-full border border-o2-coral px-3 py-1 text-xs font-medium text-o2-coral transition hover:bg-o2-coral/10 disabled:opacity-50"
          }
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
      <section className="rounded-2xl border border-o2-coral/20 bg-o2-coral/[0.04] p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-o2-navy">
          <IconeAlerta />
          Alertas de Ações Pendentes {alertas.length > 0 && `(${alertas.length})`}
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
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-o2-navy">
          <IconeFeed />
          Feed de E-mails Filtrados
        </h2>
        <div className="space-y-6">
          {[...porCategoria.entries()].map(([categoria, lista]) => (
            <div key={categoria}>
              <h3
                className={`mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${COR_CATEGORIA[categoria].texto}`}
              >
                <IconeCategoria categoria={categoria} />
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
