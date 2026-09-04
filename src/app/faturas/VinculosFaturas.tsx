import { salvarSeguradorasImobiliaria, adicionarEmailFatura, removerEmailFatura } from "./actions";
import { SEGURADORAS_CANONICAS } from "@/lib/faturasIdentificacao";
import { IconMail, IconChecklist, IconTrash } from "./icons";
import { SubmitButton } from "./SubmitButton";

const inputClass = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-o2-coral focus:outline-none";

export type Vinculo = {
  seguradora: string;
  ativo: boolean;
  dia_vencimento: number | null;
  cnpj_o2: string | null;
  observacao: string | null;
};

// Extraído de /faturas/imobiliaria/[id] pra ser reaproveitado também em
// /admin/imobiliarias/[id] (visão unificada da imobiliária) -- as duas
// telas usam exatamente as mesmas actions, só mudando pra onde volta
// depois de salvar (voltarPara).
export default function VinculosFaturas({
  imobiliariaId,
  emailsFaturas,
  vinculos,
  voltarPara,
}: {
  imobiliariaId: string;
  emailsFaturas: string[];
  vinculos: Vinculo[];
  voltarPara: string;
}) {
  const vinculosPorSeguradora = new Map<string, Vinculo[]>();
  for (const v of vinculos) {
    const lista = vinculosPorSeguradora.get(v.seguradora) ?? [];
    lista.push(v);
    vinculosPorSeguradora.set(v.seguradora, lista);
  }
  const seguradoras = Array.from(new Set([...SEGURADORAS_CANONICAS, ...vinculos.map((v) => v.seguradora)]));

  const linhasFormulario: { seguradora: string; vinculo: Vinculo | null }[] = seguradoras.flatMap((s) => [
    ...(vinculosPorSeguradora.get(s) ?? []).map((vinculo) => ({ seguradora: s, vinculo })),
    { seguradora: s, vinculo: null },
  ]);
  const linhasComIndice = linhasFormulario.map((linha, i) => ({ ...linha, i }));
  const seguradorasComVinculo = new Set(vinculos.map((v) => v.seguradora));
  const linhasExistentes = linhasComIndice.filter((l) => seguradorasComVinculo.has(l.seguradora));
  const linhasNovas = linhasComIndice.filter((l) => !seguradorasComVinculo.has(l.seguradora));

  return (
    <>
      <div className="rounded-2xl border border-o2-navy/10 bg-white p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-o2-navy/5 text-o2-navy">
            <IconMail className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold text-o2-navy">E-mail para envio de faturas</h2>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          Pra onde as faturas dessa imobiliária serão enviadas — diferente do e-mail de login dela. Pode cadastrar
          mais de um destinatário.
        </p>

        {emailsFaturas.length === 0 && (
          <p className="mb-3 text-xs font-medium text-red-600">⚠️ Nenhum e-mail cadastrado ainda — não dá pra enviar fatura.</p>
        )}

        {emailsFaturas.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {emailsFaturas.map((email) => (
              <div key={email} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-1.5">
                <span className="break-all text-sm text-gray-800">{email}</span>
                <form action={removerEmailFatura}>
                  <input type="hidden" name="imobiliaria_id" value={imobiliariaId} />
                  <input type="hidden" name="voltar_para" value={voltarPara} />
                  <input type="hidden" name="email" value={email} />
                  <SubmitButton
                    className="shrink-0 text-gray-400 transition hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                    textoCarregando="…"
                    confirmarAntes={`Remover "${email}" do envio de faturas dessa imobiliária?`}
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </SubmitButton>
                </form>
              </div>
            ))}
          </div>
        )}

        <form action={adicionarEmailFatura} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="imobiliaria_id" value={imobiliariaId} />
          <input type="hidden" name="voltar_para" value={voltarPara} />
          <input
            name="email"
            type="email"
            placeholder="novo@imobiliaria.com.br"
            className={`${inputClass} max-w-xs`}
          />
          <SubmitButton
            className="rounded-full bg-o2-navy px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            textoCarregando="Adicionando..."
          >
            + Adicionar e-mail
          </SubmitButton>
        </form>
      </div>

      <div className="rounded-2xl border border-o2-navy/10 bg-white p-6 shadow-sm">
        <div className="mb-1 flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-o2-navy/5 text-o2-navy">
            <IconChecklist className="h-4 w-4" />
          </span>
          <h2 className="text-sm font-semibold text-o2-navy">Seguradoras e dados de cada uma</h2>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Desmarcar uma seguradora não apaga o histórico — só faz essa imobiliária parar de aparecer como esperada
          nela. Esses campos só são editáveis aqui, não na tela principal.
        </p>
        <form action={salvarSeguradorasImobiliaria} className="space-y-4">
          <input type="hidden" name="imobiliaria_id" value={imobiliariaId} />
          <input type="hidden" name="voltar_para" value={voltarPara} />
          <input type="hidden" name="qtd" value={linhasFormulario.length} />
          {linhasExistentes.map(({ seguradora: s, vinculo: v, i }) => (
            <div key={`${s}-${i}`} className="rounded-lg border border-gray-200 p-3">
              <input type="hidden" name={`seguradora_${i}`} value={s} />
              <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                <input type="checkbox" name={`ativo_${i}`} defaultChecked={v?.ativo ?? false} />
                {s}
                {v?.cnpj_o2 ? (
                  <span className="text-xs font-normal text-gray-400">— {v.cnpj_o2}</span>
                ) : !v ? (
                  <span className="text-xs font-normal text-gray-400">— nova origem</span>
                ) : null}
              </label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div>
                  <label className="mb-0.5 block text-xs text-gray-500">Dia de vencimento</label>
                  <input
                    name={`dia_vencimento_${i}`}
                    type="number"
                    min={1}
                    max={31}
                    defaultValue={v?.dia_vencimento ?? ""}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-gray-500">Origem da fatura</label>
                  <select name={`cnpj_o2_${i}`} defaultValue={v?.cnpj_o2 ?? ""} className={inputClass}>
                    <option value="">—</option>
                    <option value="O2 Seguros">O2 Seguros</option>
                    <option value="O2 Capitalização">O2 Capitalização</option>
                    <option value="SegImob">SegImob</option>
                  </select>
                </div>
                <div>
                  <label className="mb-0.5 block text-xs text-gray-500">Observação</label>
                  <input name={`observacao_${i}`} defaultValue={v?.observacao ?? ""} className={inputClass} />
                </div>
              </div>
            </div>
          ))}

          {linhasNovas.length > 0 && (
            <details className="rounded-lg border border-dashed border-gray-300 p-3">
              <summary className="cursor-pointer text-sm font-medium text-o2-navy">+ Adicionar outra seguradora</summary>
              <div className="mt-3 space-y-4">
                {linhasNovas.map(({ seguradora: s, vinculo: v, i }) => (
                  <div key={`${s}-${i}`} className="rounded-lg border border-gray-200 p-3">
                    <input type="hidden" name={`seguradora_${i}`} value={s} />
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
                      <input type="checkbox" name={`ativo_${i}`} defaultChecked={v?.ativo ?? false} />
                      {s}
                    </label>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div>
                        <label className="mb-0.5 block text-xs text-gray-500">Dia de vencimento</label>
                        <input
                          name={`dia_vencimento_${i}`}
                          type="number"
                          min={1}
                          max={31}
                          defaultValue={v?.dia_vencimento ?? ""}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-xs text-gray-500">Origem da fatura</label>
                        <select name={`cnpj_o2_${i}`} defaultValue={v?.cnpj_o2 ?? ""} className={inputClass}>
                          <option value="">—</option>
                          <option value="O2 Seguros">O2 Seguros</option>
                          <option value="O2 Capitalização">O2 Capitalização</option>
                          <option value="SegImob">SegImob</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-0.5 block text-xs text-gray-500">Observação</label>
                        <input name={`observacao_${i}`} defaultValue={v?.observacao ?? ""} className={inputClass} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
          <button
            type="submit"
            className="rounded-full bg-o2-coral px-5 py-2 text-sm font-medium text-white transition hover:opacity-90"
          >
            Salvar
          </button>
        </form>
      </div>
    </>
  );
}
