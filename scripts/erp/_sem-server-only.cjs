// Pré-carga para scripts locais (tsx --require): o pacote "server-only" só existe para impedir import no navegador;
// fora do Next ele não está instalado. Aqui ele vira um módulo vazio, sem depender de stub dentro de node_modules.
const Module = require("module");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return require.resolve("./_vazio.cjs");
  return original.call(this, request, ...rest);
};
