"use client";

import { useState } from "react";

// Pedido do Matheus, 15/09/2026: o "Resultado" (comissão - repasse) deve
// recalcular na hora que a pessoa digita, sem precisar salvar a linha
// primeiro. Só essas 3 células viram client component -- quantidade de
// apólices e prêmio líquido continuam simples (não entram nessa conta).
// Os inputs continuam usando o atributo `form={formId}` pra seguir
// associados ao form externo (vazio, só com os hidden fields) que já
// existe pra cada linha -- salvar continua sendo o mesmo form action de
// sempre, isso aqui só adianta o cálculo visual antes do "Salvar".
function formatarMoeda(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function CelulasComissaoRepasse({
  formId,
  comissaoInicial,
  repasseInicial,
  className,
}: {
  formId: string;
  comissaoInicial: number;
  repasseInicial: number;
  className: string;
}) {
  const [comissao, setComissao] = useState(comissaoInicial);
  const [repasse, setRepasse] = useState(repasseInicial);
  const resultado = comissao - repasse;

  return (
    <>
      <td className="p-3">
        <input
          form={formId}
          name="comissao_gerada"
          type="number"
          min="0"
          step="0.01"
          defaultValue={comissaoInicial}
          onChange={(e) => setComissao(Number(e.target.value) || 0)}
          className={className}
        />
      </td>
      <td className="p-3">
        <input
          form={formId}
          name="repasse_gerado"
          type="number"
          min="0"
          step="0.01"
          defaultValue={repasseInicial}
          onChange={(e) => setRepasse(Number(e.target.value) || 0)}
          className={className}
        />
      </td>
      <td className={`p-3 text-right text-sm font-semibold ${resultado < 0 ? "text-red-600" : "text-o2-navy"}`}>{formatarMoeda(resultado)}</td>
    </>
  );
}
