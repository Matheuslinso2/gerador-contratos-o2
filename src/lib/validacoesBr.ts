// Validação e formatação de CPF, CNPJ e CEP — documentos brasileiros com
// dígito verificador (CPF/CNPJ) usados nos formulários de cadastro/geração
// de contrato.

export function apenasDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export function formatarCPF(valor: string): string {
  const d = apenasDigitos(valor).slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

export function formatarCNPJ(valor: string): string {
  const d = apenasDigitos(valor).slice(0, 14);
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function formatarCEP(valor: string): string {
  const d = apenasDigitos(valor).slice(0, 8);
  return d.replace(/(\d{5})(\d{1,3})$/, "$1-$2");
}

// Algoritmo padrão de dígito verificador do CPF.
export function validarCPF(valor: string): boolean {
  const d = apenasDigitos(valor);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;

  const digitos = d.split("").map(Number);
  const calcularDigito = (tamanho: number) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += digitos[i] * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return calcularDigito(9) === digitos[9] && calcularDigito(10) === digitos[10];
}

// Algoritmo padrão de dígito verificador do CNPJ.
export function validarCNPJ(valor: string): boolean {
  const d = apenasDigitos(valor);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;

  const digitos = d.split("").map(Number);
  const calcularDigito = (tamanho: number) => {
    const pesos = tamanho === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += digitos[i] * pesos[i];
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return calcularDigito(12) === digitos[12] && calcularDigito(13) === digitos[13];
}

export function validarCEP(valor: string): boolean {
  return apenasDigitos(valor).length === 8;
}

export type EnderecoViaCep = {
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
};

// Busca endereço a partir do CEP na API pública do ViaCEP (Correios).
export async function buscarEnderecoPorCep(cep: string): Promise<EnderecoViaCep | null> {
  const d = apenasDigitos(cep);
  if (d.length !== 8) return null;
  try {
    const resp = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    if (!resp.ok) return null;
    const dados = await resp.json();
    if (dados.erro) return null;
    return dados as EnderecoViaCep;
  } catch {
    return null;
  }
}
