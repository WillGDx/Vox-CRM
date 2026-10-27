# Módulos operacionais do Vox CRM

As funcionalidades desta pasta são uma implementação própria inspirada nos fluxos solicitados. Reutilizam Supabase Auth, a organização atual e os perfis Administrador, Gestor e Usuário.

| Área | Funcionalidades disponíveis | Dependências externas |
| --- | --- | --- |
| Vendas | Leads em Kanban/lista; conversão atômica em contato e negócio; funil já existente | Nenhuma |
| Automação | Mudanças de etapa criam tarefas com prazo ou alteram outra etapa; resultado da execução registrado | E-mail automático aguarda provedor |
| Documentos | Orçamentos e faturas comerciais com itens, quantidades, valores, total calculado, impressão/PDF e geração de fatura | Links de pagamento e confirmação financeira aguardam provedor; não emite nota fiscal |
| Atendimento | Canais, atendimentos, responsáveis e histórico; chat público do site com respostas na central | WhatsApp, redes sociais, e-mail e telefonia aguardam provedores |
| Projetos | Projetos/tarefas, responsáveis, dependências, lista, Kanban, Gantt, backlog/sprints e modelos reutilizáveis | Nenhuma |
| Horas | Cronômetros por tarefa, durações calculadas pelo servidor e totais | Nenhuma |
| Calendário | Eventos pessoais/equipe, conflitos, exportação ICS e páginas públicas de agendamento | Não sincroniza Google/Microsoft Calendar |
| Comunicação | Chat existente, grupos privados, enquetes e arquivos compartilhados privados | Vídeo abre uma sala externa Jitsi, com suas regras de acesso; não é uma chamada nativa |
| RH | Diretório real, departamentos, responsáveis, entrada/saída/pausas e relatórios CSV | Sem cálculo de folha de pagamento |
| Processos | Fluxos de compras, reembolsos e aprovação; formulários e decisões auditadas | Nenhuma |
| Copilot | Interface e adaptadores para resumo, redação, sugestões e transcrição de áudio | OpenAI configurada; a conta da API precisa de cota disponível para operar |

## Persistência e permissões

`20261026040000_crm_suite.sql` adiciona `crm_suite_items`, ações transacionais, páginas de agendamento e o histórico de automações. A estrutura armazena tipos definidos e dados validados; não é uma API de JSON arbitrário. Identidade, organização, horários, totais financeiros, conversão de leads, decisões e revisões são controlados pelo servidor.

Operações comerciais seguem as permissões de negócios; projetos/tarefas seguem as permissões de tarefas, a propriedade e a participação. Cadastros de RH são editáveis pelo administrador. Ponto e horas são pessoais, com leitura administrativa. Fluxos e canais são geridos por administradores/gestores. Aprovar exige ser o aprovador designado ativo, com papel autorizado, ou administrador. A decisão registra identidade e horário e não pode ser sobrescrita por uma edição comum.

Escritas no Supabase usam RPCs e a sessão verificada. As tabelas têm SELECT com RLS; gravações REST diretas são revogadas. Revisões impedem sobrescrever alterações concorrentes. O adaptador SQLite preserva os mesmos fluxos para o único usuário real de desenvolvimento.

Os conflitos de revisão das ações de negócio usam SQLSTATE `PT409`, que o PostgREST entrega como HTTP 409. Não use `40001` para esse caso: na integração real, sua semântica de falha de serialização acionou repetições na infraestrutura e causou timeout. Há regressões para salvar, excluir e executar ações com revisão desatualizada.

## Chat incorporável no site

Na Central de atendimento, um administrador/gestor cria um canal do tipo **Chat do site** e habilita o canal. O link `/atendimento/<channel UUID>` abre a conversa pública sem exigir conta do CRM. O mesmo endereço pode ser usado como `src` de um iframe no site da empresa.

A migração `20261026060000_crm_webchat.sql` armazena sessões públicas separadamente. Cada visitante recebe um token aleatório, mantido na própria sessão do navegador; somente seu hash fica no banco. O visitante pode consultar e escrever apenas em seu atendimento, sem consultar o diretório, os registros ou outras conversas. A equipe responde pela central, com as permissões comerciais existentes. Canais desabilitados ou pertencentes a um operador suspenso ficam indisponíveis.

Há limites de tamanho e frequência. Sessões expiram em sete dias e exibem as 200 mensagens mais recentes, informando quando há histórico anterior. A conversa fechada fica disponível para consulta, com opção de iniciar outro atendimento.

## Agendamento

A página pública `/agendar/<page UUID>` mostra duração, fuso e horários, sem título de eventos privados, nomes ou e-mails de outros clientes. Novos agendamentos exigem pelo menos 15 minutos de antecedência e têm janela máxima de 60 dias. O banco verifica disponibilidade e conflitos, inclusive solicitações concorrentes em páginas diferentes do mesmo responsável. O horário reservado vira um evento pessoal desse responsável.

Os formulários criam agendas no fuso `America/Sao_Paulo`. O seletor de visualização pode apresentar eventos em outros fusos. Compartilhar um link não configura envio de e-mail de confirmação.

## Grupos, enquetes e arquivos

`20261026050000_crm_collaboration_extra.sql` mantém grupos privados de participantes ativos, mensagens paginadas, enquetes e registros de arquivos. Mesmo um administrador que não participa do grupo não lê suas mensagens. Enquetes aceitam um voto por usuário, alteração de escolha e encerramento pelo autor/administrador.

O bucket **privado** `crm-shared-files` aceita PNG, JPEG, WebP, PDF, TXT e CSV até 10 MB. Caminhos incluem o UUID da organização e o do objeto; uploads usam a sessão do próprio usuário. Downloads usam URLs assinadas de cinco minutos e são entregues como arquivo. SVG, HTML e executáveis não são aceitos. Políticas restritivas preservam os outros buckets. No SQLite, arquivos ficam em BLOBs; veja [COLLABORATION_EXTRA.md](COLLABORATION_EXTRA.md).

## Conectar IA posteriormente

Na entrega inicial, os provedores externos ainda não haviam sido definidos. A conexão com OpenAI foi configurada posteriormente, em 27/10/2026. `/api/integrations/status` informa a presença da configuração; não expõe credenciais e não comprova saldo ou disponibilidade de cota. Envios e pagamentos dependentes de outros provedores continuam indisponíveis.

O adaptador de IA disponível é OpenAI. Quando escolhido, configure **somente no ambiente de runtime da Vercel** `VOX_AI_API_KEY`, e opcionalmente `VOX_AI_MODEL` (padrão `gpt-4.1-mini`) e `VOX_AI_TRANSCRIPTION_MODEL` (padrão `gpt-4o-mini-transcribe`), e publique novamente. Nunca coloque chaves no frontend, Git ou chat. Os modelos e o uso dependem da conta do provedor.

O backend também aceita a variável sensível `KeyChatGPT`, nome usado na configuração existente da Vercel, sem precisar revelar ou copiar seu valor. `VOX_AI_API_KEY` tem prioridade quando ambas existem. As duas são lidas somente no servidor; o endpoint de estado informa apenas se o provedor está configurado.

O teste real de ativação retornou `insufficient_quota` da OpenAI. O CRM identifica essa condição como HTTP 402 e orienta regularizar faturamento/créditos/limites da conta da API; limites temporários continuam como HTTP 429. As mensagens não expõem detalhes privados do provedor. A geração de texto ficou bloqueada por essa cota, e o teste de áudio não foi realizado. É necessário repetir a validação após regularizar a conta, sem concluir que a presença da chave comprova o funcionamento da IA. A assinatura do ChatGPT tem faturamento separado da API.

Somente uma solicitação explícita do usuário envia o texto revisado ou áudio. O Copilot não executa comandos do CRM nem envia mensagens por conta própria. Áudios compatíveis têm limite de 3 MB; resultados são texto revisável. Testes com respostas simuladas validam o adaptador, sem demonstrar qualidade de IA ou transcrição real quando o provedor está desconectado.

## Validação e publicação

Além dos testes já existentes:

```bash
npm test
npm run test:suite
npm run test:collaboration-extra
npm run test:webchat
npm run build
```

PGlite emula Auth/Storage e verifica regras PostgreSQL, isolamento, ações e migrações idempotentes. Testes HTTP usam SQLite real e adaptadores remotos simulados. A publicação também deve passar por verificação autenticada na Vercel/Supabase, com contas e organizações exclusivamente temporárias e limpeza comprovada. Não use dados da organização real para gerar mensagens ou solicitações de teste.
