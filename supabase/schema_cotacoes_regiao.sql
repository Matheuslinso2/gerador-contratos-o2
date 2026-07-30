-- Suporte a comparativo regional por bairro (com faixa de aluguel) na
-- Prospecção. Guarda o valor do aluguel de cada cotação (pra agrupar por
-- faixa de preço) e um mapeamento bairro -> região mais ampla, usado como
-- "plano B" quando um bairro específico não tem cotações suficientes (ex:
-- Pechincha entra como Jacarepaguá; Leblon entra como Zona Sul).

alter table cotacoes_cache add column if not exists aluguel numeric;

create table if not exists bairros_regioes (
  id uuid primary key default gen_random_uuid(),
  bairro text not null,
  cidade text not null,
  regiao text not null,
  unique (bairro, cidade)
);

alter table bairros_regioes enable row level security;

drop policy if exists "bairros_regioes acesso o2" on bairros_regioes;
create policy "bairros_regioes acesso o2"
on bairros_regioes for all
to authenticated
using (auth.jwt() ->> 'email' like '%@o2seguros.com.br')
with check (auth.jwt() ->> 'email' like '%@o2seguros.com.br');

-- Mapeamento inicial (Rio de Janeiro, maior parte da base) — lista não é
-- exaustiva, dá pra completar depois direto na tabela conforme necessário.
insert into bairros_regioes (bairro, cidade, regiao) values
  ('Copacabana', 'Rio de Janeiro', 'Zona Sul'),
  ('Ipanema', 'Rio de Janeiro', 'Zona Sul'),
  ('Leblon', 'Rio de Janeiro', 'Zona Sul'),
  ('Botafogo', 'Rio de Janeiro', 'Zona Sul'),
  ('Flamengo', 'Rio de Janeiro', 'Zona Sul'),
  ('Laranjeiras', 'Rio de Janeiro', 'Zona Sul'),
  ('Catete', 'Rio de Janeiro', 'Zona Sul'),
  ('Glória', 'Rio de Janeiro', 'Zona Sul'),
  ('Gávea', 'Rio de Janeiro', 'Zona Sul'),
  ('Leme', 'Rio de Janeiro', 'Zona Sul'),
  ('Urca', 'Rio de Janeiro', 'Zona Sul'),
  ('Humaitá', 'Rio de Janeiro', 'Zona Sul'),
  ('Jardim Botânico', 'Rio de Janeiro', 'Zona Sul'),
  ('Lagoa', 'Rio de Janeiro', 'Zona Sul'),
  ('Cosme Velho', 'Rio de Janeiro', 'Zona Sul'),
  ('São Conrado', 'Rio de Janeiro', 'Zona Sul'),
  ('Centro', 'Rio de Janeiro', 'Centro'),
  ('Lapa', 'Rio de Janeiro', 'Centro'),
  ('Santa Teresa', 'Rio de Janeiro', 'Centro'),
  ('Cidade Nova', 'Rio de Janeiro', 'Centro'),
  ('Saúde', 'Rio de Janeiro', 'Centro'),
  ('Gamboa', 'Rio de Janeiro', 'Centro'),
  ('São Cristóvão', 'Rio de Janeiro', 'Centro'),
  ('Tijuca', 'Rio de Janeiro', 'Zona Norte'),
  ('Vila Isabel', 'Rio de Janeiro', 'Zona Norte'),
  ('Grajaú', 'Rio de Janeiro', 'Zona Norte'),
  ('Méier', 'Rio de Janeiro', 'Zona Norte'),
  ('Maracanã', 'Rio de Janeiro', 'Zona Norte'),
  ('Andaraí', 'Rio de Janeiro', 'Zona Norte'),
  ('Rio Comprido', 'Rio de Janeiro', 'Zona Norte'),
  ('Bonsucesso', 'Rio de Janeiro', 'Zona Norte'),
  ('Ramos', 'Rio de Janeiro', 'Zona Norte'),
  ('Penha', 'Rio de Janeiro', 'Zona Norte'),
  ('Ilha do Governador', 'Rio de Janeiro', 'Zona Norte'),
  ('Madureira', 'Rio de Janeiro', 'Zona Norte'),
  ('Cascadura', 'Rio de Janeiro', 'Zona Norte'),
  ('Piedade', 'Rio de Janeiro', 'Zona Norte'),
  ('Todos os Santos', 'Rio de Janeiro', 'Zona Norte'),
  ('Engenho de Dentro', 'Rio de Janeiro', 'Zona Norte'),
  ('Engenho Novo', 'Rio de Janeiro', 'Zona Norte'),
  ('Barra da Tijuca', 'Rio de Janeiro', 'Barra da Tijuca'),
  ('Recreio dos Bandeirantes', 'Rio de Janeiro', 'Barra da Tijuca'),
  ('Jacarepaguá', 'Rio de Janeiro', 'Jacarepaguá'),
  ('Freguesia', 'Rio de Janeiro', 'Jacarepaguá'),
  ('Pechincha', 'Rio de Janeiro', 'Jacarepaguá'),
  ('Taquara', 'Rio de Janeiro', 'Jacarepaguá'),
  ('Tanque', 'Rio de Janeiro', 'Jacarepaguá'),
  ('Anil', 'Rio de Janeiro', 'Jacarepaguá'),
  ('Curicica', 'Rio de Janeiro', 'Jacarepaguá'),
  ('Camorim', 'Rio de Janeiro', 'Jacarepaguá'),
  ('Vargem Grande', 'Rio de Janeiro', 'Jacarepaguá'),
  ('Vargem Pequena', 'Rio de Janeiro', 'Jacarepaguá'),
  ('Campo Grande', 'Rio de Janeiro', 'Zona Oeste'),
  ('Santa Cruz', 'Rio de Janeiro', 'Zona Oeste'),
  ('Bangu', 'Rio de Janeiro', 'Zona Oeste'),
  ('Realengo', 'Rio de Janeiro', 'Zona Oeste'),
  ('Guaratiba', 'Rio de Janeiro', 'Zona Oeste'),
  ('Sepetiba', 'Rio de Janeiro', 'Zona Oeste')
on conflict (bairro, cidade) do nothing;
