import { adicionarEmailCampanha, removerEmailCampanha } from "../admin/imobiliarias/actions";
import { IconMail, IconTrash } from "@/components/icons";
import { SubmitButton } from "../faturas/SubmitButton";

const inputClass = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none";

// Mesmo padrão de VinculosFaturas/VinculosRepasse (src/app/faturas/) --
// terceiro campo de e-mail, dedicado a Campanhas comerciais. Quando vazio,
// o envio cai no mesmo e-mail já usado pra fatura/repasse (ver
// src/lib/campanhas/elegibilidade.ts) -- preencher aqui só é necessário
// quando o contato de campanha precisa ser diferente dos outros dois.
export default function VinculosCampanhas({
  imobiliariaId,
  emailsCampanhas,
  voltarPara,
}: {
  imobiliariaId: string;
  emailsCampanhas: string[];
  voltarPara: string;
}) {
  return (
    <div className="rounded-2xl border border-o2-navy/10 bg-quadro p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-o2-navy/5 text-o2-navy">
          <IconMail className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold text-o2-navy">Campanhas comerciais</h2>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Pra onde os e-mails de campanha (promoções, comunicados, newsletters) dessa imobiliária são enviados — lista
        separada de faturas e repasse de propósito: se ficar vazia, o envio usa o e-mail de faturas como reserva.
      </p>

      {emailsCampanhas.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {emailsCampanhas.map((email) => (
            <div key={email} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
              <span className="break-all text-sm text-gray-800">{email}</span>
              <form action={removerEmailCampanha}>
                <input type="hidden" name="imobiliaria_id" value={imobiliariaId} />
                <input type="hidden" name="voltar_para" value={voltarPara} />
                <input type="hidden" name="email" value={email} />
                <SubmitButton
                  className="shrink-0 text-gray-400 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  textoCarregando="…"
                  confirmarAntes={`Remover "${email}" do envio de campanhas dessa imobiliária?`}
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </SubmitButton>
              </form>
            </div>
          ))}
        </div>
      )}

      <form action={adicionarEmailCampanha} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="imobiliaria_id" value={imobiliariaId} />
        <input type="hidden" name="voltar_para" value={voltarPara} />
        <input name="email" type="email" placeholder="marketing@imobiliaria.com.br" className={`${inputClass} max-w-xs`} />
        <SubmitButton
          className="rounded-full bg-o2-navy px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          textoCarregando="Adicionando..."
        >
          + Adicionar e-mail
        </SubmitButton>
      </form>
    </div>
  );
}
