-- Módulo Sinistro (Seguro Fiança) -- Fase 1: abertura pela imobiliária +
-- fila/pré-análise da O2. Plano completo em
-- entregaveis/modulo-sinistro/Modulo Sinistro - Planejamento.pdf.
-- Aplicado direto no projeto via MCP -- este arquivo é o registro.
--
-- Acesso: a imobiliária (titular ou membro, via imobiliarias_do_usuario())
-- vê só os próprios sinistros e só edita enquanto está com ela
-- (rascunho/pendência). Colaborador O2 tem ALL desde o início (lição de
-- permissao_colaborador_o2_imobiliarias).

create table if not exists sinistros (
  id uuid primary key default gen_random_uuid(),
  codigo bigint generated always as identity unique,
  imobiliaria_id uuid not null references imobiliarias(id),
  criado_por uuid default auth.uid(),
  criado_por_email text default (auth.jwt() ->> 'email'),
  origem text not null default 'workspace' check (origem in ('workspace', 'email')),

  tipo text not null check (tipo in ('ocupado', 'chaves_sem_danos', 'chaves_com_danos')),
  etapa text not null default 'rascunho' check (etapa in (
    'rascunho', 'pre_analise', 'pendencia_imobiliaria', 'na_seguradora',
    'em_indenizacao', 'acordo_judicial', 'encerrado', 'cancelado'
  )),
  desfecho text check (desfecho in ('indenizado', 'sem_indenizacao')),
  motivo_encerramento text,
  encerrado_em date,

  -- Contrato / apólice (digitado pela imobiliária na Fase 1)
  seguradora text not null,
  numero_apolice text,
  vigencia_inicio date,
  vigencia_fim date,
  locador_nome text not null,
  locador_documento text,
  locatario_nome text not null,
  locatario_documento text,
  locatario_telefone text,
  locatario_email text,
  imovel_cep text,
  imovel_logradouro text,
  imovel_numero text,
  imovel_complemento text,
  imovel_bairro text,
  imovel_cidade text,
  imovel_uf text,

  -- Situação / prazos
  data_primeiro_vencimento date,
  data_segundo_vencimento date,
  data_entrega_chaves date,
  locatario_assinou_documentos boolean,
  pintura_vistoria_nova boolean,
  pintura_vistoria_assinada boolean,
  coberturas text[] not null default '{}',
  prazo_aviso date,
  aviso_fora_prazo boolean not null default false,
  justificativa_fora_prazo text,
  observacoes text,

  -- Favorecido da indenização
  favorecido_eh_segurado boolean,
  favorecido_nome text,
  favorecido_documento text,
  favorecido_banco text,
  favorecido_agencia text,
  favorecido_conta text,

  -- Termo de ciência (R11)
  ciencia_texto text,
  ciencia_aceita_em timestamptz,
  ciencia_aceita_por text,

  -- Envio / O2
  enviado_em timestamptz,
  valor_avisado numeric(14,2),
  responsavel_o2 text,
  pre_analise_desde timestamptz,
  pendencia_desde timestamptz,
  pendencia_prazo date,
  numero_sinistro_seguradora text,
  data_abertura_seguradora date,
  documentacao_completa_em date,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sinistros_imob_idx on sinistros(imobiliaria_id, etapa);
create index if not exists sinistros_etapa_idx on sinistros(etapa);

create table if not exists sinistro_debitos (
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid not null references sinistros(id) on delete cascade,
  discriminacao text not null,
  vencimento date,
  competencia text,
  valor numeric(14,2) not null default 0,
  multa numeric(14,2) not null default 0,
  acrescimos numeric(14,2) not null default 0,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists sinistro_debitos_sin_idx on sinistro_debitos(sinistro_id);

create table if not exists sinistro_documentos (
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid not null references sinistros(id) on delete cascade,
  tipo text not null,
  arquivo_path text not null,
  nome_arquivo text not null,
  tamanho bigint,
  enviado_por_email text default (auth.jwt() ->> 'email'),
  enviado_em timestamptz not null default now(),
  situacao text not null default 'enviado' check (situacao in ('enviado', 'aprovado', 'recusado', 'substituido')),
  motivo_recusa text,
  analisado_por text,
  analisado_em timestamptz
);
create index if not exists sinistro_documentos_sin_idx on sinistro_documentos(sinistro_id);

create table if not exists sinistro_historico (
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid not null references sinistros(id) on delete cascade,
  criado_em timestamptz not null default now(),
  autor_email text default (auth.jwt() ->> 'email'),
  autor_tipo text not null check (autor_tipo in ('imobiliaria', 'o2', 'sistema')),
  referente text check (referente in ('imobiliaria', 'seguradora', 'locatario', 'escritorio', 'interno')),
  texto text not null,
  visivel_imobiliaria boolean not null default true,
  etapa_de text,
  etapa_para text
);
create index if not exists sinistro_historico_sin_idx on sinistro_historico(sinistro_id, criado_em);

-- Helpers (security definer, mesmo padrão de imobiliarias_do_usuario()).
create or replace function sinistro_da_imobiliaria_do_usuario(sid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from sinistros s
    where s.id = sid and s.imobiliaria_id in (select imobiliarias_do_usuario())
  );
$$;

create or replace function sinistro_editavel_pela_imobiliaria(sid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from sinistros s
    where s.id = sid
      and s.imobiliaria_id in (select imobiliarias_do_usuario())
      and s.etapa in ('rascunho', 'pendencia_imobiliaria')
  );
$$;

-- Storage: pasta = id do sinistro. Texto não-uuid simplesmente não casa.
create or replace function sinistro_pasta_acessivel(pasta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case
    when pasta ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then sinistro_da_imobiliaria_do_usuario(pasta::uuid)
    else false
  end;
$$;

create or replace function sinistros_touch_updated_at()
returns trigger language plpgsql set search_path to 'public' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists sinistros_updated_at on sinistros;
create trigger sinistros_updated_at before update on sinistros
  for each row execute function sinistros_touch_updated_at();

alter table sinistros enable row level security;
alter table sinistro_debitos enable row level security;
alter table sinistro_documentos enable row level security;
alter table sinistro_historico enable row level security;

-- sinistros
drop policy if exists "sinistros o2" on sinistros;
create policy "sinistros o2" on sinistros for all to authenticated
  using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistros imob select" on sinistros;
create policy "sinistros imob select" on sinistros for select to authenticated
  using (imobiliaria_id in (select imobiliarias_do_usuario()));
drop policy if exists "sinistros imob insert" on sinistros;
create policy "sinistros imob insert" on sinistros for insert to authenticated
  with check (imobiliaria_id in (select imobiliarias_do_usuario()) and etapa = 'rascunho');
drop policy if exists "sinistros imob update" on sinistros;
create policy "sinistros imob update" on sinistros for update to authenticated
  using (imobiliaria_id in (select imobiliarias_do_usuario()) and etapa in ('rascunho', 'pendencia_imobiliaria'))
  with check (imobiliaria_id in (select imobiliarias_do_usuario()) and etapa in ('rascunho', 'pendencia_imobiliaria', 'pre_analise', 'cancelado'));

-- sinistro_debitos
drop policy if exists "sinistro_debitos o2" on sinistro_debitos;
create policy "sinistro_debitos o2" on sinistro_debitos for all to authenticated
  using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistro_debitos imob select" on sinistro_debitos;
create policy "sinistro_debitos imob select" on sinistro_debitos for select to authenticated
  using (sinistro_da_imobiliaria_do_usuario(sinistro_id));
drop policy if exists "sinistro_debitos imob escrita" on sinistro_debitos;
create policy "sinistro_debitos imob escrita" on sinistro_debitos for all to authenticated
  using (sinistro_editavel_pela_imobiliaria(sinistro_id))
  with check (sinistro_editavel_pela_imobiliaria(sinistro_id));

-- sinistro_documentos
drop policy if exists "sinistro_documentos o2" on sinistro_documentos;
create policy "sinistro_documentos o2" on sinistro_documentos for all to authenticated
  using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistro_documentos imob select" on sinistro_documentos;
create policy "sinistro_documentos imob select" on sinistro_documentos for select to authenticated
  using (sinistro_da_imobiliaria_do_usuario(sinistro_id));
drop policy if exists "sinistro_documentos imob insert" on sinistro_documentos;
create policy "sinistro_documentos imob insert" on sinistro_documentos for insert to authenticated
  with check (sinistro_editavel_pela_imobiliaria(sinistro_id) and situacao = 'enviado');
-- Reenvio: a imobiliária só pode marcar o próprio arquivo como substituído.
drop policy if exists "sinistro_documentos imob substituir" on sinistro_documentos;
create policy "sinistro_documentos imob substituir" on sinistro_documentos for update to authenticated
  using (sinistro_editavel_pela_imobiliaria(sinistro_id) and situacao in ('enviado', 'recusado'))
  with check (sinistro_editavel_pela_imobiliaria(sinistro_id) and situacao = 'substituido');

-- sinistro_historico
drop policy if exists "sinistro_historico o2" on sinistro_historico;
create policy "sinistro_historico o2" on sinistro_historico for all to authenticated
  using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistro_historico imob select" on sinistro_historico;
create policy "sinistro_historico imob select" on sinistro_historico for select to authenticated
  using (visivel_imobiliaria and sinistro_da_imobiliaria_do_usuario(sinistro_id));
drop policy if exists "sinistro_historico imob insert" on sinistro_historico;
create policy "sinistro_historico imob insert" on sinistro_historico for insert to authenticated
  with check (sinistro_da_imobiliaria_do_usuario(sinistro_id) and autor_tipo = 'imobiliaria' and visivel_imobiliaria);

-- Bucket privado dos documentos (até 50 MB por arquivo).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sinistros', 'sinistros', false, 52428800,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'
  ]
)
on conflict (id) do nothing;

drop policy if exists "sinistros storage select" on storage.objects;
create policy "sinistros storage select" on storage.objects for select to authenticated
  using (bucket_id = 'sinistros' and (is_colaborador_o2() or sinistro_pasta_acessivel((storage.foldername(name))[1])));
drop policy if exists "sinistros storage insert" on storage.objects;
create policy "sinistros storage insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'sinistros' and (is_colaborador_o2() or sinistro_pasta_acessivel((storage.foldername(name))[1])));

-- Helpers só fazem sentido pra quem está logado.
revoke execute on function sinistro_da_imobiliaria_do_usuario(uuid) from anon, public;
revoke execute on function sinistro_editavel_pela_imobiliaria(uuid) from anon, public;
revoke execute on function sinistro_pasta_acessivel(text) from anon, public;
grant execute on function sinistro_da_imobiliaria_do_usuario(uuid) to authenticated;
grant execute on function sinistro_editavel_pela_imobiliaria(uuid) to authenticated;
grant execute on function sinistro_pasta_acessivel(text) to authenticated;

-- 19/10/2026 (pedido do Matheus, fase de testes): abertura sem campo
-- obrigatório — salva só o que foi preenchido. Imobiliária também pode ficar
-- vazia (sinistro aberto pela O2 sem imobiliária ainda definida; só a O2 vê).
alter table sinistros alter column tipo drop not null;
alter table sinistros alter column seguradora drop not null;
alter table sinistros alter column locador_nome drop not null;
alter table sinistros alter column locatario_nome drop not null;
alter table sinistros alter column imobiliaria_id drop not null;

-- Agenda de próxima ação da equipe O2 (equivalente ao "Próx. Agendamento" do Corp).
alter table sinistros add column if not exists proxima_acao_em date;
alter table sinistros add column if not exists proxima_acao_descricao text;
alter table sinistros add column if not exists proxima_acao_responsavel text;
create index if not exists sinistros_proxima_acao_idx on sinistros(proxima_acao_em) where proxima_acao_em is not null;

-- 21/10/2026: o Workspace passa a ser onde a O2 gere os sinistros (sai o Corp).
-- Os abertos do Corp com aviso nos últimos 2 anos e 1 dia viraram cards
-- (origem = 'corp', sinistro_corp_id); os mais antigos foram zerados
-- (sinistros_corp.baixado_em) -- ver schema_sinistros_corp.sql. Migração única,
-- aplicada via MCP; o importador do Corp não mexe nos cards.
alter table sinistros add column if not exists produto text not null default 'fianca';
alter table sinistros add column if not exists sinistro_corp_id uuid unique references sinistros_corp(id) on delete set null;
alter table sinistros drop constraint if exists sinistros_origem_check;
alter table sinistros add constraint sinistros_origem_check check (origem in ('workspace', 'email', 'corp'));
create index if not exists sinistros_etapa_idx on sinistros(etapa);

-- 21/10/2026: operação do sinistro no Workspace (ciclo completo, equipe,
-- multiproduto, busca de apólice). Aplicado via MCP.

-- Equipe que responde pelos sinistros (responsavel_o2 guarda a "chave").
create table if not exists sinistros_equipe (
  chave text primary key,                 -- e-mail @o2seguros quando existe; senão um apelido
  nome text not null,
  email text unique,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sinistros_equipe enable row level security;
drop policy if exists "sinistros_equipe o2" on sinistros_equipe;
create policy "sinistros_equipe o2" on sinistros_equipe for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());
-- Carga inicial (responsáveis que vieram do Corp + Matheus); nomes do Corp
-- convertidos: NATALIA, VINICIUS MAIA, PATRICIA DA SILVA (com login),
-- BRENDA OLIVEIRA e BEATRIZ SILVA MARTINS (sem login @o2seguros em 21/10).

-- Indenizações pagas pela seguradora (várias por sinistro, normalmente 1 por mês).
create table if not exists sinistro_indenizacoes (
  id uuid primary key default gen_random_uuid(),
  sinistro_id uuid not null references sinistros(id) on delete cascade,
  referencia date,                         -- mês a que se refere (1º dia)
  pago_em date,
  valor numeric(14,2) not null default 0,
  observacao text,
  criado_por_email text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
create index if not exists sinistro_indenizacoes_sinistro_idx on sinistro_indenizacoes(sinistro_id);
alter table sinistro_indenizacoes enable row level security;
drop policy if exists "sinistro_indenizacoes o2" on sinistro_indenizacoes;
create policy "sinistro_indenizacoes o2" on sinistro_indenizacoes for all to authenticated using (is_colaborador_o2()) with check (is_colaborador_o2());
drop policy if exists "sinistro_indenizacoes imob select" on sinistro_indenizacoes;
create policy "sinistro_indenizacoes imob select" on sinistro_indenizacoes for select to authenticated using (sinistro_da_imobiliaria_do_usuario(sinistro_id));

alter table sinistros add column if not exists nosso_numero text;   -- apólice no Corp (vínculo com a produção)
alter table sinistros add column if not exists data_ocorrencia date; -- produtos que não são Fiança
create index if not exists sinistros_nosso_numero_idx on sinistros(nosso_numero);

-- Busca de apólice para preencher o sinistro (Nosso Nº, CPF/CNPJ ou nome do
-- locatário). Equipe O2 vê tudo; a imobiliária só as apólices dela (vínculo
-- confirmado do produtor do Corp). Lê só por índice (Nosso Nº / locatário).
create or replace function buscar_apolices_sinistro(p_q text)
returns table (
  nosso_numero text, produto text, ramo text, seguradora text, vigencia_inicio date, vigencia_fim date,
  imobiliaria_texto text, imobiliaria_id uuid, locatario_nome text, locatario_documento text,
  locatario_email text, locatario_telefone text, data_efetivacao date, status text
)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  termo text := trim(coalesce(p_q, ''));
  dig text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
  o2 boolean := is_colaborador_o2();
begin
  if length(termo) < 3 then return; end if;
  return query
  with alvo_loc as (
    select l.id from locatarios l
    where (length(dig) in (11, 14) and l.cpf = dig)
       or (termo ~ '[A-Za-zÀ-ú]' and length(termo) >= 4 and l.nome ilike '%' || termo || '%')
    limit 30
  ),
  cand as (
    select p.* from producao_unificada p
    where p.fonte = 'corp' and p.produto in ('fianca', 'capitalizacao', 'automovel', 're') and p.origem_corp_numero = termo
    union all
    select p.* from producao_unificada p join alvo_loc a on a.id = p.locatario_id where p.fonte = 'corp'
  ),
  vinc as (
    select distinct on (trim(v.nome_original)) trim(v.nome_original) nome, v.imobiliaria_id
    from imobiliaria_registros_fonte v
    where v.fonte = 'corp_produtor' and v.situacao = 'confirmado' and v.imobiliaria_id is not null
      and trim(v.nome_original) in (select distinct trim(c.imobiliaria_texto) from cand c)
    order by trim(v.nome_original), v.confirmado_em desc nulls last
  )
  select c.origem_corp_numero, produto_sinistro_de_ramo(c.produto, c.ramo_padrao), c.ramo_padrao, c.seguradora,
    (c.extras ->> 'vigencia_inicio')::date, (c.extras ->> 'vigencia_fim')::date,
    trim(c.imobiliaria_texto), vi.imobiliaria_id, l.nome, l.cpf, l.email, l.telefone, c.data_efetivacao, c.status_padrao
  from cand c
  left join vinc vi on vi.nome = trim(c.imobiliaria_texto)
  left join locatarios l on l.id = c.locatario_id
  where o2 or vi.imobiliaria_id in (select imobiliarias_do_usuario())
  order by c.data_efetivacao desc nulls last
  limit 15;
end;
$$;
revoke execute on function buscar_apolices_sinistro(text) from anon, public;
grant execute on function buscar_apolices_sinistro(text) to authenticated;
