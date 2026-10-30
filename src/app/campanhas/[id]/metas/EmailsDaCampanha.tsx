import Link from "next/link";
import InfoLegenda from "@/components/InfoLegenda";
import SubmitButton from "@/components/SubmitButton";
import { ROTULO_STATUS_CAMPANHA, COR_STATUS_CAMPANHA } from "@/lib/campanhas/rotulos";
import { prepararParciais } from "../parciaisActions";

export type EmailFilho = {
  id: string;
  nome: string;
  status: string;
  created_at: string;
  disparada_em: string | null;
  agendado_para: string | null;
  total_enviados: number;
  abertos: number;
  falhas: number;
  cliques: number;
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
        <details className="rounded-lg bg-white px-3 py-2">
          <summary className="cursor-pointer text-sm text-o2-navy">
            Ver os {filhos.length} e-mail(s): {filhos.filter((f) => f.status === "concluida").length} enviado(s), {filhos.reduce((s, f) => s + f.abertos, 0)} abertura(s)
            {filhos.some((f) => f.status === "rascunho") ? `, ${filhos.filter((f) => f.status === "rascunho").length} rascunho(s)` : ""}
            {filhos.some((f) => f.status === "agendada") ? `, ${filhos.filter((f) => f.status === "agendada").length} agendado(s)` : ""}
          </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-1 pr-3">E-mail</th>
                <th className="py-1 pr-3">Situação</th>
                <th className="py-1 pr-3">Quando</th>
                <th className="py-1 pr-3 text-right">Enviados</th>
                <th className="py-1 pr-3 text-right">Falhas</th>
                <th className="py-1 pr-3 text-right">Abertos</th>
                <th className="py-1 pr-3 text-right">Cliques</th>
                <th className="py-1 text-right">Template</th>
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
                  <td className="py-1 pr-3 text-right tabular-nums">{f.falhas}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{f.abertos}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{f.cliques}</td>
                  <td className="py-1 text-right">
                    <Link href={`/campanhas/${f.id}`} className="text-xs text-o2-coral hover:underline">
                      ver template
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </details>
      )}

      {podeGerarParcial && (
        <div className="border-t pt-3">
          <p className="mb-2 text-xs font-semibold text-gray-600">
            Parcial por e-mail
            <InfoLegenda titulo="Enviar parciais">
              Gera o panorama de cada imobiliária (ou grupo) COM meta, com os números de hoje, e mostra uma prévia para você revisar o texto e as imagens. Só depois de confirmar os e-mails saem: cada imobiliária recebe o próprio panorama como imagem, a versão fica guardada (histórico das parciais) e os cards do Bitrix recebem um comentário. Os números ficam fixos na versão.
            </InfoLegenda>
          </p>
          <form action={prepararParciais.bind(null, campanhaId)}>
            <SubmitButton className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white" textoCarregando="Gerando a prévia...">
              Enviar parciais
            </SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}
