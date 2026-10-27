# Banco de dados e login no Supabase

A versão hospedada na Vercel usa Supabase Auth e PostgreSQL. Os usuários autorizados trabalham na mesma organização, com permissões por módulo, ação e responsável. Uma conta autenticada ainda precisa de um perfil de acesso para receber os dados do CRM.

O servidor local continua usando o arquivo SQLite existente. A publicação na Vercel não envia esse arquivo nem importa seus registros automaticamente.

## Preparar o projeto

1. Crie ou selecione um projeto no painel do Supabase.
2. Aplique, em ordem, [20261026000000_crm_workspaces.sql](supabase/migrations/20261026000000_crm_workspaces.sql), [20261026010000_crm_roles.sql](supabase/migrations/20261026010000_crm_roles.sql), [20261026020000_crm_collaboration.sql](supabase/migrations/20261026020000_crm_collaboration.sql) e [20261026030000_crm_personalization.sql](supabase/migrations/20261026030000_crm_personalization.sql). Elas criam o armazenamento legado preservado, os perfis da organização, o chat/feed e o bucket privado de fotos. Reexecutar as migrações preserva dados e perfis configurados.
3. Em **Authentication → Sign In / Providers**, habilite o provedor de e-mail e senha. Mantenha a confirmação de e-mail habilitada, se essa for a política desejada para a conta.
4. Copie a URL do projeto e sua **publishable key** nas configurações do projeto. Projetos antigos podem usar a chave pública legada `anon`.
5. No projeto da Vercel, configure as variáveis abaixo nos ambientes que serão publicados e faça um novo deploy para aplicá-las.

| Variável | Valor |
| --- | --- |
| `SUPABASE_URL` | URL HTTPS do projeto Supabase |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key ou chave pública legada `anon` |

Essas variáveis são lidas pela Function da Vercel. Não precisam do prefixo `VITE_` e não são credenciais administrativas. A configuração pública necessária ao login é entregue ao navegador pela aplicação. Nunca use uma chave `service_role` ou uma chave secreta `sb_secret_` nesse campo: elas ignoram a proteção normal dos dados.

Não coloque senhas, tokens de acesso da conta Supabase, chaves administrativas ou arquivos `.env` no Git ou no chat. A aplicação não precisa de chave administrativa para operar.

Quem já mantém um projeto vinculado pela CLI do Supabase pode incluir esta migração no fluxo existente e executar `supabase db push` no diretório daquele projeto, usando a autenticação já configurada. Verifique o projeto de destino antes de executar; o caminho pelo SQL Editor não depende da instalação dessa CLI.

## Configurar o endereço da aplicação

Depois de obter o endereço real da Vercel, abra **Authentication → URL Configuration** no Supabase:

- Se **Site URL** ainda for o padrão `localhost`, defina a origem HTTPS de produção. Preserve um endereço já usado por outro aplicativo do projeto.
- Inclua o endereço de produção na lista de **Redirect URLs** quando o fluxo de confirmação utilizado exigir esse retorno.
- Se usar previews, autorize somente os endereços necessários para esses testes. Não invente um domínio antes de a Vercel fornecê-lo.

Ao criar uma conta pela aplicação, o Supabase pode enviar uma confirmação de e-mail. Nesse caso, confirme o endereço antes de entrar com e-mail e senha. Configure o envio de e-mails do projeto conforme o uso esperado; o aplicativo apresenta as respostas do fluxo de autenticação sem criar sessões falsas.

## Primeiro administrador e usuários

O operador autorizado reserva o e-mail do primeiro administrador em `public.crm_admin_bootstrap`, associado à organização criada pela migração. Essa tabela não é acessível aos usuários da aplicação. Não há senha padrão nem promoção automática do primeiro cadastro público.

Em uma **instalação nova**, depois de aplicar as migrações, consulte o UUID da organização no SQL Editor e substitua os dois campos do exemplo abaixo antes de executá-lo:

```sql
select id, name from public.crm_teams;

insert into public.crm_admin_bootstrap (workspace_id, email)
values ('UUID_DA_ORGANIZACAO', lower('admin@suaempresa.example'))
on conflict (workspace_id) do nothing;
```

Use o e-mail real que o administrador vai cadastrar e confirmar pelo Supabase Auth. A cláusula `do nothing` preserva uma reserva existente. Uma instalação que já tem administrador deve gerir os acessos pela interface do CRM, sem recriar a reserva. O token administrativo do Supabase não é um usuário ou senha do aplicativo.

Ao entrar com o e-mail reservado e confirmado, a conta recebe o perfil Administrador uma única vez. Se já havia dados dessa conta em `crm_workspaces`, eles são importados para a organização; o snapshot antigo permanece intacto. A reserva não restaura privilégios depois de uma remoção deliberada de administrador.

Os demais usuários criam e confirmam sua conta, depois aguardam liberação. Em **Usuários e permissões**, o administrador adiciona o e-mail já cadastrado, escolhe o perfil e controla a suspensão. Essa operação não envia convites por e-mail. O último administrador ativo é protegido contra remoção, suspensão ou rebaixamento.

| Perfil padrão | Registros | Gestão de acessos |
| --- | --- | --- |
| Administrador | Acesso completo | Usuários e perfis |
| Gestor | Leitura, criação, edição, exclusão e exportação da equipe | Sem gestão de acessos |
| Usuário | Leitura, criação e edição dos próprios registros | Sem exclusão, exportação ou gestão de acessos |

O administrador pode ajustar os perfis Gestor e Usuário separadamente para empresas, contatos, negócios e tarefas. Leitura, edição e exclusão aceitam os escopos Nenhum, Próprios e Todos; criação e exportação são permissões específicas. O perfil Administrador mantém acesso completo.

## Como os dados são protegidos

- `crm_members` e `crm_permission_profiles` definem os perfis e sua participação na organização; alterações passam por funções autorizadas para administradores.
- `crm_records` armazena cada registro com organização, coleção, responsável por UUID e revisão. As políticas RLS aplicam as permissões mesmo em chamadas diretas ao REST do Supabase.
- Proprietários pertencem à organização; usuários comuns não podem transferir registros para ganhar privilégios.
- Histórico de atividades é produzido pelo banco, sem permitir gravações de auditoria pelo cliente.
- A API valida o token da sessão, aplica os mesmos limites e usa esse token nas chamadas ao Supabase.
- Alterações concorrentes usam a revisão do registro para evitar sobrescritas silenciosas. Exclusões removem os vínculos correspondentes sem apagar os demais registros relacionados.
- Suspensão de um membro remove seu acesso aos dados, mesmo que a sessão de autenticação continue existente.
- `crm_workspaces` é mantida como armazenamento legado; não deve ser apagada durante a atualização.

O chat e o feed exigem participação ativa na organização, independentemente das permissões dos módulos comerciais. Conversas diretas são privadas entre seus dois participantes, inclusive para administradores que não participem delas. O feed e o canal Equipe são compartilhados com os membros ativos. Administradores podem moderar o feed e o canal Equipe. Consulte [COLLABORATION.md](COLLABORATION.md).

## Verificar a conexão

Após configurar as variáveis e publicar:

1. Abra a aplicação e confirme que a tela de login aparece.
2. Entre com a conta do administrador reservado, com e-mail confirmado.
3. Cadastre uma empresa, um contato, um negócio e uma tarefa.
4. Recarregue a página e entre com a mesma conta em outro navegador; os registros devem continuar disponíveis.
5. Adicione uma segunda conta com perfil Usuário e confirme que ela vê apenas os registros autorizados. Tente alterar perfis e excluir registros sem permissão; a API e o banco devem recusar.
6. Confirme que uma conta sem liberação fica na tela de acesso pendente e que um Gestor não pode administrar os usuários.

O endpoint `/api/config` informa o modo e a configuração pública de autenticação. Configuração ausente deve produzir uma mensagem clara, sem trocar silenciosamente o banco por memória temporária. Uma resposta de saúde/configuração não substitui o teste real de leitura e gravação no projeto Supabase.

Os módulos operacionais exigem ainda as migrações `20261026040000_crm_suite.sql`, `20261026050000_crm_collaboration_extra.sql` e `20261026060000_crm_webchat.sql`, nesta ordem. Elas usam as organizações e os membros existentes, sem promover novos usuários ou alterar o administrador. As rotas públicas de agendamento e chat expõem somente disponibilidade ou a sessão individual do visitante, pelas RPCs específicas. O acesso normal ao CRM continua autenticado. Consulte [SUITE.md](SUITE.md).

## Preservar o banco local existente

Mantenha `data/vox-crm.sqlite` e eventuais arquivos SQLite auxiliares. Não apague nem sobrescreva o arquivo para publicar. Para uma cópia consistente durante o uso, utilize a operação de backup do SQLite; para copiar os arquivos diretamente, primeiro encerre apenas a instância local que você iniciou. A migração deste diretório cria a estrutura remota, mas não transfere os dados locais. Uma transferência de registros existentes precisa ser preparada e conferida separadamente.

## Referências

- [Chaves do Supabase](https://supabase.com/docs/guides/api/api-keys)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Login com senha](https://supabase.com/docs/guides/auth/passwords)
- [URLs de retorno de autenticação](https://supabase.com/docs/guides/auth/redirect-urls)
