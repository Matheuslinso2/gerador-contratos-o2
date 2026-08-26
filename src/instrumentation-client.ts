import * as Sentry from "@sentry/nextjs";

// Sem Session Replay de propósito: o app lida com dado sensível de
// locador/locatário (CPF, dados financeiros) e gravar a tela por padrão
// arriscaria capturar isso sem uma decisão explícita sobre o assunto.
Sentry.init({
  dsn: "https://62cc8aa6564abd91a2a53de66d9c568d@o4511955116818432.ingest.us.sentry.io/4511955129991168",
  tracesSampleRate: 1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
