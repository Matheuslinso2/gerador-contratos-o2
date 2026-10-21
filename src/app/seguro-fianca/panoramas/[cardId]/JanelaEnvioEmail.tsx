"use client";

import { useEffect, useMemo, useState } from "react";
import { buscarContatosEnvio, buscarConversasEnvio, prepararUploadCarta } from "../actions";
import { createClient as criarSupabaseNavegador } from "@/lib/supabase/browser";
import type { LinhaPanorama, LinhaStatus } from "@/lib/panoramaFiancaConstantes";
import {
  EMAIL_FIANCA,
  assuntoPorTipo,
  montarHtmlEmailPanorama,
  montarHtmlEmailPendencias,
  montarHtmlEmailRecusa,
  precisaLinkBiometria,
  seguradorasAprovadas,
  seguradorasRecusadas,
  statusSugerido,
  type StatusEmail,
  type TipoEmail,
} from "@/lib/panoramaFiancaEmail";

// Janela de envio por e-mail a partir do panorama (16/10/2026). Três tipos,
// com os mesmos textos dos modelos do E-mail no card: aprovado (panorama),
// recusado (sugestão de Capitalização) e pendências + recusas. Specs:
// seguro-fianca-analise/ESPECIFICACAO-ENVIO-EMAIL-PANORAMA-FIANCA.md

export type DadosEnvio = {
  versao: number;
  inquilino: string;
  linhas: LinhaPanorama[];
  pngDataUrl: string; // vai no corpo do e-mail
  pdfBase64: string; // vai anexo (alta qualidade)
};

export type InfoCardEnvio = { inquilino: string; imobiliaria: string; linhas: LinhaStatus[] };

type Carta = { nome: string; caminho: string | null; erro?: string };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "2026-11-16" (input date) -> "16/11", como a equipe escreve.
const ddmm = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

const ROTULO_TIPO: Record<TipoEmail, string> = {
  aprovado: "Aprovado / Pré-aprovado (panorama)",
  recusado: "Recusado (sugestão de Capitalização)",
  pendencias: "Pendências + recusas",
};

export default function JanelaEnvioEmail({
  cardId,
  passeBitrix,
  card,
  dados,
  onFechar,
  onEnviado,
}: {
  cardId: number;
  passeBitrix?: string;
  card: InfoCardEnvio;
  dados: DadosEnvio | null; // null = card sem seguradora aprovada (só recusa/pendências)
  onFechar: () => void;
  onEnviado: (texto: string) => void;
}) {
  const enderecoCard = `card-1042-${cardId}@notificacoes.o2seguros.com.br`;
  const seguradoras = useMemo(() => (dados ? seguradorasAprovadas(dados.linhas) : []), [dados]);
  const recusadas = useMemo(() => seguradorasRecusadas(card.linhas), [card.linhas]);

  const [tipo, setTipo] = useState<TipoEmail>(dados ? "aprovado" : "recusado");
  const [carregando, setCarregando] = useState(true);
  const [erroContatos, setErroContatos] = useState<string | null>(null);
  // Destinatários: e-mail -> marcado?
  const [para, setPara] = useState<Record<string, boolean>>({});
  const [inquilinoEmail, setInquilinoEmail] = useState<string | null>(null);
  const [cc, setCc] = useState<Record<string, boolean>>({});
  const [nomesCotadores, setNomesCotadores] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState("");
  const [status, setStatus] = useState<StatusEmail>(() => (dados ? statusSugerido(dados.linhas) : "PRÉ-APROVADO"));
  const [assunto, setAssunto] = useState(() =>
    assuntoPorTipo(dados ? "aprovado" : "recusado", card.inquilino, card.imobiliaria, dados ? statusSugerido(dados.linhas) : "PRÉ-APROVADO")
  );
  const [validade, setValidade] = useState("");
  const [biometria, setBiometria] = useState<Record<string, string>>({}); // seguradora -> link ("x" = Tokio marcada)
  const [contatoSeguradora, setContatoSeguradora] = useState("");
  const [telefoneSeguradora, setTelefoneSeguradora] = useState("");
  const [seguradoraPendente, setSeguradoraPendente] = useState("");
  const [documentos, setDocumentos] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [cartas, setCartas] = useState<Carta[]>([]);
  // Outros arquivos (qualquer tipo), além das cartas -- 21/10/2026.
  const [anexosExtras, setAnexosExtras] = useState<Carta[]>([]);
  // Nome que a imobiliária vê na caixa de entrada ("Nome | O2 Seguros"),
  // lembrado neste navegador -- mesmo campo do E-mail no card.
  const [remetente, setRemetente] = useState("");
  useEffect(() => {
    try {
      setRemetente(localStorage.getItem("o2_remetente_nome") || "");
    } catch {}
  }, []);
  function trocarRemetente(valor: string) {
    setRemetente(valor);
    try {
      localStorage.setItem("o2_remetente_nome", valor);
    } catch {}
  }
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  // Conversa de e-mail que já existe neste card (a mais recente): o envio
  // entra nela sempre, quem decide é o servidor. Aqui só mostramos o assunto.
  const [conversa, setConversa] = useState("");
  useEffect(() => {
    buscarConversasEnvio(cardId, passeBitrix).then((r) => {
      if (r.ok && r.conversas.length) setConversa(r.conversas[0].assuntoBase);
    });
  }, [cardId, passeBitrix]);

  useEffect(() => {
    buscarContatosEnvio(cardId, passeBitrix).then((r) => {
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
  }, [cardId, passeBitrix]);

  function trocarTipo(novo: TipoEmail) {
    setTipo(novo);
    setAssunto(assuntoPorTipo(novo, card.inquilino, card.imobiliaria, status));
  }

  // Cartas e anexos sobem direto do navegador pro Storage (URL assinada por arquivo).
  const anexarCartas = (arquivos: FileList | null) => subirArquivos(arquivos, setCartas);
  const anexarExtras = (arquivos: FileList | null) => subirArquivos(arquivos, setAnexosExtras);
  async function subirArquivos(arquivos: FileList | null, setCartas: React.Dispatch<React.SetStateAction<Carta[]>>) {
    if (!arquivos?.length) return;
    const supabase = criarSupabaseNavegador();
    for (const arquivo of Array.from(arquivos)) {
      setCartas((atual) => [...atual, { nome: arquivo.name, caminho: null }]);
      const preparo = await prepararUploadCarta(cardId, arquivo.name, arquivo.size, passeBitrix);
      let resultado: Carta;
      if (!preparo.ok) {
        resultado = { nome: arquivo.name, caminho: null, erro: preparo.erro };
      } else {
        const { error } = await supabase.storage.from(preparo.bucket).uploadToSignedUrl(preparo.caminho, preparo.token, arquivo);
        resultado = error ? { nome: arquivo.name, caminho: null, erro: "falhou ao subir" } : { nome: arquivo.name, caminho: preparo.caminho };
      }
      setCartas((atual) => atual.map((c) => (c.nome === arquivo.name && !c.caminho && !c.erro ? resultado : c)));
    }
  }

  const listaExtras = extras
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const extrasInvalidos = listaExtras.filter((e) => !EMAIL_REGEX.test(e));
  const destinatarios = [...Object.keys(para).filter((e) => para[e]), ...listaExtras.filter((e) => EMAIL_REGEX.test(e))];
  const copias = Object.keys(cc).filter((e) => cc[e]);
  const cartasProntas = cartas.filter((c) => c.caminho) as { nome: string; caminho: string }[];
  const extrasProntos = anexosExtras.filter((c) => c.caminho) as { nome: string; caminho: string }[];
  const subindo = [...cartas, ...anexosExtras].some((c) => !c.caminho && !c.erro);

  const biometrias = seguradoras
    .filter((s) => (precisaLinkBiometria(s) ? biometria[s]?.trim() : biometria[s] === "x"))
    .map((s) => ({ seguradora: s, link: biometria[s] ?? "" }));

  const previa =
    tipo === "aprovado" && dados
      ? montarHtmlEmailPanorama({
          inquilino: dados.inquilino,
          status,
          validade: ddmm(validade) || "__/__",
          imagemSrc: dados.pngDataUrl,
          biometrias,
          observacoes,
          recusadasComCarta: cartasProntas.length ? recusadas : [],
        })
      : tipo === "recusado"
        ? montarHtmlEmailRecusa({ inquilino: card.inquilino, contatoSeguradora, telefoneSeguradora, observacoes })
        : montarHtmlEmailPendencias({ inquilino: card.inquilino, seguradoraPendente, documentos, recusadas, observacoes });

  async function enviar() {
    setErro(null);
    if (!destinatarios.length) return setErro("Escolha pelo menos um destinatário.");
    if (extrasInvalidos.length) return setErro(`E-mail inválido: ${extrasInvalidos.join(", ")}`);
    if (subindo) return setErro("Espere as cartas terminarem de subir.");
    if (tipo === "aprovado" && !validade) return setErro("Preencha a validade das cartas.");
    if (tipo !== "aprovado" && !cartasProntas.length) return setErro("Anexe as cartas das seguradoras.");
    if (tipo === "pendencias" && !documentos.trim()) return setErro("Liste os documentos pedidos pela seguradora.");
    setEnviando(true);
    try {
      const resp = await fetch(passeBitrix ? "/bitrix-app/panorama-enviar" : "/api/seguro-fianca/panoramas/enviar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tipo,
          cardId,
          para: destinatarios,
          cc: copias,
          assunto,
          observacoes,
          cartas: cartasProntas,
          anexosExtras: extrasProntos,
          remetenteNome: remetente,
          passeBitrix,
          ...(tipo === "aprovado" && dados
            ? {
                versao: dados.versao,
                status,
                validade: ddmm(validade),
                biometrias,
                pngBase64: dados.pngDataUrl.split(",")[1],
                pdfBase64: dados.pdfBase64,
              }
            : {}),
          ...(tipo === "recusado" ? { contatoSeguradora, telefoneSeguradora } : {}),
          ...(tipo === "pendencias" ? { seguradoraPendente, documentos } : {}),
        }),
      });
      const r = await resp.json().catch(() => ({ ok: false, erro: `Erro ${resp.status}` }));
      if (!r.ok) return setErro(r.erro ?? "Falha ao enviar.");
      const oque = tipo === "aprovado" && dados ? `Panorama v${dados.versao}` : tipo === "recusado" ? "Recusa" : "Pendências";
      onEnviado(
        `${oque} enviado para ${destinatarios.join(", ")}.` +
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
          <h2 className="font-semibold text-o2-navy">Enviar e-mail — {card.inquilino}</h2>
          <button type="button" onClick={onFechar} className="text-sm text-gray-500 hover:text-gray-800" disabled={enviando}>
            Fechar ✕
          </button>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Formulário */}
          <div className="space-y-4">
            <div>
              <span className={rotulo}>Tipo de e-mail</span>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(ROTULO_TIPO) as TipoEmail[]).map((t) => {
                  const desabilitado = t === "aprovado" && !dados;
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={desabilitado}
                      onClick={() => trocarTipo(t)}
                      title={desabilitado ? "Nenhuma seguradora aprovada neste card" : undefined}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
                        tipo === t ? "bg-o2-navy text-white" : "bg-gray-100 text-o2-navy"
                      }`}
                    >
                      {ROTULO_TIPO[t]}
                    </button>
                  );
                })}
              </div>
            </div>

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
                <input
                  id="assunto"
                  className={`${caixa} disabled:bg-gray-100 disabled:text-gray-600`}
                  value={conversa ? `Re: ${conversa}` : assunto}
                  disabled={Boolean(conversa)}
                  onChange={(e) => setAssunto(e.target.value)}
                />
                {conversa && (
                  <p className="mt-1 text-xs text-gray-500">
                    Este card já tem uma conversa por e-mail: o envio entra nela automaticamente, junto com as mensagens anteriores.
                  </p>
                )}
              </div>
              {tipo === "aprovado" && (
                <div>
                  <label className={rotulo} htmlFor="status">Resultado</label>
                  <select
                    id="status"
                    className={caixa}
                    value={status}
                    onChange={(e) => {
                      const novo = e.target.value as StatusEmail;
                      setStatus(novo);
                      setAssunto(assuntoPorTipo("aprovado", card.inquilino, card.imobiliaria, novo));
                    }}
                  >
                    <option>PRÉ-APROVADO</option>
                    <option>APROVADO</option>
                  </select>
                </div>
              )}
            </div>

            {tipo === "aprovado" && (
              <>
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
              </>
            )}

            {tipo === "recusado" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={rotulo} htmlFor="contato">Seguradora para contato (opcional)</label>
                  <input id="contato" className={caixa} placeholder="ex.: Porto Seguro" value={contatoSeguradora} onChange={(e) => setContatoSeguradora(e.target.value)} />
                </div>
                <div>
                  <label className={rotulo} htmlFor="tel">Telefone da seguradora</label>
                  <input id="tel" className={caixa} placeholder="ex.: 0800 727 0901" value={telefoneSeguradora} onChange={(e) => setTelefoneSeguradora(e.target.value)} />
                </div>
                <p className="text-xs text-gray-500 sm:col-span-2">
                  A frase &ldquo;Para maiores esclarecimentos…&rdquo; só entra se os dois forem preenchidos. O link da ficha de Capitalização entra sempre.
                </p>
              </div>
            )}

            {tipo === "pendencias" && (
              <>
                <div>
                  <label className={rotulo} htmlFor="segpend">Seguradora que pediu documentos *</label>
                  <input id="segpend" className={caixa} placeholder="ex.: Tokio Marine" value={seguradoraPendente} onChange={(e) => setSeguradoraPendente(e.target.value)} />
                </div>
                <div>
                  <label className={rotulo} htmlFor="docs">Documentos pedidos * (um por linha)</label>
                  <textarea id="docs" rows={3} className={caixa} value={documentos} onChange={(e) => setDocumentos(e.target.value)} />
                </div>
                {recusadas.length > 0 && (
                  <p className="text-xs text-gray-500">Recusadas no card (entram no texto): {recusadas.join(", ")}</p>
                )}
              </>
            )}

            <div>
              <span className={rotulo}>
                {tipo === "aprovado" ? "Cartas de recusa das demais seguradoras (opcional)" : "Cartas das seguradoras (PDF) *"}
              </span>
              <input type="file" multiple accept=".pdf,image/*" onChange={(e) => anexarCartas(e.target.files).then(() => (e.target.value = ""))} className="text-sm" />
              {cartas.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {cartas.map((c, i) => (
                    <li key={`${c.nome}-${i}`} className="flex items-center gap-2">
                      <span className={c.erro ? "text-red-600" : "text-o2-navy"}>
                        📎 {c.nome} {c.erro ? `— ${c.erro}` : c.caminho ? "✓" : "— subindo…"}
                      </span>
                      <button type="button" className="text-xs text-gray-500 underline" onClick={() => setCartas(cartas.filter((_, j) => j !== i))}>
                        remover
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <span className={rotulo}>Outros anexos (opcional, qualquer arquivo)</span>
              <input type="file" multiple onChange={(e) => anexarExtras(e.target.files).then(() => (e.target.value = ""))} className="text-sm" />
              {anexosExtras.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm">
                  {anexosExtras.map((c, i) => (
                    <li key={`${c.nome}-${i}`} className="flex items-center gap-2">
                      <span className={c.erro ? "text-red-600" : "text-o2-navy"}>
                        📎 {c.nome} {c.erro ? `— ${c.erro}` : c.caminho ? "✓" : "— subindo…"}
                      </span>
                      <button type="button" className="text-xs text-gray-500 underline" onClick={() => setAnexosExtras(anexosExtras.filter((_, j) => j !== i))}>
                        remover
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label className={rotulo} htmlFor="remetente">Remetente (seu nome)</label>
              <input
                id="remetente"
                type="text"
                maxLength={40}
                placeholder="Ex: Henrique Guterres"
                autoComplete="off"
                className={caixa}
                value={remetente}
                onChange={(e) => trocarRemetente(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">
                Aparece na caixa de entrada como: {remetente.replace(/[^\p{L}\p{N} '\-]/gu, "").replace(/\s+/g, " ").trim() ? `${remetente.replace(/[^\p{L}\p{N} '\-]/gu, "").replace(/\s+/g, " ").trim()} | O2 Seguros` : "O2 Seguros"}
              </p>
            </div>

            <div>
              <label className={rotulo} htmlFor="obs">Observações (opcional)</label>
              <textarea id="obs" rows={2} className={caixa} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
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
                disabled={enviando || carregando || subindo}
                className="rounded-lg bg-o2-coral px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {enviando ? "Enviando…" : `Enviar para ${destinatarios.length} destinatário(s)`}
              </button>
            </div>
          </div>

          {/* Prévia */}
          <div>
            <span className={rotulo}>
              Prévia do e-mail{tipo === "aprovado" ? " (o PDF alta qualidade vai anexo)" : ""}
              {cartasProntas.length ? ` · ${cartasProntas.length} carta(s) anexa(s)` : ""}
              {extrasProntos.length ? ` · ${extrasProntos.length} anexo(s) extra(s)` : ""}
            </span>
            <iframe title="Prévia do e-mail" srcDoc={previa} className="h-[640px] w-full rounded-lg border border-gray-200 bg-white" />
          </div>
        </div>
      </div>
    </div>
  );
}
