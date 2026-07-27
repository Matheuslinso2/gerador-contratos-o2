"use client";

import { useMemo, useState } from "react";
import { days360 } from "@/lib/days360";

const fmtMoeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function CalculadoraMulta() {
  const [aluguel, setAluguel] = useState("");
  const [vezes, setVezes] = useState("3");
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [desocupacao, setDesocupacao] = useState("");

  const resultado = useMemo(() => {
    const aluguelNum = Number(aluguel);
    const vezesNum = Number(vezes);
    if (!aluguelNum || !vezesNum || !inicio || !fim || !desocupacao) return null;

    const duracaoTotalDias = days360(inicio, fim);
    const diasRestantes = days360(desocupacao, fim);
    if (duracaoTotalDias <= 0) return null;

    const multaTotal = aluguelNum * vezesNum;
    const valorPorDia = multaTotal / duracaoTotalDias;
    const valorApurado = valorPorDia * diasRestantes;

    const mesesRestantes = Math.max(0, Math.floor(diasRestantes / 30));
    const diasRestantesResto = Math.max(0, diasRestantes % 30);

    return {
      multaTotal,
      duracaoTotalDias,
      diasRestantes,
      mesesRestantes,
      diasRestantesResto,
      valorPorDia,
      valorApurado,
    };
  }, [aluguel, vezes, inicio, fim, desocupacao]);

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border border-o2-navy/10 bg-white p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Dados do contrato</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Aluguel vigente (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={aluguel}
              onChange={(e) => setAluguel(e.target.value)}
              placeholder="Ex: 1200.00"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Quantidade de vezes o valor do aluguel (multa)</label>
            <input
              type="number"
              min="0"
              step="1"
              value={vezes}
              onChange={(e) => setVezes(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm text-gray-600">Início do contrato</label>
            <input
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Fim do contrato</label>
            <input
              type="date"
              value={fim}
              onChange={(e) => setFim(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-gray-600">Data da desocupação</label>
            <input
              type="date"
              value={desocupacao}
              onChange={(e) => setDesocupacao(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 focus:border-o2-coral focus:outline-none"
            />
          </div>
        </div>
      </section>

      {resultado && (
        <section className="space-y-3 rounded-xl border border-o2-coral/30 bg-o2-coral/5 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-o2-navy">Resultado</h2>

          <div className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm text-gray-700 sm:grid-cols-2">
            <p>Multa total (aluguel × {vezes}): <span className="font-medium">{fmtMoeda(resultado.multaTotal)}</span></p>
            <p>Duração total do contrato: <span className="font-medium">{resultado.duracaoTotalDias} dias</span></p>
            <p>Valor da multa por dia: <span className="font-medium">{fmtMoeda(resultado.valorPorDia)}</span></p>
            <p>
              Tempo restante até o fim do contrato:{" "}
              <span className="font-medium">
                {resultado.mesesRestantes} {resultado.mesesRestantes === 1 ? "mês" : "meses"} e{" "}
                {resultado.diasRestantesResto} {resultado.diasRestantesResto === 1 ? "dia" : "dias"}{" "}
                ({resultado.diasRestantes} dias)
              </span>
            </p>
          </div>

          <div className="rounded-lg bg-o2-navy px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-white/70">Valor apurado da multa</p>
            <p className="text-2xl font-bold text-white">{fmtMoeda(resultado.valorApurado)}</p>
          </div>
        </section>
      )}

      {!resultado && (
        <p className="text-sm text-gray-500">
          Preencha o aluguel, a quantidade de aluguéis da multa e as três datas para ver o resultado.
        </p>
      )}
    </div>
  );
}
