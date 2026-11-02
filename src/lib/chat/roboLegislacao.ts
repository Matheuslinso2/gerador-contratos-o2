import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/service";

// Consulta à LEGISLAÇÃO para o Robô O2 do chat (02/11/2026, pedido do Matheus: leis de seguros, Lei do Inquilinato e processo civil,
// guardadas no banco e disponíveis para consulta). Fonte: textos oficiais coletados do Planalto, do Sistema de Legislação da SUSEP e do STJ
// (tabelas legislacao_normas e legislacao_trechos). Somente leitura. Não é parecer jurídico: o robô sempre cita a norma, o artigo e a situação.

export const FERRAMENTA_LEGISLACAO: Anthropic.Tool = {
  name: "consultar_legislacao",
  description:
    "Consulta a LEGISLAÇÃO guardada no banco (textos oficiais): Lei do Inquilinato (Lei 8.245/1991) e leis de locação, Código Civil (locação, fiança, condomínio), Lei 15.040/2024 (Marco Legal dos Seguros), Decreto-Lei 73/1966, corretagem, CDC, LGPD, Resoluções CNSP e Circulares SUSEP (fiança locatícia, seguros de danos, garantia, capitalização, corretores, comissão, reclamações), Código de Processo Civil, leis processuais especiais (Juizados, execução fiscal, ação civil pública, falência), mediação, arbitragem e súmulas do STJ sobre seguro/fiança/locação. " +
    "Use para perguntas sobre o que a lei ou a SUSEP diz (prazos, obrigações, vigência, devolução de prêmio, garantia locatícia, despejo, prescrição, comissão). " +
    "Passe 'pergunta' (palavras-chave do assunto) e, se souber, 'norma' (ex.: 'Lei 8.245', 'Lei 15.040', 'Circular SUSEP 671', 'CPC', 'Código Civil', 'Resolução CNSP 496') e/ou 'artigo' (ex.: '37', '86'). Devolve os trechos com norma, artigo, situação (vigente, alterada ou revogada) e link oficial.",
  input_schema: {
    type: "object",
    properties: {
      pergunta: { type: "string", description: "Assunto em palavras-chave (ex.: 'prazo seguradora pagar sinistro', 'garantia locatícia única', 'devolução de prêmio cancelamento')." },
      norma: { type: "string", description: "Norma específica, se souber (ex.: 'Lei 8.245', 'Lei 15.040', 'Circular SUSEP 671', 'CPC', 'Código Civil', 'CDC', 'LGPD')." },
      artigo: { type: "string", description: "Número do artigo (ex.: '37', '86', '126'); só faz sentido junto com 'norma'." },
      limite: { type: "number", description: "Quantos trechos devolver (padrão 6, máximo 12)." },
    },
  },
};

type Entrada = { pergunta?: string; norma?: string; artigo?: string; limite?: number };

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Apelidos comuns usados pela equipe -> trecho do título/número da norma.
const APELIDOS: Record<string, string> = {
  cpc: "13.105",
  "codigo de processo civil": "13.105",
  cdc: "8.078",
  "codigo de defesa do consumidor": "8.078",
  lgpd: "13.709",
  inquilinato: "8.245",
  "lei do inquilinato": "8.245",
  "marco legal dos seguros": "15.040",
  "marco legal": "15.040",
  "codigo civil": "10.406",
  "bem de familia": "8.009",
  "fianca locaticia": "671/2022",
  "seguro fianca": "671/2022",
  "juizados especiais": "9.099",
  mediacao: "13.140",
  arbitragem: "9.307",
};

function digitos(s: string) {
  return (s.match(/\d[\d.]*\d|\d/g) ?? []).map((x) => x.replace(/\./g, ""));
}

async function resolverNormas(sb: ReturnType<typeof createServiceClient>, norma: string): Promise<{ id: string; titulo: string }[]> {
  const n = semAcento(norma);
  const alias = Object.entries(APELIDOS).find(([k]) => n.includes(k));
  const termo = alias ? alias[1] : norma;
  const { data } = await sb.from("legislacao_normas").select("id, titulo, tipo, numero, ano, arquivo").limit(2000);
  const nums = digitos(termo);
  const nt = semAcento(termo);
  const tipoPedido = /(circular|resolucao|decreto|lei complementar|carta)/.exec(semAcento(norma))?.[1] ?? null;
  const achadas = (data ?? []).filter((r) => {
    const id = `${r.tipo ?? ""} ${r.numero ?? ""} ${r.ano ?? ""} ${r.titulo ?? ""}`;
    const idDig = digitos(id.replace(/\//g, " "));
    const numReg = digitos(String(r.numero ?? "").replace(/\//g, " "));
    if (nums.length) {
      // casa o número da norma (8245, 15040...) e, se o pedido trouxer o ano, também o ano
      const principal = nums[0];
      const ok = numReg.includes(principal) || idDig.includes(principal);
      const ano = nums.find((x) => x.length === 4 && Number(x) > 1900 && x !== principal);
      const tipoOk = !tipoPedido || semAcento(`${r.tipo ?? ""} ${r.titulo ?? ""}`).includes(tipoPedido);
      return ok && tipoOk && (!ano || String(r.ano) === ano);
    }
    return semAcento(`${r.titulo ?? ""} ${r.tipo ?? ""} ${r.arquivo ?? ""}`).includes(nt);
  });
  // textos compilados oficiais primeiro; entradas de "referência" (sem texto próprio) por último
  // se há texto compilado, descarta as entradas de "referência" (sem texto próprio)
  const compiladas = achadas.filter((r) => !/refer[eê]ncia/i.test(String(r.titulo)));
  if (compiladas.length) achadas.splice(0, achadas.length, ...compiladas);
  achadas.sort((a, b) => Number(/refer[eê]ncia/i.test(String(a.titulo))) - Number(/refer[eê]ncia/i.test(String(b.titulo))));
  return achadas.slice(0, 8).map((r) => ({ id: r.id as string, titulo: r.titulo as string }));
}

const cortar = (s: string | null | undefined, n: number) => (s && s.length > n ? s.slice(0, n) + "…" : (s ?? null));

export async function executarFerramentaLegislacao(nome: string, entrada: unknown): Promise<string | null> {
  if (nome !== "consultar_legislacao") return null;
  const e = (entrada ?? {}) as Entrada;
  const sb = createServiceClient();
  const limite = Math.max(1, Math.min(Number(e.limite) || 6, 12));
  const AVISO =
    "Texto de fonte oficial (Planalto, SUSEP, STJ) coletado em 02/11/2026; não é parecer jurídico. Cite sempre a norma e o artigo, diga a situação (vigente/alterada/revogada) e, em dúvida de aplicação a contratos antigos, recomende conferir com o jurídico.";

  let normasAlvo: { id: string; titulo: string }[] | null = null;
  if (e.norma?.trim()) {
    normasAlvo = await resolverNormas(sb, e.norma);
    if (!normasAlvo.length)
      return JSON.stringify({ encontrou: false, observacao: `Não achei a norma "${e.norma}" na base de legislação. Tente o número (ex.: "8.245") ou o tipo e número (ex.: "Circular SUSEP 671").` });
  }

  // 1) Artigo específico de uma norma
  if (e.artigo?.trim() && normasAlvo?.length) {
    const art = e.artigo.replace(/\D*(\d+(?:-[A-Za-z])?).*/, "$1").toUpperCase();
    const { data } = await sb
      .from("legislacao_trechos")
      .select("norma_id, rotulo, artigo, texto, ordem, legislacao_normas(titulo, situacao, url, tipo, numero)")
      .in("norma_id", normasAlvo.map((n) => n.id))
      .eq("artigo", art)
      .order("ordem")
      .limit(limite);
    const linhas = (data ?? []) as unknown as { rotulo: string; texto: string; legislacao_normas: { titulo: string; situacao: string | null; url: string | null } | { titulo: string; situacao: string | null; url: string | null }[] }[];
    if (linhas.length)
      return JSON.stringify({
        encontrou: true,
        aviso: AVISO,
        trechos: linhas.map((l) => {
          const n = Array.isArray(l.legislacao_normas) ? l.legislacao_normas[0] : l.legislacao_normas;
          return { norma: n?.titulo, rotulo: l.rotulo, texto: cortar(l.texto, 2600), situacao: cortar(n?.situacao, 280), link_oficial: n?.url };
        }),
      });
  }

  // 2) Busca por assunto (texto em português, sem acento)
  const consulta = semAcento([e.pergunta, e.artigo && !normasAlvo ? `artigo ${e.artigo}` : ""].filter(Boolean).join(" "));
  if (!consulta) return JSON.stringify({ encontrou: false, observacao: "Informe a 'pergunta' (assunto) ou 'norma' + 'artigo'." });
  type Achado = { titulo: string; rotulo: string; texto: string; situacao: string | null; url: string | null; relevancia: number };
  const buscar = async (q: string) => {
    const { data, error } = await sb.rpc("legislacao_buscar", { p_consulta: q, p_normas: normasAlvo?.length ? normasAlvo.map((n) => n.id) : null, p_limite: limite });
    return { achados: (data ?? []) as Achado[], erro: error?.message ?? null };
  };
  // Primeiro exige todas as palavras no mesmo trecho; se nada vier, tenta "qualquer uma" (assuntos que a lei trata em artigos separados).
  let { achados: r, erro } = await buscar(consulta);
  if (!erro && !r.length) {
    const palavras = [...new Set(consulta.split(/[^a-z0-9]+/).filter((p) => p.length > 3))];
    if (palavras.length > 1) {
      ({ achados: r, erro } = await buscar(palavras.join(" or ")));
      // só vale se o trecho tiver ao menos 2 das palavras (evita devolver lixo por uma palavra solta)
      r = r.filter((x) => palavras.filter((w) => semAcento(x.texto).includes(w.slice(0, 5))).length >= 2);
    }
  }
  if (erro) return JSON.stringify({ encontrou: false, erro });
  if (!r.length)
    return JSON.stringify({ encontrou: false, observacao: "Nenhum trecho da legislação guardada trata disso com essas palavras. Tente sinônimos ou palavras mais gerais; a base não inclui temas repetitivos do STJ nem normas revogadas.", normas_consideradas: normasAlvo?.map((n) => n.titulo) ?? "todas" });
  return JSON.stringify({
    encontrou: true,
    aviso: AVISO,
    normas_consideradas: normasAlvo?.map((n) => n.titulo) ?? "todas",
    trechos: r.map((x) => ({ norma: x.titulo, rotulo: x.rotulo, texto: cortar(x.texto, 2000), situacao: cortar(x.situacao, 280), link_oficial: x.url })),
  });
}
