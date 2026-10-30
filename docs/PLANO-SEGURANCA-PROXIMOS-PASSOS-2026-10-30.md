# Plano de segurança — próximos passos (30/10/2026)

Continuação de `docs/REVISAO-SEGURANCA-WORKSPACE-2026-10-30.md`.

## Já feito em 30/10

| Item | O que foi feito | Status |
|---|---|---|
| 1–3 | Migração `supabase/schema_seguranca_2026_10_30.sql` aplicada no banco: 33 funções deixaram de ser chamáveis por visitante (23 só service_role, 3 de gatilho fechadas, 7 + `erp_contar_alertas_fatura` só logado), 5 views com `security_invoker`, RLS nos 3 backups de 28/10. Testado: equipe vê os mesmos dados (emissão 1.088, alertas 641, cobrança 41.404), login de imobiliária vê 0, tempo igual. Alertas do Supabase `security_definer_view` e `rls_disabled_in_public` sumiram. | **No banco** |
| 4 | "Confirm email" ligado e "anonymous sign-ins" desligado (conferido pelo Matheus no painel). | OK |
| 5 | `/api/erro-cliente`: só aceita o próprio site, corpo ≤ 8 KB, 5 alertas/IP e 40 no total a cada 10 min; `alertarAdmin` escapa HTML. | Código local, falta publicar |
| 6 | `next.config.ts`: nosniff, Referrer-Policy, Permissions-Policy, `frame-ancestors 'self'` (Bitrix liberado só em `/bitrix-app`). | Código local, falta publicar |

Ficaram de propósito liberadas para visitante: `is_admin_o2`, `is_colaborador_o2`, `is_equipe_o2`, `chat_participa`, `imobiliarias_do_usuario` (usadas em ~240 policies para PUBLIC; só respondem sobre quem chama).

## Próximos passos (por ordem de prioridade)

### A. Painel do Supabase — Matheus, ~5 min
1. Authentication → Attack Protection (ou Providers → Email): ligar **"Prevent use of leaked passwords"** (item 8).
2. Senha mínima **8 caracteres** (e ajustar a checagem de 6 em `src/app/signup/actions.ts` para bater).
3. Authentication → Rate Limits: conferir limites de login/cadastro/recuperação de senha.

### B. Publicar itens 5 e 6 — Claude, com OK do Matheus
- Commit só dos 4 arquivos (`git commit -- <paths>`), push, e conferir na produção:
  cabeçalhos em `/login`, aba **E-mail** abrindo dentro de um card do Bitrix.

### C. Impedir que o problema volte — Claude, migração pequena
- O Supabase dá EXECUTE para `anon` **automaticamente** em toda função nova — foi assim que as 33 ficaram abertas.
  Proposta: `alter default privileges in schema public revoke execute on functions from anon, public;`
  (função nova que precisar ser pública recebe `grant` explícito). Conferir antes que nenhum formulário
  público chama RPC como visitante.
- Pôr conferência de equipe em `erp_contar_alertas_fatura`, `gerar_numero_aviso_sinistro`, `sinistro_pasta_acessivel`
  (as 3 únicas liberadas para logado sem checagem; só leem).
- Fixar `search_path` nas 20 funções do alerta `function_search_path_mutable` (risco baixo, limpeza).
- Apagar os 3 backups de 28/10 quando o Matheus confirmar que não precisa mais.

### D. Limite de tentativas (item 7) — Cloudflare, Matheus + Claude
- Regra de rate limit no Cloudflare para `POST` em `/login`, `/signup`, `/esqueci-senha`, formulários públicos
  (`/ficha-fianca`, `/seguro-incendio`, `/seguro-auto`, `/capitalizacao`, `/rc-obras`…) e `/api/erro-cliente`.
- Conferir se o domínio `contratos.o2seguros.com.br` passa pelo proxy do Cloudflare (nuvem laranja); se não, usar o Vercel Firewall.

### E. Antivírus nos anexos dos formulários públicos — decisão do Matheus
Hoje só há checagem de tipo/extensão (`lib/tipoArquivoUpload.ts`).
1. **Já, sem custo:** aceitar só PDF/JPG/PNG nos formulários públicos (Word/Excel podem ter macro), limite de tamanho por
   arquivo, nunca devolver o arquivo do visitante com o tipo informado pelo navegador.
2. **Varredura de verdade:** ClamAV num servidor pequeno (container) que recebe o arquivo antes de ele ir para o bucket
   definitivo (quarentena → limpo). Não usar VirusTotal: envia documento com dado pessoal a terceiro (LGPD).

### F. Contas da equipe — maior risco hoje é senha roubada
- Verificação em duas etapas (MFA/TOTP do Supabase) para admins e equipe O2 no Workspace/ERP.
- Duas etapas obrigatória no Google Workspace (@o2seguros.com.br), Vercel, Supabase, GitHub, Cloudflare, Bitrix.

### G. Itens menores da revisão
- Item 9: rotacionar o token do webhook do WordPress (aparece na URL/logs).
- Item 10: trocar `===` por `timingSafeEqual` nos webhooks `incendio-email`, `google-forms/capitalizacao`,
  `bitrix-email-resposta` e nos crons.
- Não revisado ainda: rotas `src/app/bitrix-app/*`, server actions dos formulários públicos, histórico do Git
  (segredo já commitado?), backups do Supabase (plano tem backup diário/PITR?).
- CSP completa (depois de mapear Sentry, Google Maps e scripts do Next).
