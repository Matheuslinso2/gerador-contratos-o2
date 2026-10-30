# Revisão de segurança do Workspace O2 — 30/10/2026

Contexto: revisão feita pelo Claude (chat) a pedido do Matheus. **Nada foi alterado** no código nem no banco. Este arquivo existe para continuar o trabalho no Claude Code.

Escopo revisado: `src/proxy.ts`, `next.config.ts`, `vercel.json`, `.gitignore`, as 40 rotas em `src/app/api/**`, `lib/admin.ts`, `lib/supabase/service.ts`, `lib/campanhas/unsubscribeToken.ts`, `lib/bitrix/appAuth.ts`, e os alertas de segurança do Supabase (projeto `gerador-contratos-o2`) mais consultas só de catálogo (permissões), sem ler dados.

**Não revisado:** rotas de `src/app/bitrix-app/*`, server actions dos formulários públicos, configuração da Vercel/Cloudflare/WordPress, configuração de Auth do Supabase, histórico do Git (se algum segredo já foi commitado).

## Críticas (banco de dados)

1. **22 funções SECURITY DEFINER que gravam dados são executáveis pelo papel `anon`** (qualquer pessoa com a chave pública do site, via `/rest/v1/rpc/<nome>`) e **não checam quem chama** (sem `is_admin_o2`, `auth.uid` etc.):
   `erp_aplicar_comissoes_corp`, `erp_atualizar_alertas_fatura`, `erp_atualizar_baixa_corp_mensal`, `erp_atualizar_conferencia_corp`, `erp_atualizar_fora_faturas`, `erp_atualizar_retrato`, `erp_conferir_comissoes_corp`, `erp_corp_casar_documentos`, `erp_corp_casar_parcelas`, `erp_corp_criar_parcelas`, `erp_corp_gravar_baixas`, `erp_corp_quitar_parcelas`, `erp_cruzar_extratos`, `erp_cruzar_faturas_carregadas`, `erp_inferir_administrado`, `erp_inferir_pro_labore_direto`, `erp_inferir_regras_repasse`, `erp_ligar_renovacoes_legado`, `erp_ligar_renovacoes_legado_sem_cliente`, `erp_recalcular_comissoes`, `erp_reconferir_comissoes_corp`, `reivindicar_lote_campanha_envios`.
   Também sem checagem e sem escrita aparente: `erp_contar_alertas_fatura`, `sinistros_kpi_fato_cards_gatilho` (esta é função de gatilho, não deveria ser exposta).
   Têm checagem interna (risco menor, mas ainda expostas a `anon` sem necessidade): `erp_auditar`, `erp_baixa_erp_processar`, `erp_identificar_linhas`, `erp_importar_corp`, `erp_parcela_correcao_aplicar/desfazer/gerar`, `erp_previsao_ajustar`, `sinistros_marca_novidade_imob`, `chat_participa`, `imobiliarias_do_usuario`, `is_admin_o2`, `is_colaborador_o2`, `is_equipe_o2`.
2. **Views SECURITY DEFINER** com `SELECT` para `anon`: `erp_fora_das_ultimas_faturas`, `erp_emissao_fila`, `erp_alertas_fatura`, `erp_parcelas_cobranca`, `erp_repasse_direto_verificacao`. Rodam com a permissão do dono e ignoram as regras das tabelas de baixo.
3. **Tabelas sem RLS no schema public** com `SELECT`/`INSERT` para `anon`: `erp_premio_backup_2810`, `erp_premio_backup_2810_prod`, `erp_iof_backup_2810`.

Confirmado com `has_function_privilege`/`has_table_privilege`; o conteúdo das tabelas e views não foi lido.

### Proposta de correção (NÃO aplicada — revisar antes)

```sql
-- 1) Funções: tirar anon/PUBLIC e deixar só quem precisa
revoke execute on function public.<nome>(<args>) from anon, public;
-- repetir para cada função acima; manter authenticated só onde a tela chama via RPC com sessão.
-- O service_role (crons) continua funcionando.

-- 2) Views: respeitar as regras de quem consulta
alter view public.erp_alertas_fatura set (security_invoker = true);
-- idem para as outras 4; depois revogar select de anon:
revoke select on public.erp_alertas_fatura from anon;

-- 3) Backups: ligar RLS (sem policy = ninguém lê) ou apagar se não forem mais necessários
alter table public.erp_premio_backup_2810 enable row level security;
-- idem erp_premio_backup_2810_prod, erp_iof_backup_2810
```

Antes de revogar, conferir no código quais RPCs as telas chamam com sessão logada (grep por `.rpc(`) para não quebrar nada.

## Médias

4. **Cadastro aberto + permissão por sufixo de e-mail.** `lib/admin.ts` dá acesso de equipe/colaborador por `@o2seguros.com.br` e `@nichoos.com`, e admin por lista de e-mails. Só é seguro com **"Confirm email" ligado** no Supabase Auth (verificar no painel; não foi possível ver daqui). Considerar também desligar `/signup` público se o cadastro for só por convite.
5. **`/api/erro-cliente` é público e sem limite**: cada POST dispara e-mail ao admin (`alertarAdmin`) com texto controlado por quem chama. Risco de spam na caixa do admin. Sugestão: limite por IP, tamanho máximo, e exigir sessão ou token.
6. **Sem cabeçalhos de segurança** em `next.config.ts` (CSP, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`). Atenção: o `/bitrix-app` é aberto dentro de iframe do Bitrix, então o `frame-ancestors` precisa permitir o domínio do Bitrix.
7. **Sem limite de tentativas (rate limit) no código** para login e formulários públicos. Avaliar regras no Cloudflare/Vercel Firewall.
8. **Proteção contra senhas vazadas desligada** no Supabase Auth (alerta `auth_leaked_password_protection`).
9. **Token do webhook do WordPress na URL** (`/api/integracoes/wordpress-leads?secret=...`): URLs aparecem em logs. Limitação do plugin (sem header customizado); mitigar rotacionando o token e limitando por IP/rate limit.
10. **Comparação de segredos com `===`** nos webhooks `incendio-email`, `google-forms/capitalizacao`, `bitrix-email-resposta` e nos crons. Risco baixo; trocar por `timingSafeEqual` por boa prática.

## Vírus / arquivos enviados

Não encontrei varredura antivírus nos uploads. Só há restrição de tipo (extensão/MIME) em `lib/tipoArquivoUpload.ts` e nos buckets. Os formulários públicos (`/ficha-fianca`, `/seguro-incendio`, `/seguro-auto` etc.) aceitam anexos. Sugestão: varredura (ClamAV em função própria, ou serviço externo) antes de o arquivo ser tratado como confiável, limite de tamanho por arquivo, e nunca servir anexos de visitantes com `Content-Type` inferido do cliente.

## O que já está bom

- Login validado no servidor com `supabase.auth.getUser()` no `proxy.ts`; rotas privadas redirecionam para `/login`.
- Webhooks do WhatsApp (X-Hub-Signature-256) e do Resend (Svix) usam assinatura HMAC com `timingSafeEqual`.
- Descadastro de campanhas usa token HMAC stateless com `timingSafeEqual`.
- Todos os 21 crons exigem `Authorization: Bearer CRON_SECRET` (e recusam se o segredo não estiver configurado).
- Callback do Instagram valida `state` via cookie (anti-CSRF).
- Rotas de contrato (`/api/contratos/[id]/*`) exigem sessão e checam o dono do contrato.
- `.env*` está no `.gitignore`; Sentry configurado; `service_role` isolado em `createServiceClient` e só usado no servidor.
- Tabelas com RLS ligado e sem policy (ex.: `bitrix_app_auth`, `instagram_auth`, `wordpress_leads_tokens`) negam acesso de `anon`/`authenticated` — comportamento correto para tabelas só do servidor.

## Prompt sugerido para o Claude Code

> Leia `docs/REVISAO-SEGURANCA-WORKSPACE-2026-10-30.md`. Comece pelos itens críticos 1–3: liste no código quais RPCs são chamadas com sessão de usuário (`.rpc(`), proponha uma migração SQL em `supabase/` para revogar `EXECUTE` de `anon`/`public` nas funções listadas (mantendo `authenticated` só onde a tela precisa), trocar as 5 views para `security_invoker` e ligar RLS nas 3 tabelas de backup. Mostre a migração para eu aprovar antes de aplicar. Depois trate os itens 4–6.
