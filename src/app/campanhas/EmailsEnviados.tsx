import { ROTULO_STATUS_ENVIO, COR_STATUS_ENVIO, type DetalheEmail } from "@/lib/campanhas/producaoStatus";

function formatarDataHora(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

// Pedido do Matheus, 07/10/2026: dropdown, em cada imobiliária (campanhas)
// ou pessoa (avisos internos), com os endereços de e-mail pra onde o envio
// foi e o que aconteceu com cada um (enviado, aberto, clicado). Usa <details>
// nativo -- abre/fecha sem JavaScript, serve nos dois lugares.
export function EmailsEnviados({ emails, rotulo }: { emails: DetalheEmail[]; rotulo?: string }) {
  if (!emails.length) return null;
  const titulo = rotulo ?? `${emails.length} e-mail${emails.length > 1 ? "s" : ""} enviado${emails.length > 1 ? "s" : ""}`;

  return (
    <details className="mt-1 text-[11px]">
      <summary className="cursor-pointer select-none font-medium text-o2-navy hover:underline">{titulo}</summary>
      <ul className="mt-1 space-y-1.5 rounded-lg border border-o2-navy/10 bg-white p-2">
        {emails.map((e) => (
          <li key={e.email} className="space-y-0.5">
            <p className="flex flex-wrap items-center gap-1">
              <span className="break-all font-medium text-o2-navy">{e.email}</span>
              <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${COR_STATUS_ENVIO[e.chave]}`}>
                {ROTULO_STATUS_ENVIO[e.chave]}
              </span>
              {e.clicadoEm && <span className="whitespace-nowrap rounded-full bg-o2-navy/10 px-2 py-0.5 text-[10px] font-medium text-o2-navy">Clicou</span>}
            </p>
            <p className="text-gray-400">
              {e.enviadoEm ? `Enviado em ${formatarDataHora(e.enviadoEm)}` : "Ainda não enviado"}
              {e.abertoEm && ` · Abriu em ${formatarDataHora(e.abertoEm)}`}
              {e.clicadoEm && ` · Clicou em ${formatarDataHora(e.clicadoEm)}`}
            </p>
            {e.erro && <p className="text-red-500">Erro: {e.erro}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}
