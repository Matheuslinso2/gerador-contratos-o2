-- Enriquece imobiliarias_conhecidas com o export do CRM (Bitrix24) de
-- 30/07/2026 — só as linhas que têm CNPJ (36 de 1884), pra poder cruzar
-- com segurança sem duplicar. Atualiza nome/cidade/UF/bairro de quem já
-- existe e adiciona quem for novo.

insert into imobiliarias_conhecidas (nome, cnpj, cidade, uf, bairro) values
('A Fonte Imobiliária Ltda', '03432650000102', 'RIO DE JANEIRO', 'RJ', null),
('AB Lima Imóveis', '29620173000194', 'Rio de Janeiro', 'RJ', 'Cidade Nova'),
('Alexandre grieco assessoria imobiliaria', '23992271000176', null, null, null),
('Art Nova Assessoria Imobiliária Ltda', '28283976000138', 'Rio de Janeiro', 'RJ', 'Copacabana'),
('Atlas Gestão Imobiliária', '23364560000120', 'Rio de Janeiro', 'RJ', 'Ipanema'),
('Bom Fim Imóveis', '13937505000129', 'Porto Alegre', 'RS', 'Centro Histórico'),
('C l serviços imobiliários ltda', '13970949000166', null, null, null),
('CLAP IMÓVEIS', '29033830000105', 'Rio de Janeiro', 'RJ', 'Barra da Tijuca'),
('coluna consultoria imobiliária', '29198769000148', null, null, null),
('Correta friburg empreendimentos imobiliarios ltda', '73586109000126', null, null, null),
('D S de Marins Imobiliária - ME', '27151932000191', 'Angra dos Reis', 'RJ', 'Centro'),
('Estada Imóveis', '27671005000100', 'Rio de Janeiro', 'RJ', 'Copacabana'),
('Expan Imóveis', '10945215000139', 'Rio de Janeiro', 'RJ', 'Barra da Tijuca'),
('Geraldo paes imoveis ltda', '40473059000111', null, null, null),
('Great Empire Administradora de Bens Ltda', '14034587000164', 'Rio de Janeiro', 'RJ', 'Casdadura'),
('IMBT CONSULTORIA E ADMINISTRACAO IMOBILIARIA', '26840879000173', 'Rio de Janeiro', 'RJ', 'Centro'),
('Imobiliária Dória', '27618766000190', 'Curitiba', 'PR', 'Juveve'),
('Imóvel Certo no Rio Administradora de Imóveis Ltda', '26525374000114', 'Rio de Janeiro', 'RJ', 'Leme'),
('L3', '14788026000150', 'Rio de Janeiro', 'RJ', 'Recreio dos Bandeirantes'),
('liberty niteroi administradora de bens ltda', '14792464000192', null, null, null),
('Líder Imóveis Negócios Imobiliários Ltda - ME', '25195665000129', 'Cabo Frio', 'RJ', 'Centro'),
('Lobo Lobão Imóveis', '21001008000142', 'Taubaté', 'SP', 'Centro'),
('Marco Grillo Consultoria Imobiliária', '17857495000172', 'Rio de Janeiro', 'RJ', 'Taquara'),
('MARGARIDA MEIRELES IMOBILIÁRIA', '21053844000170', 'Rio de Janeiro', 'RJ', 'Flamengo'),
('MERITHUN IMOBILIÁRIA', '07816502000134', 'Rio de Janeiro', 'RJ', 'Recreio dos Bandeirantes'),
('Mix Consultoria Imobiliária', '33461806000136', 'Rio de Janeiro', 'RJ', 'Jacarepaguá'),
('Monte Alegre Imóveis', '02902950000137', 'São Paulo', 'RJ', 'Broklin'),
('MVI Administração de Imóveis Ltda - ME', '26168490000100', 'Rio de Janeiro', 'RJ', 'Sepetiba'),
('Nota 10X Administração Imobiliária', '13581336000137', 'Rio de Janeiro', 'RJ', 'Del Castilho'),
('OLV REALTY Consultoria Imobiliária e Engenharia', '24106984000158', 'Rio de Janeiro', 'RJ', 'Centro'),
('Proced Imóveis', '29703857000150', 'Cabo Frio', 'RJ', 'Centro'),
('Prohome Administração e Consultoria de Imóveis Ltda.', '12461469000107', 'Rio de Janeiro', 'RJ', null),
('Quartier e Intermediações imobiliárias e corretagem de seguros', '29217308000175', 'Rio de janeiro', 'RJ', 'Recreio dos Bandeirantes'),
('Savale Imóveis Ltda', '02435305000151', 'Santo Antonio da Patrulha', 'RS', 'Pitangueiras'),
('WD França Imóveis', '30726120000131', 'Rio de Janeiro', 'RJ', 'Centro'),
('Wilc Consultoria Imobiliária Eirelli - EPP', '22013191000169', 'Rio de Janeiro', 'RJ', 'Barra da Tijuca')
on conflict (cnpj) do update set
  nome = excluded.nome,
  cidade = coalesce(excluded.cidade, imobiliarias_conhecidas.cidade),
  uf = coalesce(excluded.uf, imobiliarias_conhecidas.uf),
  bairro = coalesce(excluded.bairro, imobiliarias_conhecidas.bairro);
