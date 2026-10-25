-- ERP O2 — Fase 1b: cadeia canal de gestão → imobiliária → cliente (25/10/2026)
-- Matheus: ERPs de gestão imobiliária (Superlógica, Base Software) e parceiros (Segimob) têm
-- muitas imobiliárias na carteira e intermediam a oferta de seguro; há uma cadeia de indicações
-- e remunerações via repasse. O cliente/segurado é a entidade única; a imobiliária indica; o
-- canal está acima dela. Essa cadeia deve ficar gravada em cada documento, de todos os ramos.
-- O canal NÃO é imobiliária (não entra na base única); é um cadastro próprio do ERP.

create table if not exists erp_canais (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  tipo text not null default 'erp_gestao' check (tipo in ('erp_gestao','parceiro','retransmissao','outro')),
  codigo_corp text,                 -- "Canal Vendas" / agente do Corp
  origem_comercial text,            -- valor correspondente em imobiliarias.origem_comercial (lista do SharePoint)
  canal_venda text,                 -- valor correspondente em erp_documentos.canal_venda (grade do Corp)
  ativo boolean not null default true,
  observacao text,
  created_at timestamptz not null default now()
);
alter table erp_canais enable row level security;
drop policy if exists erp_canais_o2 on erp_canais;
create policy erp_canais_o2 on erp_canais for all to authenticated using ((select is_colaborador_o2())) with check ((select is_colaborador_o2()));

insert into erp_canais (nome, tipo, origem_comercial, canal_venda, observacao) values
  ('Superlógica', 'erp_gestao', 'SUPERLÓGICA', 'superlogica', 'ERP de gestão imobiliária; parceria de oferta de seguro na carteira'),
  ('Base Software', 'erp_gestao', 'BASE SOFTWARE', 'base_software', 'ERP de gestão imobiliária; parceria de oferta de seguro na carteira'),
  ('Segimob', 'parceiro', null, 'segimob', 'Parceiro Tokio; comissão chega via Segimob (extratos por imobiliária)')
on conflict (nome) do nothing;

-- a ficha da imobiliária ganha o canal (enriquecimento da base única, derivado da origem comercial do SharePoint)
alter table imobiliarias add column if not exists canal_id uuid references erp_canais(id);
update imobiliarias i set canal_id = c.id from erp_canais c where i.canal_id is null and c.origem_comercial is not null and i.origem_comercial = c.origem_comercial;

-- o documento guarda a cadeia: canal_id (acima) · imobiliaria_principal_id (indica) · locatario_id (cliente)
alter table erp_documentos add column if not exists canal_id uuid references erp_canais(id);
alter table erp_documento_produtores add column if not exists canal_id uuid references erp_canais(id);

-- preenche a cadeia: 1º pelo canal de venda explícito do Corp/card; 2º pelo canal da imobiliária indicadora
create or replace function erp_definir_canal() returns trigger language plpgsql set search_path = public as $$
begin
  if new.canal_id is null then
    if new.canal_venda is not null then
      select c.id into new.canal_id from erp_canais c where c.canal_venda = new.canal_venda limit 1;
    end if;
    if new.canal_id is null and new.imobiliaria_principal_id is not null then
      select i.canal_id into new.canal_id from imobiliarias i where i.id = new.imobiliaria_principal_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists erp_documentos_canal on erp_documentos;
create trigger erp_documentos_canal before insert or update of canal_venda, imobiliaria_principal_id on erp_documentos
  for each row execute function erp_definir_canal();

-- legado: aplica a mesma regra em tudo que já está carregado (auditoria desligada)
alter table erp_documentos disable trigger erp_documentos_aud;
update erp_documentos d set canal_id = c.id from erp_canais c where d.canal_id is null and d.canal_venda is not null and c.canal_venda = d.canal_venda;
update erp_documentos d set canal_id = i.canal_id from imobiliarias i where d.canal_id is null and d.imobiliaria_principal_id = i.id and i.canal_id is not null;
alter table erp_documentos enable trigger erp_documentos_aud;

-- o canal como produtor do documento (elo de repasse acima da imobiliária); % entra com a regra na Fase 3
insert into erp_documento_produtores (documento_id, canal_id, agente, principal, pct_participacao, repasse_pct, repasse_valor_previsto)
select d.id, d.canal_id, 'canal', false, 0, 0, 0
from erp_documentos d
where d.canal_id is not null
  and not exists (select 1 from erp_documento_produtores p where p.documento_id = d.id and p.agente = 'canal');
