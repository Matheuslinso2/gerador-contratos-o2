-- Base Única × Power BI (21/10/2026). Decisão do Matheus: "O POWER BI SEMPRE
-- VALE" — o cadastro de produtores do Power BI (lista "Cadastro de Produtores"
-- do SharePoint analyticspwb, espelhada em corp_regra_produtor pela sessão
-- Integração Power BI) substitui vínculo/grupo confirmado no Workspace quando
-- discordar. Nada é apagado sem rastro: toda mudança vai para
-- imobiliaria_historico. Aplicação: scripts/base-unica/aplicar-power-bi.mjs.

create table if not exists imobiliaria_historico (
  id uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid references imobiliarias(id) on delete set null,
  grupo_id uuid references imobiliaria_grupos(id) on delete set null,
  registro_id uuid references imobiliaria_registros_fonte(id) on delete set null,
  campo text not null,          -- grupo_id, papel_no_grupo, vinculo, ficha_criada, grupo_criado, origem_comercial…
  antes jsonb,
  depois jsonb,
  motivo text not null,
  origem text not null default 'power_bi',
  criado_em timestamptz not null default now()
);
create index if not exists imobiliaria_historico_imob_idx on imobiliaria_historico (imobiliaria_id);
alter table imobiliaria_historico enable row level security;
drop policy if exists "imobiliaria_historico colaborador o2" on imobiliaria_historico;
create policy "imobiliaria_historico colaborador o2" on imobiliaria_historico for all to authenticated
  using ((select public.is_colaborador_o2())) with check ((select public.is_colaborador_o2()));

-- Dados do Power BI na ficha (pedido do Matheus: origem e tipo de pessoa).
alter table imobiliarias add column if not exists origem_comercial text;   -- PROSPECÇÃO ATIVA, BASE SOFTWARE, SUPERLÓGICA, INDICAÇÃO…
alter table imobiliarias add column if not exists tipo_pessoa text;        -- JURÍDICA / FÍSICA
alter table imobiliarias add column if not exists centralizador_power_bi text;

-- Produtores que o Power BI centraliza em "O2 SEGUROS": produção própria da O2
-- (canal Venda direta O2), mesmo que o nome não comece com "O2 CORRETORA".
create table if not exists base_unica_produtores_venda_direta (
  produtor text primary key,
  origem text not null default 'power_bi',
  atualizado_em timestamptz not null default now()
);
alter table base_unica_produtores_venda_direta enable row level security;
drop policy if exists "base_unica_produtores_venda_direta colaborador o2" on base_unica_produtores_venda_direta;
create policy "base_unica_produtores_venda_direta colaborador o2" on base_unica_produtores_venda_direta for all to authenticated
  using ((select public.is_colaborador_o2())) with check ((select public.is_colaborador_o2()));

-- producao_resolvida: Venda direta O2 passa a incluir os produtores que o Power
-- BI centraliza em O2 SEGUROS (MARTINELLI (BASE), NAGIB LIMA (O2)…).
create or replace view producao_resolvida with (security_invoker = true) as
 SELECT p.id, p.produto, p.tipo, p.fonte, p.importacao_id, p.origem_arquivo_id, p.origem_aba, p.origem_linha, p.origem_bitrix_id,
    p.competencia_arquivo, p.herdada, p.chave_caso, p.data_recebimento, p.data_efetivacao, p.status_original, p.status_padrao,
    p.ramo_original, p.ramo_padrao, p.seguradora, p.plano, p.imobiliaria_texto, p.fonte_vinculo, p.responsavel, p.aluguel,
    p.premio, p.comissao, p.locatario_id, p.extras, p.created_at, p.origem_corp_numero,
    CASE WHEN canal.venda_direta THEN NULL::uuid ELSE v.imobiliaria_id END AS imobiliaria_id,
    CASE WHEN canal.venda_direta THEN NULL::uuid ELSE i.grupo_id END AS grupo_id,
    CASE WHEN canal.venda_direta THEN 'Venda direta O2'::text ELSE COALESCE(g.nome, i.apelido, i.nome) END AS imobiliaria_exibicao,
    CASE WHEN canal.venda_direta THEN 'venda_direta_o2'::text ELSE 'imobiliaria'::text END AS canal,
    CASE WHEN p.fonte = 'corp'::text THEN CASE WHEN p.ramo_original ~ '^2 '::text THEN 'segunda_susep'::text ELSE 'primeira_susep'::text END ELSE NULL::text END AS susep_o2
   FROM producao_unificada p
     CROSS JOIN LATERAL ( SELECT COALESCE(p.imobiliaria_texto ~* '^O2 CORRETORA'::text, false)
        OR (p.fonte = 'corp' AND EXISTS (SELECT 1 FROM base_unica_produtores_venda_direta d WHERE d.produtor = p.imobiliaria_texto)) AS venda_direta) canal
     LEFT JOIN LATERAL ( SELECT r.imobiliaria_id
           FROM imobiliaria_registros_fonte r
          WHERE r.fonte = p.fonte_vinculo AND r.situacao = 'confirmado'::text AND (r.chave_externa = p.imobiliaria_texto OR r.nome_original = p.imobiliaria_texto)
          ORDER BY (r.chave_externa = p.imobiliaria_texto) DESC
         LIMIT 1) v ON true
     LEFT JOIN imobiliarias i ON i.id = v.imobiliaria_id
     LEFT JOIN imobiliaria_grupos g ON g.id = i.grupo_id;

-- Aplicado em 21/10/2026: 183 fichas criadas (2 desfeitas: SUPERLOGICA = canal,
-- "1 - REPASSE PADRÃO" = modelo do Corp), 13 ligadas por nome igual, 12 grupos
-- novos (ADJUVE, RENASCENÇA, CANALE, MONTE ALEGRE…), Giullia no Grupo Teruszkin,
-- Ribas-HP/Pintas fora do grupo, MARTINELLI (BASE) como Venda direta O2.
-- Pendente de decisão: Max Brokers (o PBI separa as duas fichas do grupo).

-- 21/10/2026: reaplicação automática (aprovada pelo Matheus) no fim do cron
-- /api/cron/corp-sharepoint, via src/lib/baseUnica/aplicarPowerBi.ts. Pares
-- distintos produtor × código da grade, sem ler as 136 mil linhas. Função SQL
-- comum (não "atomic") para não criar dependência sobre corp_grade.
create or replace function base_unica_produtor_codigos()
returns table (produtor text, codigo_produtor text)
language sql stable set search_path = public as $$
  select distinct produtor, codigo_produtor::text from corp_grade
  where produtor is not null and codigo_produtor is not null
$$;
revoke all on function base_unica_produtor_codigos() from anon, public, authenticated;
grant execute on function base_unica_produtor_codigos() to service_role;
