"use client";

import { useState } from "react";
import InfoLegenda from "@/components/InfoLegenda";

export type NumerosEmail = {
  id: string;
  rotulo: string;
  destinatarios: number;
  enviados: number;
  enviadosExternos: number;
  falhas: number;
  abriram: number;
  clicaram: number;
  descadastros: number;
};

const TODOS = "todos";

// Resumo do envio de uma campanha com VÁRIOS e-mails (27/10/2026): os envios
// moram nas campanhas filhas (boas-vindas, parciais...), então os cards somam
// todos os e-mails e o seletor recorta um e-mail só. Abertura e clique contam
// só quem é de fora da O2 (mesma regra de sempre).
export function ResumoEnvios({ emails }: { emails: NumerosEmail[] }) {
  const [escolhido, setEscolhido] = useState(TODOS);
  const alvo = escolhido === TODOS ? emails : emails.filter((e) => e.id === escolhido);
  const soma = (campo: keyof Omit<NumerosEmail, "id" | "rotulo">) => alvo.reduce((s, e) => s + e[campo], 0);
  const enviadosExternos = soma("enviadosExternos");
  const taxa = enviadosExternos > 0 ? (soma("abriram") / enviadosExternos) * 100 : 0;

  const cartao = (valor: number, rotulo: string, cor: string) => (
    <div className="bg-quadro p-4 text-center">
      <p className={`text-2xl font-bold ${cor}`}>{valor}</p>
      <p className="text-xs text-gray-500">{rotulo}</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-gray-600" htmlFor="resumo-email">
          Mostrar números de
        </label>
        <select
          id="resumo-email"
          value={escolhido}
          onChange={(e) => setEscolhido(e.target.value)}
          className="max-w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:border-o2-coral focus:outline-none"
        >
          <option value={TODOS}>Todos os e-mails ({emails.length})</option>
          {emails.map((e) => (
            <option key={e.id} value={e.id}>
              {e.rotulo}
            </option>
          ))}
        </select>
        <InfoLegenda titulo="Resumo do envio">
          Soma dos envios de todos os e-mails da campanha (boas-vindas, parciais e demais), ou de um e-mail só ao escolher no seletor. Destinatários e enviados contam cada envio: quem recebeu dois e-mails aparece duas vezes. Abriram e Clicaram contam só quem é de fora da O2.
        </InfoLegenda>
      </div>

      <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-xl border border-o2-navy/10 bg-gray-200 shadow-sm">
        {cartao(soma("destinatarios"), "Destinatários", "text-o2-navy")}
        {cartao(soma("enviados"), "Enviados", "text-green-700")}
        {cartao(soma("falhas"), "Falhas", "text-red-600")}
      </div>

      <p className="text-xs text-gray-500">
        Abertura e clique contam só quem é de fora da O2 · taxa de abertura {taxa.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ({enviadosExternos} enviado(s) fora da O2)
      </p>
      <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-xl border border-o2-navy/10 bg-gray-200 shadow-sm">
        {cartao(soma("abriram"), "Abriram", "text-o2-navy")}
        {cartao(soma("clicaram"), "Clicaram", "text-o2-navy")}
        {cartao(soma("descadastros"), "Descadastros", "text-gray-600")}
      </div>
    </div>
  );
}
