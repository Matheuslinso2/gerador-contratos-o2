import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (via pdfjs-dist) lê arquivos internos do próprio pacote em
  // tempo de execução; sem isso, o empacotamento serverless da Vercel corta
  // esses arquivos e a extração de PDF quebra em produção (mas funciona local).
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
