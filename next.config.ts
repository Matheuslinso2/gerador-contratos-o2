import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Contratos reais (PDF/Word de várias páginas) passam facilmente do
      // limite padrão de 1 MB para o corpo de uma Server Action.
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
