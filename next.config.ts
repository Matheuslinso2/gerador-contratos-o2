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
};

export default nextConfig;
