"use client";

import { useEffect, useRef, useState } from "react";
import { O2_CINZA_ESCURO, FONTE } from "@/lib/integracoes/emailO2";
import { uploadImagemCampanha } from "./actions";

// Editor de corpo do e-mail com negrito/sublinhado/colar formatado e
// inserção de imagem (pedido da reunião de 15/09/2026). O corpo final
// precisa ser HTML baseado em tabela (<tr><td>...</td></tr>) pra
// compatibilidade com Outlook -- ver envolverEmailCampanha, que interpola
// `corpo_html` direto dentro de um <table> -- então em vez de submeter o
// innerHTML cru do contentEditable (que o navegador estrutura em <div>/<p>
// soltos), cada bloco de nível superior é lido e reembrulhado num <tr><td>
// antes de ir pro input escondido.
// Reverso de sincronizar(): cada <tr><td ...>CONTEUDO</td></tr> salvo no
// banco vira um <div>CONTEUDO</div> solto, formato que o contentEditable
// entende de verdade -- um <tr> fora de <table> é HTML inválido, e o
// navegador descarta ou reorganiza sozinho de forma imprevisível se
// receber isso direto (usado ao reabrir uma campanha existente pra editar
// o conteúdo, ver EditarConteudoCampanha.tsx).
function desembrulharParaEdicao(corpoHtml: string): string {
  const blocos: string[] = [];
  const regex = /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(corpoHtml))) {
    blocos.push(`<div>${match[1]}</div>`);
  }
  return blocos.length ? blocos.join("") : corpoHtml;
}

// Causa real da imagem "quebrada" (achado completo em 17/09/2026, revendo
// o caso de perto): não é só colar do WhatsApp Desktop (file:/blob:) --
// pegou um caso real onde a imagem veio de dentro do Gmail (visualizando o
// anexo do WhatsApp encaminhado por e-mail e colando dali), e o Gmail bota
// no clipboard um <img src="https://mail.google.com/mail/...&view=fimg...">
// -- um link de verdade, com https, mas preso à SESSÃO de quem colou (só
// resolve se o navegador de quem vê tiver aquela conta do Gmail logada).
// Passa batido em qualquer checagem de prefixo (file:/blob:) porque parece
// uma URL normal. Por isso a regra virou "confia só no que a gente mesmo
// subiu" em vez de tentar adivinhar todo formato de link que não presta.
function referenciaDeImagemConfiavel(src: string): boolean {
  const baseStorage = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/campanhas-imagens/`;
  return src.startsWith(baseStorage);
}

export function EditorCorpo({ name, corpoInicialHtml }: { name: string; corpoInicialHtml?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ultimaSelecaoRef = useRef<Range | null>(null);
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [erroImagem, setErroImagem] = useState<string | null>(null);
  const [corpoHtmlValue, setCorpoHtmlValue] = useState("");

  // Causa real de "não consigo inserir/trocar a imagem" (achado 17/09/2026,
  // 2ª rodada): document.execCommand("insertHTML") insere na seleção ATUAL
  // do navegador -- mas abrir o seletor de arquivo nativo (janela do
  // sistema operacional) rouba o foco da página por tempo suficiente pra
  // essa seleção não voltar de forma confiável quando o arquivo é
  // escolhido e o foco retorna. Resultado: a imagem some ou nunca chega a
  // aparecer, sem erro nenhum. Guarda a posição do cursor MANUALMENTE (no
  // mousedown do botão, ainda com o editor focado) e restaura ela na hora
  // de inserir, em vez de confiar que o navegador vai lembrar sozinho.
  function capturarSelecaoAtual() {
    const selecao = window.getSelection();
    const editor = editorRef.current;
    if (!selecao || !editor || selecao.rangeCount === 0) return;
    const range = selecao.getRangeAt(0);
    if (editor.contains(range.startContainer)) {
      ultimaSelecaoRef.current = range.cloneRange();
    }
  }

  useEffect(() => {
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // Navegador sem suporte a execCommand (raro) -- segue sem forçar <p>,
      // o parser de blocos abaixo ainda lida com <div> solto.
    }
    // Achado 17/09/2026 (3ª rodada): o conteúdo inicial NÃO pode vir de
    // dangerouslySetInnerHTML no JSX -- toda vez que o componente
    // re-renderiza (inclusive por causa do PRÓPRIO setEnviandoImagem
    // true/false disparado por uma inserção de imagem), o React reaplica
    // esse innerHTML e apaga qualquer imagem/edição inserida manualmente no
    // DOM entre um render e outro (confirmado com um teste isolado
    // forçando re-renders durante o upload -- a imagem sumia sempre que
    // setEnviandoImagem(false) rodava logo depois de inserir). Por isso o
    // HTML inicial só é aplicado UMA VEZ aqui, imperativamente, e o <div>
    // do editor nunca mais recebe esse prop via JSX depois disso.
    if (editorRef.current) {
      editorRef.current.innerHTML = desembrulharParaEdicao(corpoInicialHtml ?? "");
    }
    // Campanha existente reaberta pra editar (EditarConteudoCampanha) pode
    // já trazer uma referência quebrada salva de ANTES desse fix existir --
    // sincronizar()/aoColar só rodam em resposta a uma ação do usuário, não
    // no carregamento inicial, então sem isso a imagem quebrada ficaria
    // muda até o usuário mexer em alguma coisa.
    removerImagensSemReferenciaValida();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function paddingBloco() {
    return `padding:6px 28px;font-size:14px;color:${O2_CINZA_ESCURO};font-family:${FONTE};line-height:1.6;`;
  }

  function sincronizar() {
    const editor = editorRef.current;
    if (!editor) return;

    const linhas: string[] = [];
    let soltoAtual = "";
    const fecharSolto = () => {
      if (soltoAtual.trim()) linhas.push(soltoAtual);
      soltoAtual = "";
    };

    editor.childNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === "P" || el.tagName === "DIV") {
          fecharSolto();
          const conteudo = el.innerHTML.trim();
          if (conteudo && conteudo.toLowerCase() !== "<br>") linhas.push(conteudo);
          return;
        }
        soltoAtual += el.outerHTML;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        soltoAtual += node.textContent ?? "";
      }
    });
    fecharSolto();

    // Estado controlado, não ref imperativa -- mesmo achado do
    // dangerouslySetInnerHTML acima: um input não-controlado
    // (defaultValue) também se mostrou reiniciando pra "" em
    // re-renders disparados por setEnviandoImagem, perdendo o valor
    // certo que sincronizar() tinha acabado de gravar.
    setCorpoHtmlValue(linhas.map((conteudo) => `<tr><td style="${paddingBloco()}">${conteudo}</td></tr>`).join(""));
  }

  function aplicarFormatacao(comando: string) {
    editorRef.current?.focus();
    document.execCommand(comando);
    sincronizar();
  }

  // Upload de verdade + inserção no editor -- usado tanto pelo botão
  // "Inserir imagem" quanto por colar uma imagem de verdade (ver aoColar).
  // Insere via Range explícito (não execCommand) -- ver capturarSelecaoAtual
  // acima pro motivo.
  async function inserirImagemNoEditor(arquivo: File) {
    setErroImagem(null);
    setEnviandoImagem(true);
    try {
      const formData = new FormData();
      formData.append("imagem", arquivo);
      const url = await uploadImagemCampanha(formData);

      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();

      const img = document.createElement("img");
      img.src = url;
      img.style.cssText = "max-width:100%;display:block;margin:8px 0;border-radius:8px;";

      const range = ultimaSelecaoRef.current;
      if (range && editor.contains(range.startContainer)) {
        range.deleteContents();
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        const selecao = window.getSelection();
        selecao?.removeAllRanges();
        selecao?.addRange(range);
        ultimaSelecaoRef.current = range.cloneRange();
      } else {
        // Sem posição salva (editor vazio, nunca teve foco ainda) -- põe no
        // final do conteúdo em vez de perder a imagem.
        editor.appendChild(img);
      }

      sincronizar();
    } catch (erro) {
      setErroImagem(erro instanceof Error ? erro.message : "Falha ao enviar imagem.");
    } finally {
      setEnviandoImagem(false);
    }
  }

  async function selecionarImagem(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    await inserirImagemNoEditor(arquivo);
  }

  // Causa real da imagem "quebrada" só na hora do envio (achado 17/09/2026):
  // colar uma imagem copiada de outro app (ex: WhatsApp Desktop) às vezes
  // não põe o bitmap de verdade na área de transferência, só uma referência
  // de arquivo local (file://...) ou um blob: -- o navegador de quem colou
  // ainda enxerga essa imagem (o arquivo existe NA MÁQUINA dela), então
  // parece funcionar normalmente até o e-mail sair e chegar em outro
  // computador, onde esse caminho não existe. Intercepta o paste: se tiver
  // um bitmap de verdade no clipboard, sobe pro Storage igual ao botão
  // "Inserir imagem"; senão, deixa colar o texto normal e limpa qualquer
  // <img> com referência que nunca vai resolver, avisando na hora em vez
  // de só na hora do envio.
  async function aoColar(e: React.ClipboardEvent<HTMLDivElement>) {
    const item = [...e.clipboardData.items].find((it) => it.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      capturarSelecaoAtual();
      const arquivo = item.getAsFile();
      if (arquivo) await inserirImagemNoEditor(arquivo);
      return;
    }
    setTimeout(() => {
      sincronizar();
      removerImagensSemReferenciaValida();
    }, 0);
  }

  function removerImagensSemReferenciaValida() {
    const editor = editorRef.current;
    if (!editor) return;
    const imagensQuebradas = [...editor.querySelectorAll("img")].filter(
      (img) => !referenciaDeImagemConfiavel(img.getAttribute("src") ?? "")
    );
    if (!imagensQuebradas.length) return;
    imagensQuebradas.forEach((img) => img.remove());
    setErroImagem(
      'Uma imagem foi removida por não ser uma referência confiável (era um link local, de blob ou preso à sessão de quem colou -- nunca chegaria certo pra outra pessoa) — use o botão "Inserir imagem" acima pra anexar de novo.'
    );
    sincronizar();
  }

  const botaoClass =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:border-o2-coral hover:text-o2-coral disabled:opacity-50";

  return (
    <div>
      <div className="mb-0 flex flex-wrap items-center gap-1.5 rounded-t-lg border border-b-0 border-gray-300 bg-gray-50 p-1.5">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => aplicarFormatacao("bold")} className={`${botaoClass} font-bold`}>
          N
        </button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => aplicarFormatacao("underline")} className={`${botaoClass} underline`}>
          S
        </button>
        <span className="mx-1 h-4 w-px bg-gray-300" />
        {/* onMouseDown com preventDefault + capturarSelecaoAtual (achado
            17/09/2026): sem o preventDefault, o clique no botão rouba o
            foco do editor antes de conseguirmos ler a seleção. Guarda a
            posição do cursor (ou a imagem selecionada, se o usuário clicou
            numa pra substituir) AQUI, com o editor ainda focado -- abrir o
            seletor de arquivo do sistema operacional em seguida não deixa
            garantido que essa posição volte sozinha, por isso ela é restaurada
            manualmente em inserirImagemNoEditor. */}
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            capturarSelecaoAtual();
          }}
          onClick={() => fileInputRef.current?.click()}
          disabled={enviandoImagem}
          className={botaoClass}
        >
          {enviandoImagem ? "Enviando imagem..." : "Inserir imagem"}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={selecionarImagem} />
      </div>
      {erroImagem && <p className="border border-t-0 border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700">{erroImagem}</p>}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={sincronizar}
        onBlur={sincronizar}
        onPaste={aoColar}
        className="min-h-[180px] rounded-b-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none [&_img]:max-w-full [&_img]:rounded-lg"
      />
      <p className="mt-1 text-xs text-gray-400">Escreva normalmente, dá pra colar texto formatado, deixar em negrito/sublinhado e inserir imagem.</p>
      <input type="hidden" name={name} value={corpoHtmlValue} readOnly />
    </div>
  );
}
