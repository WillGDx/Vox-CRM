# Vox CRM

Vox CRM é uma aplicação em português para organizar vendas, tarefas e a comunicação da equipe. Reúne funil comercial, chat, feed corporativo, projetos, calendário, ponto e aprovações em uma interface com aparência personalizável.

**Aplicação publicada:** [vox-crm-psi.vercel.app](https://vox-crm-psi.vercel.app)

**Repositório:** [WillGDx/Vox-CRM](https://github.com/WillGDx/Vox-CRM)

O projeto tem implementação e identidade próprias, inspiradas nos fluxos do Bitrix24. Não é uma distribuição oficial do Bitrix24 e ainda não oferece todos os recursos desse produto. Esta publicação é uma aplicação independente: não exige instalar ou compilar o REA, repositório em que seu desenvolvimento começou.

## Funcionalidades

| Área | O que você pode fazer |
| --- | --- |
| Painel | Consultar indicadores calculados com os registros do CRM e acompanhar atividades recentes. |
| CRM e vendas | Cadastrar empresas, contatos e negócios; relacionar os registros; usar o funil em Kanban ou lista; buscar, filtrar por responsável e exportar CSV conforme a permissão. |
| Leads | Organizar leads e convertê-los em contato e negócio em uma operação atômica. |
| Automação comercial | Criar regras de mudança de etapa para gerar tarefas com prazo ou alterar etapas, com registro do resultado das execuções. |
| Orçamentos e faturas | Criar documentos comerciais com itens, quantidades, preços e totais calculados; gerar fatura a partir de orçamento e imprimir ou salvar em PDF pelo navegador. |
| Central de atendimento | Criar canais de chat do site, receber conversas públicas, atribuir responsáveis e responder com histórico centralizado. |
| Tarefas e projetos | Definir responsáveis, prioridades, prazos e dependências; usar lista, Kanban, Gantt, backlog e sprints; reutilizar modelos e acompanhar horas com cronômetros. |
| Chat interno | Conversar com a equipe, abrir conversas individuais e grupos privados, consultar histórico e acompanhar mensagens não lidas. |
| Feed corporativo | Publicar comunicados, comentar, reagir, fixar avisos, criar enquetes e compartilhar arquivos privados da equipe. |
| Calendário | Criar eventos pessoais e de equipe, verificar conflitos, exportar ICS e compartilhar páginas públicas de agendamento. |
| Equipe e ponto | Manter diretório, departamentos e responsáveis; registrar entrada, saída e pausas; consultar relatórios e exportar CSV. |
| Processos e aprovações | Registrar compras e reembolsos, definir aprovadores e acompanhar decisões com autoria e horário registrados. |
| Perfil e aparência | Editar informações e foto do perfil; escolher tema claro, escuro ou do dispositivo, cor de destaque e fundo pessoal com foto. |
| Administração | Liberar ou suspender usuários, atribuir perfis, ajustar permissões por módulo e alterar o nome da organização. |
| Copilot | Solicitar resumos, redação, sugestões e transcrição de áudio pelo adaptador OpenAI, quando houver chave e cota disponíveis. |

O chat da equipe, as conversas individuais e o feed usam Supabase Realtime, com atualização alternativa quando necessário. Grupos, enquetes e arquivos usam atualização periódica; os guias específicos detalham cada fluxo.

### Integrações e limites atuais

- **WhatsApp, redes sociais, telefonia, envio de e-mails comerciais e pagamentos on-line:** os provedores ainda precisam ser escolhidos e integrados. Cadastrar uma chave por si só não implementa esses canais.
- **Vídeo:** o aplicativo abre uma sala externa do Jitsi, sujeita às regras desse serviço. A infraestrutura de chamadas não é hospedada pelo CRM.
- **Documentos comerciais:** orçamento e fatura não equivalem a nota fiscal; não há emissão fiscal nem confirmação de pagamento integrada.
- **Calendário e RH:** há exportação ICS e controle de ponto; não há sincronização com Google/Microsoft Calendar nem cálculo de folha de pagamento.
- **Processos:** há formulários e aprovações auditadas; ainda não há um editor gráfico geral de automação em múltiplas etapas.
- **IA:** a implantação atual possui chave configurada, mas a última tentativa real recebeu `insufficient_quota`. A geração de texto depende de regularizar a cota da API; a transcrição real ainda não foi validada.

## Tecnologias e arquitetura

| Camada | Tecnologia |
| --- | --- |
| Interface | React 19, TypeScript, Vite 7 e Lucide React |
| API | Node.js 24, módulos ES e uma Vercel Function na versão hospedada |
| Desenvolvimento local | SQLite nativo do Node.js, com persistência em arquivo |
| Produção compartilhada | Supabase Auth, PostgreSQL, RLS, Realtime e Storage privado |
| Testes | Node Test Runner e PGlite para as funções e políticas SQL |
| IA opcional | API OpenAI, acessada somente pelo servidor |

Há dois modos de execução:

| | Desenvolvimento local | Hospedagem na nuvem |
| --- | --- | --- |
| Entrada da API | `server.mjs` | `api/index.mjs` → `supabase-handler.mjs` |
| Banco | `data/vox-crm.sqlite` | PostgreSQL do Supabase |
| Contas | Um usuário de desenvolvimento, sem login | Supabase Auth e participação ativa na organização |
| Uso indicado | Desenvolver e testar os fluxos | Uso compartilhado pela equipe |

`npm start` e `npm run dev` sempre iniciam o adaptador SQLite local. Definir variáveis do Supabase não transforma esses comandos no ambiente de produção. Na Vercel, o código usa a sessão verificada do usuário e a chave publicável do Supabase, preservando a aplicação das políticas RLS; não exige `service_role` no runtime.

## Começar no computador

Use **Node.js 24.x** e npm. O projeto usa o módulo nativo `node:sqlite`; versões antigas do Node não são compatíveis.

```bash
git clone https://github.com/WillGDx/Vox-CRM.git
cd Vox-CRM
npm ci
npm run dev
```

O comando de desenvolvimento inicia a API na porta **3000** e o Vite na porta **5173**, ambos na interface local. O Vite encaminha `/api` para o servidor. As portas precisam estar livres; `Ctrl+C` encerra os dois processos.

Para executar a interface compilada, na mesma pasta:

```bash
npm run build
npm start
```

Nesse modo, a API e a interface usam a porta **3000**. A prontidão pode ser conferida em outro terminal:

```bash
curl --fail --silent http://127.0.0.1:3000/api/health
```

A resposta deve indicar `status: "ok"` e `database: "sqlite"`. O primeiro início cria o banco com registros comerciais fictícios para demonstração. Reiniciar ou reconstruir a interface preserva o arquivo; não o apague para atualizar o app.

| Variável local opcional | Padrão | Finalidade |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Endereço de escuta do servidor SQLite. |
| `PORT` | `3000` | Porta usada por `npm start`. O script de desenvolvimento fixa a API em 3000. |
| `CRM_DB_PATH` | `data/vox-crm.sqlite` | Caminho de outro banco, útil para desenvolvimento e testes isolados. |

O servidor SQLite não oferece autenticação multiusuário. Para disponibilizar o CRM à equipe, use o modo Supabase/Vercel abaixo. O arquivo local não é enviado nem importado automaticamente para o Supabase; faça backup antes de qualquer transferência de dados.

## Publicar na Vercel com Supabase

### 1. Preparar o banco

Crie ou selecione um projeto Supabase e execute as migrações de [`supabase/migrations`](supabase/migrations), nesta ordem:

| Ordem | Migração | Conteúdo |
| --- | --- | --- |
| 1 | [`20261026000000_crm_workspaces.sql`](supabase/migrations/20261026000000_crm_workspaces.sql) | Armazenamento legado, preservado para compatibilidade. |
| 2 | [`20261026010000_crm_roles.sql`](supabase/migrations/20261026010000_crm_roles.sql) | Organização, membros, perfis de acesso e registros comerciais. |
| 3 | [`20261026020000_crm_collaboration.sql`](supabase/migrations/20261026020000_crm_collaboration.sql) | Chat, feed e Realtime. |
| 4 | [`20261026030000_crm_personalization.sql`](supabase/migrations/20261026030000_crm_personalization.sql) | Perfil, aparência e imagens privadas. |
| 5 | [`20261026040000_crm_suite.sql`](supabase/migrations/20261026040000_crm_suite.sql) | Vendas, projetos, calendário, ponto, processos e automações. |
| 6 | [`20261026050000_crm_collaboration_extra.sql`](supabase/migrations/20261026050000_crm_collaboration_extra.sql) | Grupos, enquetes e arquivos compartilhados privados. |
| 7 | [`20261026060000_crm_webchat.sql`](supabase/migrations/20261026060000_crm_webchat.sql) | Sessões do chat público do site. |

Você pode usar o SQL Editor do Supabase. Confira o projeto de destino e preserve os dados existentes. As migrações foram preparadas para reexecução sem redefinir os perfis já configurados.

Em **Authentication**, habilite e-mail e senha e configure a política de confirmação de e-mail. Depois de obter o domínio definitivo, registre a origem HTTPS em **URL Configuration → Site URL** e nas URLs de redirecionamento necessárias. Preserve configurações usadas por outros aplicativos do mesmo projeto.

### 2. Configurar a Vercel

Importe este repositório no painel da Vercel com estas opções:

| Configuração | Valor |
| --- | --- |
| Root Directory | `.` — raiz deste repositório |
| Framework Preset | Vite |
| Node.js Version | 24.x |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

Cadastre as variáveis abaixo em **Settings → Environment Variables** para Production e, se necessário, Preview:

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `SUPABASE_URL` | Sim | URL HTTPS do projeto Supabase. |
| `SUPABASE_PUBLISHABLE_KEY` | Sim | Chave publicável; projetos legados também podem usar a chave pública `anon`. |
| `VOX_AI_API_KEY` | Para IA | Chave da API OpenAI, somente no servidor. |
| `VOX_AI_MODEL` | Não | Modelo de texto; padrão `gpt-4.1-mini`. |
| `VOX_AI_TRANSCRIPTION_MODEL` | Não | Modelo de áudio; padrão `gpt-4o-mini-transcribe`. |

O backend também aceita **`KeyChatGPT`**, nome usado na configuração existente. Se as duas variáveis de chave estiverem presentes, `VOX_AI_API_KEY` tem prioridade. Não é necessário copiar uma chave existente para o outro nome.

[`.env.example`](.env.example) contém nomes de variáveis, sem valores. Ele é uma referência: os scripts não carregam arquivos `.env` automaticamente. Na hospedagem, configure os valores pelo painel ou pela CLI da Vercel e publique novamente após alterá-los.

Não use prefixo `VITE_` para a chave de IA. Não configure `service_role`, `sb_secret_` ou `SUPABASE_ACCESS_TOKEN` como chave publicável; essas credenciais não são necessárias para o funcionamento do app. Nunca envie segredos ao Git ou ao chat.

O arquivo [`vercel.json`](vercel.json) encaminha `/api/*` à Function e as rotas da interface ao frontend. O SQLite e seus dados ficam fora da publicação. O procedimento completo está em [DEPLOY.md](DEPLOY.md).

### 3. Liberar o administrador e a equipe

O operador autorizado precisa reservar o e-mail do primeiro administrador na tabela `public.crm_admin_bootstrap`, associado à organização criada pela migração. Faça essa configuração pelo acesso administrativo ao banco, seguindo [SUPABASE.md](SUPABASE.md), antes do primeiro acesso dessa conta.

**Não existe senha padrão.** O administrador entra com a senha da sua conta no Supabase Auth, usando o e-mail reservado e confirmado. A reserva concede o perfil uma única vez; o primeiro cadastro público não recebe poderes administrativos automaticamente.

Os demais colaboradores criam suas contas, confirmam o e-mail quando exigido e aguardam liberação. O administrador usa **Usuários e permissões** para adicionar o e-mail já cadastrado, atribuir um perfil ou suspender o acesso. Essa ação não envia convite por e-mail.

| Perfil padrão | Acesso aos módulos comerciais | Administração de acessos |
| --- | --- | --- |
| Administrador | Completo. | Gerencia usuários e perfis. |
| Gestor | Lê, cria, edita, exclui e exporta registros da equipe. | Não. |
| Usuário | Lê, cria e edita os próprios registros. | Não; sem exclusão ou exportação por padrão. |

Os perfis Gestor e Usuário podem ser ajustados por módulo: empresas, contatos, negócios e tarefas. Leitura, edição e exclusão têm escopos **Nenhum**, **Próprios** e **Todos**; criação e exportação são permissões separadas. Os módulos operacionais aplicam ainda regras de responsável, participação, privacidade ou aprovação descritas em [SUITE.md](SUITE.md).

O último administrador ativo não pode ser removido, suspenso ou rebaixado. Alterar cargo, departamento ou outros campos do perfil pessoal não altera permissões.

### 4. Conferir a publicação

Confira o login na URL real, entre com o administrador e teste a gravação e leitura de registros após recarregar a página. Com uma conta liberada como Usuário, verifique os limites de acesso. Confira também chat, feed, perfil e imagens privadas; uma resposta de saúde sozinha não comprova a integração com o banco.

As páginas `/agendar/<UUID>` e `/atendimento/<UUID>` são públicas por finalidade específica. A primeira revela disponibilidade para agendamento; a segunda permite ao visitante acessar somente a própria sessão de atendimento. Elas não liberam acesso geral ao CRM.

## Ativar o Copilot

Depois de configurar uma chave no servidor, a conta/projeto correspondente na **API OpenAI** precisa ter faturamento e cota disponíveis. A assinatura ChatGPT Plus ou Pro tem cobrança separada e não inclui o consumo dessa API.

No Copilot, escolha uma ação e revise o conteúdo antes de enviar. A aplicação envia o texto ou áudio apenas mediante solicitação explícita e retorna um texto revisável. Ela não executa ações no CRM nem envia mensagens automaticamente em nome do usuário.

A transcrição aceita MP3, WAV, WebM, Ogg e M4A até **3 MB**. O adaptador está implementado, mas a transcrição real permanece pendente de validação. Consulte [SUITE.md](SUITE.md) para os limites e o estado da integração.

`/api/integrations/status`, acessado por um membro autorizado, informa a presença da configuração, sem revelar chaves. `configured: true` não comprova saldo, autorização do modelo ou disponibilidade do provedor. Se houver `insufficient_quota`, regularize créditos/faturamento/limites no [painel da API OpenAI](https://platform.openai.com/settings/organization/billing/overview). Uma mudança de saldo não exige novo deploy; a alteração de variáveis exige.

## Segurança e privacidade

- A API valida a sessão e o vínculo ativo com a organização. As políticas RLS e as funções PostgreSQL aplicam a autorização também no banco.
- Conversas individuais e grupos são privados para os participantes; um administrador que não participa não recebe acesso ao histórico privado.
- Imagens pessoais e arquivos compartilhados ficam em buckets privados, com permissões por conta ou organização e URLs assinadas com validade limitada.
- Suspender um membro bloqueia novas operações e autorizações. Links já assinados continuam válidos até expirar, e arquivos já baixados podem permanecer em cache.
- Revisões protegem contra sobrescrita silenciosa de alterações concorrentes. Totais, identidade, decisões e horários sensíveis são controlados no servidor.
- `node_modules`, `dist`, arquivos `.env` com valores, bancos locais e metadados da Vercel devem permanecer fora do Git. Mantenha credenciais somente nos mecanismos de configuração do ambiente.

## Estrutura do código

```text
Vox-CRM/
├── src/                         # Interface React, páginas, estilos e clientes
├── public/                      # Recursos estáticos
├── api/index.mjs                # Entrada da Vercel Function
├── server.mjs                   # API e servidor SQLite para desenvolvimento
├── dev.mjs                      # Inicia API local e Vite em conjunto
├── domain.mjs                   # Validação e operações dos registros comerciais
├── seed.mjs                     # Dados fictícios de demonstração
├── supabase-handler.mjs         # Sessão e acesso remoto ao Supabase
├── collaboration-handler.mjs    # Chat e feed
├── personalization-handler.mjs  # Perfil, aparência e imagens
├── suite-handler.mjs            # Vendas, projetos, calendário, RH e processos
├── suite-domain.mjs             # Contratos e validação dos módulos operacionais
├── collaboration-extra-handler.mjs # Grupos, enquetes e arquivos
├── webchat-handler.mjs          # Chat público do site
├── copilot-handler.mjs          # Adaptador OpenAI e estado das integrações
├── local-*.mjs                  # Persistência dos módulos no SQLite
├── supabase/migrations/         # Estrutura, funções e políticas SQL versionadas
├── tests/                       # Testes HTTP, adaptadores e políticas SQL
└── vercel.json                  # Build, Function e encaminhamento de rotas
```

## Testes e validação

Na raiz do repositório:

```bash
npm test
npm run build
npm run test:permissions
npm run test:collaboration
npm run test:personalization
npm run test:suite
npm run test:collaboration-extra
npm run test:webchat
```

`npm test` usa bancos SQLite temporários e respostas remotas simuladas para exercitar rotas, validação, relacionamentos, persistência, autorização e adaptadores. `npm run build` verifica os tipos e gera a interface. Os comandos SQL usam PGlite com Auth/Storage emulados para verificar políticas, isolamento e ações do banco.

Esses testes não substituem a validação autenticada na implantação real. Em verificações de produção, use contas, organizações e arquivos exclusivamente temporários, com limpeza conferida; evite gerar mensagens ou registros na organização real. Testes simulados de IA não comprovam geração ou transcrição com o provedor real.

## Solução de problemas

| Sintoma | O que conferir |
| --- | --- |
| Erro ao importar `node:sqlite` | Confirme `node --version` e use Node.js 24.x. |
| Porta ocupada ao iniciar | Verifique 3000 e 5173; encerre somente a instância de desenvolvimento que você iniciou. |
| Interface compilada indisponível no servidor local | Execute `npm run build` antes de `npm start`. Para editar, use `npm run dev`. |
| Configuração do Supabase ausente | Confira os nomes, o ambiente Production/Preview e os valores na Vercel; faça novo deploy após alterar variáveis. |
| Conta com acesso pendente | Confirme o e-mail e peça ao administrador para liberar a conta já cadastrada. |
| Confirmação de e-mail retorna ao endereço errado | Confira Site URL e Redirect URLs no Supabase Auth. |
| Erro de tabela ou função inexistente | Verifique se as sete migrações foram aplicadas, em ordem, no projeto correto. |
| Conflito de edição / HTTP 409 | Recarregue os dados e reaplique a alteração com a versão atual. |
| Copilot sem provedor / HTTP 503 | Configure a chave no servidor da Vercel e publique novamente. |
| IA sem cota / HTTP 402 | Regularize faturamento, créditos ou limite de gastos da conta/projeto da API OpenAI; depois repita a solicitação. |
| Limite temporário da IA / HTTP 429 | Aguarde e tente novamente; verifique os limites do provedor. |

## Guias do projeto

- [Publicação na Vercel](DEPLOY.md)
- [Supabase, autenticação, administrador e permissões](SUPABASE.md)
- [Chat e feed corporativo](COLLABORATION.md)
- [Perfil, temas e imagens pessoais](PERSONALIZATION.md)
- [Módulos operacionais, integrações e seus limites](SUITE.md)
- [Grupos, enquetes e arquivos privados](COLLABORATION_EXTRA.md)

Para manutenção, preserve o banco existente, mantenha as migrações versionadas e execute os testes adequados antes de publicar. A aplicação não contém código proprietário do Bitrix24.
