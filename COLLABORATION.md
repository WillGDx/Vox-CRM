# Chat interno e feed da empresa

Os módulos usam os colaboradores cadastrados e liberados em **Usuários e permissões**. Contas pendentes ou suspensas não podem ler nem enviar conteúdo. Os perfis comerciais de empresas, contatos, negócios e tarefas continuam independentes desses espaços de comunicação.

## Chat interno

- **Equipe** reúne os membros ativos da organização.
- **Nova conversa** abre ou retoma uma conversa direta com outro colaborador ativo.
- Mensagens de texto aceitam várias linhas e Unicode. Enter envia e Shift+Enter insere uma linha.
- O histórico fica no banco, com carregamento de mensagens anteriores e contagem de não lidas. Abrir uma conversa visível marca a leitura.
- Autores podem editar ou excluir suas mensagens. Administradores também podem moderar mensagens no canal Equipe.
- Conversas diretas são acessíveis somente aos dois participantes. O perfil Administrador do CRM não concede acesso a conversas diretas de terceiros.

## Feed da empresa

Qualquer membro ativo pode publicar, comentar e reagir com Curtir, Celebrar ou Apoiar. O autor pode editar ou excluir seu conteúdo. Administradores podem moderar publicações e comentários e fixar comunicados. A lista preserva a ordenação dos fixados e permite carregar publicações anteriores.

O conteúdo é apresentado como texto; não é interpretado como HTML. Esta entrega contempla mensagens e publicações de texto. Chamadas, anexos e notificações push não fazem parte destes módulos.

## Banco e atualização ao vivo

Execute `20261026020000_crm_collaboration.sql` depois das duas migrações anteriores. Ela cria as tabelas, políticas RLS e funções autorizadas de chat/feed. Quando a publicação `supabase_realtime` existe, as seis tabelas são adicionadas de forma idempotente. Os demais membros dessa publicação são preservados.

O navegador assina alterações com a sessão Supabase do próprio usuário. As políticas do banco controlam o conteúdo entregue, incluindo conversas diretas. Há atualização periódica e ao voltar para a aba como alternativa quando a conexão ao vivo não está disponível. O indicador de conexão distingue os dois modos.

Gravações passam por funções que definem autor e horário no servidor. Exclusões feitas pela aplicação limpam o texto e mantêm apenas o marcador de conteúdo removido. O cliente não pode forjar autoria, timestamps ou permissões de moderação.

## Desenvolvimento e testes

O modo SQLite local mantém um único usuário de desenvolvimento. Ele oferece o canal Equipe e feed persistentes, sem inventar colaboradores para conversas diretas. A validação de múltiplos usuários usa Supabase simulado ou organizações temporárias isoladas no provedor real.

```bash
npm test
npm run test:collaboration
npm run build
```

Os testes SQL usam PostgreSQL/PGlite e simulam Supabase Auth localmente; a entrega de eventos Realtime exige validação contra o serviço real. Ao testar na nuvem, use organizações e contas próprias de validação, sem enviar mensagens ou publicações para a organização real, e remova os registros criados ao concluir.
