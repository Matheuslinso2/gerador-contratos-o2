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

export function EditorCorpo({ name, corpoInicialHtml }: { name: string; corpoInicialHtml?: string }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [erroImagem, setErroImagem] = useState<string | null>(null);

  useEffect(() => {
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // Navegador sem suporte a execCommand (raro) -- segue sem forçar <p>,
      // o parser de blocos abaixo ainda lida com <div> solto.
    }
  }, []);

  function paddingBloco() {
    return `padding:6px 28px;font-size:14px;color:${O2_CINZA_ESCURO};font-family:${FONTE};line-height:1.6;`;
  }

  function sincronizar() {
    const editor = editorRef.current;
    const hidden = hiddenRef.current;
    if (!editor || !hidden) return;

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

    hidden.value = linhas.map((conteudo) => `<tr><td style="${paddingBloco()}">${conteudo}</td></tr>`).join("");
  }

  function aplicarFormatacao(comando: string) {
    editorRef.current?.focus();
    document.execCommand(comando);
    sincronizar();
  }

  // Upload de verdade + inserção no editor -- usado tanto pelo botão
  // "Inserir imagem" quanto por colar uma imagem de verdade (ver aoColar).
  async function inserirImagemNoEditor(arquivo: File) {
    setErroImagem(null);
    setEnviandoImagem(true);
    try {
      const formData = new FormData();
      formData.append("imagem", arquivo);
      const url = await uploadImagemCampanha(formData);
      editorRef.current?.focus();
      document.execCommand(
        "insertHTML",
        false,
        `<img src="${url}" style="max-width:100%;display:block;margin:8px 0;border-radius:8px;" />`
      );
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
    const imagensQuebradas = [...editor.querySelectorAll("img")].filter((img) => {
      const src = img.getAttribute("src") ?? "";
      return src.startsWith("file:") || src.startsWith("blob:");
    });
    if (!imagensQuebradas.length) return;
    imagensQuebradas.forEach((img) => img.remove());
    setErroImagem(
      'Uma imagem colada não pôde ser inserida (era só uma referência local, não a imagem de verdade) — use o botão "Inserir imagem" acima pra anexar.'
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
        {/* onMouseDown com preventDefault (achado 17/09/2026): sem isso, o
            clique no botão rouba o foco do editor e apaga a seleção atual
            -- se o usuário tinha clicado numa imagem existente pra
            substituí-la, essa seleção se perde antes do arquivo ser
            escolhido, e o insertHTML (abaixo, em inserirImagemNoEditor) não
            tem mais o que substituir. Mantendo a seleção viva, escolher uma
            imagem nova troca a que estava selecionada em vez de só inserir
            outra ao lado. */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
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
        dangerouslySetInnerHTML={{ __html: desembrulharParaEdicao(corpoInicialHtml ?? "") }}
      />
      <p className="mt-1 text-xs text-gray-400">Escreva normalmente, dá pra colar texto formatado, deixar em negrito/sublinhado e inserir imagem.</p>
      <input ref={hiddenRef} type="hidden" name={name} defaultValue="" />
    </div>
  );
}
