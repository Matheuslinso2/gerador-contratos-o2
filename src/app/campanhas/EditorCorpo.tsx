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

  async function selecionarImagem(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
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
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={enviandoImagem} className={botaoClass}>
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
        onPaste={() => setTimeout(sincronizar, 0)}
        className="min-h-[180px] rounded-b-lg border border-gray-300 px-3 py-2 text-sm focus:border-o2-coral focus:outline-none [&_img]:max-w-full [&_img]:rounded-lg"
        dangerouslySetInnerHTML={{ __html: corpoInicialHtml ?? "" }}
      />
      <p className="mt-1 text-xs text-gray-400">Escreva normalmente, dá pra colar texto formatado, deixar em negrito/sublinhado e inserir imagem.</p>
      <input ref={hiddenRef} type="hidden" name={name} defaultValue="" />
    </div>
  );
}
