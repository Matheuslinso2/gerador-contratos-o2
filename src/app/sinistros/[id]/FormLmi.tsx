"use client";

import { useState } from "react";
import SubmitButton from "@/components/SubmitButton";
import { COBERTURAS_LMI } from "@/lib/sinistros/regras";
import { salvarLmi } from "../operacao";
import { botaoSecundario, inputClass, labelClass } from "../ui";

// LMI da apólice: ( ) global ( ) individual -- no individual, uma caixa por
// cobertura para ativar só as que a apólice tem, cada uma com o seu limite
// (ajuste da equipe, 23/10/2026).
export default function FormLmi({
  id,
  ctx,
  tipoInicial,
  lmiGlobal,
  coberturas,
}: {
  id: string;
  ctx: string | null;
  tipoInicial: "global" | "individual";
  lmiGlobal: number | null;
  coberturas: Record<string, number>;
}) {
  const [tipo, setTipo] = useState(tipoInicial);
  const [ativas, setAtivas] = useState<string[]>(Object.keys(coberturas));
  return (
    <form action={salvarLmi} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      {ctx && <input type="hidden" name="ctx" value={ctx} />}
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" name="lmi_tipo" value="global" checked={tipo === "global"} onChange={() => setTipo("global")} className="accent-o2-coral" />
          Global
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="lmi_tipo" value="individual" checked={tipo === "individual"} onChange={() => setTipo("individual")} className="accent-o2-coral" />
          Individual (por cobertura)
        </label>
      </fieldset>
      {tipo === "global" ? (
        <div className="max-w-xs">
          <label className={labelClass}>LMI (R$)</label>
          <input name="lmi" inputMode="decimal" defaultValue={lmiGlobal ?? ""} placeholder="0,00" className={inputClass} />
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {COBERTURAS_LMI.map((c) => {
            const ativa = ativas.includes(c.chave);
            return (
              <div key={c.chave} className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${ativa ? "border-o2-coral bg-orange-50" : "border-gray-200 bg-white"}`}>
                <label className="flex flex-1 items-center gap-2 text-sm text-o2-navy">
                  <input
                    type="checkbox"
                    name={`ativa_${c.chave}`}
                    checked={ativa}
                    onChange={() => setAtivas((a) => (a.includes(c.chave) ? a.filter((x) => x !== c.chave) : [...a, c.chave]))}
                    className="accent-o2-coral"
                  />
                  {c.titulo}
                </label>
                {ativa && (
                  <input
                    name={`lmi_${c.chave}`}
                    inputMode="decimal"
                    defaultValue={coberturas[c.chave] ?? ""}
                    placeholder="LMI R$"
                    className="w-32 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
      <SubmitButton className={botaoSecundario} textoCarregando="…">
        Salvar LMI
      </SubmitButton>
    </form>
  );
}
