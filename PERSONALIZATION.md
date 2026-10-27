# Perfil e configurações pessoais

Abra **Configurações do app** na barra lateral para escolher tema claro, escuro ou do dispositivo, uma das seis cores de destaque, fundos prontos ou uma foto pessoal. As alterações têm prévia; **Salvar aparência** sincroniza a preferência na conta, inclusive em outros dispositivos. Cancelar ou sair da tela desfaz a prévia. A foto de fundo fica apenas no espaço pessoal.

Clique no seu nome/foto no rodapé do menu ou no topo para abrir **Meu perfil**. É possível editar nome, cargo, departamento, telefone, localização, apresentação e foto. O e-mail é exibido somente para consulta. Esta tela não altera senha, e-mail, cargos de acesso nem permissões.

A seção **Organização** das configurações permite ao administrador alterar o nome compartilhado. Gestores e usuários veem o nome para consulta. Usuários e permissões continuam na seção administrativa própria.

## Persistência e imagens

No Supabase, nome e informações pessoais são mantidos em `Auth user_metadata`. As preferências ficam em `crm_preferences` na mesma conta. Esses metadados são editáveis pelo próprio usuário e nunca concedem acesso ou perfil administrativo: a autorização continua em `crm_members`, nos perfis e nas regras RLS.

A migração `20261026030000_crm_personalization.sql` cria o bucket privado `crm-personal-media`. Imagens têm caminho `<user UUID>/avatar|background/<object UUID>.png|jpg|jpeg|webp`. O usuário ativo escreve somente seus próprios arquivos; pode consultar seu fundo e os avatares dos colegas ativos da mesma organização. O fundo de outro usuário não é compartilhado. A API gera URLs assinadas com duração de uma hora usando a sessão do usuário. Não é preciso tornar o bucket público nem configurar chave administrativa no runtime.

O diretório dos colegas expõe apenas identificador, nome e foto autorizada. Não inclui telefone, apresentação, preferências ou fundo. As restrições do bucket também se aplicam quando outras políticas de Storage permissivas já existem, preservando os demais buckets.

Suspender uma conta bloqueia a API e a emissão de novas URLs assinadas. URLs emitidas antes da suspensão continuam válidas até sua expiração; imagens já baixadas também podem permanecer no cache do navegador ou do serviço de Storage.

A interface aceita PNG, JPEG e WebP até 12 MB antes do ajuste, verifica a assinatura da imagem e ajusta o arquivo no navegador. O avatar usa recorte central quadrado; o fundo mantém a proporção. São enviados arquivos WebP de até 2 MB para avatar e 8 MB para fundo. SVG e URLs arbitrárias não são aceitos. Arquivos substituídos são removidos após salvar; falhas na gravação dos metadados tentam remover o upload recém-criado.

As preferências de tema sem imagens também são mantidas em cache local por identificador da conta para reduzir a mudança de cores ao abrir. Fotos, caminhos de mídia e URLs assinadas não ficam nesse cache. Sair da conta limpa o tema e as imagens da tela; o próximo usuário recebe suas próprias preferências.

No desenvolvimento SQLite, perfil, aparência, nome da organização e imagens persistem no banco local para o único usuário de desenvolvimento. Isso não substitui o controle de contas da versão Supabase.

## Validação

`npm test` verifica os adaptadores locais/remotos, limites e validação, URLs confiáveis, proteção de campos e atualização concorrente de perfil/aparência. `npm run test:personalization` exercita funções PostgreSQL e políticas de Storage no PGlite com Auth/Storage emulados. A publicação deve também verificar uploads reais, isolamento entre contas e persistência na Vercel e no Supabase.
