import Link from "next/link";
import InfoLegenda from "@/components/InfoLegenda";
import SubmitButton from "@/components/SubmitButton";
import { ROTULO_STATUS_CAMPANHA, COR_STATUS_CAMPANHA } from "@/lib/campanhas/rotulos";
import { gerarParciaisCampanha } from "./actions";

export type EmailFilho = {
  id: string;
  nome: string;
  status: string;
  created_at: string;
  disparada_em: string | null;
  agendado_para: string | null;
  total_enviados: number;
  abertos: number;
};

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

// E-mails desta campanha (22/10/2026): boas-vindas por imobiliária, parciais
// e demais acompanhamentos ficam pendurados na campanha, em vez de virar
// campanhas soltas na lista. Cada um continua com a própria tela de e-mail
// (revisar, disparar, aberturas).
export default function EmailsDaCampanha({
  campanhaId,
  filhos,
  podeGerarParcial,
}: {
  campanhaId: string;
  filhos: EmailFilho[];
  podeGerarParcial: boolean;
}) {
  return (
    <div id="emails-da-campanha" className="space-y-3 rounded-xl border border-o2-navy/10 bg-quadro p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-o2-navy">
          E-mails desta campanha ({filhos.length})
          <InfoLegenda titulo="E-mails desta campanha">
            Outros e-mails da mesma campanha, como boas-vindas por imobiliária e parciais. Cada um abre na própria tela (prévia, disparo, aberturas). As imobiliárias que recebem esses e-mails entram no quadro de produção da campanha.
          </InfoLegenda>
        </h3>
        <Link href={`/campanhas/nova?pai=${campanhaId}`} className="text-sm font-medium text-o2-coral hover:underline">
          + Novo e-mail desta campanha
        </Link>
      </div>

      {filhos.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-1 pr-3">E-mail</th>
                <th className="py-1 pr-3">Situação</th>
                <th className="py-1 pr-3">Quando</th>
                <th className="py-1 pr-3 text-right">Enviados</th>
                <th className="py-1 text-right">Abertos</th>
              </tr>
            </thead>
            <tbody>
              {filhos.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-1 pr-3">
                    <Link href={`/campanhas/${f.id}`} className="text-o2-navy hover:underline">
                      {f.nome}
                    </Link>
                  </td>
                  <td className="py-1 pr-3">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${COR_STATUS_CAMPANHA[f.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {ROTULO_STATUS_CAMPANHA[f.status] ?? f.status}
                    </span>
                  </td>
                  <td className="py-1 pr-3 text-xs text-gray-500">
                    {f.status === "agendada" && f.agendado_para ? `agendado ${quando(f.agendado_para)}` : f.disparada_em ? quando(f.disparada_em) : `criado ${quando(f.created_at)}`}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{f.total_enviados}</td>
                  <td className="py-1 text-right tabular-nums">{f.abertos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {podeGerarParcial && (
        <div className="border-t pt-3">
          <p className="mb-2 text-xs font-semibold text-gray-600">
            Parcial por e-mail
            <InfoLegenda titulo="Parcial automática">
              Cria um e-mail de parcial para cada imobiliária (ou grupo) COM meta, com os números de hoje: meta, realizado, quanto falta, barra de progresso, dias até o fim, cotações em andamento e a premiação. Cada uma recebe só os próprios números. Os números ficam fixos no momento da geração: para a próxima parcial, gere de novo. Sem data, os e-mails ficam como rascunho para revisar e disparar; com data, saem sozinhos na hora marcada.
            </InfoLegenda>
          </p>
          <form action={gerarParciaisCampanha.bind(null, campanhaId)} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Remetente (nome, opcional)</label>
              <input name="remetente_nome" maxLength={40} placeholder="Ex: Lívia" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Agendar o envio (opcional)</label>
              <input name="agendado_para" type="datetime-local" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none" />
            </div>
            <SubmitButton className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white" textoCarregando="Gerando...">
              Gerar parciais
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
