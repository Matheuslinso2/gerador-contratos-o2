# Worker de recebimento — E-mail no Card (Fase 2)

Recebe as respostas dos clientes em `*@notificacoes.o2seguros.com.br` e repassa pro webhook da Plataforma O2, que registra a atividade no card certo do Bitrix.

## Passo a passo (Matheus)

Esses passos precisam ser feitos por você porque envolvem login/segredo — eu não posso digitar isso.

### 1. Instalar dependências

```bash
cd cloudflare-worker-email
npm install
```

### 2. Login no Cloudflare (abre o navegador, você faz login normal — sem digitar token em lugar nenhum)

```bash
npx wrangler login
```

### 3. Definir o segredo compartilhado

Gere um valor aleatório rodando isto no terminal (guarde o resultado, não vai aparecer de novo):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Depois rode:

```bash
npm run secret
```

(vai pedir pra colar o valor gerado acima)

**Importante:** esse valor não pode ir pro README nem pro código — é um segredo real, usado só nos dois lugares abaixo (Cloudflare e Vercel).

### 4. Publicar o Worker

```bash
npm run deploy
```

Isso vai mostrar uma URL tipo `o2-bitrix-email-resposta.<sua-conta>.workers.dev` — não precisa usar essa URL em lugar nenhum, é só confirmação de que publicou.

### 5. Adicionar a mesma variável na Vercel

No painel da Vercel (projeto `gerador-contratos-o2` → Settings → Environment Variables), adicionar:

- **Nome:** `BITRIX_EMAIL_RESPOSTA_SECRET`
- **Valor:** o mesmo valor gerado no passo 3
- **Ambiente:** Production (e Preview se quiser testar antes)

Depois disso, redeployar o projeto na Vercel pra pegar a variável nova (ou espera o próximo commit que eu fizer).

### 6. Configurar a regra de e-mail no Cloudflare

No dashboard do Cloudflare, no domínio `o2seguros.com.br` → **Email → Email Routing**:

- Criar uma regra: endereço de destino `*@notificacoes.o2seguros.com.br` (coringa) → **Ação: Send to a Worker** → selecionar `o2-bitrix-email-resposta`.

Se quiser, eu guio essa parte com você pelo navegador (é só clicar, não tem segredo pra digitar).

## Teste

Depois de tudo publicado: responda um dos e-mails de teste que já mandamos pelo card (ex: "Teste SPA Fianca"), e confira se uma atividade nova aparece no histórico do card em alguns segundos. Eu posso confirmar isso pelos logs da Vercel e do Supabase assim que você avisar que respondeu.
