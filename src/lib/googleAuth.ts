import { auth } from "@googleapis/sheets";

// Autenticação via Conta de Serviço do Google (mesmo cliente de auth usado
// pelos pacotes @googleapis/*). A chave privada, ao ser colada no Vercel,
// guarda as quebras de linha como "\n" literal — precisa virar quebra de
// linha de verdade antes de entrar no cliente do Google.
type CredenciaisGoogle = {
  email?: string;
  chavePrivada?: string;
  contexto?: string;
};

export function obterAutenticacaoGoogle(escopos: string[], credenciais: CredenciaisGoogle = {}) {
  const email = credenciais.email || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const chavePrivada = credenciais.chavePrivada || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !chavePrivada) {
    throw new Error(
      `Integração com Google não configurada${credenciais.contexto ? ` para ${credenciais.contexto}` : ""}: faltam as credenciais da conta de serviço.`
    );
  }

  // Usa a mesma instância/tipagem de autenticação consumida pelos pacotes
  // @googleapis/*. Isso evita conflito quando outra versão transitiva de
  // google-auth-library também existe no projeto.
  return new auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: chavePrivada.replace(/\\n/g, "\n"),
    },
    scopes: escopos,
  });
}
