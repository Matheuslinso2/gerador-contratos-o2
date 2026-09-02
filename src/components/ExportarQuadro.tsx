"use client";

import { useState } from "react";

// Exportação 100% no navegador -- nada é enviado pro servidor, nada é
// salvo/registrado. "PDF" é uma captura visual do quadro exatamente como
// está na tela (cores, barras, tabelas); "Excel" é os dados por trás
// daquele quadro, prontos pra filtrar/somar/copiar.

const COR_FUNDO_PADRAO = "#0e131a"; // --paper dos painéis escuros (Capitalização/Seguro Auto/Fiança/Ramos Elementares)

async function capturarQuadroComoPdf(quadroId: string, nomeArquivo: string, corFundo: string) {
  const elemento = document.getElementById(quadroId);
  if (!elemento) return;

  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);

  const canvas = await html2canvas(elemento, {
    scale: 2,
    backgroundColor: corFundo,
    useCORS: true,
    ignoreElements: (el) => el.hasAttribute("data-export-ignore"),
  });
  const imagem = canvas.toDataURL("image/png");
  const orientacao = canvas.width >= canvas.height ? "l" : "p";
  const pdf = new jsPDF({ orientation: orientacao, unit: "px", format: [canvas.width, canvas.height] });
  pdf.addImage(imagem, "PNG", 0, 0, canvas.width, canvas.height);
  pdf.save(`${nomeArquivo}.pdf`);
}

function baixarComoExcel(dados: Record<string, unknown>[], nomeArquivo: string, nomeAba: string) {
  import("xlsx").then((XLSX) => {
    const planilha = XLSX.utils.json_to_sheet(dados);
    const livro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(livro, planilha, nomeAba.slice(0, 31));
    XLSX.writeFile(livro, `${nomeArquivo}.xlsx`);
  });
}

const botaoEstilo: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--ink-muted, #93a2b5)",
  background: "transparent",
  border: "1px solid var(--line, #263241)",
  borderRadius: 6,
  padding: "3px 9px",
  cursor: "pointer",
  lineHeight: 1.4,
};

// Barra pequena com "Excel" (opcional -- só quando o quadro tem dados
// tabulares que fazem sentido numa planilha) e "PDF" (sempre, é a "foto"
// do quadro do jeito que está). Colocar dentro do cabeçalho de cada
// quadro, fora do elemento com quadroId (senão os botões aparecem na
// própria captura).
export default function ExportarQuadro({
  quadroId,
  nomeArquivo,
  dadosExcel,
  nomeAbaExcel,
  corFundo = COR_FUNDO_PADRAO,
}: {
  quadroId: string;
  nomeArquivo: string;
  dadosExcel?: Record<string, unknown>[];
  nomeAbaExcel?: string;
  corFundo?: string;
}) {
  const [carregandoPdf, setCarregandoPdf] = useState(false);

  return (
    <div data-export-ignore="true" style={{ display: "flex", gap: 6, flexShrink: 0 }}>
      {dadosExcel && dadosExcel.length > 0 && (
        <button
          type="button"
          style={botaoEstilo}
          onClick={() => baixarComoExcel(dadosExcel, nomeArquivo, nomeAbaExcel ?? "Dados")}
        >
          Excel
        </button>
      )}
      <button
        type="button"
        style={{ ...botaoEstilo, opacity: carregandoPdf ? 0.6 : 1 }}
        disabled={carregandoPdf}
        onClick={async () => {
          setCarregandoPdf(true);
          try {
            await capturarQuadroComoPdf(quadroId, nomeArquivo, corFundo);
          } finally {
            setCarregandoPdf(false);
          }
        }}
      >
        {carregandoPdf ? "Gerando..." : "PDF"}
      </button>
    </div>
  );
}

// Botão maior, pro painel inteiro (só PDF -- não faz sentido "o painel
// inteiro em Excel" quando cada quadro já tem sua própria planilha).
export function BotaoExportarPainelPdf({
  painelId,
  nomeArquivo,
  corFundo = COR_FUNDO_PADRAO,
}: {
  painelId: string;
  nomeArquivo: string;
  corFundo?: string;
}) {
  const [carregando, setCarregando] = useState(false);

  return (
    <button
      type="button"
      data-export-ignore="true"
      style={{
        fontSize: 12.5,
        fontWeight: 600,
        color: "var(--ink, #e7ebef)",
        background: "var(--surface, #161e28)",
        border: "1px solid var(--line, #263241)",
        borderRadius: 8,
        padding: "8px 14px",
        cursor: "pointer",
        opacity: carregando ? 0.6 : 1,
      }}
      disabled={carregando}
      onClick={async () => {
        setCarregando(true);
        try {
          await capturarQuadroComoPdf(painelId, nomeArquivo, corFundo);
        } finally {
          setCarregando(false);
        }
      }}
    >
      {carregando ? "Gerando PDF..." : "Baixar painel em PDF"}
    </button>
  );
}
