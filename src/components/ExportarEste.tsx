"use client";

import { useRef, useState } from "react";
import { IconSpinner } from "./icons";
import { capturarElementoComoPdf } from "./ExportarQuadro";

// Excel/PDF para QUALQUER quadro, sem precisar montar os dados à parte
// (pedido do Matheus, 22/10/2026: "a opção de baixar em Excel ou PDF não
// está em todos os quadros"). Basta pôr <ExportarEste /> no cabeçalho do
// quadro:
// - o quadro é o ancestral mais próximo marcado com `data-quadro`; sem
//   marca, o primeiro ancestral que contém uma tabela ou gráfico;
// - PDF = foto do quadro como está na tela (igual ao ExportarQuadro);
// - Excel = as tabelas que estão no quadro, uma aba por tabela, com
//   números/valores/percentuais convertidos para número de verdade. Quadro
//   sem tabela (cartões, barras) sai como lista do que está escrito.
// Nada vai para o servidor: tudo acontece no navegador.

function acharQuadro(origem: HTMLElement): HTMLElement | null {
  const marcado = origem.closest<HTMLElement>("[data-quadro]");
  if (marcado) return marcado;
  // Primeiro ancestral que tem tabela ou que é um cartão (borda arredondada).
  let el = origem.parentElement;
  for (let nivel = 0; el && nivel < 6; nivel++, el = el.parentElement) {
    const classe = typeof el.className === "string" ? el.className : "";
    if (el.querySelector("table, [data-export-tabela]") || (/\brounded/.test(classe) && /\bborder\b/.test(classe))) return el;
  }
  return origem.parentElement?.parentElement ?? null;
}

const dentroDeIgnorado = (el: Element, quadro: Element) => {
  const ign = el.closest("[data-export-ignore]");
  return !!ign && quadro.contains(ign);
};

function textoDaCelula(td: HTMLElement): string {
  const campo = td.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not([type=hidden]), select, textarea");
  if (campo) {
    if (campo instanceof HTMLSelectElement) return campo.selectedOptions[0]?.text ?? "";
    if (campo instanceof HTMLInputElement && (campo.type === "checkbox" || campo.type === "radio")) return campo.checked ? "sim" : "não";
    return campo.value;
  }
  // Sem os pedaços marcados para não exportar (botões, ícones de legenda).
  const copia = td.cloneNode(true) as HTMLElement;
  copia.querySelectorAll("[data-export-ignore], button").forEach((n) => n.remove());
  return (copia.innerText || copia.textContent || "").replace(/\s*\n\s*/g, " · ").replace(/\s+/g, " ").trim();
}

// "R$ 1.234,56" -> 1234.56 ; "12,5%" -> 0.125 (formato %) ; "1.234" -> 1234.
type Celula = string | number | { v: number; t: "n"; z: string };
function converter(texto: string): Celula {
  const t = texto.replace(/ /g, " ").trim();
  const m = t.match(/^(-|−)?\s*(R\$)?\s*(-)?\s*(\d{1,3}(?:\.\d{3})+|\d+)(,\d+)?\s*(%)?$/);
  if (!m) return t;
  const negativo = !!(m[1] || m[3]);
  const n = Number(`${m[4].replace(/\./g, "")}${m[5] ? "." + m[5].slice(1) : ""}`) * (negativo ? -1 : 1);
  if (!Number.isFinite(n)) return t;
  if (m[6]) return { v: n / 100, t: "n", z: "0.0%" };
  if (m[2]) return { v: n, t: "n", z: '"R$" #,##0.00' };
  return n;
}

function linhasDaTabela(tabela: HTMLTableElement): Celula[][] {
  const linhas: Celula[][] = [];
  tabela.querySelectorAll<HTMLTableRowElement>("tr").forEach((tr) => {
    if (tr.closest("table") !== tabela || tr.hidden) return;
    const celulas: Celula[] = [];
    tr.querySelectorAll<HTMLTableCellElement>("th, td").forEach((c) => {
      if (c.closest("tr") !== tr || c.hasAttribute("data-export-ignore")) return;
      const valor = c.tagName === "TH" ? textoDaCelula(c) : converter(textoDaCelula(c));
      celulas.push(valor);
      for (let i = 1; i < (c.colSpan || 1); i++) celulas.push("");
    });
    if (celulas.some((v) => v !== "")) linhas.push(celulas);
  });
  return linhas;
}

const limparNome = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60) || "quadro";

const nomeAba = (s: string, usados: Set<string>) => {
  let base = s.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Dados";
  let nome = base;
  for (let i = 2; usados.has(nome); i++) nome = `${base.slice(0, 26)} ${i}`;
  usados.add(nome);
  return nome;
};

async function baixarExcel(quadro: HTMLElement, titulo: string, arquivo: string) {
  const XLSX = await import("xlsx");
  const livro = XLSX.utils.book_new();
  const usados = new Set<string>();
  const tabelas = [...quadro.querySelectorAll<HTMLTableElement>("table")].filter(
    (t) => t.hasAttribute("data-export-tabela") || !dentroDeIgnorado(t, quadro)
  );
  for (const [i, tabela] of tabelas.entries()) {
    const linhas = linhasDaTabela(tabela);
    if (!linhas.length) continue;
    const rotulo = tabela.getAttribute("data-export-tabela") || (tabelas.length > 1 ? `${titulo} ${i + 1}` : titulo);
    XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet(linhas), nomeAba(rotulo, usados));
  }
  if (!livro.SheetNames.length) {
    // Sem tabela: cada linha de texto do quadro vira uma linha da planilha.
    const copia = quadro.cloneNode(true) as HTMLElement;
    copia.querySelectorAll("[data-export-ignore], button, script, style").forEach((n) => n.remove());
    document.body.appendChild(copia);
    copia.style.position = "absolute";
    copia.style.left = "-99999px";
    const texto = copia.innerText;
    copia.remove();
    const linhas = texto
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => [converter(l)]);
    XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet([[titulo], ...linhas]), nomeAba(titulo, usados));
  }
  XLSX.writeFile(livro, `${arquivo}.xlsx`);
}

// Texto do primeiro título do quadro, sem os botões e o ícone da legenda.
function tituloDoQuadro(quadro: HTMLElement): string {
  const h = quadro.querySelector("h1, h2, h3, h4");
  if (!h) return "";
  const copia = h.cloneNode(true) as HTMLElement;
  copia.querySelectorAll("[data-export-ignore], button").forEach((n) => n.remove());
  return (copia.textContent ?? "").replace(/\s+/g, " ").trim();
}

const botao: React.CSSProperties = {
  textTransform: "none",
  letterSpacing: "normal",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--ink-muted, #93a2b5)",
  background: "transparent",
  border: "1px solid var(--line, #d9dee5)",
  borderRadius: 9999,
  padding: "3px 11px",
  cursor: "pointer",
  lineHeight: 1.4,
};

export default function ExportarEste({ titulo, corFundo }: { titulo?: string; corFundo?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [gerando, setGerando] = useState<"excel" | "pdf" | null>(null);

  async function exportar(tipo: "excel" | "pdf") {
    const quadro = ref.current ? acharQuadro(ref.current) : null;
    if (!quadro) return;
    const nome = titulo || quadro.getAttribute("data-quadro") || tituloDoQuadro(quadro) || document.title || "Quadro";
    // Fundo da página (painéis claros e escuros) quando não vier explícito.
    const fundo = corFundo || getComputedStyle(document.body).backgroundColor || undefined;
    const arquivo = `${limparNome(nome)}-${new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })}`;
    setGerando(tipo);
    try {
      if (tipo === "excel") await baixarExcel(quadro, nome, arquivo);
      else await capturarElementoComoPdf(quadro, arquivo, fundo);
    } finally {
      setGerando(null);
    }
  }

  return (
    <div ref={ref} data-export-ignore="true" style={{ display: "inline-flex", gap: 6, flexShrink: 0, marginLeft: "auto" }}>
      {(["excel", "pdf"] as const).map((tipo) => (
        <button key={tipo} type="button" style={{ ...botao, opacity: gerando ? 0.7 : 1 }} disabled={!!gerando} onClick={() => exportar(tipo)}>
          {gerando === tipo ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <IconSpinner className="h-3 w-3" />
              Gerando...
            </span>
          ) : tipo === "excel" ? (
            "Excel"
          ) : (
            "PDF"
          )}
        </button>
      ))}
    </div>
  );
}
