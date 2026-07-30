import { GoogleAuth } from "google-auth-library";

// Autenticação via Conta de Serviço do Google (mesmo cliente de auth usado
// pelos pacotes @googleapis/*). A chave privada, ao ser colada no Vercel,
// guarda as quebras de linha como "\n" literal — precisa virar quebra de
// linha de verdade antes de entrar no cliente do Google.
export function obterAutenticacaoGoogle(escopos: string[]) {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const chavePrivada = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  if (!email || !chavePrivada) {
    throw new Error(
      "Integração com Google não configurada: faltam GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY."
    );
  }

  return new GoogleAuth({
    credentials: {
      client_email: email,
      private_key: chavePrivada.replace(/\\n/g, "\n"),
    },
    scopes: escopos,
  });
}
