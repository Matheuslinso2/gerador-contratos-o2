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
};

export default withSentryConfig(nextConfig, {
  org: "o2-seguros",
  project: "javascript-nextjs",
  silent: !process.env.CI,
});
