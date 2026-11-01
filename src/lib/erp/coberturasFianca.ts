// Padronização dos nomes das coberturas de Fiança (apólices Porto, Tokio, Pottencial, Too, Yelum): nome do PDF -> nome padrão + tipo.
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
export type PadraoCobertura = { nome: string; tipo: "basica" | "adicional" | "servico" };
export function padronizarCoberturaFianca(original: string): PadraoCobertura | null {
  const n = sem(original);
  if (/PINTURA/.test(n)) return { nome: /INTERNA/.test(n) && /EXTERNA/.test(n) ? "Pintura interna e externa" : /EXTERNA/.test(n) ? "Pintura externa" : "Pintura interna", tipo: "adicional" };
  if (/DANOS/.test(n)) return { nome: "Danos ao imóvel", tipo: "adicional" };
  if (/MULTA|RESCIS/.test(n)) return { nome: "Multa por rescisão contratual", tipo: "adicional" };
  if (/ASSIST/.test(n)) return { nome: "Assistência 24 horas", tipo: "servico" };
  if (/INADIMPLENCIA|ALUGUEL \+ ENCARGOS|ALUGUEL E ENCARGOS/.test(n)) return { nome: "Aluguel e encargos legais", tipo: "basica" };
  if (/^ALUGUEL$/.test(n)) return { nome: "Aluguel", tipo: "basica" };
  if (/I\.?P\.?T\.?U/.test(n)) return { nome: "IPTU", tipo: "basica" };
  if (/CONDOMIN|DESP\.? ORD/.test(n)) return { nome: "Condomínio (despesas ordinárias)", tipo: "basica" };
  if (/^AGUA$/.test(n)) return { nome: "Água", tipo: "basica" };
  if (/ENERGIA|^LUZ$/.test(n)) return { nome: "Energia elétrica", tipo: "basica" };
  if (/^GAS$/.test(n)) return { nome: "Gás", tipo: "basica" };
  if (/^ALUGUEL/.test(n)) return { nome: "Aluguel", tipo: "basica" };
  return null;
}
