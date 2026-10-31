// Teste sem Corp das regras de erro do robô de anexos: simula a noite de 30/10 (5 documentos que sempre dão erro)
// e confere que: pula, no máximo 2 tentativas, não repete após reinício, e a fila andou além dos 5.
//   npx.cmd tsx scripts/robo-corp/testar-fila.ts
import { estaPulado, registrarErro, selecionarPendentes, type EntradaEstado } from "./anexos-fila";
const ruins = new Set(["115250", "115263", "115374", "115375", "116567"]);
const bons = Array.from({ length: 60 }, (_, i) => String(120000 - i)); // não colidem com os ruins
const fila = [...ruins, ...bons].map((nn) => ({ nn })); // os 5 ruins no começo da fila, como na noite de 30/10
const estado: Record<string, EntradaEstado> = {};
const falhou = new Set<string>();
let ok = 0, tentativasTotais = 0, reinicios = 0, consecutivos = 0;
const V = 3;
let falhas = 0; const ver = (c: boolean, m: string) => { if (!c) { falhas++; console.log("FALHOU:", m); } };
for (let sessao = 0; sessao < 12; sessao++) {
  const pend = selecionarPendentes(fila, estado, V, falhou);
  if (!pend.length) break;
  let andou = 0, caiu = false;
  for (const i of pend) {
    if (ruins.has(i.nn)) { tentativasTotais++; registrarErro(estado, i.nn, "anexo-visualizar não apareceu em 5 s"); falhou.add(i.nn); if (++consecutivos >= 5) { caiu = true; break; } }
    else { estado[i.nn] = { resultado: "baixado", versao: V }; ok++; andou++; consecutivos = 0; }
  }
  if (caiu) { reinicios++; consecutivos = 0; } else break;
}
ver(ok === 60, `todos os 60 bons foram feitos (${ok})`);
ver(tentativasTotais <= ruins.size, `cada ruim tentou no máximo 1x neste processo (${tentativasTotais})`);
ver(reinicios <= 1, `no máximo 1 reinício (${reinicios})`);
// 2ª tentativa só no fim, em outro processo (falhou vazio): depois dela, pulado
const falhou2 = new Set<string>();
const p2 = selecionarPendentes(fila, estado, V, falhou2);
ver(p2.length === ruins.size && p2.every((i) => ruins.has(i.nn)), "no dia seguinte só os ruins voltam (1 tentativa sobrando)");
for (const i of p2) registrarErro(estado, i.nn, "de novo");
ver([...ruins].every((nn) => estaPulado(estado[nn]) && estado[nn].tentativas === 2), "após a 2ª tentativa os 5 estão pulados com tentativas=2");
ver(selecionarPendentes(fila, estado, V, new Set()).length === 0, "pulados não voltam mais");
// erro antigo (sem contador) vale 1 tentativa
ver(selecionarPendentes([{ nn: "1" }], { "1": { resultado: "erro" } }, V, new Set()).length === 1 && !estaPulado({ resultado: "erro" }), "erro antigo = 1 tentativa, 1 sobrando");
console.log(falhas ? `${falhas} FALHA(S)` : `OK: ${ok} documentos bons feitos, ${tentativasTotais} tentativas nos 5 ruins, ${reinicios} reinício(s), 5 pulados`);
process.exit(falhas ? 1 : 0);
