import { extractText, getDocumentProxy } from "unpdf";

// Leitor do PDF "Relatório de Renovações — Apresentando Itens e Garantias" do
// Corp (Consultas → Gerenciador de Relatórios → Documentos → Renovações). Nesse
// modelo o Corp não exporta Excel, só PDF. Teste de 22/10/2026 (dez/2026): traz
// local do risco e parcelas de todos os documentos; valores de cobertura vêm em
// Residencial/Empresarial e NUNCA em Imobiliário (LMI do imobiliário fica no
// histórico). O texto sai fora de ordem em alguns blocos (o rótulo "Local do
// Risco:" às vezes traz o endereço na mesma linha, às vezes não) — por isso a
// leitura é por heurística e o resultado é sempre marcado como "veio do PDF".

export type CoberturaPdf = { nome: string; valor: number };
export type DocumentoPdf = {
  nossoNumero: string;
  apolice: string;
  seguradora: string; // código curto do Corp (TOKI, YELU, PORT…)
  ramo: string; // ex.: "2 IMOBILIARIO"
  inicioVigencia: string | null;
  fimVigencia: string | null;
  premioTotal: number | null;
  parcelas: number | null;
  valorPrimeiraParcela: number | null;
  enderecoRisco: string | null; // "RUA X, 26 - CASA 2 - B. BAIRRO" (bairro pode vir cortado)
  cidadeUf: string | null;
  atividade: string | null;
  coberturas: CoberturaPdf[];
};

const valor = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;
const dataIso = (s: string) => `${s.slice(6, 10)}-${s.slice(3, 5)}-${s.slice(0, 2)}`;
const ROTULO = /^(Local do Risco:|Cidade\/UF:|LOC:|Atividade:|Cobertura Im ?p\. Seg\.|Dados do Item)/;

export async function lerPdfItensGarantias(arquivo: Uint8Array): Promise<DocumentoPdf[]> {
  const pdf = await getDocumentProxy(arquivo);
  const { text } = await extractText(pdf, { mergePages: false });
  const linhas = (text as string[]).flatMap((p) => p.split("\n")).map((l) => l.trim());
  const inicios: number[] = [];
  linhas.forEach((l, i) => /^\d{2}\/\d{2}\/\d{4} à \d{2}\/\d{2}\/\d{4} \d+NNº:/.test(l) && inicios.push(i));

  return inicios.map((ini, k) => {
    const fim = inicios[k + 1] ?? linhas.length;
    const bloco = linhas.slice(ini, fim);
    const [, de, ate, nn] = bloco[0].match(/^(\d{2}\/\d{2}\/\d{4}) à (\d{2}\/\d{2}\/\d{4}) (\d+)NNº:/)!;
    const achar = (re: RegExp) => bloco.map((l) => l.match(re)).find(Boolean) ?? null;
    const segRamo = achar(/^([A-Z0-9]{2,5}) - (.+)$/);
    const premio = achar(/^Pr\. Total: ([\d.,]+)/);
    const parc = achar(/Vl\. 1ª Parc\.: ([\d.,]+) (\d+)\s*$/);

    // Fim do bloco útil: a linha do nome do próximo segurado vem logo antes de "Dt. Nasc.".
    let corte = bloco.length;
    for (let i = 1; i < bloco.length; i++) if (/^Dt\. Nasc\./.test(bloco[i])) { corte = i - 1; break; }
    const util = bloco.slice(0, corte);

    let endereco: string | null = null;
    let cidade: string | null = null;
    let atividade: string | null = null;
    const coberturas: CoberturaPdf[] = [];
    const iItem = util.findIndex((l) => /^Dados do Item/.test(l));
    if (iItem >= 0) {
      const inline = util.slice(iItem).map((l) => l.match(/^Local do Risco: (.+)$/)).find(Boolean);
      if (inline) endereco = inline[1].trim();
      let depoisDaCobertura = false;
      for (const l of util.slice(iItem + 1)) {
        if (/^Cobertura Im ?p\. Seg\./.test(l)) { depoisDaCobertura = true; continue; }
        if (!l || ROTULO.test(l)) continue;
        const cob = l.match(/^(.*?[A-ZÀ-Ú].*?) ([\d.]+,\d{2})(\s|$)/);
        if (cob && depoisDaCobertura) { coberturas.push({ nome: cob[1].trim(), valor: valor(cob[2]) }); continue; }
        if (/^[\d.]+,\d{2}/.test(l)) continue; // valor solto de franquia/limite sem nome
        if (/\/[A-Z]{2}$/.test(l)) { cidade = l; continue; }
        if (!endereco) { endereco = l; continue; }
        if (!atividade && !depoisDaCobertura) atividade = l;
      }
    }
    return {
      nossoNumero: nn,
      apolice: (achar(/^Apólice: (.*)$/)?.[1] ?? "").trim(),
      seguradora: segRamo?.[1] ?? "",
      ramo: segRamo?.[2]?.trim() ?? "",
      inicioVigencia: dataIso(de),
      fimVigencia: dataIso(ate),
      premioTotal: premio ? valor(premio[1]) : null,
      parcelas: parc ? Number(parc[2]) : null,
      valorPrimeiraParcela: parc ? valor(parc[1]) : null,
      enderecoRisco: endereco,
      cidadeUf: cidade,
      atividade,
      coberturas,
    };
  });
}

// "R. DAS AMENDOEIRAS, 58 - CASA 2 - B. CENTRO" → partes da planilha.
export function separarEndereco(endereco: string | null) {
  if (!endereco) return { logradouro: "", numero: "", complemento: "", bairro: "" };
  const partes = endereco
    .split(/\s+-(?:\s+|$)/)
    .map((p) => p.replace(/^-\s*|\s*-$/g, "").trim())
    .filter((p, i) => i === 0 || p);
  const [rua, numero = ""] = partes[0].split(/,\s*/);
  const bairroParte = partes.find((p, i) => i > 0 && /^B\. /.test(p));
  const complemento = partes.slice(1).filter((p) => p && p !== bairroParte).join(" ");
  return { logradouro: rua ?? "", numero, complemento, bairro: bairroParte ? bairroParte.replace(/^B\. /, "") : "" };
}
