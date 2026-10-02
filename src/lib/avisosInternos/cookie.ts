// Nome do cookie que carrega o HTML do recado entre novo -> revisar ->
// enviarAvisoInterno (ver novo/actions.ts pro motivo). Fica num arquivo
// próprio porque um arquivo "use server" só pode exportar funções --
// não dá pra exportar essa constante direto de novo/actions.ts.
export const COOKIE_MENSAGEM_AVISO = "aviso_mensagem_html";
