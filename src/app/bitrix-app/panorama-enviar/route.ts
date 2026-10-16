// Mesmo envio do Panorama por e-mail, num caminho sob /bitrix-app (público
// no proxy) pra funcionar de dentro do iframe do Bitrix, onde não há
// sessão do Workspace. A autorização é o passe HMAC da aba "Panorama",
// conferido dentro da rota (ver lib/panoramaAutorizacao.ts).
export { POST } from "@/app/api/seguro-fianca/panoramas/enviar/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
