// Envia o e-mail de alerta do vigia dos robôs do Corp para o Matheus. Uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs scripts/robo-corp/alerta-vigia.ts "texto do aviso"
import { enviarEmail } from "@/lib/email";

process.loadEnvFile(".env.local");
const texto = (process.argv[2] ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
if (!texto) process.exit(1);
enviarEmail({
  para: "matheus@o2seguros.com.br",
  assunto: "⚠️ Robôs do Corp parados",
  html: `<div style="font-family:Arial,sans-serif;max-width:560px"><p style="color:#01192e;font-size:15px"><b>Aviso do vigia dos robôs do Corp</b></p><p style="font-size:14px;color:#01192e">${texto}</p><p style="font-size:12px;color:#888">O vigia já tentou reiniciar sozinho. Detalhes: scripts\\robo-corp\\saida\\vigia.log</p></div>`,
  remetente: "Workspace O2 — Vigia do Corp",
}).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
