// Carrega o livro "Seguros e Economia: princípios e aplicações" (Contador, ENS, 2023) em legislacao_normas/legislacao_trechos (pasta 'livros'),
// para o Robô O2 consultar vocabulário e conceitos de seguro. Uso interno. Reexecutar substitui os trechos.
//   node scripts/erp/carregar-livro-conceitos.cjs
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const ARQ = "livros/seguros-e-economia-contador-ens-2023";
const semAcento = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const CAPS = [[1, "História do seguro"], [91, "Pilares e efeitos do seguro"], [111, "Instituições, regulação e operações de seguro"], [139, "Seguro e escolha em condições de risco"], [175, "Formação do mercado de seguro"], [211, "Gestão das carteiras das seguradoras"], [301, "Desempenho do mercado e suas instituições"], [359, "Planejamento estratégico e previsão"], [405, "O mercado internacional de seguros"], [471, "A fraude no seguro"], [493, "Seguro e o meio ambiente"]];
const OFFSET = 18; // página do PDF = página impressa + 18
const capDe = (imp) => { let c = null; for (const [p, n] of CAPS) if (imp >= p) c = [p, n]; return c ? `Cap. ${CAPS.findIndex((x) => x[0] === c[0]) + 1} – ${c[1]}` : "Introdução"; };
(async () => {
  const bruto = fs.readFileSync("erp-o2/conhecimento-livros/seguros-e-economia-contador-ens-2023.txt", "utf8");
  const paginas = bruto.split(/\n=== p(\d+) ===\n/); // [antes, n1, texto1, n2, texto2...]
  const lista = [];
  for (let i = 1; i < paginas.length; i += 2) lista.push({ pdf: Number(paginas[i]), texto: paginas[i + 1].trim() });
  const norma = { pasta: "livros", tipo: "Livro", numero: null, ano: 2023, titulo: "Seguros e Economia: princípios e aplicações (Claudio R. Contador, ENS, 2023)", ementa: "Livro-texto de economia do seguro: história, pilares, regulação, escolha sob risco (utilidade esperada, seleção adversa, risco moral), demanda e oferta, gestão de carteiras e reservas, desempenho do mercado, fraude e meio ambiente. Base de vocabulário e conceitos.", url: null, situacao: "Obra de referência (não é norma). Uso interno.", temas: "vocabulário de seguros; conceitos; economia do seguro", arquivo: ARQ, coletado_em: "2026-11-02", observacoes: "Livro protegido por direito autoral, guardado só para consulta interna.", tamanho_texto: bruto.length };
  const { data: up, error } = await sb.from("legislacao_normas").upsert(norma, { onConflict: "arquivo" }).select("id").single();
  if (error) throw error;
  await sb.from("legislacao_trechos").delete().eq("norma_id", up.id);
  const trechos = []; let buf = "", ini = null, fim = null;
  const fechar = () => { if (!buf.trim()) return; const a = ini - OFFSET, b = fim - OFFSET; trechos.push({ rotulo: `${capDe(a)}, p. ${a}${b !== a ? "–" + b : ""}`, artigo: "p" + a, texto: buf.trim() }); buf = ""; ini = null; };
  for (const p of lista) { if (p.texto.length < 40) continue; if (ini === null) ini = p.pdf; fim = p.pdf; buf += (buf ? "\n" : "") + p.texto; if (buf.length > 3200) fechar(); }
  fechar();
  const linhas = trechos.map((t, i) => ({ norma_id: up.id, ordem: i, rotulo: t.rotulo, artigo: t.artigo, texto: t.texto, texto_busca: semAcento(`${norma.titulo} ${t.rotulo} ${t.texto}`) }));
  for (let i = 0; i < linhas.length; i += 100) { const { error: e } = await sb.from("legislacao_trechos").insert(linhas.slice(i, i + 100)); if (e) { console.log("ERRO", e.message); break; } }
  console.log("trechos gravados:", linhas.length);
})();
