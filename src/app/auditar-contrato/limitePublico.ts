// Constante isolada num arquivo sem "use server" de propósito: actions.ts
// tem essa diretiva, e um módulo "use server" só pode exportar funções
// async -- exportar uma constante direto de lá quebra o build. page.tsx
// (Server Component) e actions.ts importam os dois daqui.
export const LIMITE_AUDITORIAS_PUBLICAS_POR_IP = 5;
