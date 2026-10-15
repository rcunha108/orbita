# Conectar ao LiveKit Cloud e hospedar o chat

O código já usa o SDK do LiveKit. Para duas pessoas em computadores diferentes se encontrarem, ambas precisam acessar o mesmo backend Órbita com HTTPS. Conectar somente o LiveKit a instalações locais com bancos separados não compartilha contas, presença, canais ou convites.

## 1. Criar o projeto de mídia

O projeto informado para esta instalação usa `wss://orbita-06z7utuf.livekit.cloud`. Essa URL é pública; o arquivo `.env.production.example` documenta as variáveis sem incluir credenciais.

No [LiveKit Cloud](https://cloud.livekit.io/), crie um projeto e obtenha sua **Project URL**, **API Key** e **API Secret** nas configurações do projeto. A URL tem o formato `wss://seu-projeto.livekit.cloud` e pode ser informada ao responsável pela configuração. As chaves devem ser inseridas diretamente nas variáveis seguras do serviço que hospeda o backend; não as envie em conversas, commits ou arquivos do instalador.

## 2. Publicar o backend no Railway

No Railway, crie um serviço a partir do repositório `rcunha108/orbita`, branch `main`. O `Dockerfile` inclui frontend e backend; não execute `npm run dev`, LiveKit local ou coturn nesse serviço.

Configure as variáveis do serviço:

| Variável             | Valor                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `LIVEKIT_URL`        | A Project URL `wss://` do LiveKit Cloud                                |
| `LIVEKIT_API_KEY`    | A API Key real do mesmo projeto, inserida nas configurações seguras    |
| `LIVEKIT_API_SECRET` | O API Secret real do mesmo projeto, inserido nas configurações seguras |
| `HOST`               | `0.0.0.0`                                                              |
| `DATABASE_PATH`      | `/data/orbita.sqlite`                                                  |
| `SECURE_COOKIES`     | `true`                                                                 |

Remova `LIVEKIT_DEV_MODE`, caso exista. A imagem já define os valores não secretos acima. O backend respeita a variável `PORT` fornecida pela plataforma; o padrão da imagem é 3001.

Adicione um **volume persistente** montado em `/data` e confira se o usuário `node` da imagem tem acesso de escrita a ele. Sem o volume, contas e mensagens podem ser perdidas ao recriar o container. Mantenha **uma réplica**: SQLite e os convites de chamada em memória não foram preparados para várias instâncias. Evite suspensão automática durante os testes de chamada.

Gere um domínio público HTTPS para o serviço, apontando para a porta do backend. Configure `/api/health` como rota de healthcheck. O proxy deve preservar Host e conexões WebSocket. O LiveKit Cloud fornece o serviço de mídia; não é necessário publicar as portas do LiveKit local no Railway.

Antes de contratar, confira planos, limites e cobranças atuais de ambos os provedores. Estas instruções não criam contas, contratam planos nem provisionam recursos automaticamente.

## 3. Verificar a conexão

No terminal do backend, com as três variáveis LiveKit já configuradas:

```bash
npm run media:check
```

O comando consulta a API de salas sem criar salas nem encerrar chamadas, tem timeout de 15 segundos e não imprime chaves, tokens ou nomes de salas. Um resultado positivo confirma conectividade HTTPS e autenticação da API; não comprova a transmissão WebRTC entre os dispositivos.

Abra a aplicação HTTPS, crie duas contas, entre na mesma comunidade e no mesmo canal em dois dispositivos. Confirme presença e uma mensagem recebida no outro computador. Entre na voz, autorize o microfone e teste o áudio nos dois sentidos. Depois teste uma ligação aceita e o compartilhamento de tela, usando o seletor do navegador. Consulte permissões de microfone/tela do navegador se a conexão existir sem captura.

`/api/media/status` indica que a configuração de mídia está presente; não é um teste de disponibilidade do provedor. Guarde apenas resultados e mensagens de erro sem credenciais.

## 4. Conectar o instalador

Após confirmar o endereço HTTPS público do chat, configure o `serverUrl` descrito em [Windows](windows.md) em **todos** os computadores, com o mesmo endereço do backend Órbita. Use a URL HTTPS do chat, não a URL `wss://` do LiveKit.

O instalador local v0.1.0 não recebe chaves do LiveKit e não é ativado pela simples criação do projeto Cloud. Contas e mensagens locais não são migradas automaticamente ao backend compartilhado.

## Verificação desta preparação

O [relatório do container](evidence/cloud-container-report.json) registra cinco verificações aprovadas: frontend/API, cadastro e mensagens com handshake em tempo real, persistência após reinício, detecção de credenciais ausentes e execução sem root/arquivos privados. Os 12 testes existentes do backend e o build TypeScript também passaram. A URL pública do LiveKit respondeu por HTTPS; autenticação Cloud, implantação Railway e chamadas entre dispositivos ainda aguardam configuração e teste.

Em ambientes de build que usam proxy TLS corporativo, o Dockerfile aceita opcionalmente um bundle de autoridades certificadoras por BuildKit `--secret id=build_ca,src=/caminho/ca-bundle.crt`. O bundle é usado apenas durante a instalação e não é copiado para a imagem. Use as opções de proxy suportadas pelo Docker quando necessário e mantenha a verificação TLS habilitada. Em um ambiente sem esse proxy, `docker build -t orbita .` usa a confiança padrão do Node.
