"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { excluirContatoImobiliaria, registrarContatoImobiliaria } from "./actions";
import { DIAS_SEM_CONTATO_ALERTA, ICONE_CANAL, ROTULO_CANAL, type CanalContato, type UltimosContatos } from "@/lib/campanhas/contatosTipos";

const ddmm = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }) : null);
const primeiroNome = (email: string | null) => {
  if (!email) return "equipe";
  const parte = email.split("@")[0].split(/[._-]/)[0];
  return parte.charAt(0).toUpperCase() + parte.slice(1);
};
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

// Célula "Último contato" do quadro da campanha (22/10/2026): último contato
// do responsável (Bitrix + lançados por fora), demais contatos da equipe e
// o botão para registrar um contato feito fora do Bitrix (telefone ou
// WhatsApp particular, visita).
export default function ContatoImobiliaria({
  campanhaId,
  contatos,
  unidades,
  responsaveis,
}: {
  campanhaId: string;
  contatos: UltimosContatos | null;
  unidades: { id: string; nome: string }[];
  responsaveis: string[];
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [canal, setCanal] = useState<CanalContato>("whatsapp");
  const [data, setData] = useState(hojeSP());
  const [feitoPor, setFeitoPor] = useState(contatos?.responsavelEmail ?? "");
  const [unidade, setUnidade] = useState(unidades[0]?.id ?? "");
  const [obs, setObs] = useState("");
  const [pendente, setPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const opcoesQuem = [...new Set([...responsaveis, ...(contatos?.responsavelEmail ? [contatos.responsavelEmail] : [])])].sort();

  async function salvar() {
    setErro(null);
    setPendente(true);
    try {
      await registrarContatoImobiliaria(campanhaId, { imobiliariaId: unidade, canal, data, feitoPor, observacao: obs });
      setAberto(false);
      setObs("");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui registrar.");
    } finally {
      setPendente(false);
    }
  }

  async function apagar(id: string) {
    if (!window.confirm("Apagar este contato lançado por fora?")) return;
    setErro(null);
    try {
      await excluirContatoImobiliaria(id);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui apagar.");
    }
  }

  const alerta = !contatos || contatos.diasSemContato === null || contatos.diasSemContato > DIAS_SEM_CONTATO_ALERTA;
  const quemConta = contatos?.responsavelEmail ? `${primeiroNome(contatos.responsavelEmail)}: ` : "";
  const campo = "w-full rounded border border-gray-300 px-1.5 py-1 text-xs focus:border-o2-coral focus:outline-none";

  return (
    <div className="min-w-[170px] space-y-0.5 text-[11px] leading-tight text-gray-600">
      {contatos === null ? (
        <span className="text-xs text-gray-400">Bitrix indisponível agora</span>
      ) : (
        <>
          <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${alerta ? "bg-red-100 text-red-700" : "bg-green-100 text-green-800"}`}>
            {quemConta}
            {contatos.diasSemContato === null ? "sem contato em 90 dias" : contatos.diasSemContato === 0 ? "hoje" : `há ${contatos.diasSemContato} dia(s)`}
          </span>
          {contatos.eventos.map((e, i) => (
            <div
              key={`${e.origem}-${e.id ?? i}-${e.data}`}
              className={`flex items-center gap-1 whitespace-nowrap ${e.quem && e.quem === contatos.responsavelEmail ? "font-medium text-o2-navy" : ""}`}
              title={e.observacao ?? undefined}
            >
              <span>
                {ICONE_CANAL[e.canal]} {ROTULO_CANAL[e.canal].toLowerCase()} {ddmm(e.data)} · {primeiroNome(e.quem)}
                {e.origem === "manual" && <span className="text-gray-400"> (por fora{e.observacao ? ": " + e.observacao.slice(0, 30) : ""})</span>}
              </span>
              {e.origem === "manual" && e.id && (
                <button type="button" onClick={() => apagar(e.id as string)} className="text-gray-400 hover:text-red-700" title="Apagar este contato" data-export-ignore="true">
                  ×
                </button>
              )}
            </div>
          ))}
          {contatos.emailCampanha && <div className="whitespace-nowrap text-gray-400">✉ e-mail da campanha {ddmm(contatos.emailCampanha)}</div>}
          {contatos.semEmpresaNoBitrix && <div className="text-amber-700">sem empresa ligada no Bitrix</div>}
        </>
      )}

      {!aberto ? (
        <button type="button" onClick={() => setAberto(true)} className="mt-0.5 text-[11px] font-medium text-o2-coral hover:underline" data-export-ignore="true">
          + Registrar contato
        </button>
      ) : (
        <div className="mt-1 w-56 space-y-1 rounded-lg border border-o2-navy/15 bg-white p-2 shadow-sm" data-export-ignore="true">
          <div className="text-[11px] font-semibold text-o2-navy">Contato feito fora do Bitrix</div>
          {unidades.length > 1 && (
            <select value={unidade} onChange={(e) => setUnidade(e.target.value)} className={campo}>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-2 gap-1">
            <select value={canal} onChange={(e) => setCanal(e.target.value as CanalContato)} className={campo}>
              {(Object.keys(ROTULO_CANAL) as CanalContato[]).map((c) => (
                <option key={c} value={c}>
                  {ROTULO_CANAL[c]}
                </option>
              ))}
            </select>
            <input type="date" value={data} max={hojeSP()} onChange={(e) => setData(e.target.value)} className={campo} />
          </div>
          <select value={feitoPor} onChange={(e) => setFeitoPor(e.target.value)} className={campo}>
            <option value="">Feito por mim</option>
            {opcoesQuem.map((e) => (
              <option key={e} value={e} title={e}>
                Feito por {primeiroNome(e)}
              </option>
            ))}
          </select>
          <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} placeholder="O que foi conversado (opcional)" className={campo} />
          {erro && <div className="text-red-700">{erro}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={salvar} disabled={pendente || !unidade} className="rounded-full bg-o2-coral px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
              {pendente ? "…" : "Registrar"}
            </button>
            <button type="button" onClick={() => setAberto(false)} className="text-xs text-gray-500 hover:underline">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {!aberto && erro && <div className="text-red-700">{erro}</div>}
    </div>
  );
}
