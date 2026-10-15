# Voz, chamadas e compartilhamento de tela

O Órbita usa LiveKit como SFU WebRTC e Socket.IO/HTTP para convites. O áudio e a tela passam pelo servidor de mídia; o histórico de texto continua em SQLite.

## Desenvolvimento local

A configuração automatizada foi validada em **Linux amd64**, com Docker disponível, Node.js 24 e Chromium 154.

```bash
npm ci
npm run media:install
npm run dev
```

`media:install` verifica/instala o executável LiveKit 1.13.10 a partir da imagem oficial fixada por digest, obtém a imagem coturn 4.6.3 também por digest e prepara a configuração local. Não instala pacotes do sistema nem altera políticas do navegador. A execução de `dev` inicia quatro processos: API, Vite, LiveKit e TURN.

O instalador preserva o executável existente se seu checksum for diferente, em vez de substituí-lo. As imagens e os hashes esperados estão em `scripts/install-livekit.mjs`. Um container temporário de extração do LiveKit é removido após a cópia. O TURN roda como o usuário não privilegiado da imagem oficial, com rede do host Linux, e seu container é removido quando o processo é encerrado.

`prepare-media.mjs` cria credenciais aleatórias locais em `.tools/media-dev.json` e preserva seus valores nas execuções seguintes. Os arquivos de credenciais/configuração têm modo 0600 e são ignorados pelo projeto. Não os envie para o Git ou em conversas. O ZIP da entrega não inclui `.tools`, banco de dados ou credenciais. Não há chaves padrão de produção.

O helper seleciona o primeiro IPv4 não loopback para anunciar a mídia. `LIVEKIT_NODE_IP` permite selecionar outra interface da máquina. A API do LiveKit fica nas interfaces loopback e selecionada; TURN recebe conexões apenas no loopback. Esta configuração serve para navegador e serviços na **mesma máquina de desenvolvimento**. Os endereços loopback anunciados não são uma configuração de acesso público.

| Serviço               | Porta/transporte local |
| --------------------- | ---------------------- |
| Frontend              | 5173 HTTP              |
| API                   | 3001 HTTP/Socket.IO    |
| LiveKit sinalização   | 7880 HTTP/WebSocket    |
| LiveKit ICE           | 7881 TCP, 7882 UDP     |
| TURN para o navegador | 3478 TCP               |
| Relay TURN para o SFU | UDP 40000–40100        |

### Usar

1. Crie duas contas em contextos de navegador separados, entre na mesma comunidade e abra o mesmo canal.
2. Clique em **Entrar na voz**. Autorize o microfone e, se solicitado pelo navegador, o acesso à rede local.
3. Use o botão do microfone para silenciar/ativar.
4. Clique em **Compartilhar tela** e escolha a aba, janela ou tela no seletor nativo do navegador. O áudio da tela depende da fonte, do navegador e do sistema operacional.
5. Use **Parar compartilhamento**, inclusive o controle nativo do navegador, ou **Sair do áudio** para encerrar a captura.
6. Para uma ligação, selecione outra pessoa conectada ao canal e clique em ligar. A pessoa pode aceitar ou recusar; quem iniciou pode cancelar. Convites sem resposta expiram em 45 segundos.

Uma ligação aceita usa uma sala separada, limitada aos dois participantes autorizados. Entrar nela encerra a participação anterior na voz do canal. Encerrar a ligação desconecta os dois lados. Não são ligações telefônicas/PSTN nem chamadas para contatos offline.

A navegação para outro canal encerra a participação de mídia atual. Uma sessão do navegador tem uma identidade de mídia por sala: abrir a mesma sala em duas abas da mesma sessão pode substituir a conexão anterior.

## Rede restrita sem remover políticas

O Chromium desta máquina tem a política gerenciada `WebRtcIPHandling=disable_non_proxied_udp`. A tentativa direta não conseguiu completar ICE. Foi configurado **TURN por TCP**, mantendo a política intacta. O relay encaminha a mídia ao SFU e a conexão passou a funcionar.

O TURN local usa TCP sem TLS apenas no loopback para desenvolvimento. Ele tem credenciais aleatórias e o relay pode alcançar o SFU na própria máquina. Essa configuração não deve ser exposta como um relay público.

## Permissões e ciclo de vida

- O backend exige sessão válida e participação na comunidade para emitir o token da sala.
- O token tem admissão de 20 segundos e só permite microfone, tela e áudio da tela; não autoriza câmera nem dados arbitrários.
- Na ligação privada, só os dois participantes podem receber um token, depois do aceite. Não é possível escolher livremente um nome de sala.
- A permissão de microfone é obtida antes de emitir o token curto, para que o tempo de decisão no prompt não expire a admissão.
- Sair da comunidade ou encerrar a sessão solicita ao SFU a remoção das conexões registradas. Sessões expiradas também são verificadas periodicamente.
- Depois de dez segundos sem nenhuma conexão de chat da conta, a mídia e as chamadas dessa conta são encerradas. A saída explícita encerra captura e conexão no cliente.
- Convites/chamadas são estado em memória de um único backend. Reinício do backend não restaura ligações. O registro de revogação também é local ao processo; a admissão JWT tem uma janela curta e não substitui uma infraestrutura de revogação distribuída.

A remoção depende da disponibilidade do serviço de mídia. Falhas de remoção e reinícios precisam de monitoramento/reconciliação numa implantação pública. Não se promete revogação distribuída instantânea nem impossibilidade de reutilizar um token já emitido durante sua curta validade. WebRTC protege o transporte, mas esta configuração não habilita criptografia ponta a ponta com chaves exclusivamente dos participantes: o SFU faz parte da infraestrutura confiável.

## Produção ou LiveKit hospedado

Execute `npm start` com estas variáveis na API, fornecidas por configuração segura do servidor:

- `LIVEKIT_URL`: endereço **wss** do serviço.
- `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`: credenciais reais do serviço, mantidas apenas no backend.
- `SECURE_COOKIES=true` sob HTTPS.

Não ative `LIVEKIT_DEV_MODE` em produção. Ele só habilita a leitura dos arquivos locais gerados. O navegador recebe um JWT limitado à sala, nunca a chave secreta da API. O LiveKit deve anunciar ICE e TURN alcançáveis pelos usuários externos. Use HTTPS/WSS e TURN/TLS com certificados válidos, políticas de firewall apropriadas e domínios liberados no ambiente. O proxy da aplicação precisa preservar Host e os upgrades de Socket.IO.

Para macOS/Windows ou uma infraestrutura diferente, use uma instalação suportada do LiveKit/um serviço hospedado e configure as variáveis acima; o instalador automatizado fornecido é para Linux amd64.

## Testes executados

Com a mídia local rodando e após `npm run build`:

```bash
npm test
npm run test:e2e
npm run test:media
```

O teste de mídia cria duas contas num banco isolado. A automação do Chromium fornece áudio sintético e um padrão sintético à API de captura de tela; a captura não é de um monitor físico. A conexão WebRTC, o SFU, o TURN e a codificação/decodificação de vídeo são reais; não há mock da transmissão. A captura exibida no relatório é o padrão de teste recebido pelo segundo cliente. Isso não mede qualidade de voz humana, latência em Internet, áudio do sistema ou todos os seletores de captura por sistema operacional.

[Relatório de mídia](evidence/media-report.json) · [Captura no receptor](evidence/media-screen.png).

A interface carrega o SDK de mídia em um chunk separado, apenas ao abrir um canal. O build informa que esse chunk supera 500 kB (cerca de 151 kB gzip); o SDK não faz parte do carregamento inicial do catálogo. Ainda faltam testes de carga, escala horizontal, observabilidade operacional e validação em redes públicas antes de uma implantação para usuários externos.
