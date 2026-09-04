// Alguns CNPJs distintos em `imobiliarias` são, de fato, a MESMA empresa
// ou o MESMO grupo econômico (confirmado manualmente durante conciliações
// -- CNPJ antigo com fatura ainda vigente + CNPJ novo com produção nova,
// pessoa física + jurídica da mesma pessoa, ou controladas do mesmo grupo).
// Cada CNPJ continua sendo um registro PRÓPRIO e completo em `imobiliarias`
// de propósito (contrato-base, e-mail, financeiro, vínculos de fatura --
// nada é compartilhado ou herdado entre eles); isso só decide quais linhas
// aparecem juntas, sob um mesmo grupo, nas telas que listam imobiliárias
// (Faturas e Configurações → Imobiliárias cadastradas) -- pra não parecer
// cadastro duplicado quando na real são registros deliberadamente
// separados da mesma empresa/grupo.
export const GRUPOS_VISUAIS: Record<string, { chave: string; nomeGrupo: string }> = {
  "37460218000139": { chave: "ACESSE_RJ", nomeGrupo: "Acesse Imóvel RJ" },
  "02038854000192": { chave: "ACESSE_RJ", nomeGrupo: "Acesse Imóvel RJ" },
  "56106738000192": { chave: "MAX_BROKERS", nomeGrupo: "Max Brokers" },
  "34595830000120": { chave: "MAX_BROKERS", nomeGrupo: "Max Brokers" },
  "41364706000110": { chave: "MARCUS_DREHER", nomeGrupo: "Marcus Dreher" },
  "00908412711": { chave: "MARCUS_DREHER", nomeGrupo: "Marcus Dreher" },
  "48328384000100": { chave: "RAMIRO_SA", nomeGrupo: "Ramiro Sá" },
  "40444309772": { chave: "RAMIRO_SA", nomeGrupo: "Ramiro Sá" },
  "92786854000163": { chave: "TERUSZKIN", nomeGrupo: "Grupo Teruszkin" },
  "08984167000146": { chave: "TERUSZKIN", nomeGrupo: "Grupo Teruszkin" },
  "09008875000104": { chave: "TERUSZKIN", nomeGrupo: "Grupo Teruszkin" },
};
