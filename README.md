# Órbita

Aplicação independente para descobrir comunidades e canais, participar de uma comunidade e conversar nos seus canais. Implementação original em **React + TypeScript + Node.js + SQLite FTS5 + Socket.IO**, com identidade visual e ilustrações próprias, sem serviços externos necessários para executar.

O foco desta entrega é **descoberta de servidores e canais**, conforme o escopo escolhido. Não é uma reprodução completa do Discord. O acesso ao Discord foi bloqueado pelo proxy deste ambiente: **não houve engenharia reversa verificada do código ou comportamento do Discord**. [Leia o relatório e os registros de acesso](docs/investigation.md).

## Executar

**Windows:** [baixe o instalador de 64 bits na release v0.1.0](https://github.com/rcunha108/orbita/releases/tag/v0.1.0). Ele inclui o runtime e permite abrir o aplicativo pelo atalho, no navegador. [Instalação, limites e geração do EXE](docs/windows.md). O modo local mantém os dados no computador; para conversar entre computadores e usar mídia, conecte a um servidor compartilhado. O instalador ainda não possui assinatura digital nem validação de instalação em Windows real.

Requer Node.js 24.15 ou superior com `node:sqlite` e FTS5; validado em Node.js 24.19.0 e npm 11.9.0. Use o diretório `/workspace/orbita` neste ambiente.

```bash
npm ci
npm run media:install
npm run dev
```

Em Linux amd64 com Docker, os comandos preparam e iniciam frontend (**5173**), API (**3001**), LiveKit e TURN locais. [Configuração, uso e implantação da mídia](docs/media.md). O Vite encaminha `/api` para a API; não é preciso configurar credenciais. Para executar a versão compilada em um único processo:

```bash
npm run build
npm start
```

A versão compilada é servida pela API na porta **3001**. Por padrão, a API escuta apenas na interface local. `PORT`, `HOST` e `DATABASE_PATH` são opções não secretas. Exemplo para outra porta:

```bash
PORT=3002 npm start
```

`HOST=0.0.0.0` torna a API acessível nas interfaces de rede. Crie sua conta pela interface; não há credenciais padrão. Em implantação HTTPS, defina `SECURE_COOKIES=true` e configure o proxy reverso para preservar o Host e encaminhar WebSocket. [Contas, sessões e chat em tempo real](docs/realtime.md).

## O que funciona

- Descoberta de 12 comunidades fictícias e 60 canais, com resultados paginados.
- Busca no servidor por nomes, descrições, tags e nome da comunidade de um canal.
- Prefixos, correspondência sem distinção de acentos/maiúsculas e combinação de todas as palavras digitadas.
- Filtros por categoria com contagens, ordenação por relevância, membros ou ordem de adição.
- Requisições de busca canceladas quando a consulta muda, estados de carregamento, erro, nova tentativa e nenhum resultado.
- Cadastro/login com senha protegida por scrypt, sessões HTTP-only, logout e contas individuais.
- Entrada/saída idempotente de comunidades por conta; leitura e envio autorizados no servidor.
- Mensagens em tempo real, presença por conta, digitação temporária e recuperação após reconexão.
- Voz por canal, silenciar microfone, ligações com aceite/recusa/cancelamento e compartilhamento de tela.
- TURN por TCP para redes restritas, sem alterar políticas do navegador.
- Navegação de canais, histórico paginado e envio de mensagens; texto é renderizado como texto, sem interpretar HTML.
- Persistência de participações e mensagens em `.data/orbita.sqlite`; seed transacional executado apenas ao criar uma base vazia.
- Layout responsivo, rótulos acessíveis, navegação por teclado, atalho Ctrl/Cmd+K, suporte a movimento reduzido e diálogo nativo.

Os nomes, contagens, verificação e status online das comunidades são **dados fictícios de demonstração**, não informações recebidas do Discord nem presença ao vivo. O chat usa Socket.IO para atualizações ao vivo e HTTP para envio persistente e recuperação. Há voz em grupo por canal, ligações entre duas pessoas e compartilhamento de tela via LiveKit/WebRTC. Ainda não há notificações, câmera, ligações telefônicas, upload de arquivos, moderação ou mensagens privadas de texto.

## Organização

```text
src/
  App.tsx                    Navegação e estrutura principal
  auth.tsx                   Contas e ciclo de vida da sessão
  api.ts                     Cliente HTTP e erros
  types.ts                   Contratos usados pelo frontend e backend
  hooks/useDiscovery.ts      Busca com debounce e cancelamento
  components/
    Discovery.tsx            Busca, filtros e resultados
    Artwork.tsx              Ilustrações originais
    CommunityCard.tsx        Cartões de comunidades e canais
    CommunityView.tsx        Comunidade, canais e conversa
server/
  auth.ts                    Senhas e sessões
  media.ts                   Permissões, tokens de mídia e chamadas
  realtime.ts                Eventos, presença e digitação
  main.ts                    Inicialização e encerramento
  http.ts                    HTTP, JSON, rotas e arquivos estáticos
  store.ts                   Esquema, consultas e persistência
  search.ts                  Validação e construção da consulta FTS
  seed.ts                    Comunidades fictícias e canais iniciais
tests/browser.ts             Fluxos reais em Chromium
docs/investigation.md        Evidências, limites e decisões
```

Consultas SQL recebem parâmetros vinculados. A entrada do usuário é dividida em tokens Unicode e convertida em prefixos FTS entre aspas; operadores FTS não são executados como linguagem de consulta. IDs de ordenação e categorias são validados em listas fechadas. A API valida limites de corpo, tamanho das mensagens, participação na comunidade e origem de escritas com cabeçalho `Origin`.

## Validação

```bash
npm test
npm run build
npm run test:e2e
npm run test:media  # com LiveKit/TURN locais rodando
npm run format:check
```

O teste de navegador requer Chromium instalado em `/usr/bin/chromium`; use `CHROMIUM_PATH` para outro executável. Ele cria uma base **em memória** e um servidor numa porta aleatória, sem modificar o banco usado no desenvolvimento. Capturas e resultados são gravados em `.test-artifacts/`.

Os testes verificam busca, acentos, filtros, paginação, tratamento de entrada, permissões de escrita, persistência após reabrir a base, cursores de mensagens, HTTP, navegação, respostas antigas de busca, recuperação de erros e layout móvel. [Resultados da validação](docs/validation.md).

## Evolução para produção

As contas e o chat desta etapa usam um único processo Node. Para um produto público, acrescente recuperação/verificação de conta, moderação, limites de envio, regras de canais privados, migrações versionadas e backups. Escala horizontal requer adaptador de eventos compartilhado e banco adequado. Voz/chamadas/tela usam LiveKit/WebRTC com essas identidades; disponibilizar para usuários externos exige HTTPS/WSS, TURN público seguro e infraestrutura de mídia configurada. Consulte [detalhes e limites desta etapa](docs/realtime.md).
