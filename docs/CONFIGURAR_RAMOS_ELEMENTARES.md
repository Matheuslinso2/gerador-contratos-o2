# Configuração do painel de Ramos Elementares

O código da página está em `/ramos-elementares`. A planilha operacional é acessada somente para leitura.

## 1. Banco de dados

Executar no SQL Editor do Supabase:

`supabase/schema_ramos_elementares.sql`

Isso cria o último retrato mensal usado como histórico e contingência.

## 2. Conta técnica do Google

Criar ou reutilizar uma conta de serviço no Google Cloud com acesso às APIs:

- Google Drive API;
- Google Sheets API.

Compartilhar com o e-mail da conta de serviço somente a pasta onde ficam as planilhas mensais, com permissão de leitor.

## 3. Variáveis no Vercel

Adicionar em Production:

- `RAMOS_ELEMENTARES_GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `RAMOS_ELEMENTARES_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `RAMOS_ELEMENTARES_DRIVE_FOLDER_ID`

A chave privada pode ser colada com `\n`; o projeto converte essas sequências em quebras de linha.

Durante a configuração inicial, é possível usar temporariamente:

- `RAMOS_ELEMENTARES_SPREADSHEET_ID`

Esse ID fixo é apenas um fallback. A pasta é necessária para a troca automática de competência.

## 4. Regra de localização mensal

O sistema procura dentro da pasta uma planilha cujo nome contenha:

- o mês e o ano da competência;
- `COTAÇÃO DIÁRIA RE`;
- e não comece com `Cópia de`.

Se encontrar mais de uma candidata, não escolhe silenciosamente e apresenta um alerta ao usuário.

## 5. Atualização

- leitura ao abrir a página;
- nova leitura automática a cada 2 minutos enquanto a página estiver aberta;
- botão `Atualizar agora` para leitura imediata;
- último retrato válido salvo no Supabase para contingência.

## 6. Segurança

- a credencial Google é usada apenas no servidor;
- nenhuma chave é enviada ao navegador;
- os escopos são `drive.readonly` e `spreadsheets.readonly`;
- o painel não escreve nem corrige a planilha;
- acesso da página restrito a contas `@o2seguros.com.br`.
