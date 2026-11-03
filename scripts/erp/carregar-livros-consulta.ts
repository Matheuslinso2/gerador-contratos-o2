process.loadEnvFile(".env.local");
// Carrega os livros de consulta do Matheus (PDF em Downloads) em legislacao_normas (tipo 'Livro') + legislacao_trechos, para o Robô O2 consultar
// técnicas e conceitos. Texto nativo (unpdf), sem IA. Uso interno; livros protegidos por direito autoral, só para consulta.
// Reexecutar substitui os trechos de cada livro. Uso: tsx scripts/erp/carregar-livros-consulta.ts [chave ...]
import fs from "node:fs";
import path from "node:path";
import { getDocumentProxy, extractText } from "unpdf";
import { createServiceClient } from "@/lib/supabase/service";

const sb = createServiceClient();
const DOWNLOADS = "C:/Users/O2-Grupo/Downloads";
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Livro = { chave: string; arquivo: string; titulo: string; ano: number | null; ementa: string; temas: string };
const LIVROS: Livro[] = [
  { chave: "direito-dos-seguros", arquivo: "e-book_direito_dos_seguros.pdf", titulo: "Direito dos Seguros (e-book)", ano: null, ementa: "Obra de direito dos seguros: contrato de seguro, proposta e apólice, boa-fé, risco, sinistro, regulação. Apoio de conceitos jurídicos; não é aconselhamento jurídico.", temas: "direito dos seguros; contrato de seguro; proposta; apólice; sinistro" },
  { chave: "direito-empresarial", arquivo: "Direito Empresarial - André Luiz Santa Cruz - 2020.pdf", titulo: "Direito Empresarial (André Luiz Santa Cruz, 2020)", ano: 2020, ementa: "Manual de direito empresarial: empresário, sociedades, títulos de crédito, contratos empresariais. Apoio de conceitos; não é aconselhamento jurídico.", temas: "direito empresarial; sociedades; títulos de crédito; contratos" },
  { chave: "direito-societario", arquivo: "Direito Societário.pdf", titulo: "Direito Societário", ano: null, ementa: "Material de direito societário: tipos de sociedade, administração, quotas e ações. Apoio de conceitos; não é aconselhamento jurídico.", temas: "direito societário; sociedades; quotas" },
  { chave: "direito-digital", arquivo: "PRINCÍPIOS DO DIREITO DIGITAL.pdf", titulo: "Princípios do Direito Digital", ano: null, ementa: "Princípios do direito digital: privacidade, proteção de dados, responsabilidade, contratos eletrônicos. Apoio para LGPD e portal; não é aconselhamento jurídico.", temas: "direito digital; LGPD; proteção de dados; contratos eletrônicos" },
  { chave: "analise-financeira-apostila", arquivo: "Apostila 1 - Analise Financeira.pdf", titulo: "Apostila 1 – Análise Financeira", ano: null, ementa: "Apostila de análise financeira: demonstrações, análise vertical e horizontal, índices de liquidez, endividamento e rentabilidade.", temas: "análise financeira; análise vertical; análise horizontal; índices; demonstrações" },
  { chave: "analise-financeira-dialnet", arquivo: "Dialnet-AnaliseFinanceiraPeloMetodo-5454757.pdf", titulo: "Análise Financeira pelo Método (artigo, Dialnet)", ano: null, ementa: "Artigo sobre análise financeira por método de índices e demonstrações.", temas: "análise financeira; índices; método" },
  { chave: "gestao-de-empresas", arquivo: "Ebook-Gestao-de-Empresas.pdf", titulo: "E-book Gestão de Empresas", ano: null, ementa: "E-book de gestão de empresas: planejamento, finanças, pessoas, processos e indicadores.", temas: "gestão; planejamento; indicadores; processos" },
  { chave: "ui-design-principles", arquivo: "UI Design Principles - Michael Filipiuk.pdf", titulo: "UI Design Principles (Michael Filipiuk)", ano: null, ementa: "Princípios de design de interface: hierarquia visual, espaçamento, tipografia, cor, consistência e componentes. Base do guia de estilo do ERP.", temas: "design de interface; UI; hierarquia visual; tipografia; espaçamento; cor" },
  { chave: "fundamentos-webdesign", arquivo: "Fundamentos de Webdesign -Livro completo.pdf", titulo: "Fundamentos de Webdesign (livro completo)", ano: null, ementa: "Fundamentos de webdesign: layout, usabilidade, cores, tipografia, navegação e boas práticas.", temas: "webdesign; layout; usabilidade; navegação" },
  { chave: "architecture-patterns-python", arquivo: "Architecture-Patterns-with-Python.pdf", titulo: "Architecture Patterns with Python", ano: null, ementa: "Padrões de arquitetura de software em Python: domínio, repositório, unidade de trabalho, eventos e mensageria. Consulta técnica.", temas: "arquitetura de software; Python; padrões; domínio; eventos" },
  { chave: "ecpython", arquivo: "ECPython.pdf", titulo: "ECPython", ano: null, ementa: "Material de programação em Python. Consulta técnica.", temas: "Python; programação" },
];

async function carregar(l: Livro) {
  const arq = path.join(DOWNLOADS, l.arquivo);
  if (!fs.existsSync(arq)) { console.log(l.chave, "ARQUIVO NÃO ENCONTRADO"); return; }
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(arq)));
  const { text } = await extractText(pdf, { mergePages: false });
  const paginas = (text as string[]).map((t) => t.replace(/\s+/g, " ").trim());
  const total = paginas.reduce((a, t) => a + t.length, 0);
  if (total < 2000) { console.log(l.chave, `SEM TEXTO NATIVO (${total} caracteres, ${paginas.length} páginas): precisa de OCR`); return; }
  const norma = { pasta: "livros", tipo: "Livro", numero: null, ano: l.ano, titulo: l.titulo, ementa: l.ementa, url: null, situacao: "Obra de referência (não é norma). Uso interno.", temas: l.temas, arquivo: "livros/" + l.chave, coletado_em: "2026-11-03", observacoes: "Material protegido por direito autoral, guardado só para consulta interna.", tamanho_texto: total };
  const { data: up, error } = await sb.from("legislacao_normas").upsert(norma, { onConflict: "arquivo" }).select("id").single();
  if (error) throw error;
  await sb.from("legislacao_trechos").delete().eq("norma_id", up.id);
  const trechos: { rotulo: string; artigo: string; texto: string }[] = [];
  let buf = "", ini = 0, fim = 0;
  const fechar = () => { if (!buf.trim()) return; trechos.push({ rotulo: `p. ${ini}${fim !== ini ? "–" + fim : ""}`, artigo: "p" + ini, texto: buf.trim() }); buf = ""; ini = 0; };
  paginas.forEach((t, i) => { if (t.length < 40) return; if (!ini) ini = i + 1; fim = i + 1; buf += (buf ? "\n" : "") + t; if (buf.length > 3200) fechar(); });
  fechar();
  const linhas = trechos.map((t, i) => ({ norma_id: up.id, ordem: i, rotulo: t.rotulo, artigo: t.artigo, texto: t.texto, texto_busca: semAcento(`${l.titulo} ${t.rotulo} ${t.texto}`) }));
  for (let i = 0; i < linhas.length; i += 100) { const { error: e } = await sb.from("legislacao_trechos").insert(linhas.slice(i, i + 100)); if (e) { console.log(l.chave, "ERRO", e.message); return; } }
  console.log(l.chave, `ok · ${paginas.length} páginas · ${linhas.length} trechos · ${Math.round(total / 1000)} mil caracteres`);
}

async function main() {
  const filtro = process.argv.slice(2);
  for (const l of LIVROS) { if (filtro.length && !filtro.includes(l.chave)) continue; try { await carregar(l); } catch (e) { console.log(l.chave, "FALHOU", (e as Error).message); } }
}
main().then(() => process.exit(0));
