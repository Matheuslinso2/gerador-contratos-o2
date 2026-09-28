// Nome que a imobiliária vê em e-mails/comunicados da O2 (Campanhas, Faturas,
// Repasse). imobiliarias.nome é o nome cadastral/bruto (caixa alta, sufixo
// jurídico, tags internas tipo "(BASE)") -- não serve pra chamar o cliente.
// Pedido do Matheus, 26/09/2026: campo `apelido` no cadastro, editável pela
// própria imobiliária e pela O2; quando vazio, cai no nome tratado aqui.

const SUFIXOS_JURIDICOS = /[\s,\-–/.]*\b(?:ltda|eireli|epp|me|s\.?\s?\/?\s?a|s\.a)\b\.?(?:\s*[-–/]\s*(?:me|epp))?\s*$/i;
const CONECTORES = new Set(["de", "da", "do", "dos", "das", "e", "em", "a", "o"]);
const VOGAL = /[aeiouáéíóúâêôãõ]/i;

function paraTitleCase(texto: string): string {
  return texto
    .split(/(\s+)/)
    .map((pedaco, i) => {
      if (/^\s+$/.test(pedaco) || !pedaco) return pedaco;
      const minusculo = pedaco.toLowerCase();
      if (i > 0 && CONECTORES.has(minusculo)) return minusculo;
      // Sigla: sem vogal (MG, JMC), 2 letras (AB, AG, RJ) ou com dígito (A3, 2MX).
      const sigla = /\d/.test(pedaco) || (pedaco.length <= 3 && !VOGAL.test(pedaco)) || /^[A-Za-z]{2}$/.test(pedaco);
      if (sigla) return pedaco.toUpperCase();
      return minusculo.replace(/\p{L}/u, (c) => c.toUpperCase());
    })
    .join("");
}

export function limparNomeCru(nome: string): string {
  let limpo = nome.replace(/\([^)]*\)/g, " ");
  for (let i = 0; i < 3; i++) limpo = limpo.replace(SUFIXOS_JURIDICOS, "");
  limpo = limpo.replace(/\s+/g, " ").replace(/^[\s\-–,./]+|[\s\-–,./]+$/g, "");
  if (!limpo) return nome.trim();
  // Nome já em caixa mista foi digitado por alguém de propósito -- só perde
  // tag/sufixo, sem reescrever a capitalização.
  return limpo === limpo.toUpperCase() ? paraTitleCase(limpo) : limpo;
}

export function nomeParaComunicacao(imob: { apelido?: string | null; nome: string }): string {
  return imob.apelido?.trim() || limparNomeCru(imob.nome);
}
