-- ERP O2 — Fase 1b / etapa T1: Código O2 (nosso número do Workspace) e código do produtor
-- Decisões do Matheus (25/10/2026, plano erp-o2/TRANSICAO-NOSSO-NUMERO-E-CODIGO-PRODUTOR.pdf):
--   1. Recriar os códigos do zero, inclusive para o que o Corp já numerou, para padronizar.
--      Acompanhar "nosso número Corp" × "Código O2" até dezembro/2026; seguros com vigência a
--      partir de JANEIRO/2027 nascem no ERP. Até lá é aprendizagem e adequação.
--   2. Casamento com o Bitrix fica interno (nada exposto no card nem ao cliente por enquanto).
--      O nosso número do Workspace se chama "Código O2".
--   3. Produtor NÃO é obrigatório em todo produto: só em modo FATURA (a imobiliária é
--      certificada por análise do CNPJ, ou CPF + CRECI, para produzir em fatura; essa informação
--      vem pré-definida no card do Bitrix). Tipos de contratação: indicação de imobiliária,
--      venda direta O2 (cliente procura a corretora), frota (PJ com vários itens), canal.
--   4. Não exibir nada novo para fora ainda.

-- ============================================================ 1. erp_documentos
-- situações antes da apólice + tipo de contratação + modo de cobrança
alter table erp_documentos drop constraint if exists erp_documentos_situacao_check;
alter table erp_documentos add constraint erp_documentos_situacao_check check (situacao in
  ('cotacao','proposta','digitado','emitido','vigente','vencido','cancelado','devolvido'));

alter table erp_documentos
  add column if not exists tipo_contratacao text check (tipo_contratacao in ('indicacao_imobiliaria','venda_direta','frota','canal')),
  add column if not exists modo_cobranca text not null default 'individual' check (modo_cobranca in ('individual','fatura'));
comment on column erp_documentos.tipo_contratacao is 'indicacao_imobiliaria = imob indicou o cliente; venda_direta = cliente procurou a O2; frota = PJ com vários itens; canal = Superlógica/Base/Segimob';
comment on column erp_documentos.modo_cobranca is 'fatura = cobrado na fatura mensal da imobiliária (produtor obrigatório); individual = boleto/cartão do próprio cliente';

-- legado do Corp: inferir o que dá
update erp_documentos set modo_cobranca = 'fatura' where tipo = 'F' and modo_cobranca = 'individual';
update erp_documentos set tipo_contratacao = case
    when canal_venda = 'venda_direta' then 'venda_direta'
    when canal_venda in ('superlogica','base_software') then 'canal'
    when imobiliaria_principal_id is not null then 'indicacao_imobiliaria'
    else null end
  where tipo_contratacao is null;

-- fatura exige produtor — vale para o que nasce no ERP; o legado do Corp tem faturas de
-- venda direta sem imob ligada e continua podendo ser atualizado
alter table erp_documentos drop constraint if exists erp_documentos_fatura_exige_produtor;
alter table erp_documentos add constraint erp_documentos_fatura_exige_produtor
  check (modo_cobranca <> 'fatura' or imobiliaria_principal_id is not null or origem = 'corp_import');

-- ============================================================ 2. Código O2: renumerar tudo
-- Hoje nosso_numero = nosso_numero_corp (13.045 → 133.632). Passa a ser a sequência própria,
-- a partir de 200.000 (faixa que não se confunde com a do Corp), na ordem do número do Corp
-- para preservar a cronologia. nosso_numero_corp continua guardado e pesquisável.
do $$
begin
  alter table erp_documentos disable trigger erp_documentos_aud;
  with ord as (
    select id, 199999 + row_number() over (order by nosso_numero_corp nulls last, created_at, id) as novo
    from erp_documentos
  )
  update erp_documentos d set nosso_numero = ord.novo from ord where ord.id = d.id and d.nosso_numero <> ord.novo;
  perform setval('erp_nosso_numero_seq', (select max(nosso_numero) from erp_documentos));
  alter table erp_documentos enable trigger erp_documentos_aud;
end $$;

-- ============================================================ 3. Código O2 do produtor (ficha da base única)
create sequence if not exists imobiliarias_codigo_o2_seq start 1;
alter table imobiliarias
  add column if not exists codigo_o2 int unique,
  add column if not exists fatura_habilitada boolean not null default false,
  add column if not exists fatura_habilitada_em date,
  add column if not exists fatura_observacao text;
comment on column imobiliarias.codigo_o2 is 'Código O2 do produtor: numeração própria do Workspace (substitui o código do Corp, que fica em codigo_produtor_corp / registros_fonte)';
comment on column imobiliarias.fatura_habilitada is 'Imobiliária certificada (análise de CNPJ ou CPF+CRECI) para contratar em modo fatura';

-- numera as fichas existentes na ordem de criação (fichas mais antigas = códigos menores)
with ord as (select id, row_number() over (order by created_at, nome) as n from imobiliarias where codigo_o2 is null)
update imobiliarias i set codigo_o2 = ord.n from ord where ord.id = i.id;
select setval('imobiliarias_codigo_o2_seq', greatest((select max(codigo_o2) from imobiliarias), 1));
alter table imobiliarias alter column codigo_o2 set default nextval('imobiliarias_codigo_o2_seq');

-- ============================================================ 4. Resolver produtor por qualquer código
-- Código O2, código do Corp (principal ou secundário via registros_fonte), CNPJ/CPF ou nome exato.
create or replace function erp_resolver_produtor(p text)
returns uuid language sql stable set search_path = public as $$
  with t as (select trim(p) as v, regexp_replace(p, '\D', '', 'g') as digitos)
  select id from (
    select i.id, 1 as prio from imobiliarias i, t where t.v ~ '^\d+$' and i.codigo_o2 = t.v::int
    union all
    select i.id, 2 from imobiliarias i, t where t.v ~ '^\d+$' and i.codigo_produtor_corp::text = t.v
    union all
    select f.imobiliaria_id, 3 from imobiliaria_registros_fonte f, t where f.fonte = 'corp_produtor' and f.chave_externa = t.v and f.imobiliaria_id is not null
    union all
    select i.id, 4 from imobiliarias i, t where length(t.digitos) in (11, 14) and regexp_replace(coalesce(i.cnpj, ''), '\D', '', 'g') = t.digitos
    union all
    select i.id, 5 from imobiliarias i, t where lower(i.nome) = lower(t.v) or lower(coalesce(i.apelido, '')) = lower(t.v)
  ) x order by prio limit 1
$$;
grant execute on function erp_resolver_produtor(text) to authenticated;

-- ============================================================ 5. Parâmetros da transição
insert into erp_parametros (chave, valor, descricao) values
  ('erp_vigencia_inicio', '"2027-01-01"', 'Seguros com início de vigência a partir desta data nascem no ERP (Código O2 exposto); antes disso, convivência Corp × ERP'),
  ('codigo_o2_exposto', 'false', 'Enquanto false, o Código O2 fica interno (não vai para o card do Bitrix, e-mails ou PDFs)')
on conflict (chave) do nothing;
