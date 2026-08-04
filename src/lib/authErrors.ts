// Tradução exata (o Supabase às vezes muda a pontuação/número entre
// versões, por isso também tem correspondência por trecho logo abaixo).
const MENSAGENS: Record<string, string> = {
  "Invalid login credentials": "E-mail ou senha incorretos.",
  "Email not confirmed": "Confirme seu e-mail antes de entrar (verifique sua caixa de entrada).",
  "User already registered": "Já existe uma conta com esse e-mail.",
  "Password should be at least 6 characters": "A senha precisa ter pelo menos 6 caracteres.",
  "Unable to validate email address: invalid format": "Esse e-mail não parece válido — confira se digitou certo.",
  "Signup is disabled": "Criação de contas está temporariamente desativada. Fale com a O2.",
  "New password should be different from the old password.": "A nova senha precisa ser diferente da senha atual.",
  "Auth session missing!": "Sua sessão expirou. Peça um novo link e tente de novo.",
};

// Correspondência por trecho, pra pegar variações (ex: número de segundos
// muda a cada erro de limite de tentativas).
const TRECHOS: [string, string][] = [
  ["Password should be at least", "A senha precisa ter pelo menos 6 caracteres."],
  ["you can only request this after", "Muitas tentativas seguidas — espere um minuto e tente de novo."],
  ["rate limit", "Muitas tentativas seguidas — espere um pouco e tente de novo."],
  ["Token has expired", "Esse link expirou. Peça um novo."],
  ["Invalid token", "Esse link não é mais válido. Peça um novo."],
  ["Network", "Falha de conexão. Confira sua internet e tente de novo."],
];

// Nunca deixa passar uma mensagem crua em inglês pro usuário — se não
// reconhecer, cai num aviso genérico amigável em português.
const GENERICO = "Não foi possível concluir agora. Tente novamente em instantes.";

export function traduzirErroAuth(mensagem: string) {
  if (MENSAGENS[mensagem]) return MENSAGENS[mensagem];
  const porTrecho = TRECHOS.find(([trecho]) => mensagem.toLowerCase().includes(trecho.toLowerCase()));
  if (porTrecho) return porTrecho[1];
  if (/^[\x00-\x7F]*$/.test(mensagem) === false) return mensagem; // já não é ASCII puro, provavelmente já está em pt-BR
  console.error("[authErrors] mensagem não traduzida:", mensagem);
  return GENERICO;
}
