import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

export default nextConfig;
