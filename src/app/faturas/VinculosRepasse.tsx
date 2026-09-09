import { adicionarEmailRepasse, removerEmailRepasse, salvarCodigoProdutorCorp } from "./actions";
import { IconReceipt, IconTrash } from "./icons";
import { SubmitButton } from "./SubmitButton";

const inputClass = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none";

// Extraído de /faturas/imobiliaria/[id] pra ser reaproveitado também em
// /admin/imobiliarias/[id], mesmo padrão de VinculosFaturas.
export default function VinculosRepasse({
  imobiliariaId,
  emailsRepasses,
  codigoProdutorCorp,
  voltarPara,
}: {
  imobiliariaId: string;
  emailsRepasses: string[];
  codigoProdutorCorp: string | null;
  voltarPara: string;
}) {
  return (
    <div className="rounded-2xl border border-o2-navy/10 bg-white p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-o2-navy/5 text-o2-navy">
          <IconReceipt className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-semibold text-o2-navy">Repasse de comissão</h2>
      </div>
      <p className="mb-3 text-xs text-gray-500">
        Pra onde o relatório de repasse + comprovante de pagamento dessa imobiliária serão enviados —
        lista separada do e-mail de faturas de propósito: algumas imobiliárias exigem que o repasse de
        valores vá direto pro dono ou pra diretoria, não pro contato financeiro de sempre.
      </p>

      {emailsRepasses.length === 0 && (
        <p className="mb-3 text-xs font-medium text-red-600">⚠️ Nenhum e-mail cadastrado ainda — não dá pra enviar repasse.</p>
      )}

      {emailsRepasses.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {emailsRepasses.map((email) => (
            <div key={email} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
              <span className="break-all text-sm text-gray-800">{email}</span>
              <form action={removerEmailRepasse}>
                <input type="hidden" name="imobiliaria_id" value={imobiliariaId} />
                <input type="hidden" name="voltar_para" value={voltarPara} />
                <input type="hidden" name="email" value={email} />
                <SubmitButton
                  className="shrink-0 text-gray-400 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  textoCarregando="…"
                  confirmarAntes={`Remover "${email}" do envio de repasse dessa imobiliária?`}
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </SubmitButton>
              </form>
            </div>
          ))}
        </div>
      )}

      <form action={adicionarEmailRepasse} className="mb-5 flex flex-wrap items-end gap-2">
        <input type="hidden" name="imobiliaria_id" value={imobiliariaId} />
        <input type="hidden" name="voltar_para" value={voltarPara} />
        <input
          name="email"
          type="email"
          placeholder="diretoria@imobiliaria.com.br"
          className={`${inputClass} max-w-xs`}
        />
        <SubmitButton
          className="rounded-full bg-o2-navy px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          textoCarregando="Adicionando..."
        >
          + Adicionar e-mail
        </SubmitButton>
      </form>

      <div className="border-t border-gray-100 pt-4">
        <label className="mb-0.5 block text-xs text-gray-500">Código do produtor no Corp</label>
        <p className="mb-2 text-xs text-gray-500">
          O número que identifica essa imobiliária como &quot;Produtor&quot; no relatório de repasse exportado
          do Corp (ex: 406). Preenchendo aqui, o próximo relatório dela já casa sozinho, sem precisar
          conferir manual.
        </p>
        <form action={salvarCodigoProdutorCorp} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="imobiliaria_id" value={imobiliariaId} />
          <input type="hidden" name="voltar_para" value={voltarPara} />
          <input
            name="codigo_produtor_corp"
            defaultValue={codigoProdutorCorp ?? ""}
            placeholder="Ex: 406"
            className={`${inputClass} max-w-[10rem]`}
          />
          <SubmitButton
            className="rounded-full border border-o2-navy px-4 py-1.5 text-sm font-medium text-o2-navy transition hover:bg-o2-navy hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            textoCarregando="Salvando..."
          >
            Salvar código
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
