"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import PanoramaVisual from "../PanoramaVisual";
import JanelaEnvioEmail, { type DadosEnvio } from "./JanelaEnvioEmail";
import { gerarVersaoPanorama } from "../actions";
import type { CardPanorama } from "@/lib/bitrix/panoramaFianca";
import {
  LINHAS_PANORAMA,
  LMI_BASICO,
  LMI_COMPLETO,
  ROTULO_PAGAMENTO,
  ROTULO_STATUS,
  celulaPreenchida,
  precoNumero,
  statusEditavel,
  type CabecalhoPanorama,
  type CelulaPreco,
  type ChaveLinha,
  type FormaPagamento,
  type LinhaPanorama,
  type PrecosLinha,
} from "@/lib/panoramaFiancaConstantes";

export type VersaoSalva = {
  versao: number;
  cabecalho: CabecalhoPanorama;
  linhas: LinhaPanorama[];
  formaPagamento: FormaPagamento;
  assinaturaStatus: string;
  geradoPor: string;
  geradoEm: string;
};

type Precos = Partial<Record<ChaveLinha, PrecosLinha>>;
type Plano = "basico" | "completo";

const LARGURA = 1600;
const ALTURA = 900;

function nomeArquivo(cardId: number, versao: number, inquilino: string) {
  const slug = inquilino
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `panorama-fianca-${cardId}-v${versao}-${slug}`;
}

async function capturar(elemento: HTMLElement, escala: number): Promise<HTMLCanvasElement> {
  const { default: html2canvas } = await import("html2canvas-pro");
  // Garante fonte e logos carregados antes da captura (senão sai sem logo).
  await document.fonts.ready;
  await Promise.all(
    [...elemento.querySelectorAll("img")].map((img) =>
      img.complete ? null : new Promise((ok) => ((img.onload = ok), (img.onerror = ok)))
    )
  );
  return html2canvas(elemento, { scale: escala, backgroundColor: "#ffffff", useCORS: true, width: LARGURA, height: ALTURA });
}

// Máscara de moeda do campo valor (pedido do Matheus 16/10/2026): o
// colaborador digita só números e os 2 últimos viram centavos -- "15151" ->
// "151,51", "1235400" -> "12.354,00". Evita o erro de digitar 12354 querendo
// dizer 123,54 (caso real do card 2816). Resultado continua compatível com
// precoNumero().
function mascaraReal(digitado: string): string {
  const digitos = digitado.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9);
  if (!digitos) return "";
  return (Number(digitos) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Só as células preenchidas das linhas aprovadas -- pra saber se o rascunho
// mudou em relação à última versão salva.
function assinaturaPrecos(linhas: LinhaPanorama[]): string {
  return JSON.stringify(
    linhas
      .filter((l) => statusEditavel(l.status))
      .map((l) => [
        l.chave,
        ...(["basico", "completo"] as const).flatMap((plano) =>
          Object.entries(l.precos[plano] as Record<string, CelulaPreco>)
            .filter(([, c]) => celulaPreenchida(c))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([lmi, c]) => `${plano}${lmi}:${c.parcelas.trim()}x${precoNumero(c.valor)}`)
        ),
      ])
  );
}

async function montarPdf(canvas: HTMLCanvasElement) {
  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "l", unit: "px", format: [LARGURA, ALTURA], hotfixes: ["px_scaling"], compress: true });
  // PNG sem perda (texto nítido em qualquer zoom). Sem a compressão
  // "SLOW" o jsPDF guardava os pixels crus e o arquivo passava de 9 MB.
  pdf.addImage(canvas, "PNG", 0, 0, LARGURA, ALTURA, undefined, "SLOW");
  return pdf;
}

function baixar(url: string, nome: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.click();
}

// passeBitrix: preenchido quando a tela roda dentro da aba "Panorama" do
// card no Bitrix (sem login do Workspace) -- ver lib/bitrix/sessaoPanorama.ts.
export default function Montador({
  card,
  versoes,
  passeBitrix,
}: {
  card: CardPanorama;
  versoes: VersaoSalva[];
  passeBitrix?: string;
}) {
  const router = useRouter();
  const ultima = versoes[0];

  // Grade começa com os preços da última versão (versão 2+ normalmente só
  // ajusta alguns valores -- tratativa de desconto ou seguradora nova).
  const [precos, setPrecos] = useState<Precos>(() =>
    Object.fromEntries((ultima?.linhas ?? []).map((l) => [l.chave, l.precos]))
  );
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento | null>(ultima?.formaPagamento ?? null);
  // null = rascunho atual. Card que já tem versão abre nela, com os botões
  // de download à mão (antes abria no rascunho e o colaborador não achava
  // os downloads -- relato do Matheus 16/10/2026). Editar qualquer campo
  // volta pro rascunho.
  const [versaoAberta, setVersaoAberta] = useState<number | null>(ultima?.versao ?? null);
  const [mensagem, setMensagem] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [baixando, setBaixando] = useState<"png" | "png_hd" | "pdf" | null>(null);
  const [gerando, iniciarGeracao] = useTransition();

  const statusMudou = !!ultima && ultima.assinaturaStatus !== card.assinaturaStatus;

  const rascunho: LinhaPanorama[] = useMemo(
    () => card.linhas.map((l) => ({ ...l, precos: precos[l.chave] ?? { basico: {}, completo: {} } })),
    [card.linhas, precos]
  );

  const versaoExibida = versaoAberta !== null ? versoes.find((v) => v.versao === versaoAberta) : undefined;
  const dadosVisual = versaoExibida
    ? { cabecalho: versaoExibida.cabecalho, linhas: versaoExibida.linhas, formaPagamento: versaoExibida.formaPagamento }
    : { cabecalho: card.cabecalho, linhas: rascunho, formaPagamento: formaPagamento ?? ("" as FormaPagamento) };

  // Pré-visualização = o mesmo componente de 1600×900, encolhido pra caber.
  const caixaRef = useRef<HTMLDivElement>(null);
  const capturaRef = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(0.5);
  useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    const obs = new ResizeObserver(([e]) => setEscala(e.contentRect.width / LARGURA));
    obs.observe(caixa);
    return () => obs.disconnect();
  }, []);

  function alterarCelula(chave: ChaveLinha, plano: Plano, lmi: string, campo: keyof CelulaPreco, valor: string) {
    setVersaoAberta(null);
    setPrecos((atual) => {
      const linha = atual[chave] ?? { basico: {}, completo: {} };
      const grade = { ...linha[plano] } as Record<string, CelulaPreco>;
      grade[lmi] = { ...(grade[lmi] ?? { parcelas: "", valor: "" }), [campo]: valor };
      return { ...atual, [chave]: { ...linha, [plano]: grade } };
    });
  }

  function gerar() {
    setMensagem(null);
    if (!formaPagamento) {
      setMensagem({ tipo: "erro", texto: "Escolha a forma de pagamento." });
      return;
    }
    iniciarGeracao(async () => {
      const r = await gerarVersaoPanorama(card.id, formaPagamento, precos, passeBitrix);
      if (!r.ok) {
        setMensagem({ tipo: "erro", texto: r.erro });
        return;
      }
      setMensagem({ tipo: "ok", texto: `Versão ${r.versao} gerada. Baixe o PNG ou o PDF abaixo.` });
      router.refresh();
      setVersaoAberta(r.versao);
    });
  }

  // png = WhatsApp (2400×1350, leve); png_hd e pdf = e-mail em alta
  // qualidade (4800×2700, sem perda) -- pedido do Matheus em 16/10/2026,
  // enquanto o envio por e-mail não é ligado no Workspace (Fase 2).
  // Baixar funciona em qualquer tela (pedido do Matheus 16/10/2026). No
  // rascunho, o download salva a versão antes -- todo arquivo que sai tem
  // versão registrada (base do controle de envio). Se o rascunho é igual à
  // última versão, reaproveita ela em vez de criar duplicata.
  // Versão que vai sair (download ou e-mail). No rascunho, salva antes --
  // ou reaproveita a última se nada mudou. null = não deu (mensagem já
  // mostrada).
  async function garantirVersao(acao: string): Promise<{ versao: number; nova: boolean } | null> {
    if (versaoExibida) return { versao: versaoExibida.versao, nova: false };
    if (!formaPagamento) {
      setMensagem({ tipo: "erro", texto: `Escolha a forma de pagamento antes de ${acao}.` });
      return null;
    }
    const igualUltima =
      !!ultima &&
      !statusMudou &&
      ultima.formaPagamento === formaPagamento &&
      assinaturaPrecos(ultima.linhas) === assinaturaPrecos(rascunho);
    if (igualUltima) return { versao: ultima.versao, nova: false };
    const r = await gerarVersaoPanorama(card.id, formaPagamento, precos, passeBitrix);
    if (!r.ok) {
      setMensagem({ tipo: "erro", texto: r.erro });
      return null;
    }
    return { versao: r.versao, nova: true };
  }

  async function exportar(tipo: "png" | "png_hd" | "pdf") {
    if (!capturaRef.current) return;
    setMensagem(null);
    setBaixando(tipo);
    const garantida = await garantirVersao("baixar");
    if (!garantida) {
      setBaixando(null);
      return;
    }
    const { versao, nova: novaVersao } = garantida;
    try {
      const canvas = await capturar(capturaRef.current, tipo === "png" ? 1.5 : 3);
      const nome = nomeArquivo(card.id, versao, dadosVisual.cabecalho.inquilino);
      if (tipo !== "pdf") {
        baixar(canvas.toDataURL("image/png"), `${nome}${tipo === "png_hd" ? "-alta-qualidade" : ""}.png`);
      } else {
        (await montarPdf(canvas)).save(`${nome}.pdf`);
      }
      if (novaVersao) {
        setMensagem({ tipo: "ok", texto: `Versão ${versao} salva e baixada.` });
        router.refresh();
        setVersaoAberta(versao);
      }
    } finally {
      setBaixando(null);
    }
  }

  // Envio por e-mail (Fase 2, 16/10/2026): garante a versão, gera a imagem
  // (vai no corpo) e o PDF alta qualidade (vai anexo) e abre a janela.
  // janelaAberta + envio: card sem seguradora aprovada abre a janela só
  // com recusa/pendências (envio = null, sem panorama).
  const [janelaAberta, setJanelaAberta] = useState(false);
  const [envio, setEnvio] = useState<DadosEnvio | null>(null);
  const [preparandoEnvio, setPreparandoEnvio] = useState(false);
  async function abrirEnvio() {
    if (!capturaRef.current) return;
    setMensagem(null);
    if (!card.linhas.some((l) => statusEditavel(l.status))) {
      setEnvio(null);
      setJanelaAberta(true);
      return;
    }
    setPreparandoEnvio(true);
    try {
      const garantida = await garantirVersao("enviar");
      if (!garantida) return;
      const corpoPng = await capturar(capturaRef.current, 1.5);
      const pdf = await montarPdf(await capturar(capturaRef.current, 3));
      setEnvio({
        versao: garantida.versao,
        inquilino: dadosVisual.cabecalho.inquilino,
        linhas: dadosVisual.linhas,
        pngDataUrl: corpoPng.toDataURL("image/png"),
        pdfBase64: pdf.output("datauristring").split(",")[1],
      });
      setJanelaAberta(true);
      if (garantida.nova) {
        router.refresh();
        setVersaoAberta(garantida.versao);
      }
    } finally {
      setPreparandoEnvio(false);
    }
  }

  const visiveis = card.linhas.filter((l) => l.status !== "oculto");
  const inputBase = "rounded border border-gray-300 px-1.5 py-1 text-sm focus:border-o2-coral focus:outline-none";

  return (
    <div className="space-y-5">
      {statusMudou && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <b>Atualização disponível:</b> o status de alguma seguradora mudou no Bitrix desde a versão {ultima.versao}. Confira
          a grade e gere uma nova versão.
        </p>
      )}

      {/* 1. Dados do card (só leitura -- correção é no Bitrix) */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-o2-navy">1. Dados do card (vêm do Bitrix)</h2>
          <button type="button" onClick={() => router.refresh()} className="text-sm text-o2-navy underline">
            Recarregar do Bitrix
          </button>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-gray-500">Imobiliária: </dt><dd className="inline">{card.cabecalho.imobiliaria || "—"}</dd></div>
          <div><dt className="inline text-gray-500">Inquilino: </dt><dd className="inline">{card.cabecalho.inquilino}</dd></div>
          <div className="sm:col-span-2"><dt className="inline text-gray-500">Imóvel: </dt><dd className="inline">{card.cabecalho.imovel || "—"}</dd></div>
          <div>
            <dt className="inline text-gray-500">Aluguel / Cond. / IPTU: </dt>
            <dd className="inline">
              {[card.cabecalho.aluguel, card.cabecalho.condominio, card.cabecalho.iptu]
                .map((n) => (n ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"))
                .join(" / ")}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-gray-500">Algo errado? Corrija no card do Bitrix e clique em &ldquo;Recarregar do Bitrix&rdquo;.</p>
      </section>

      {/* 2. Grade de preços */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-1 font-semibold text-o2-navy">2. Preços dos portais</h2>
        <p className="mb-3 text-xs text-gray-500">
          Colunas = LMI (múltiplos do aluguel). Em cada célula: nº de parcelas e valor da parcela. Deixe vazio o LMI que a seguradora não oferece.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr className="text-xs text-gray-500">
                <th className="text-left" rowSpan={2}>Seguradora</th>
                <th rowSpan={2}>Status</th>
                <th colSpan={LMI_BASICO.length} className="bg-gray-100 py-1">Plano Básico</th>
                <th colSpan={LMI_COMPLETO.length} className="bg-gray-100 py-1">Plano Completo</th>
              </tr>
              <tr className="text-xs text-gray-500">
                {LMI_BASICO.map((l) => <th key={`b${l}`}>{l}x</th>)}
                {LMI_COMPLETO.map((l) => <th key={`c${l}`}>{l}x</th>)}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => {
                const def = LINHAS_PANORAMA.find((d) => d.chave === l.chave)!;
                const editavel = statusEditavel(l.status);
                const celula = (plano: Plano, lmi: string) => {
                  const c = (precos[l.chave]?.[plano] as Record<string, CelulaPreco> | undefined)?.[lmi];
                  if (!editavel) return <td key={`${plano}${lmi}`} className="rounded bg-gray-100" />;
                  return (
                    <td key={`${plano}${lmi}`} className="rounded bg-orange-50 p-1">
                      <div className="flex items-center gap-1">
                        <input
                          aria-label={`${def.seguradora} ${def.plano ?? ""} ${plano} ${lmi}x parcelas`}
                          inputMode="numeric"
                          placeholder="nº"
                          className={`${inputBase} w-11`}
                          value={c?.parcelas ?? ""}
                          onChange={(e) => alterarCelula(l.chave, plano, lmi, "parcelas", e.target.value.replace(/\D/g, ""))}
                        />
                        <span className="text-xs text-gray-400">x</span>
                        <input
                          aria-label={`${def.seguradora} ${def.plano ?? ""} ${plano} ${lmi}x valor`}
                          inputMode="numeric"
                          placeholder="0,00"
                          className={`${inputBase} w-24 text-right`}
                          value={c?.valor ?? ""}
                          onChange={(e) => alterarCelula(l.chave, plano, lmi, "valor", mascaraReal(e.target.value))}
                        />
                      </div>
                    </td>
                  );
                };
                return (
                  <tr key={l.chave}>
                    <td className="whitespace-nowrap pr-2 font-medium text-o2-navy">
                      {def.seguradora} {def.plano && <span className="text-xs text-gray-500">{def.plano}</span>}
                    </td>
                    <td className={`whitespace-nowrap px-2 text-center text-xs font-semibold ${editavel ? "text-o2-coral" : "text-gray-400"}`}>
                      {ROTULO_STATUS[l.status]}
                    </td>
                    {LMI_BASICO.map((lmi) => celula("basico", lmi))}
                    {LMI_COMPLETO.map((lmi) => celula("completo", lmi))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {card.linhas.some((l) => l.status === "oculto") && (
          <p className="mt-2 text-xs text-gray-500">
            Não aparecem no panorama (status &ldquo;Não analisar&rdquo; ou não cotada):{" "}
            {card.linhas
              .filter((l) => l.status === "oculto")
              .map((l) => {
                const d = LINHAS_PANORAMA.find((x) => x.chave === l.chave)!;
                return d.plano ? `${d.seguradora} ${d.plano}` : d.seguradora;
              })
              .join(", ")}
          </p>
        )}
      </section>

      {/* 3. Forma de pagamento + gerar */}
      <section className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-o2-navy">3. Forma de pagamento</h2>
        {(Object.keys(ROTULO_PAGAMENTO) as FormaPagamento[]).map((f) => (
          <label key={f} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="pagamento"
              checked={formaPagamento === f}
              onChange={() => {
                setVersaoAberta(null);
                setFormaPagamento(f);
              }}
            />
            {ROTULO_PAGAMENTO[f]}
          </label>
        ))}
        <button
          type="button"
          onClick={gerar}
          disabled={gerando}
          className="ml-auto rounded-lg bg-o2-coral px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {gerando ? "Gerando…" : `Gerar versão ${(ultima?.versao ?? 0) + 1}`}
        </button>
      </section>

      {mensagem && (
        <p className={`rounded-lg p-3 text-sm ${mensagem.tipo === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
          {mensagem.texto}
        </p>
      )}

      {/* 4. Pré-visualização / versões */}
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-2 font-semibold text-o2-navy">4. Panorama</h2>
          <button
            type="button"
            onClick={() => setVersaoAberta(null)}
            className={`rounded-full px-3 py-1 text-xs ${versaoAberta === null ? "bg-o2-navy text-white" : "bg-gray-100"}`}
          >
            Rascunho atual
          </button>
          {versoes.map((v) => (
            <button
              key={v.versao}
              type="button"
              onClick={() => setVersaoAberta(v.versao)}
              className={`rounded-full px-3 py-1 text-xs ${versaoAberta === v.versao ? "bg-o2-navy text-white" : "bg-gray-100"}`}
              title={`Gerada por ${v.geradoPor} em ${new Date(v.geradoEm).toLocaleString("pt-BR")}`}
            >
              v{v.versao} · {new Date(v.geradoEm).toLocaleDateString("pt-BR")}
            </button>
          ))}
            <span className="ml-auto flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => exportar("png")}
                disabled={!!baixando}
                className="rounded-lg border border-o2-navy px-3 py-1.5 text-sm font-semibold text-o2-navy disabled:opacity-60"
              >
                {baixando === "png" ? "Gerando…" : "Baixar PNG (WhatsApp)"}
              </button>
              <button
                type="button"
                onClick={() => exportar("pdf")}
                disabled={!!baixando}
                className="rounded-lg border border-o2-navy px-3 py-1.5 text-sm font-semibold text-o2-navy disabled:opacity-60"
              >
                {baixando === "pdf" ? "Gerando…" : "Baixar PDF alta qualidade (e-mail)"}
              </button>
              <button
                type="button"
                onClick={() => exportar("png_hd")}
                disabled={!!baixando}
                className="rounded-lg border border-o2-navy px-3 py-1.5 text-sm font-semibold text-o2-navy disabled:opacity-60"
              >
                {baixando === "png_hd" ? "Gerando…" : "Baixar imagem alta qualidade (e-mail)"}
              </button>
              <button
                type="button"
                onClick={abrirEnvio}
                disabled={!!baixando || preparandoEnvio}
                className="rounded-lg bg-o2-coral px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {preparandoEnvio ? "Preparando…" : "✉ Enviar por e-mail"}
              </button>
            </span>
        </div>
        {versaoExibida ? (
          <p className="mb-2 text-xs text-gray-500">
            Versão {versaoExibida.versao} · gerada por {versaoExibida.geradoPor} em{" "}
            {new Date(versaoExibida.geradoEm).toLocaleString("pt-BR")} (retrato salvo, não muda mais)
          </p>
        ) : (
          <p className="mb-2 text-xs text-gray-500">Rascunho: atualiza enquanto você digita. Ao baixar, ele é salvo como nova versão automaticamente.</p>
        )}

        <div ref={caixaRef} className="w-full overflow-clip rounded-lg border border-gray-200" style={{ height: ALTURA * escala }}>
          <div style={{ transform: `scale(${escala})`, transformOrigin: "top left", width: LARGURA }}>
            <PanoramaVisual {...dadosVisual} />
          </div>
        </div>
      </section>

      {/* Cópia em tamanho real, fora da tela -- é ela que vira PNG/PDF
          (capturar a versão encolhida da pré-visualização sairia borrado). */}
      <div aria-hidden style={{ position: "fixed", left: -10000, top: 0, pointerEvents: "none" }}>
        <PanoramaVisual ref={capturaRef} {...dadosVisual} />
      </div>

      {janelaAberta && (
        <JanelaEnvioEmail
          cardId={card.id}
          passeBitrix={passeBitrix}
          card={{ inquilino: card.cabecalho.inquilino, imobiliaria: card.cabecalho.imobiliaria, linhas: card.linhas }}
          dados={envio}
          onFechar={() => setJanelaAberta(false)}
          onEnviado={(texto) => {
            setJanelaAberta(false);
            setMensagem({ tipo: "ok", texto });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
