import type { ReactNode } from "react";

// Texto das respostas do Robô O2, usado pelo chat flutuante e pelo campo do robô dentro de cada painel.

// *negrito* e **negrito** do texto do robô viram negrito de verdade (antes apareciam os asteriscos soltos).
export function Negrito({ texto }: { texto: string }): ReactNode {
  return (
    <>
      {texto.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).map((p, i) => {
        const m = /^\*{1,2}([^*\n]+)\*{1,2}$/.exec(p);
        return m ? <strong key={i}>{m[1]}</strong> : p;
      })}
    </>
  );
}

// Transforma links (https://...) do texto em links clicáveis; o do relatório PDF do robô vira um botão.
export function ComLinks({ texto, escuro }: { texto: string; escuro: boolean }): ReactNode {
  return (
    <>
      {texto.split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/\S+)/g).map((parte, i) => {
        const md = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(parte);
        const url = md ? md[2] : /^https?:\/\//.test(parte) ? parte : null;
        if (!url) return <Negrito key={i} texto={parte} />;
        // [texto](url) vira link com o texto (arquivos de apólice/card); URL solta do storage é o relatório em PDF
        const rotulo = md ? `📎 ${md[1]}` : url.includes("/storage/") ? "📄 Abrir o relatório (PDF)" : "abrir link";
        return (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className={`font-semibold underline ${escuro ? "text-white" : "text-o2-blue"}`}>
            {rotulo}
          </a>
        );
      })}
    </>
  );
}
