import { textoCorresponde } from "@/lib/textoCorresponde";
import { apenasDigitos } from "@/lib/pdfComSenha";

export type ImobiliariaParaRepasse = {
  id: string;
  nome: string;
  cnpj: string | null;
  codigo_produtor_corp: string | null;
};

export type ResultadoIdentificacaoRepasse = {
  imobiliaria_id: string | null;
  confianca: "alta" | "media" | "baixa" | null;
};

// Sinal mais forte de longe: o "código do produtor" que o Corp imprime no
// relatório (ex: "Total do Produtor: 406 CARLA MARCOS PINNA") é o mesmo
// número que fica salvo em imobiliarias.codigo_produtor_corp assim que
// alguém confirma manualmente uma vez -- da 2ª vez em diante casa sozinho,
// sem precisar comparar nome nem CPF.
export function buscarImobiliariaPorCodigoProdutor(
  codigo: string | null,
  imobiliarias: ImobiliariaParaRepasse[]
): ResultadoIdentificacaoRepasse {
  if (!codigo?.trim()) return { imobiliaria_id: null, confianca: null };
  const encontrada = imobiliarias.find((i) => i.codigo_produtor_corp && i.codigo_produtor_corp.trim() === codigo.trim());
  return encontrada ? { imobiliaria_id: encontrada.id, confianca: "alta" } : { imobiliaria_id: null, confianca: null };
}

// CPF/CNPJ só aparece no comprovante bancário (dados de quem recebe), nunca
// no relatório do Corp -- ainda assim vale tentar, é tão forte quanto o
// código do produtor quando disponível.
export function buscarImobiliariaPorCpfCnpj(
  cpfCnpj: string | null,
  imobiliarias: ImobiliariaParaRepasse[]
): ResultadoIdentificacaoRepasse {
  const alvo = apenasDigitos(cpfCnpj ?? "");
  if (!alvo) return { imobiliaria_id: null, confianca: null };
  const encontrada = imobiliarias.find((i) => i.cnpj && apenasDigitos(i.cnpj) === alvo);
  return encontrada ? { imobiliaria_id: encontrada.id, confianca: "alta" } : { imobiliaria_id: null, confianca: null };
}

// Último recurso: nome do produtor (relatório) ou do favorecido
// (comprovante) batendo com o cadastro -- mesmo critério "media"/"baixa" já
// usado em Faturas (media = 1 correspondência só, baixa = mais de uma,
// ambíguo, precisa de olho humano).
export function sugerirImobiliariaPorNome(
  nome: string | null,
  imobiliarias: ImobiliariaParaRepasse[]
): ResultadoIdentificacaoRepasse {
  if (!nome?.trim()) return { imobiliaria_id: null, confianca: null };
  const correspondencias = imobiliarias.filter((i) => textoCorresponde(i.nome, nome));
  if (correspondencias.length === 1) return { imobiliaria_id: correspondencias[0].id, confianca: "media" };
  if (correspondencias.length > 1) return { imobiliaria_id: correspondencias[0].id, confianca: "baixa" };
  return { imobiliaria_id: null, confianca: null };
}

// Repasse só fica "pronto pra envio" quando o valor líquido do relatório
// bate com o valor transferido no comprovante -- string de moeda pode
// divergir por centavos de arredondamento entre o que o Corp calcula e o
// que o banco de fato processou, então compara com uma tolerância pequena
// em vez de igualdade exata.
export function valoresBatem(valorRelatorio: number | null, valorComprovante: number | null): boolean {
  if (valorRelatorio === null || valorComprovante === null) return false;
  return Math.abs(valorRelatorio - valorComprovante) < 0.01;
}
