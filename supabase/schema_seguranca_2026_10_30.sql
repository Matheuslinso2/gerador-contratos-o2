-- Revisão de segurança 30/10/2026 — itens críticos 1, 2 e 3
-- (docs/REVISAO-SEGURANCA-WORKSPACE-2026-10-30.md)
--
-- Conferido antes de escrever (catálogo + código):
--   * As crons, scripts e robôs chamam estas funções com service_role (createServiceClient),
--     que continua com EXECUTE explícito — nada muda para eles.
--   * Funções chamadas por OUTRAS funções SECURITY DEFINER rodam como o dono (postgres),
--     então também não dependem do EXECUTE de anon/authenticated.
--   * Única função da lista chamada por tela com sessão logada: erp_contar_alertas_fatura
--     (src/app/erp/page.tsx e src/app/erp/conferencia/page.tsx) → mantém authenticated.
--   * As 5 views: as telas (erp/emissao, erp/conferencia, erp/parcelas/cobranca, erp/page)
--     consultam com sessão logada. Todas as tabelas de baixo têm RLS + policy de
--     colaborador O2 e SELECT para authenticated, então com security_invoker a equipe
--     continua vendo tudo e visitante/imobiliária deixa de ver.
--   * NÃO mexe em is_admin_o2 / is_colaborador_o2 / is_equipe_o2 / chat_participa /
--     imobiliarias_do_usuario: são usadas em ~240 policies que valem para PUBLIC
--     (inclusive anon) em tabelas lidas pelos formulários públicos (produtos,
--     seguradoras, tipos_garantia, imobiliarias...). Sem EXECUTE, o visitante passaria
--     a receber "permission denied for function" e os formulários quebrariam.
--     Elas só respondem sobre quem chama (anon → false/vazio), então o risco é nulo.

begin;

-- ---------------------------------------------------------------------------
-- 1a) Gravam dados e não checam quem chama → só service_role (crons/scripts)
-- ---------------------------------------------------------------------------
revoke execute on function
  public.erp_aplicar_comissoes_corp(),
  public.erp_aplicar_comissoes_corp(integer),
  public.erp_atualizar_alertas_fatura(),
  public.erp_atualizar_baixa_corp_mensal(),
  public.erp_atualizar_conferencia_corp(),
  public.erp_atualizar_fora_faturas(),
  public.erp_atualizar_retrato(),
  public.erp_conferir_comissoes_corp(integer),
  public.erp_corp_casar_documentos(integer),
  public.erp_corp_casar_parcelas(integer),
  public.erp_corp_criar_parcelas(integer),
  public.erp_corp_gravar_baixas(integer),
  public.erp_corp_quitar_parcelas(),
  public.erp_cruzar_extratos(),
  public.erp_cruzar_faturas_carregadas(),
  public.erp_inferir_administrado(),
  public.erp_inferir_pro_labore_direto(),
  public.erp_inferir_regras_repasse(),
  public.erp_ligar_renovacoes_legado(date, date),
  public.erp_ligar_renovacoes_legado_sem_cliente(),
  public.erp_recalcular_comissoes(date, date),
  public.erp_reconferir_comissoes_corp(),
  public.reivindicar_lote_campanha_envios(uuid, integer)
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1b) Funções de gatilho: o gatilho dispara independente de EXECUTE do usuário,
--     então ninguém precisa chamá-las direto.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.erp_auditar(),
  public.sinistros_kpi_fato_cards_gatilho(),
  public.sinistros_marca_novidade_imob()
from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1c) Têm checagem interna (is_colaborador_o2) e nenhuma tela as chama hoje:
--     tira o visitante, mantém authenticated (a checagem continua valendo).
-- ---------------------------------------------------------------------------
revoke execute on function
  public.erp_baixa_erp_processar(uuid),
  public.erp_identificar_linhas(uuid),
  public.erp_importar_corp(date, date, boolean),
  public.erp_parcela_correcao_aplicar(),
  public.erp_parcela_correcao_desfazer(),
  public.erp_parcela_correcao_gerar(),
  public.erp_previsao_ajustar(uuid)
from public, anon;

-- ---------------------------------------------------------------------------
-- 1d) Chamada pela tela /erp com sessão: tira o visitante, mantém authenticated.
-- ---------------------------------------------------------------------------
revoke execute on function public.erp_contar_alertas_fatura() from public, anon;

-- ---------------------------------------------------------------------------
-- 2) Views passam a respeitar o RLS de quem consulta; visitante sem SELECT.
-- ---------------------------------------------------------------------------
alter view public.erp_alertas_fatura             set (security_invoker = true);
alter view public.erp_emissao_fila               set (security_invoker = true);
alter view public.erp_fora_das_ultimas_faturas   set (security_invoker = true);
alter view public.erp_parcelas_cobranca          set (security_invoker = true);
alter view public.erp_repasse_direto_verificacao set (security_invoker = true);

revoke all on
  public.erp_alertas_fatura,
  public.erp_emissao_fila,
  public.erp_fora_das_ultimas_faturas,
  public.erp_parcelas_cobranca,
  public.erp_repasse_direto_verificacao
from anon;

-- ---------------------------------------------------------------------------
-- 3) Backups de 28/10: RLS ligado sem policy = só service_role/postgres leem.
--    (Mantidos por enquanto; apagar depois de confirmar que não precisa mais.)
-- ---------------------------------------------------------------------------
alter table public.erp_premio_backup_2810      enable row level security;
alter table public.erp_premio_backup_2810_prod enable row level security;
alter table public.erp_iof_backup_2810         enable row level security;

revoke all on
  public.erp_premio_backup_2810,
  public.erp_premio_backup_2810_prod,
  public.erp_iof_backup_2810
from anon, authenticated;

commit;
