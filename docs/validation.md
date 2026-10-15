# Validação da entrega

## Resultados executados

| Verificação                                  | Resultado                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Instalação com `npm ci --no-audit --no-fund` | Concluída com o lockfile, incluindo uma reinstalação de verificação                               |
| `npm run build`                              | Tipos de frontend/backend verificados e versão de produção compilada                              |
| `npm test`                                   | 12 testes aprovados, zero falhas, zero ignorados                                                  |
| `npm run test:e2e`                           | 12 grupos de verificações de navegador aprovados; nenhum erro JavaScript de página                |
| `npm run format:check`                       | Código e documentação formatados com Prettier                                                     |
| Inicialização com `npm run dev`              | Frontend e API iniciados, respostas HTTP funcionais verificadas                                   |
| Proxy de desenvolvimento                     | HTML, saúde da API, busca `programacao` e entrada/saída da comunidade verificados através do Vite |

Ferramentas verificadas: Node.js **24.18.0 e 24.19.0**, npm **11.16.0 e 11.9.0**, Chromium **154.0.8037.57**. A reinstalação e a validação final usaram a versão de Node/npm fixada no ambiente. O npm 11.16 reporta o postinstall de esbuild como pendente de aprovação; os comandos de compilação, testes e desenvolvimento aqui executados funcionaram sem desabilitar verificações de integridade ou aprovar scripts adicionais.

## Testes de API e banco

1. Consultas Unicode, prefixos, combinação de palavras e pontuação/operadores tratados como entrada textual.
2. Categorias, contagens e paginação estável; validação de parâmetros e ordenação.
3. Descoberta de canais e associação à comunidade/categoria correta.
4. Entrada/saída idempotente, atualização de contagens e validação da participação antes do envio.
5. Histórico por cursor exclusivo sem perda nem duplicação entre páginas.
6. Persistência de mensagens e participações após fechar e reabrir o banco.
7. Respostas HTTP de descoberta e erros úteis.
8. Fluxo HTTP de participação, envio, leitura e saída.
9. Rejeição de origens externas em escritas, JSON inválido, tipos de conteúdo incorretos e corpo com tamanho excessivo.

## Fluxos de navegador

[Relatório produzido pelo teste](evidence/browser-report.json).

- Catálogo inicial com seis cartões por página e 12 comunidades no total.
- Busca sem acentos e retorno à primeira página ao mudar a consulta.
- Categorias e descoberta de canais.
- Estado vazio, limpeza de filtros e ordenação.
- Resposta antiga e atrasada não sobrescreve a consulta atual.
- Falha de rede simulada é exibida e a nova tentativa funciona.
- Participação habilita o compositor; mensagem permanece após recarregar e HTML é exibido como texto.
- Navegação, biblioteca de comunidades e saída removem o acesso de escrita.
- Viewport móvel de 390 px sem transbordamento horizontal, com diálogo e canais funcionais.

Os testes de navegador usam a versão de produção do frontend, uma API real e uma base SQLite em memória, isolada dos dados da aplicação em desenvolvimento. Os testes do banco incluem persistência em um arquivo temporário. As duas verificações de origem — HTTP direto e através do Vite — preservam a validação de origem da API.

## Nova etapa: autenticação e tempo real

As validações de servidor incluem senhas, expiração de sessão, logout e dois clientes Socket.IO reais. O teste de navegador inclui duas contas independentes, entrega ao vivo, presença, digitação, revogação e recuperação de 35 mensagens após interrupção de WebSocket. Consulte [a arquitetura e os limites](realtime.md).

## Nova etapa: mídia real

O teste `npm run test:media` verificou áudio WebRTC entre duas contas, silenciar/ativar, quadros sintéticos da API de captura de tela decodificados no receptor, chamadas com recusa/aceite/encerramento e revogação ao sair da comunidade. Áudio e quadros capturados são sintéticos na automação; a transmissão usa LiveKit 1.13.10 e coturn 4.6.3 reais. A política WebRTC do Chromium foi preservada, usando TURN/TCP. [Relatório](evidence/media-report.json) e [configuração](media.md).

## Capturas do próprio Órbita

- [Descoberta no desktop](evidence/desktop.png)
- [Canal e mensagens](evidence/conversation.png)
- [Chat em tempo real após reconexão](evidence/realtime.png)
- [Compartilhamento de tela no receptor](evidence/media-screen.png)
- [Descoberta no celular](evidence/mobile.png)

As capturas são do app criado nesta entrega. Elas **não são evidências de uma sessão no Discord**.

## Limites

Sem validação de paridade com Discord, implantação pública multiusuário, auditoria completa de acessibilidade ou teste de carga. Autenticação e chat em tempo real estão implementados e testados com contas isoladas. Ainda não há recuperação de conta ou moderação. A mídia usa LiveKit e TURN locais, com testes específicos descritos abaixo. Os dados do catálogo são fictícios. A entrega foi validada nesta máquina; publicação, implantação externa e restauração em outra tarefa não foram executadas.
