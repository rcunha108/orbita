# Contas e chat em tempo real

Esta etapa adiciona contas individuais e chat ao Órbita. Voz, chamadas e compartilhamento de tela agora usam as mesmas identidades e permissões; veja [a configuração de mídia](media.md).

## Executar e experimentar

Use `npm ci`, `npm run build` e `npm start`, ou `npm run dev` para desenvolvimento. Crie uma conta na interface, entre em uma comunidade e abra um canal. Para testar duas pessoas, use dois perfis/contextos de navegador distintos (por exemplo, uma janela comum e outra anônima). Abas no mesmo perfil compartilham a sessão da conta.

As contas criadas não requerem serviços externos. A senha deve ter entre 10 e 128 caracteres. Não há contas ou senhas padrão. Nomes e e-mails dos testes são fictícios, usados apenas em bancos isolados.

## Autenticação e sessões

- Senhas protegidas com scrypt assíncrono e salt aleatório por conta; a senha não é armazenada.
- Comparação do hash com tempo constante. Tentativas de entrar com e-mail inexistente também executam scrypt.
- Sessões opacas de 256 bits; apenas SHA-256 do token é armazenado no banco.
- Cookie `orbita_session` HTTP-only, `SameSite=Strict`, duração de sete dias. Nenhum token é armazenado no localStorage.
- Logout invalida a sessão e desconecta seus sockets. As outras abas atualizam a autenticação por BroadcastChannel e ao voltar ao primeiro plano.
- Limite por IP de dez tentativas de cadastro/login por minuto por processo, sem confiar no cabeçalho X-Forwarded-For.
- Em HTTPS, defina **`SECURE_COOKIES=true`**. O proxy reverso deve preservar o Host externo e encaminhar upgrades WebSocket. O modo local HTTP usa cookies sem Secure.

Cadastro e login ficam em `/api/auth/register` e `/api/auth/login`; `/api/auth/me` retorna a identidade atual e `/api/auth/logout` encerra a sessão. Escritas HTTP e a conexão Socket.IO validam a origem quando o navegador a envia.

Não há verificação de e-mail, recuperação/troca de senha ou painel de administração nesta etapa. Esses fluxos e políticas operacionais precisam ser definidos antes de abrir cadastros públicos.

## Autoridade e dados

Participações são vinculadas ao ID autenticado, nunca a um ID enviado no corpo pelo cliente. Uma conta não herda as participações do perfil compartilhado anterior. Os dados antigos permanecem no banco, sem serem atribuídos a uma nova conta.

O catálogo e os nomes de canais continuam públicos. Ler histórico, assinar eventos, digitar e enviar mensagens exige uma sessão válida e participação na comunidade. Ao sair da comunidade, todos os sockets dessa conta no canal são revogados. Sessões são revalidadas em cada operação e antes de publicar uma mensagem; conexões expiradas são encerradas por verificação periódica.

As contagens históricas dos cartões permanecem dados fictícios. O indicador **online neste canal** vem das conexões reais do chat, agrupadas por conta para que duas abas não contem como duas pessoas. Ele descreve participantes conectados ao canal, não toda a presença do servidor.

## Fluxo e recuperação

1. O cliente conecta ao Socket.IO autenticado pelo cookie e assina um canal.
2. O servidor valida a participação, registra a assinatura e entrega o histórico recente.
3. O envio usa HTTP com um `clientId` aleatório. Mensagem e recibo de envio são gravados na mesma transação.
4. O servidor publica a mensagem já persistida para os assinantes autorizados. O remetente real vem da sessão.
5. O frontend combina as respostas e os eventos por ID canônico para impedir duplicações.
6. Após reconexão, o frontend busca todas as mensagens posteriores ao último ID visto, em páginas de até 100, enquanto continua recebendo eventos novos.

Uma nova tentativa com o mesmo `clientId` e conteúdo retorna a mensagem existente. Reutilizar o mesmo identificador para outro conteúdo/canal retorna conflito. Isto evita duplicar uma gravação quando a resposta HTTP se perde; não promete entrega exatamente uma vez na rede.

O indicador de digitação é temporário, limitado no servidor e expira após quatro segundos. Não é persistido. O cliente mostra conexão, reconexão e falhas de sincronização; o envio fica desabilitado até a assinatura/sincronização terminar.

## Arquitetura

- `server/auth.ts`: credenciais, sessões e identidade.
- `server/store.ts`: persistência e validação de participação.
- `server/realtime.ts`: assinaturas, publicação, presença, digitação e revogação.
- `server/http.ts`: autenticação, cookies, endpoints e proteção de origem.
- `src/auth.tsx`: interface de cadastro/login e ciclo de vida da sessão.
- `src/hooks/useRealtimeChannel.ts`: conexão, recuperação de lacunas e combinação de eventos.

Esta versão usa um processo Node e SQLite. Escala horizontal requer um adaptador de eventos compartilhado, estratégia de presença, balanceamento adequado e um banco apropriado; não basta iniciar várias cópias independentes. Ainda não há moderação, limites de envio por usuário, canais privados ou recibos de leitura.

## Validação

`npm test` inclui dois clientes Socket.IO reais: autenticação, permissões, isolamento de participações, mensagens, digitação, presença, deduplicação, recuperação por cursor, logout e revogação ao sair.

`npm run test:e2e` usa dois contextos reais do Chromium. Verifica entrega sem recarregar, autoria, digitação, presença e recuperação de **35 mensagens perdidas** após interromper um WebSocket — mais que a página inicial de 30 mensagens. Depois verifica logout e bloqueio de acesso.
