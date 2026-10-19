"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COBERTURAS, DISCRIMINACOES, formatarReais, totalDebitos, type Debito } from "@/lib/sinistros/regras";
import { salvarDebitos } from "../actions";
import { Aviso, botaoPrimario, botaoSecundario, inputClass } from "../ui";

type Linha = Debito & { chave: number };

let proximaChave = 1;
function novaLinha(parcial: Partial<Debito> = {}): Linha {
  return { chave: proximaChave++, discriminacao: "Aluguel", vencimento: "", competencia: "", valor: 0, multa: 0, acrescimos: 0, ...parcial };
}

// Competência no formato MM/AAAA a partir do vencimento (sugestão; dá pra
// editar).
function competenciaDe(vencimento: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return "";
  const [a, m] = vencimento.split("-");
  return `${m}/${a}`;
}

export default function EditorDebitos({
  id,
  iniciais,
  coberturas,
  editavel,
}: {
  id: string;
  iniciais: Debito[];
  coberturas: string[];
  editavel: boolean;
}) {
  const router = useRouter();
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    iniciais.length
      ? iniciais.map((d) => novaLinha({ ...d, vencimento: d.vencimento ?? "", competencia: d.competencia ?? "" }))
      : [novaLinha()]
  );
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pendente, iniciar] = useTransition();

  // Discriminações sugeridas = coberturas marcadas no passo 2 + "Outros".
  const opcoes = DISCRIMINACOES.filter((t) => {
    const c = COBERTURAS.find((x) => x.titulo === t);
    return !c || coberturas.includes(c.chave);
  });

  function alterar(chave: number, campo: keyof Debito, valor: string) {
    setSalvo(false);
    setLinhas((ls) =>
      ls.map((l) => {
        if (l.chave !== chave) return l;
        const nova = { ...l, [campo]: ["valor", "multa", "acrescimos"].includes(campo) ? Number(valor.replace(",", ".")) || 0 : valor };
        if (campo === "vencimento" && !l.competencia) nova.competencia = competenciaDe(valor);
        return nova;
      })
    );
  }

  function salvar(depois?: string) {
    setErro(null);
    iniciar(async () => {
      const r = await salvarDebitos(id, linhas);
      if (!r.ok) {
        setErro(r.erro ?? "Não foi possível salvar.");
        return;
      }
      setSalvo(true);
      if (depois) router.push(depois);
      else router.refresh();
    });
  }

  const total = totalDebitos(linhas);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        Uma linha por boleto em aberto. Esta tabela é a base da <b>Declaração de Débitos</b>: valor que não estiver aqui não é analisado pela seguradora.
      </p>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-o2-navy text-left text-xs text-white">
            <tr>
              <th className="px-2 py-2">Discriminação</th>
              <th className="px-2 py-2">Vencimento</th>
              <th className="px-2 py-2">Competência</th>
              <th className="px-2 py-2">Valor (R$)</th>
              <th className="px-2 py-2">Multa (R$)</th>
              <th className="px-2 py-2">Acréscimos (R$)</th>
              {editavel && <th />}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className="border-t border-gray-100">
                <td className="p-1.5">
                  <select disabled={!editavel} value={l.discriminacao} onChange={(e) => alterar(l.chave, "discriminacao", e.target.value)} className={inputClass}>
                    {[...new Set([...opcoes, l.discriminacao])].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </td>
                <td className="p-1.5">
                  <input type="date" disabled={!editavel} value={l.vencimento ?? ""} onChange={(e) => alterar(l.chave, "vencimento", e.target.value)} className={inputClass} />
                </td>
                <td className="p-1.5">
                  <input disabled={!editavel} value={l.competencia ?? ""} placeholder="MM/AAAA" onChange={(e) => alterar(l.chave, "competencia", e.target.value)} className={`${inputClass} w-24`} />
                </td>
                {(["valor", "multa", "acrescimos"] as const).map((campo) => (
                  <td key={campo} className="p-1.5">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      disabled={!editavel}
                      value={l[campo] || ""}
                      onChange={(e) => alterar(l.chave, campo, e.target.value)}
                      className={`${inputClass} w-28 text-right`}
                    />
                  </td>
                ))}
                {editavel && (
                  <td className="p-1.5">
                    <button type="button" onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))} className="text-xs text-red-600 hover:underline">
                      remover
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-200 bg-gray-50">
              <td colSpan={3} className="px-3 py-2">
                {editavel && (
                  <button type="button" onClick={() => setLinhas((ls) => [...ls, novaLinha()])} className="text-sm font-semibold text-o2-coral hover:underline">
                    + Adicionar linha
                  </button>
                )}
              </td>
              <td colSpan={editavel ? 4 : 3} className="px-3 py-2 text-right font-semibold text-o2-navy">
                Total avisado: {formatarReais(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {editavel && (
        <div className="flex justify-end gap-3">
          <button type="button" disabled={pendente} onClick={() => salvar()} className={botaoSecundario}>
            {salvo ? "Salvo ✓" : "Salvar"}
          </button>
          <button type="button" disabled={pendente} onClick={() => salvar(`/sinistros/${id}?passo=4`)} className={botaoPrimario}>
            {pendente ? "Salvando…" : "Salvar e continuar →"}
          </button>
        </div>
      )}
    </div>
  );
}
