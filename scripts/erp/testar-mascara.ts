import { mascararSegredos as m } from "@/lib/erp/mascararSegredos";
const casos: [string, string][] = [
  ["REPASSE 15% PRO LABORE", "REPASSE 15% PRO LABORE"],
  ["portal Porto login: joao.silva senha: Abc@1234", "portal Porto login: *** senha: ***"],
  ["usuário/senha: matheus / 1234", "usuário/senha: ***"],
  ["SENHA É 998877", "SENHA É ***"],
  ["acesso liberado pela imob", "acesso liberado pela imob"],
  ["token=XyZ-123 pin 4455", "token=*** pin ***"],
];
let f = 0; for (const [i, o] of casos) { const r = m(i); if (r !== o) { f++; console.log("FALHOU:", JSON.stringify(i), "->", JSON.stringify(r), "esperado", JSON.stringify(o)); } }
console.log(f ? `${f} falha(s)` : "OK máscara");
