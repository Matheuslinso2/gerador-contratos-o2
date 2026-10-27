"use client";

import { useRef } from "react";

export type EmailDaConversa = { id: string; data: string | null; de: string; para: string; assunto: string; trecho: string; tem_anexo: boolean; prova: boolean };
export type AnexoDoEmail = { id: string; nome: string; tipo: string; situacao: string; url: string | null };

const entidades = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const dataBr = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "—");
const nomeDe = (v: string) => entidades(v).replace(/<.*>/, "").replace(/"/g, "").trim() || entidades(v);

/** Botão "E-mails (n)" da ficha do documento: abre a conversa daquele documento (só cabeçalho e trecho) e os PDFs anexados. */
export default function JanelaEmails({ codigoO2, emails, anexos }: { codigoO2: string; emails: EmailDaConversa[]; anexos: AnexoDoEmail[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
        E-mails ({emails.length})
      </button>
      <dialog ref={ref} className="m-auto w-[min(920px,94vw)] rounded-lg border border-gray-300 p-0 shadow-xl backdrop:bg-black/40">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">Conversa do documento · Código O2 {codigoO2}</div>
            <div className="text-xs text-gray-500">Só cabeçalho e trecho das mensagens. O texto completo continua na caixa de e-mail.</div>
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100">Fechar</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
          {anexos.length > 0 && (
            <div className="mb-4 rounded border border-gray-200 bg-gray-50 p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">PDFs guardados</div>
              <ul className="space-y-1 text-sm">
                {anexos.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-white px-1.5 py-0.5 text-[11px] uppercase text-gray-600 ring-1 ring-gray-200">{a.tipo}</span>
                    {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">{a.nome}</a> : <span>{a.nome}</span>}
                    {a.situacao !== "confirmada" && <span className="text-xs text-amber-700">vínculo provável, conferir</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ol className="space-y-3">
            {emails.map((e) => (
              <li key={e.id} className="rounded border border-gray-200 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-medium text-gray-900">{entidades(e.assunto) || "(sem assunto)"}</div>
                  <div className="text-xs text-gray-500">{dataBr(e.data)}</div>
                </div>
                <div className="mt-0.5 text-xs text-gray-600">
                  de {nomeDe(e.de)} · para {entidades(e.para).slice(0, 120)}
                  {e.tem_anexo ? " · com anexo" : ""}
                  {e.prova ? " · indica emissão" : ""}
                </div>
                {e.trecho && <p className="mt-1.5 text-sm text-gray-800">{entidades(e.trecho)}</p>}
              </li>
            ))}
          </ol>
        </div>
      </dialog>
    </>
  );
}
