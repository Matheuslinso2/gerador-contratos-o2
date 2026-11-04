// Conferência PALAVRA POR PALAVRA do texto oficial da biblioteca contra o texto do contrato (04/11/2026).
// Achado real: contrato Pottencial (Patricia de Souza Barros × Marcio Zen) tinha "limites e condições do seguro" onde o texto
// oficial da cobertura Danos ao Imóvel diz "limites e condições contratuais do seguro" -- a leitura da IA por "conteúdo
// essencial" não pega palavra faltando. Aqui é código: alinha cada bloco oficial com o trecho mais parecido do contrato
// (LCS) e lista as palavras do oficial que NÃO estão no contrato, com o contexto ao redor. Só texto; não decide gravidade.

type Palavra = { raw: string; norm: string };

export type AchadoPalavras = {
  bloco: string; // início do bloco oficial (para identificar)
  cobertura: number; // 0..1 -- parte das palavras do oficial encontradas no contrato
  faltas: string[]; // trechos com a(s) palavra(s) faltante(s) entre [colchetes]
  totalPalavrasFaltando: number;
};

const SEM_ACENTO = /[̀-ͯ]/g;

// Variações de gênero/número das partes não são divergência: LOCADOR/LOCADORA/LOCADORES, LOCATÁRIO(A)/LOCATÁRIOS, SEGURADOR(A)/SEGURADORAS...
// (os contratos escrevem "o LOCADOR", "LOCADOR(A)", "LOCADORES(AS)" conforme as partes). Plural simples também é igualado.
// Artigos/preposições contraídas que variam com o gênero das partes ("pelo(a)", "dos(as)") -- não carregam condição.
const SEM_PESO = new Set(["pelo", "pela", "pelos", "pelas", "nos", "nas", "dos", "das", "aos", "uma", "uns", "que"]);

function raiz(p: string): string {
  if (/^locador/.test(p)) return "locador";
  if (/^locatari/.test(p)) return "locatario";
  if (/^segurador/.test(p)) return "seguradora";
  if (/^segurad[oa]s?$/.test(p)) return "segurado";
  if (/^(fiador|proprietari|imobiliari)/.test(p)) return p.replace(/(es|s|a|as)$/, "").replace(/o$/, "");
  if (/(am|em)$/.test(p) && p.length > 5) return p.replace(/am$/, "a").replace(/em$/, "e"); // declara/declaram
  return p.length > 4 ? p.replace(/s$/, "") : p;
}

function palavras(texto: string): Palavra[] {
  const achados = texto.match(/[\p{L}\p{N}]+/gu) ?? [];
  // Palavras de até 2 letras (a, o, de, da, es...) ficam de fora: variações de gênero "o(a)", "LOCADOR(es)" e artigos
  // gerariam falso alarme; o que importa são as palavras de conteúdo.
  return achados
    .map((raw) => ({ raw, norm: raiz(raw.toLowerCase().normalize("NFD").replace(SEM_ACENTO, "")) }))
    .filter((p) => p.norm.length > 2 && !SEM_PESO.has(p.norm));
}

// Maior subsequência comum entre o oficial (O) e a janela do contrato (J); devolve, para cada palavra de O, se ela casou.
function casamento(o: Palavra[], j: Palavra[]): boolean[] {
  const m = o.length;
  const n = j.length;
  const tabela: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let a = m - 1; a >= 0; a--) {
    for (let b = n - 1; b >= 0; b--) {
      tabela[a][b] = o[a].norm === j[b].norm ? tabela[a + 1][b + 1] + 1 : Math.max(tabela[a + 1][b], tabela[a][b + 1]);
    }
  }
  const achou = new Array<boolean>(m).fill(false);
  let a = 0;
  let b = 0;
  while (a < m && b < n) {
    if (o[a].norm === j[b].norm) {
      achou[a] = true;
      a++;
      b++;
    } else if (tabela[a + 1][b] >= tabela[a][b + 1]) a++;
    else b++;
  }
  return achou;
}

const TAM_GRAMA = 4;

export function conferirPalavraPorPalavra(blocosOficiais: string[], textoContrato: string): AchadoPalavras[] {
  const contrato = palavras(textoContrato);
  if (contrato.length < 30) return [];
  const indiceGramas = new Map<string, number[]>();
  for (let i = 0; i + TAM_GRAMA <= contrato.length; i++) {
    const chave = contrato.slice(i, i + TAM_GRAMA).map((p) => p.norm).join(" ");
    const lista = indiceGramas.get(chave);
    if (lista) lista.push(i);
    else indiceGramas.set(chave, [i]);
  }

  const achados: AchadoPalavras[] = [];
  for (const bloco of blocosOficiais) {
    const oficial = palavras(bloco);
    if (oficial.length < 12) continue; // blocos muito curtos (títulos) não dão base segura
    // Onde esse bloco começa no contrato: voto por deslocamento (agrupado de 25 em 25 palavras).
    const votos = new Map<number, number>();
    let gramas = 0;
    for (let i = 0; i + TAM_GRAMA <= oficial.length; i++) {
      gramas++;
      const pos = indiceGramas.get(oficial.slice(i, i + TAM_GRAMA).map((p) => p.norm).join(" "));
      if (!pos) continue;
      for (const p of pos) {
        const balde = Math.floor((p - i) / 25);
        votos.set(balde, (votos.get(balde) ?? 0) + 1);
      }
    }
    let melhor = -1;
    let melhorVotos = 0;
    for (const [balde, v] of votos) {
      const total = v + (votos.get(balde + 1) ?? 0);
      if (total > melhorVotos) {
        melhorVotos = total;
        melhor = balde;
      }
    }
    // Quase nada em comum: o bloco não está no contrato (ou é condicional não aplicável) -- isso é com a IA ("ausente").
    if (melhor < 0 || melhorVotos < gramas * 0.3) continue;

    const inicio = Math.max(0, melhor * 25 - 25);
    const fim = Math.min(contrato.length, melhor * 25 + 25 + Math.ceil(oficial.length * 1.4) + 25);
    const janela = contrato.slice(inicio, fim);
    const achou = casamento(oficial, janela);
    const casadas = achou.filter(Boolean).length;
    const cobertura = casadas / oficial.length;
    if (cobertura < 0.6) continue; // redação bem diferente: a IA já trata como divergente/ausente

    const faltas: string[] = [];
    let totalFalta = 0;
    for (let i = 0; i < oficial.length; ) {
      if (achou[i]) {
        i++;
        continue;
      }
      let k = i;
      while (k < oficial.length && !achou[k]) k++;
      if (i < 10) {
        i = k; // início do bloco = título/rótulo da biblioteca (ex: "CLÁUSULA ESPECIAL Nº 2 – DANOS AO IMÓVEL (quando contratada...)"), não texto do contrato
        continue;
      }
      totalFalta += k - i;
      const antes = oficial.slice(Math.max(0, i - 4), i).map((p) => p.raw).join(" ");
      const faltando = oficial.slice(i, k).map((p) => p.raw).join(" ");
      const depois = oficial.slice(k, k + 4).map((p) => p.raw).join(" ");
      faltas.push(`${antes ? `…${antes} ` : ""}[${faltando}]${depois ? ` ${depois}…` : ""}`);
      i = k;
    }
    if (faltas.length === 0) continue;
    achados.push({ bloco: bloco.trim().replace(/\s+/g, " ").slice(0, 90), cobertura, faltas, totalPalavrasFaltando: totalFalta });
  }
  return achados;
}
