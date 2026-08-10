// Lista fechada de ramos do módulo de Produção -- o ramo de cada linha vem
// de qual arquivo foi enviado (escolhido no upload), não do texto livre da
// coluna "Ramo" da planilha (que varia entre "2 FIANÇA"/"FIANCA LOCATICIA",
// "IMOBILIARIO"/"2 IMOBILIARIO" etc. para o mesmo produto).
export const RAMOS_PRODUCAO = [
  { valor: "automovel", rotulo: "Automóvel" },
  { valor: "fianca_locaticia", rotulo: "Fiança Locatícia" },
  { valor: "capitalizacao", rotulo: "Capitalização" },
  { valor: "incendio_residencial", rotulo: "Incêndio Residencial" },
  { valor: "incendio_empresarial", rotulo: "Incêndio Empresarial" },
  { valor: "incendio_imobiliario", rotulo: "Incêndio Imobiliário" },
  { valor: "condominio", rotulo: "Condomínio" },
] as const;

export type RamoProducao = (typeof RAMOS_PRODUCAO)[number]["valor"];

const VALORES = RAMOS_PRODUCAO.map((r) => r.valor) as string[];

export function ehRamoValido(valor: string): valor is RamoProducao {
  return VALORES.includes(valor);
}

export function rotuloRamo(valor: string): string {
  return RAMOS_PRODUCAO.find((r) => r.valor === valor)?.rotulo ?? valor;
}
