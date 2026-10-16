"use client";

import { useEffect, useMemo, useState } from "react";
import { buscarContatosEnvio } from "../actions";
import type { LinhaPanorama } from "@/lib/panoramaFiancaConstantes";
import {
  EMAIL_FIANCA,
  assuntoSugerido,
  montarHtmlEmailPanorama,
  precisaLinkBiometria,
  seguradorasAprovadas,
  statusSugerido,
  type StatusEmail,
} from "@/lib/panoramaFiancaEmail";

// Janela de envio do panorama por e-mail (Fase 2, 16/10/2026). Spec:
// seguro-fianca-analise/ESPECIFICACAO-ENVIO-EMAIL-PANORAMA-FIANCA.md

export type DadosEnvio = {
  versao: number;
  inquilino: string;
  linhas: LinhaPanorama[];
  pngDataUrl: string; // vai no corpo do e-mail
  pdfBase64: string; // vai anexo (alta qualidade)
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "2026-11-16" (input date) -> "16/11", como a equipe escreve.
const ddmm = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

export default function JanelaEnvioEmail({
  cardId,
  dados,
  onFechar,
  onEnviado,
}: {
  cardId: number;
  dados: DadosEnvio;
  onFechar: () => void;
  onEnviado: (texto: string) => void;
}) {
  const enderecoCard = `card-1042-${cardId}@notificacoes.o2seguros.com.br`;
  const seguradoras = useMemo(() => seguradorasAprovadas(dados.linhas), [dados.linhas]);

  const [carregando, setCarregando] = useState(true);
  const [erroContatos, setErroContatos] = useState<string | null>(null);
  // Destinatários: e-mail -> marcado?
  const [para, setPara] = useState<Record<string, boolean>>({});
  const [inquilinoEmail, setInquilinoEmail] = useState<string | null>(null);
  const [cc, setCc] = useState<Record<string, boolean>>({});
  const [nomesCotadores, setNomesCotadores] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState("");
  const [status, setStatus] = useState<StatusEmail>(() => statusSugerido(dados.linhas));
  const [assunto, setAssunto] = useState(() => assuntoSugerido(dados.inquilino, statusSugerido(dados.linhas)));
  const [validade, setValidade] = useState("");
  const [biometria, setBiometria] = useState<Record<string, string>>({}); // seguradora -> link ("x" = Tokio marcada)
  const [observacoes, setObservacoes] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    buscarContatosEnvio(cardId).then((r) => {
      setCarregando(false);
      if (!r.ok) {
        setErroContatos(r.erro);
        return;
      }
      // Só marca sozinho quando a imobiliária tem 1 e-mail. Com vários, o
      // colaborador escolhe -- caso real (Ramiro Sá, 16/10): financeiro@,
      // laudos@, contratos@ e um endereço do WhatsApp (powerzap) juntos.
      const unico = r.emailsImobiliaria.length === 1;
      setPara(Object.fromEntries(r.emailsImobiliaria.map((e) => [e, unico])));
      setInquilinoEmail(r.emailInquilino);
      setCc(Object.fromEntries(r.cotadores.map((c) => [c.email, true])));
      setNomesCotadores(Object.fromEntries(r.cotadores.map((c) => [c.email, c.nome])));
    });
  }, [cardId]);

  const listaExtras = extras
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const extrasInvalidos = listaExtras.filter((e) => !EMAIL_REGEX.test(e));
  const destinatarios = [...Object.keys(para).filter((e) => para[e]), ...listaExtras.filter((e) => EMAIL_REGEX.test(e))];
  const copias = Object.keys(cc).filter((e) => cc[e]);

  const biometrias = seguradoras
    .filter((s) => (precisaLinkBiometria(s) ? biometria[s]?.trim() : biometria[s] === "x"))
    .map((s) => ({ seguradora: s, link: biometria[s] ?? "" }));

  const previa = montarHtmlEmailPanorama({
    inquilino: dados.inquilino,
    status,
    validade: ddmm(validade) || "__/__",
    imagemSrc: dados.pngDataUrl,
    biometrias,
    observacoes,
  });

  async function enviar() {
    setErro(null);
    if (!destinatarios.length) return setErro("Escolha pelo menos um destinatário.");
    if (extrasInvalidos.length) return setErro(`E-mail inválido: ${extrasInvalidos.join(", ")}`);
    if (!validade) return setErro("Preencha a validade das cartas.");
    setEnviando(true);
    try {
      const resp = await fetch("/api/seguro-fianca/panoramas/enviar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cardId,
          versao: dados.versao,
          para: destinatarios,
          cc: copias,
          assunto,
          status,
          validade: ddmm(validade),
          biometrias,
          observacoes,
          pngBase64: dados.pngDataUrl.split(",")[1],
          pdfBase64: dados.pdfBase64,
        }),
      });
      const r = await resp.json().catch(() => ({ ok: false, erro: `Erro ${resp.status}` }));
      if (!r.ok) return setErro(r.erro ?? "Falha ao enviar.");
      onEnviado(
        `Panorama v${dados.versao} enviado para ${destinatarios.join(", ")}.` +
          (r.registradoNoCard ? " Registrado no card do Bitrix." : " Atenção: não consegui registrar no card do Bitrix (o e-mail saiu).")
      );
    } finally {
      setEnviando(false);
    }
  }

  const caixa = "rounded-lg border border-gray-300 px-2 py-1.5 text-sm w-full focus:border-o2-coral focus:outline-none";
  const rotulo = "mb-1 block text-xs font-semibold text-gray-600";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal>
      <div className="w-full max-w-6xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-semibold text-o2-navy">Enviar panorama v{dados.versao} por e-mail — {dados.inquilino}</h2>
          <button type="button" onClick={onFechar} className="text-sm text-gray-500 hover:text-gray-800" disabled={enviando}>
            Fechar ✕
          </button>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Formulário */}
          <div className="space-y-4">
            {carregando ? (
              <p className="text-sm text-gray-500">Buscando e-mails no Bitrix…</p>
            ) : (
              <>
                {erroContatos && <p className="rounded bg-amber-50 p-2 text-xs text-amber-800">{erroContatos}</p>}
                <div>
                  <span className={rotulo}>Para</span>
                  {Object.keys(para).length === 0 && (
                    <p className="text-xs text-amber-700">A imobiliária não tem e-mail no Bitrix. Digite abaixo (e cadastre no Bitrix).</p>
                  )}
                  {Object.keys(para).length > 1 && (
                    <p className="mb-1 text-xs text-gray-500">A imobiliária tem vários e-mails no Bitrix — marque para quem enviar.</p>
                  )}
                  {Object.keys(para).map((e) => (
                    <label key={e} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={para[e]} onChange={(ev) => setPara({ ...para, [e]: ev.target.checked })} />
                      {e} <span className="text-xs text-gray-400">(imobiliária)</span>
                    </label>
                  ))}
                  {inquilinoEmail && !(inquilinoEmail in para) && (
                    <button
                      type="button"
                      className="mt-1 text-xs text-o2-navy underline"
                      onClick={() => setPara({ ...para, [inquilinoEmail]: true })}
                    >
                      + incluir inquilino ({inquilinoEmail})
                    </button>
                  )}
                  <input
                    className={`${caixa} mt-2`}
                    placeholder="Outros e-mails (separe por vírgula)"
                    value={extras}
                    onChange={(e) => setExtras(e.target.value)}
                  />
                  {extrasInvalidos.length > 0 && <p className="mt-1 text-xs text-red-600">Inválido: {extrasInvalidos.join(", ")}</p>}
                </div>

                <div>
                  <span className={rotulo}>Cópia</span>
                  <p className="text-sm text-gray-700">{EMAIL_FIANCA} <span className="text-xs text-gray-400">(sempre)</span></p>
                  {Object.keys(cc).map((e) => (
                    <label key={e} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={cc[e]} onChange={(ev) => setCc({ ...cc, [e]: ev.target.checked })} />
                      {nomesCotadores[e] || e} <span className="text-xs text-gray-400">({e} · cotador)</span>
                    </label>
                  ))}
                </div>
              </>
            )}

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <label className={rotulo} htmlFor="assunto">Assunto</label>
                <input id="assunto" className={caixa} value={assunto} onChange={(e) => setAssunto(e.target.value)} />
              </div>
              <div>
                <label className={rotulo} htmlFor="status">Resultado</label>
                <select
                  id="status"
                  className={caixa}
                  value={status}
                  onChange={(e) => {
                    const novo = e.target.value as StatusEmail;
                    setStatus(novo);
                    setAssunto(assuntoSugerido(dados.inquilino, novo));
                  }}
                >
                  <option>PRÉ-APROVADO</option>
                  <option>APROVADO</option>
                </select>
              </div>
            </div>

            <div>
              <label className={rotulo} htmlFor="validade">Validade das cartas aprovadas *</label>
              <input id="validade" type="date" className={`${caixa} max-w-48`} value={validade} onChange={(e) => setValidade(e.target.value)} />
            </div>

            {seguradoras.length > 0 && (
              <div>
                <span className={rotulo}>Biometria facial (só entra no e-mail o que for preenchido)</span>
                <div className="space-y-2">
                  {seguradoras.map((s) =>
                    precisaLinkBiometria(s) ? (
                      <div key={s} className="flex items-center gap-2">
                        <span className="w-24 shrink-0 text-sm text-o2-navy">{s}</span>
                        <input
                          className={caixa}
                          placeholder="link de biometria deste cliente"
                          value={biometria[s] ?? ""}
                          onChange={(e) => setBiometria({ ...biometria, [s]: e.target.value })}
                        />
                      </div>
                    ) : (
                      <label key={s} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={biometria[s] === "x"}
                          onChange={(e) => setBiometria({ ...biometria, [s]: e.target.checked ? "x" : "" })}
                        />
                        <span className="text-o2-navy">{s}</span>
                        <span className="text-xs text-gray-500">— avisar que o link vai pelo celular cadastrado</span>
                      </label>
                    )
                  )}
                </div>
              </div>
            )}

            <div>
              <label className={rotulo} htmlFor="obs">Observações (pendência documental etc. — opcional)</label>
              <textarea id="obs" rows={3} className={caixa} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
            </div>

            <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              <b>Vincular a conversa original:</b> coloque este endereço em cópia no e-mail da ficha no Gmail para as mensagens de lá
              também entrarem no card:
              <div className="mt-1 flex items-center gap-2">
                <code className="rounded bg-white px-2 py-1 text-o2-navy">{enderecoCard}</code>
                <button
                  type="button"
                  className="text-o2-navy underline"
                  onClick={() => {
                    navigator.clipboard.writeText(enderecoCard).then(() => setCopiado(true));
                  }}
                >
                  {copiado ? "Copiado ✓" : "Copiar"}
                </button>
              </div>
              As respostas a este e-mail já voltam para o card automaticamente.
            </div>

            {erro && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{erro}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onFechar} disabled={enviando} className="rounded-lg px-4 py-2 text-sm text-gray-600">
                Cancelar
              </button>
              <button
                type="button"
                onClick={enviar}
                disabled={enviando || carregando}
                className="rounded-lg bg-o2-coral px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {enviando ? "Enviando…" : `Enviar para ${destinatarios.length} destinatário(s)`}
              </button>
            </div>
          </div>

          {/* Prévia */}
          <div>
            <span className={rotulo}>Prévia do e-mail (o PDF alta qualidade vai anexo)</span>
            <iframe title="Prévia do e-mail" srcDoc={previa} className="h-[640px] w-full rounded-lg border border-gray-200 bg-white" />
          </div>
        </div>
      </div>
    </div>
  );
}
