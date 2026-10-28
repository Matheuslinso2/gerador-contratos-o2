"use client";

import { useState } from "react";
import type { DocumentoLista } from "@/lib/erp/documentos";
import { vincular } from "./actions";

const data = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const SITUACAO: Record<string, string> = { vigente: "Vigente", vencido: "Vencida", cancelado: "Cancelada" };

export default function EscolherApolice({
  entidade,
  cardId,
  passe,
  resultados,
  numeroAtual,
  buscou,
}: {
  entidade: number;
  cardId: number;
  passe: string;
  resultados: DocumentoLista[];
  numeroAtual: string;
  buscou: boolean;
}) {
  const [enviando, setEnviando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [vinculado, setVinculado] = useState<string | null>(null);

  async function escolher(d: DocumentoLista) {
    setMsg(null);
    setEnviando(d.id);
    try {
      const r = await vincular(entidade, cardId, passe, d.id);
      if (r.ok) {
        setVinculado(d.id);
        setMsg({
          ok: true,
          texto: `Vinculado: o nº ${r.numero} foi gravado no card.${r.endossoNoErp ? " O endosso também ficou ligado à apólice no ERP." : " Quando o endosso entrar no ERP, ele já sai ligado a esta apólice."} Atualize o card (F5) para ver o campo preenchido.`,
        });
      } else setMsg({ ok: false, texto: r.erro });
    } catch {
      setMsg({ ok: false, texto: "Não consegui vincular agora. Tente de novo." });
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className="space-y-2">
      {msg && (
        <p className={`rounded-lg border p-3 text-sm ${msg.ok ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>{msg.texto}</p>
      )}
      {!buscou ? (
        <p className="text-sm text-gray-500">Digite o nº da apólice, o nome ou o CPF/CNPJ para buscar.</p>
      ) : resultados.length === 0 ? (
        <p className="text-sm text-gray-500">Nenhuma apólice encontrada com essa busca. Tente outro dado ou marque &quot;Buscar em todas as imobiliárias&quot;.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-o2-navy/10">
          <table className="w-full text-sm">
            <thead className="bg-quadro text-left text-xs uppercase tracking-wide text-o2-navy">
              <tr>
                <th className="p-2">Nº da apólice</th>
                <th className="p-2">Titular</th>
                <th className="p-2">Seguradora / produto</th>
                <th className="p-2">Vigência</th>
                <th className="p-2 text-right">Prêmio total</th>
                <th className="p-2">Imobiliária</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {resultados.map((d) => {
                const atual = !!numeroAtual && d.numero_apolice === numeroAtual;
                return (
                  <tr key={d.id} className={`border-t ${vinculado === d.id || atual ? "bg-green-50" : ""}`}>
                    <td className="p-2 font-semibold tabular-nums">
                      {d.numero_apolice ?? "—"}
                      <div className="text-[11px] font-normal text-gray-500">Código O2 {d.nosso_numero}</div>
                    </td>
                    <td className="p-2">
                      {d.titular ?? d.cliente ?? "—"}
                      {d.inquilino && d.inquilino !== d.titular && <div className="text-[11px] text-gray-500">Inquilino: {d.inquilino}</div>}
                    </td>
                    <td className="p-2">
                      {d.seguradora_nome ?? "—"}
                      <div className="text-[11px] text-gray-500">{d.produto_nome ?? ""}</div>
                    </td>
                    <td className="whitespace-nowrap p-2">
                      {data(d.vigencia_inicio)} a {data(d.vigencia_fim)}
                      <div className="text-[11px] text-gray-500">{SITUACAO[d.situacao] ?? d.situacao}</div>
                    </td>
                    <td className="p-2 text-right tabular-nums">{brl(d.premio_total)}</td>
                    <td className="p-2 text-xs">{d.imobiliaria ?? "—"}</td>
                    <td className="p-2">
                      {atual && vinculado !== d.id ? (
                        <span className="text-xs font-medium text-green-700">Já no card</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => escolher(d)}
                          disabled={!!enviando || vinculado === d.id}
                          className="rounded-full bg-o2-coral px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {enviando === d.id ? "Vinculando…" : vinculado === d.id ? "Vinculado ✓" : "Vincular"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
