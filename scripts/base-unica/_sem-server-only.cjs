// Scripts de linha de comando (tsx) que reaproveitam código de src/lib marcado
// com `import "server-only"`: aqui não há bundle do Next, então o marcador
// vira um módulo vazio. Uso: npx tsx --require ./scripts/base-unica/_sem-server-only.cjs <script>
const Module = require("module");
const carregar = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === "server-only") return {};
  return carregar.call(this, pedido, ...resto);
};
