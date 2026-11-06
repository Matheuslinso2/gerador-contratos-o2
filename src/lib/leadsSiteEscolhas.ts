// Respostas "de escolha" dos formulários do site (assunto de interesse etc.).
// O plugin que manda o lead pro sistema só passa campos de texto, então o site
// copia essas escolhas pra campos de texto escondidos com estes nomes (ver o
// código "espelho" do formulário no WordPress). Usado no painel /leads-site e
// no e-mail de aviso de lead novo, pra os dois mostrarem a mesma coisa.
export const CAMPOS_DE_ESCOLHA: [string, string][] = [
  ["interesse", "Interesse"],
  ["tipo_solucao", "Procura"],
  ["perfil_escolhido", "Perfil"],
  ["contratos_escolhido", "Contratos ativos"],
  ["empresa", "Imobiliária"],
];

// Só as escolhas que a pessoa de fato preencheu (vazio não entra).
export function escolhasDoLead(campos: Record<string, unknown> | null): [string, string][] {
  const preenchidas: [string, string][] = [];
  for (const [chave, rotulo] of CAMPOS_DE_ESCOLHA) {
    const valor = campos?.[chave];
    if (typeof valor === "string" && valor.trim()) preenchidas.push([rotulo, valor.trim()]);
  }
  return preenchidas;
}

export function resumoDasEscolhas(campos: Record<string, unknown> | null): string {
  return escolhasDoLead(campos)
    .map(([rotulo, valor]) => `${rotulo}: ${valor}`)
    .join(" · ");
}
