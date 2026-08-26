import * as Sentry from "@sentry/nextjs";

const DSN = "https://62cc8aa6564abd91a2a53de66d9c568d@o4511955116818432.ingest.us.sentry.io/4511955129991168";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: DSN,
      tracesSampleRate: 1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
