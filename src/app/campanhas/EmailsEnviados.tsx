import type { DetalheEmail, ChaveStatusEnvio } from "@/lib/campanhas/producaoStatus";

// "08/10 09:31" -- sem ano e sem segundos, pra caber compacto embaixo do
// nome da imobiliária.
function dataCurta(iso: string): string {
  return new Date(iso)
    .toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .replace(",", "");
}

const COR_PONTO: Record<ChaveStatusEnvio, string> = {
  aguardando: "bg-gray-300",
  na_fila: "bg-yellow-400",
  abriu: "bg-green-500",
  nao_abriu: "bg-orange-400",
  falhou: "bg-red-500",
  descadastrado: "bg-gray-400",
};

// Pedido do Matheus, 07/10/2026: em vez de dropdown, os e-mails de cada
// imobiliária ficam fixos abaixo do nome, em bloco compacto: 1 linha com o
// endereço (ponto colorido = status) e 1 linha com envio/abertura/clique.
export function EmailsEnviados({ emails, compacto = false }: { emails: DetalheEmail[]; compacto?: boolean }) {
  if (!emails.length) return null;

  // Versão de UMA linha por e-mail -- usada no resumo de cada campanha na
  // lista (/campanhas), pra campanhas individuais com poucos e-mails
  // (pedido do Matheus, 08/10/2026): ver se abriram sem entrar na campanha.
  if (compacto) {
    return (
      <ul className="mt-1 space-y-0.5">
        {emails.map((e) => (
          <li key={e.email} className="flex flex-wrap items-center gap-x-1.5 text-[11px] leading-snug">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${COR_PONTO[e.chave]}`} aria-hidden="true" />
            <span className="break-all font-medium text-o2-navy">{e.email}</span>
            {e.abertoEm ? (
              <span className="font-medium text-green-700">· Abriu {dataCurta(e.abertoEm)}</span>
            ) : e.enviadoEm ? (
              <span className="text-orange-600">· Não abriu</span>
            ) : e.chave === "falhou" ? (
              <span className="text-red-500">· Falhou</span>
            ) : (
              <span className="text-gray-400">· Na fila</span>
            )}
            {e.clicadoEm && <span className="font-medium text-o2-navy">· Clicou</span>}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="mt-1.5 space-y-1.5 border-l-2 border-o2-navy/10 pl-2.5">
      {emails.map((e) => (
        <li key={e.email} className="text-[11px] leading-snug">
          <p className="flex items-start gap-1.5">
            <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${COR_PONTO[e.chave]}`} aria-hidden="true" />
            <span className="break-all font-medium text-o2-navy">{e.email}</span>
          </p>
          <p className="pl-3 text-gray-500">
            {e.enviadoEm ? `Enviado ${dataCurta(e.enviadoEm)}` : e.chave === "falhou" ? "Falhou" : "Na fila"}
            {e.abertoEm ? (
              <span className="font-medium text-green-700"> · Abriu {dataCurta(e.abertoEm)}</span>
            ) : e.enviadoEm ? (
              <span className="text-orange-600"> · Não abriu</span>
            ) : null}
            {e.clicadoEm && <span className="font-medium text-o2-navy"> · Clicou</span>}
          </p>
          {e.erro && <p className="pl-3 text-red-500">Erro: {e.erro}</p>}
        </li>
      ))}
    </ul>
  );
}
