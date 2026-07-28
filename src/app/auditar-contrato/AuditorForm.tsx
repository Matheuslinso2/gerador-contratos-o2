"use client";

import { useFormStatus } from "react-dom";
import { auditar } from "./actions";

function BotaoEnviar() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-full bg-o2-coral px-6 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Analisando... (pode levar até 1 minuto)" : "Analisar contrato"}
    </button>
  );
}

export default function AuditorForm() {
  return (
    <form action={auditar} className="space-y-3">
      <div>
        <label className="text-sm text-gray-600">Cole o texto do contrato</label>
        <textarea
          name="texto"
          rows={8}
          placeholder="Cole aqui o texto completo do contrato de locação..."
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
      </div>

      <p className="text-center text-sm text-gray-400">— ou —</p>

      <div>
        <label className="text-sm text-gray-600">Envie o arquivo do contrato (.docx ou .pdf)</label>
        <input
          name="arquivo"
          type="file"
          accept=".docx,.pdf"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
        <p className="mt-1 text-xs text-gray-500">
          Se enviar um arquivo, ele substitui o texto colado acima. PDFs escaneados (sem texto
          real) também funcionam — a IA lê direto das páginas do documento.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 p-3">
        <p className="mb-2 text-sm font-medium text-o2-navy">
          Cotação/proposta de seguro (opcional)
        </p>
        <p className="mb-2 text-xs text-gray-500">
          Se enviar, o Auditor confere se segurado, valor do aluguel, prazo e endereço batem
          entre o contrato e a cotação.
        </p>
        <input
          name="arquivo_cotacao"
          type="file"
          accept=".docx,.pdf"
          className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
        />
      </div>

      <BotaoEnviar />
    </form>
  );
}
