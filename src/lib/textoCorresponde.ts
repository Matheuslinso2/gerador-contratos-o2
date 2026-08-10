// Comparação fuzzy de nomes (imobiliária, cliente etc.) -- normaliza acento
// e pontuação e considera "corresponde" se um texto contém o outro (em
// qualquer direção), já que a mesma entidade aparece com grafias diferentes
// entre fontes/meses.

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizarTextoBusca(texto: string): string {
  return semAcento(texto.toLowerCase()).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function textoCorresponde(valor: string, busca: string): boolean {
  const a = normalizarTextoBusca(valor);
  const b = normalizarTextoBusca(busca);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}
