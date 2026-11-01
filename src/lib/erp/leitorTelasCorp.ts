// Leitor das telas do Corp (OCR local do Windows -> campos). O Corp é um canvas: só existe a imagem da janela "Controle de Documentos" (1366x768, janela sempre no mesmo lugar).
// Cada campo é lido de uma REGIÃO fixa da janela (coordenadas da tela original). Nada de IA: o OCR é o do Windows, local e gratuito. Nível 8 (Corp = só comparação).
// Texto livre (Observações) passa por mascararSegredos: valor depois de senha/login/usuário/token/pin vira ***.
import { mascararSegredos } from "./mascararSegredos";

export type Palavra = { t: string; x: number; y: number; w: number; h: number };
export const VERSAO_LEITOR = 2;

type Rect = [number, number, number, number]; // x0, y0, x1, y1 (tela original 1366x768)

/** Palavras do OCR (recorte ampliado) -> coordenadas da tela original. */
export function palavrasDaTela(linhas: { palavras: Palavra[] }[], recorte: { left: number; top: number; escala: number }): Palavra[] {
  const out: Palavra[] = [];
  for (const l of linhas) for (const p of l.palavras ?? []) out.push({ t: p.t, x: p.x / recorte.escala + recorte.left, y: p.y / recorte.escala + recorte.top, w: p.w / recorte.escala, h: p.h / recorte.escala });
  return out;
}

const cx = (p: Palavra) => p.x + p.w / 2;
const cy = (p: Palavra) => p.y + p.h / 2;
const dentro = (p: Palavra, r: Rect) => cx(p) >= r[0] && cx(p) <= r[2] && cy(p) >= r[1] && cy(p) <= r[3];

/** Agrupa palavras em linhas (por proximidade vertical) e devolve o texto de cada linha, da esquerda p/ direita. */
function linhasDe(ps: Palavra[], tol = 6): { y: number; palavras: Palavra[]; texto: string }[] {
  const ord = [...ps].sort((a, b) => cy(a) - cy(b));
  const grupos: Palavra[][] = [];
  for (const p of ord) {
    const g = grupos.find((gr) => Math.abs(cy(gr[0]) - cy(p)) <= tol);
    if (g) g.push(p); else grupos.push([p]);
  }
  return grupos.map((g) => { g.sort((a, b) => a.x - b.x); return { y: g.reduce((s, p) => s + cy(p), 0) / g.length, palavras: g, texto: g.map((p) => p.t).join(" ") }; }).sort((a, b) => a.y - b.y);
}
type P = Palavra[][]; // um conjunto de palavras por passe de OCR (a = cor 2,5×; b = preto e branco 3×)
const textoUm = (ps: Palavra[], r: Rect): string | null => { const t = linhasDe(ps.filter((p) => dentro(p, r))).map((l) => l.texto).join(" ").replace(/\s+/g, " ").trim(); return t || null; };
/** Texto da região: o mais longo entre os passes (o OCR às vezes corta o fim ou perde o campo num passe). */
const texto = (P: P, r: Rect): string | null => { let best: string | null = null; for (const ps of P) { const t = textoUm(ps, r); if (t && (!best || t.length > best.length)) best = t; } return best; };
/** Primeira leitura VÁLIDA entre os passes (data/número que não passa na validação cai para o outro passe). */
const primeiro = <T,>(P: P, r: Rect, conv: (s: string | null) => T | null): T | null => { for (const ps of P) { const v = conv(textoUm(ps, r)); if (v !== null && v !== undefined) return v; } return null; };

/** Passe com MAIS palavras na região (tabelas e texto de várias linhas: vale o passe que leu mais). */
const cheio = (P: P, r: Rect): Palavra[] => P.map((ps) => ps.filter((p) => dentro(p, r))).sort((a, b) => b.length - a.length)[0] ?? [];

// ---- normalizadores (corrigem os erros típicos do OCR em números/datas) ----
export function dinheiro(s: string | null): number | null {
  if (!s) return null;
  let t = s.replace(/\s+/g, "").replace(/^[_—–•~]+/, "-").replace(/[OoQ]/g, "0").replace(/[lI|]/g, "1").replace(/S/g, "5").replace(/[^\d,.\-]/g, "");
  if (!/\d/.test(t)) return null;
  const neg = t.startsWith("-");
  t = t.replace(/-/g, "");
  // dinheiro do Corp SEMPRE tem vírgula e 2 casas ("-480,00", "1.234,56"); sem isso o OCR perdeu a vírgula e o número não é confiável: devolve null (o outro passe tenta)
  if (!/,\d{2}$/.test(t)) return null;
  t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
export function percentual(s: string | null): number | null { const v = dinheiro(s ? s.replace(/%/g, "") : s); return v !== null && Math.abs(v) <= 100 ? v : null; }
export function data(s: string | null): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, "").replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (!m) return null;
  const [d, mo, a] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a < 1990 || a > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(a, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
const inteiro = (s: string | null): number | null => { if (!s) return null; const t = s.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/\D/g, ""); return t ? Number(t) : null; };
const apenasDigitos = (s: string | null) => (s ? s.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/\D/g, "") : "");

export type Campos = Record<string, unknown>;
export type Leitura = { tela: string; campos: Campos; avisos: string[] };

/** A janela é a do documento certo? (cabeçalho "NNNNNN  NOME" e título "Controle de Documentos") */
export function cabecalho(ps: P): { nosso_numero: number | null; situacao: string | null; titular: string | null; janela_ok: boolean } {
  const titulo = texto(ps, [230, 110, 420, 130]);
  return {
    janela_ok: !!titulo && /controle/i.test(titulo),
    nosso_numero: primeiro(ps, [218, 143, 296, 166], inteiro),
    titular: texto(ps, [322, 143, 840, 166]),
    situacao: texto(ps, [845, 138, 1045, 170]),
  };
}

function lerDocumento(ps: P): Campos {
  const seg = texto(ps, [360, 424, 765, 442]); const ramo = texto(ps, [360, 470, 765, 488]); const cli = texto(ps, [360, 515, 765, 534]);
  /* seguradora/ramo: texto cinza (desabilitado) que o OCR não lê; o ERP já tem os dois */ const sc = (t: string | null) => { const m = t ? /^(\d+)\s+(.+)$/.exec(t) : null; return m && /[A-Za-zÀ-ú]{3}/.test(m[2]) ? { codigo: Number(m[1]), nome: m[2].trim() } : { codigo: null, nome: null }; };
  return {
    dt_emissao: primeiro(ps, [360, 238, 480, 257], data),
    numero_apolice: texto(ps, [482, 238, 620, 257]),
    numero_endosso: texto(ps, [622, 238, 740, 257]),
    dt_proposta: primeiro(ps, [358, 285, 470, 303], data),
    tipo_documento: texto(ps, [485, 285, 765, 303]),
    motivo_endosso: texto(ps, [360, 325, 765, 343]),
    apolice_endossada: texto(ps, [360, 376, 495, 395]),
    seguradora: sc(seg), ramo: sc(ramo), cliente: sc(cli),
    numero_proposta: texto(ps, [358, 577, 495, 596]),
    vigencia_inicio: primeiro(ps, [525, 577, 640, 596], data),
    vigencia_fim: primeiro(ps, [662, 577, 775, 596], data),
    forma_pagamento: texto(ps, [797, 229, 975, 247]),
    qtde_parcelas: primeiro(ps, [905, 253, 975, 272], inteiro),
    prazo_1a_parcela: primeiro(ps, [1070, 224, 1138, 243], inteiro),
    dia_fixo: primeiro(ps, [1070, 258, 1138, 277], inteiro),
    valor_1a_parcela: primeiro(ps, [1000, 331, 1138, 350], dinheiro),
    premio_liquido: primeiro(ps, [855, 310, 960, 329], dinheiro),
    premio_adicional: primeiro(ps, [855, 342, 960, 361], dinheiro),
    desconto: primeiro(ps, [855, 374, 960, 393], dinheiro),
    custo: primeiro(ps, [855, 406, 960, 425], dinheiro),
    iof: primeiro(ps, [855, 438, 960, 457], dinheiro),
    premio_total: primeiro(ps, [855, 472, 960, 491], dinheiro),
    comissao_base: primeiro(ps, [1025, 404, 1128, 423], dinheiro),
    comissao_pct: primeiro(ps, [1025, 437, 1128, 456], percentual),
    comissao_valor: primeiro(ps, [1025, 470, 1128, 489], dinheiro),
    digitacao_inicial: texto(ps, [905, 513, 1062, 532]),
    ultima_alteracao: texto(ps, [905, 535, 1062, 554]),
  };
}

function lerParcelas(ps: P): Campos {
  const linhas = linhasDe(cheio(ps, [222, 218, 852, 588]), 7);
  const parcelas: Campos[] = [];
  for (const l of linhas) {
    const col = (r: [number, number]) => textoUm(l.palavras, [r[0], l.y - 9, r[1], l.y + 9]);
    const n = inteiro(col([232, 272]));
    const venc = data(col([414, 496]));
    if (!n || !venc) continue; // cabeçalho e rodapé não têm nº + vencimento
    parcelas.push({ n, forma_pagamento: col([273, 413]), vencimento: venc, valor: dinheiro(col([497, 629])), dt_quitacao: data(col([630, 712])), valor_quitado: dinheiro(col([713, 850])) });
  }
  return { parcelas, total_rodape: primeiro(ps, [497, 588, 632, 608], dinheiro) };
}

function lerComissoes(ps: P): Campos {
  const linhas = linhasDe(cheio(ps, [222, 360, 932, 584]), 7);
  const itens: Campos[] = [];
  for (const l of linhas) {
    const col = (r: [number, number]) => textoUm(l.palavras, [r[0], l.y - 9, r[1], l.y + 9]);
    const n = inteiro(col([232, 272])); const venc = data(col([273, 356]));
    if (!n || !venc) continue;
    itens.push({ n, vencimento_base: venc, base: dinheiro(col([357, 469])), comissao: dinheiro(col([470, 581])), pct: percentual(col([582, 642])), premiacao: dinheiro(col([643, 755])), premiacao_pct: percentual(col([756, 817])), total: dinheiro(col([818, 930])) });
  }
  return {
    base_calculo: texto(ps, [478, 226, 640, 244]), valor_base: primeiro(ps, [477, 251, 582, 269], dinheiro), pct_sobre_base: primeiro(ps, [477, 277, 582, 295], percentual), valor_total: primeiro(ps, [477, 303, 582, 321], dinheiro),
    forma_recebimento: texto(ps, [478, 328, 640, 346]), premiacao_tipo: texto(ps, [652, 226, 812, 244]), premiacao_valor: primeiro(ps, [651, 303, 756, 321], dinheiro), parcelas_comissao: itens,
    total_comissao: primeiro(ps, [470, 589, 582, 607], dinheiro),
  };
}

function lerRepasses(ps: P): Campos {
  const linhas = linhasDe(cheio(ps, [246, 218, 792, 428]), 7);
  const repasses: Campos[] = [];
  for (const l of linhas) {
    const col = (r: [number, number]) => textoUm(l.palavras, [r[0], l.y - 9, r[1], l.y + 9]);
    const agente = col([247, 298]); const prod = col([299, 559]);
    if (!agente || !prod || /^agente$/i.test(agente)) continue;
    repasses.push({ agente, produtor: prod, pct_participacao: percentual(col([601, 677])), total_repasses: dinheiro(col([678, 790])) });
  }
  return {
    repasses, canal_vendas: texto(ps, [894, 221, 1142, 240]), corretagem: texto(ps, [893, 275, 1142, 293]),
    repasse_para: texto(ps, [340, 436, 680, 454]),
    comissao: { base_calculo: texto(ps, [478, 484, 640, 502]), valor_base: primeiro(ps, [477, 510, 582, 528], dinheiro), pct: primeiro(ps, [477, 536, 582, 554], percentual), valor_total: primeiro(ps, [477, 562, 582, 580], dinheiro), forma_repasse: texto(ps, [478, 586, 640, 604]) },
    premiacao: { base_calculo: texto(ps, [651, 484, 812, 502]), valor_base: primeiro(ps, [650, 510, 757, 528], dinheiro), pct: primeiro(ps, [650, 536, 757, 554], percentual), valor_total: primeiro(ps, [650, 562, 757, 580], dinheiro), forma_repasse: texto(ps, [651, 586, 812, 604]) },
  };
}

function lerItens(ps: P): Campos {
  const grade: Campos[] = [];
  for (const l of linhasDe(cheio(ps, [228, 510, 895, 598]), 6)) {
    const col = (r: [number, number]) => textoUm(l.palavras, [r[0], l.y - 8, r[1], l.y + 8]);
    const g = col([241, 553]);
    if (!g || /^garantia/i.test(g)) continue;
    grade.push({ garantia: g, importancia_segurada: dinheiro(col([554, 657])), taxa: dinheiro(col([658, 719])), premio: dinheiro(col([720, 802])), franquia: dinheiro(col([803, 893])) });
  }
  const garantidos: Campos[] = [];
  for (const y of [415, 442, 468]) {
    const nome = texto(ps, [227, y, 562, y + 18]); const doc = apenasDigitos(texto(ps, [734, y, 916, y + 18]));
    if (nome) garantidos.push({ nome, pessoa: texto(ps, [576, y, 718, y + 18]), cpf_cnpj: doc || null });
  }
  const obs = linhasDe(cheio(ps, [928, 244, 1124, 598]), 6).map((l) => l.texto).join("\n");
  return {
    item: texto(ps, [386, 203, 462, 221]), numero_item: primeiro(ps, [228, 244, 274, 263], inteiro),
    inicio_contrato: primeiro(ps, [288, 244, 388, 263], data), final_contrato: primeiro(ps, [398, 244, 498, 263], data),
    cep: ((c) => (c.length === 8 ? c : null))(apenasDigitos(texto(ps, [371, 305, 469, 323]))), logradouro: texto(ps, [518, 305, 852, 323]), numero: texto(ps, [861, 305, 908, 323]),
    complemento: texto(ps, [371, 341, 469, 359]), bairro: texto(ps, [478, 341, 658, 359]), cidade: texto(ps, [667, 341, 852, 359]), uf: texto(ps, [861, 341, 892, 359]),
    garantidos, garantias_visiveis: grade, garantias_parciais: grade.length >= 4, // a grade rola: só as 4 primeiras linhas aparecem na foto
    observacoes_item: obs ? mascararSegredos(obs) : null,
  };
}

function lerObservacoes(ps: P): Campos {
  const t = linhasDe(cheio(ps, [219, 199, 1131, 606]), 7).map((l) => l.texto).join("\n").trim();
  const masc = t ? mascararSegredos(t) : null;
  return { texto: masc, tem_pro_labore: masc ? /pr[oó][\s-]?labore/i.test(masc) : false, tem_segredo_mascarado: masc ? masc.includes("***") : false };
}

function lerAcompanhamento(ps: P): Campos {
  const obs = linhasDe(cheio(ps, [727, 234, 1138, 505]), 7).map((l) => l.texto).join("\n").trim();
  const arq = linhasDe(cheio(ps, [727, 538, 1138, 582]), 7).map((l) => l.texto).join("\n").trim();
  const assin = texto(ps, [268, 552, 440, 574]);
  return {
    dt_emissao: primeiro(ps, [262, 250, 368, 269], data), numero_apolice: texto(ps, [381, 250, 517, 269]), numero_endosso: texto(ps, [531, 250, 667, 269]),
    data_recebimento: primeiro(ps, [262, 339, 368, 358], data), data_entrega: primeiro(ps, [262, 435, 368, 454], data), forma_entrega: texto(ps, [391, 435, 667, 456]), entregue_para: texto(ps, [391, 483, 667, 504]),
    assinatura_proposta: assin, assinada: assin ? !/n[aã]o/i.test(assin) : null,
    observacoes: obs ? mascararSegredos(obs) : null, arquivamento: arq ? mascararSegredos(arq) : null,
  };
}

function lerAnexos(ps: P): Campos {
  const ls = linhasDe(cheio(ps, [505, 203, 1118, 604]), 5);
  const nomes = ls.filter((l) => /\.(pdf|png|jpe?g|docx?|xlsx?|txt|msg|eml|zip|tiff?|xml|csv)\b/i.test(l.texto) && l.palavras[0].x < 700).map((l) => ({ y: l.y, nome: l.palavras.filter((p) => p.x < 1000).map((p) => p.t).join(" ") }));
  const tipos = ls.map((l) => ({ y: l.y, tipo: l.palavras.filter((p) => p.x >= 1000).map((p) => p.t).join(" ") })).filter((x) => x.tipo);
  const anexos = nomes.map((n) => ({ nome: n.nome, tipo: tipos.filter((t) => Math.abs(t.y - n.y) <= 22).sort((a, b) => Math.abs(a.y - n.y) - Math.abs(b.y - n.y))[0]?.tipo ?? null }));
  return { anexos, quantidade: anexos.length };
}

export function lerTela(tela: string, ps: P): Leitura {
  const avisos: string[] = [];
  const cab = cabecalho(ps);
  if (!cab.janela_ok) avisos.push("janela 'Controle de Documentos' não reconhecida");
  let campos: Campos;
  switch (tela) {
    case "documento": campos = lerDocumento(ps); break;
    case "parcelas": campos = lerParcelas(ps); break;
    case "comissoes": campos = lerComissoes(ps); break;
    case "repasses": campos = lerRepasses(ps); break;
    case "itens": campos = lerItens(ps); break;
    case "observacoes": campos = lerObservacoes(ps); break;
    case "acompanhamento": campos = lerAcompanhamento(ps); break;
    case "anexos": campos = lerAnexos(ps); break;
    default: campos = {}; avisos.push(`tela desconhecida: ${tela}`);
  }
  return { tela, campos: { cabecalho: cab, ...campos }, avisos };
}
