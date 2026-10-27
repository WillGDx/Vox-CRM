# Grupos, enquetes e arquivos

A área de chat inclui **Grupos e reuniões**. O criador escolhe os colegas ativos que participam do grupo; apenas essas contas podem consultar seu histórico e enviar mensagens. Um administrador que não participa também não recebe acesso. As conversas individuais e o canal Equipe existentes continuam disponíveis.

As mensagens usam páginas de até 50 itens com cursor composto por data e identificador. A interface atualiza os grupos e a conversa aberta a cada dez segundos e quando a janela recupera o foco. Esta extensão usa atualização periódica, sem declarar conexão Realtime.

**Abrir sala de vídeo** abre um endereço aleatório do Jitsi para o grupo. Trata-se de um serviço externo, sujeito às regras de acesso dele; o anfitrião pode precisar entrar no Jitsi. Use as opções de sala de espera do serviço e compartilhe o endereço com os participantes. O aplicativo não oferece infraestrutura própria de videoconferência ou gravação.

Na área de feed, **Enquetes e arquivos da equipe** permite publicar uma pergunta com duas a oito opções. Cada usuário tem um voto, que pode alterar enquanto a enquete estiver aberta. Resultados mostram contagens, sem divulgar a opção individual dos colegas. O autor ou um administrador pode encerrar a enquete.

Arquivos PNG, JPEG, WebP, PDF, TXT e CSV de até 10 MB podem ser compartilhados com os membros ativos da organização. O bucket `crm-shared-files` é privado: uploads usam a sessão do usuário e os downloads recebem URLs assinadas por cinco minutos, com disposição de download. Outra organização e contas suspensas não recebem novas autorizações. Links já assinados e cópias baixadas seguem seus próprios prazos de validade e cache.

O autor ou administrador pode remover um arquivo. A interface pede uma segunda ação explícita antes da exclusão. Falha ao registrar o arquivo após o upload tenta limpar o objeto enviado. Nenhuma chave administrativa é necessária no frontend ou no runtime.

## Instalação e validação

Aplique `supabase/migrations/20261026050000_crm_collaboration_extra.sql` depois das migrações anteriores. Ela adiciona tabelas, uma RPC verificada por sessão, políticas RLS e o bucket privado, sem modificar as tabelas originais de chat/feed. As políticas restritivas de Storage impedem que regras permissivas antigas tornem estes arquivos públicos e permanecem neutras nos demais buckets.

No desenvolvimento local, `local-collaboration-extra.mjs` persiste grupos, mensagens, enquetes e votos no SQLite, e arquivos em BLOBs no mesmo banco. O único participante disponível é o usuário real de desenvolvimento; não são inventados colaboradores.

Validação automatizada: `node --test tests/collaboration-extra.test.mjs` e `node tests/sql-collaboration-extra.mjs`. Os testes SQL emulam Auth/Storage no PGlite; uploads e links assinados devem também ser conferidos com o projeto real antes de declarar a publicação validada.
