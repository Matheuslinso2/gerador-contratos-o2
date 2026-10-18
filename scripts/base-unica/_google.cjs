// Helper: auth do Google com as credenciais do .env.local do projeto (só leitura)
const path = require("path");
const P = path.resolve(__dirname, "..", "..");
require(path.join(P, "node_modules/dotenv")).config({ path: path.join(P, ".env.local") });
const { drive, auth } = require(path.join(P, "node_modules/@googleapis/drive"));
const { sheets } = require(path.join(P, "node_modules/@googleapis/sheets"));

function pem(k) {

  const corpo = k.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "");
  const estranhos = new Set(corpo.replace(/[A-Za-z0-9+/=]/g, ""));

  const b = corpo.replace(/\\n/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  return "-----BEGIN PRIVATE KEY-----\n" + b.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
}

function cliente(qual = "RE") {
  const e = qual === "RE" ? process.env.RAMOS_ELEMENTARES_GOOGLE_SERVICE_ACCOUNT_EMAIL : process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const k = qual === "RE" ? process.env.RAMOS_ELEMENTARES_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY : process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const a = new auth.GoogleAuth({
    credentials: { client_email: e, private_key: pem(k) },
    scopes: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return { email: e, drive: drive({ version: "v3", auth: a }), sheets: sheets({ version: "v4", auth: a }) };
}

module.exports = { cliente };

if (require.main === module) {
  (async () => {
    for (const qual of ["RE", "GERAL"]) {
      const c = cliente(qual);
      console.log("==", qual, c.email);
      let pt, n = 0;
      do {
        const r = await c.drive.files.list({
          q: "trashed=false", pageSize: 1000, pageToken: pt,
          fields: "nextPageToken,files(id,name,mimeType,modifiedTime,parents)",
          supportsAllDrives: true, includeItemsFromAllDrives: true,
        });
        for (const f of r.data.files) {
          n++;
          console.log([f.mimeType.replace("application/vnd.google-apps.", ""), f.name, (f.modifiedTime || "").slice(0, 10), f.id, (f.parents || []).join(",")].join(" | "));
        }
        pt = r.data.nextPageToken;
      } while (pt);
      console.log("total", n);
    }
  })().catch((e) => console.error("ERRO", e.message));
}
