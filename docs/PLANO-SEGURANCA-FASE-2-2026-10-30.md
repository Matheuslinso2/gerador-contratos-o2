# Segurança do Workspace/ERP: fase 2 (planejado em 30/10/2026)

Continuação de `docs/PLANO-SEGURANCA-PROXIMOS-PASSOS-2026-10-30.md` (fase 1 concluída em 30/10).
Origem: levantamento somente leitura do item G (30/10). Nada aqui foi feito ainda.

## Etapa 1: só código, sem nada do Matheus (1 sessão)

| # | O que | Risco hoje | Como corrigir |
|---|---|---|---|
| 1.1 | E-mails internos dos formulários aceitam HTML do visitante: dá para montar um e-mail de golpe "oficial" para o comercial@ e as caixas de produto | Médio | Escapar o texto em `linhaCampo()` (`src/lib/integracoes/emailO2.ts`). Uma correção cobre os 7 formulários |
| 1.2 | Abas do Bitrix aceitam qualquer usuário do portal (inclusive convidado/extranet); `conversas-gmail` faz busca livre no Gmail da O2; `card-email` devolve assinaturas e modelos a quem fizer POST | Médio | Exigir usuário `@o2seguros` (`emailDoUsuarioBitrix`) em info-card, conversas, conversas-gmail, enviar-email, anexo/imagem-upload-url, modelos-email; `card-email` só mostra conteúdo com token válido |
| 1.3 | `/bitrix-app/registrar-placements` aberta (executa `placement.bind`) | Médio | Exigir sessão de admin |
| 1.4 | Cookie de "acesso público" (Auditor/Multa) pode ser criado à mão | Médio | Cookie assinado (HMAC + validade) e checagem também dentro de `auditarPublico` |
| 1.5 | Regra de rota pública por prefixo (`startsWith`) | Baixo | `path === r \|\| path.startsWith(r + "/")` em `src/proxy.ts` |
| 1.6 | Senhas dos robôs comparadas com `===` (20 crons + 4 webhooks) | Baixo | Função única `compararSegredo` / `exigirCronSecret` em `src/lib/segredos.ts` com `timingSafeEqual` |
| 1.7 | `/api/social/imagem/[postId]` mostra rascunho e erro detalhado | Baixo | Só posts aprovados/publicados; erro genérico |

**Teste:** testes locais por rota mais um teste seu (abrir a aba E-mail e a aba Apólice-mãe de um card no Bitrix).

## Etapa 2: formulários públicos (1 sessão + 1 teste seu)

| # | O que | Como corrigir |
|---|---|---|
| 2.1 | Sem proteção contra robô de spam (cards falsos no Bitrix, e-mails, planilha) | Campo-isca invisível (honeypot) e tempo mínimo de preenchimento; limites de tamanho por campo. O Firewall já limita 60 por minuto por IP. Se mesmo assim aparecer spam: Cloudflare Turnstile (grátis, precisa criar uma chave) |
| 2.2 | Upload direto do navegador com permissão aberta: qualquer um enche o bucket, e o envio pode apontar para o arquivo de outra pessoa | O servidor gera uma URL de envio assinada só para a pasta daquele envio (`{responseId}/...`), como já é feito no app Bitrix; tirar o INSERT de visitante dos 4 buckets; o servidor só aceita caminhos do próprio envio |

**Teste:** você manda 1 ficha de teste de cada formulário com anexo, e eu confiro card, e-mail e antivírus.

## Etapa 3: precisa de você (cerca de 10 min cada, eu guio)

| # | O que | O que você faz |
|---|---|---|
| 3.1 | Token da planilha da Ficha Fiança escrito no código (`integracoes/google-apps-script/ficha-fianca-planilha.gs`) | Colar um token novo no Apps Script (Propriedades do script) e na Vercel; eu tiro o valor do código |
| 3.2 | Token do webhook do WordPress sem validade e sem tela para trocar | Eu crio a tela de gerar/revogar token (guardado só como hash); você troca a URL no plugin do WordPress |

## Depois (quando houver tempo)
- Política completa de conteúdo (CSP): mapear Sentry, Google Maps e scripts do Next antes.
- Conferir backups do Supabase (plano Pro: diário, 7 dias) e decidir se vale ter recuperação a qualquer ponto no tempo (PITR, pago).
- Conector do GitHub no app Claude (credencial em formato inválido no plugin), conveniência e não segurança.
- Não é segurança, mas apareceu nos registros: a chave principal do Bitrix sem permissão de **tarefas** (KPI R9 do Painel Comercial zerado).
