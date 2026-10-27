# Publicar Vox CRM na Vercel com Supabase

No repositório [WillGDx/Vox-CRM](https://github.com/WillGDx/Vox-CRM), use **a raiz do repositório (`.`)** como Root Directory da Vercel, onde ficam `package.json` e `vercel.json`. A aplicação inclui o frontend Vite e uma única função Node.js em `api/index.mjs`. Se estiver usando a cópia de desenvolvimento dentro do REA, o diretório equivalente é `examples/vox-crm`; o REA e suas dependências não fazem parte da publicação.

## Supabase

1. Crie ou escolha um projeto Supabase.
2. Aplique, em ordem, [`20261026000000_crm_workspaces.sql`](supabase/migrations/20261026000000_crm_workspaces.sql), [`20261026010000_crm_roles.sql`](supabase/migrations/20261026010000_crm_roles.sql), [`20261026020000_crm_collaboration.sql`](supabase/migrations/20261026020000_crm_collaboration.sql) e [`20261026030000_crm_personalization.sql`](supabase/migrations/20261026030000_crm_personalization.sql). Elas criam o armazenamento, os perfis, a colaboração com Realtime e o bucket privado de fotos. O guia [`SUPABASE.md`](SUPABASE.md) detalha a ativação.
3. Em **Authentication**, habilite o acesso por e-mail e senha. Cadastre os usuários pelo fluxo da aplicação ou pelo painel do Supabase, conforme a política de cadastro escolhida.
4. Configure o endereço público final do CRM em **Authentication → URL Configuration → Site URL** e nas URLs de redirecionamento permitidas. Isso é necessário para os links de confirmação de e-mail.

Para os módulos operacionais, aplique também, em ordem, `20261026040000_crm_suite.sql`, `20261026050000_crm_collaboration_extra.sql` e `20261026060000_crm_webchat.sql` do mesmo diretório de migrações, antes de publicar. Elas adicionam os fluxos de vendas/projetos/RH/processos, grupos/enquetes/arquivos privados e sessões do chat público. Veja [SUITE.md](SUITE.md).

No projeto da **Vercel**, adicione estas variáveis em **Settings → Environment Variables**, no ambiente Production e também em Preview se for utilizá-lo:

| Nome | Origem |
| --- | --- |
| `SUPABASE_URL` | URL HTTPS do projeto, disponível nas configurações de API do Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Chave publicável do projeto; projetos legados podem usar a chave `anon` |

A chave `service_role` não é necessária. O backend valida a sessão e usa o token do próprio usuário; as regras RLS do Supabase aplicam as permissões por módulo, operação e responsável. Os dados da organização ficam no Supabase, sem depender do disco temporário das funções da Vercel.

Nunca coloque credenciais em `vercel.json`, no Git ou em argumentos de comandos registrados em logs. A URL e a chave publicável são fornecidas ao cliente por `/api/config`; segredos de administração não devem ser configurados nessa rota.

## Conectar o GitHub à Vercel

No painel da Vercel, importe `WillGDx/Vox-CRM` como um novo projeto ou, para usar o projeto já existente, conecte esse repositório em **Settings → Git**. Configure as variáveis do Supabase antes do deploy e use as opções da tabela abaixo. A conexão permite que novos commits na branch de produção gerem publicações automaticamente. Enviar o código ao GitHub por si só não configura essa conexão.

## Login pela CLI (alternativa)

Com Node.js 24 e npm disponíveis, entre na pasta do aplicativo e execute:

```bash
cd Vox-CRM
npx --yes vercel@65.2.0 login
```

A CLI usa OAuth Device Flow. Abra a URL oficial mostrada por ela e conclua o acesso na sua conta Vercel. Não envie tokens ou senhas no chat. A autorização fica na configuração local da CLI, fora dos arquivos da aplicação. A pasta `.vercel/`, criada ao vincular o projeto, é ignorada pelo Git.

## Validar e publicar

```bash
npm ci
npm test
npm run test:permissions
npm run test:collaboration
npm run test:personalization
npm run test:suite
npm run test:collaboration-extra
npm run test:webchat
npm run build
npx --yes vercel@65.2.0 deploy --dry
```

O modo `--dry` inspeciona a configuração e os arquivos que seriam enviados; não faz upload nem cria publicação. A lista não deve conter `.env`, bancos locais, `node_modules`, testes ou o servidor SQLite de desenvolvimento.

Para criar um projeto e publicar em produção com a CLI 65.2.0:

```bash
npx --yes vercel@65.2.0 deploy --prod --yes --project vox-crm --create-if-missing
```

Se usar uma equipe específica, acrescente `--scope` com o identificador da equipe. Para um projeto existente, informe seu nome ou ID em `--project`. Configure as variáveis do Supabase antes de considerar a publicação pronta; depois de adicioná-las ou alterá-las, publique novamente.

Pelo painel da Vercel, as opções equivalentes são:

| Configuração | Valor |
| --- | --- |
| Root Directory | `.` (raiz de `WillGDx/Vox-CRM`) |
| Framework Preset | Vite |
| Node.js Version | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

O `vercel.json` encaminha `/api/*` para a função e mantém o caminho da API em `route`. As demais rotas da interface usam o fallback SPA; arquivos estáticos existentes continuam sendo servidos pelo CDN.

## Copilot com OpenAI (opcional)

Configure `VOX_AI_API_KEY` como variável sensível apenas no runtime da Vercel. O backend também aceita `KeyChatGPT`, nome usado na publicação existente; se ambos existirem, `VOX_AI_API_KEY` tem prioridade. Os modelos opcionais são `VOX_AI_MODEL` (padrão `gpt-4.1-mini`) e `VOX_AI_TRANSCRIPTION_MODEL` (padrão `gpt-4o-mini-transcribe`). Publique novamente depois de alterar variáveis.

A conta da API OpenAI precisa de faturamento e cota disponíveis; a assinatura do ChatGPT não inclui o consumo da API. Uma resposta `insufficient_quota` aparece no CRM como HTTP 402. Alterar créditos ou limites no provedor não exige outro deploy. Veja [SUITE.md](SUITE.md) para limites, privacidade e estado da validação real. Nunca use prefixo `VITE_` em uma chave de IA.

## Conferir a publicação

Use exclusivamente o endereço HTTPS real retornado pela Vercel. Confirme:

- A tela de acesso carrega, incluindo CSS e JavaScript.
- `/api/config` informa que o Supabase está configurado, sem expor credenciais de administração.
- Uma chamada a `/api/state` sem sessão é recusada.
- Depois de entrar, é possível cadastrar e editar registros, recarregar a página e encontrar os dados preservados.
- Uma conta sem liberação não recebe os dados da organização.
- Usuário comum acessa apenas os registros permitidos pelo perfil; Gestor não administra usuários e perfis.
- Administrador consegue adicionar um usuário já cadastrado, definir o perfil e suspender seu acesso. O último administrador ativo não pode ser removido.
- Dois colaboradores conseguem conversar no chat, receber atualizações sem recarregar e manter a conversa privada para os demais.
- Publicações, comentários e reações do feed persistem; pinagem e moderação respeitam o perfil.
- Perfil, foto, tema escuro e papel de parede persistem na conta; outra conta mantém suas próprias preferências. Apenas administradores alteram o nome da organização.

Uma publicação só fica validada quando os fluxos autenticados também funcionam com o projeto Supabase real. Um build bem-sucedido ou uma resposta da página inicial não demonstra persistência nem isolamento entre usuários.

## Token administrativo do Supabase

O token administrativo usado para instalar e configurar a aplicação é independente dos perfis de acesso ao CRM. Ele deve ficar exclusivamente no campo seguro `SUPABASE_ACCESS_TOKEN` do ambiente de trabalho; não é enviado ao frontend nem exigido dos usuários.

Na tela de tokens com escopo do Supabase, os nomes apresentados são **Application services → Auth Config → Read-write** e **Project → Project Settings → Read-write**, além das permissões de Database necessárias à migração. Os códigos `auth_config_read` e `auth_config_write` são nomes de API. Para mudar o escopo, gere um token novo para o projeto e substitua o valor seguro. Nunca envie o token no chat ou o inclua no código.

## Desenvolvimento local

O fluxo local com SQLite continua disponível com `npm start` ou `npm run dev`. Ele não deve ser confundido com a publicação na Vercel. Não copie o arquivo `data/vox-crm.sqlite` para a Vercel e não configure `/tmp` como banco de produção.

Cada tarefa de nuvem já é isolada. Reutilize o checkout existente; não crie worktrees para instalar, testar ou publicar este exemplo.

## Referências oficiais

- [Vite na Vercel](https://vercel.com/docs/frameworks/frontend/vite)
- [Funções Node.js](https://vercel.com/docs/functions/runtimes/node-js)
- [Versões de Node.js](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Rewrites](https://vercel.com/docs/routing/rewrites)
- [Login da CLI](https://vercel.com/docs/cli/login)
- [Deploy pela CLI](https://vercel.com/docs/cli/deploy)
- [Ambientes e deploy no Supabase](https://supabase.com/docs/guides/deployment/managing-environments)
- [URLs de redirecionamento do Supabase Auth](https://supabase.com/docs/guides/auth/redirect-urls)
