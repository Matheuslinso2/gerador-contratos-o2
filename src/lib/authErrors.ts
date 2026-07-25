const MENSAGENS: Record<string, string> = {
  "Invalid login credentials": "E-mail ou senha incorretos.",
  "Email not confirmed": "Confirme seu e-mail antes de entrar (verifique sua caixa de entrada).",
  "User already registered": "Já existe uma conta com esse e-mail.",
  "Password should be at least 6 characters": "A senha precisa ter pelo menos 6 caracteres.",
};

export function traduzirErroAuth(mensagem: string) {
  return MENSAGENS[mensagem] ?? mensagem;
}
