import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";

// Descoberta OAuth (RFC 9728) do conector de leitura: diz ao Claude que o
// login é feito pelo servidor de autorização do Supabase deste projeto.
// Atende /.well-known/oauth-protected-resource e .../api/mcp; o endereço do
// recurso sai do próprio pedido (contratos.o2seguros.com.br em produção).
const handler = protectedResourceHandler({
  authServerUrls: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
});

export { handler as GET };
export const OPTIONS = metadataCorsOptionsRequestHandler();
