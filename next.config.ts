import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Código da publicação que gerou esta página: o aviso "sistema atualizado"
  // (components/AvisoNovaVersao.tsx) compara com /api/versao.
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? "local" },
  experimental: {
    serverActions: {
      // Contratos reais (PDF/Word de várias páginas) passam facilmente do
      // limite padrão de 1 MB para o corpo de uma Server Action. O Auditor
      // pode receber contrato + cotação no mesmo envio, então a margem
      // precisa cobrir os dois arquivos somados.
      bodySizeLimit: "25mb",
    },
  },
  // Reforço: garante que a logo e as fontes usadas em
  // src/app/api/social/imagem/[postId]/route.tsx entrem no bundle da
  // função, mesmo que o rastreio automático da Vercel não capture os
  // fs.readFileSync (já aconteceu de sumir em produção).
  outputFileTracingIncludes: {
    "/api/social/imagem/*": ["public/marca-o2/**/*", "src/lib/social/fonts/**/*"],
  },
  // Cabeçalhos de segurança (revisão 30/10/2026, item 6). Só frame-ancestors
  // na CSP por enquanto: uma CSP completa precisa mapear Sentry, Google Maps
  // e os scripts inline do Next antes, senão quebra telas. Sem
  // X-Frame-Options porque ele não consegue liberar o Bitrix no /bitrix-app
  // (frame-ancestors já cobre todos os navegadores atuais).
  async headers() {
    const comuns = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    ];
    return [
      // Nenhuma página pode ser aberta dentro de iframe de outro site
      // (o Painel Comercial usa iframe do próprio domínio, liberado por 'self').
      { source: "/:path*", headers: [...comuns, { key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
      // O app do Bitrix abre dentro do portal da O2 no Bitrix24 -- a regra
      // de baixo substitui a de cima só nessas rotas.
      {
        source: "/bitrix-app/:path*",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self' https://o2seguros.bitrix24.com.br" }],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "o2-seguros",
  project: "javascript-nextjs",
  silent: !process.env.CI,
});
