# Instalador Windows

O arquivo `release/Orbita-Setup-0.1.0-x64.exe` instala o Órbita por usuário em Windows 10/11 x64, com Node.js 24.18.0 incluído. O usuário não precisa instalar Node.js, Docker ou pacotes npm. A interface abre no navegador padrão; recomendamos Edge ou Chrome atualizado. É um instalador para o aplicativo web com servidor local e iniciador nativo, sem Electron.

## Instalar e abrir

1. Execute o instalador e conclua o assistente em português.
2. Abra o atalho **Órbita**, na área de trabalho ou no menu Iniciar.
3. Crie uma conta pela interface. Não existem contas padrão.
4. Use **Encerrar Órbita**, no menu Iniciar, para desligar o servidor. Fechar a aba mantém o processo local ativo.

O instalador não exige privilégios de administrador. Os programas ficam em `%LOCALAPPDATA%\Programs\Orbita`; o banco fica em `%LOCALAPPDATA%\Orbita\orbita.sqlite`. A desinstalação preserva esse banco. Para fazer backup, encerre o Órbita antes de copiar a pasta de dados. Falhas de inicialização são registradas em `startup-error.log` na mesma pasta.

O iniciador nativo `Orbita.exe` abre o runtime sem console e a API escuta exclusivamente em `127.0.0.1:31043`. Um canal de controle local reaproveita o processo nas próximas aberturas e permite encerrá-lo. O pacote contém somente a interface compilada, o servidor compilado em um arquivo, o runtime oficial, o iniciador, ícone e avisos de licença. Não contém banco de desenvolvimento, contas, chaves, ferramentas Linux ou dependências de desenvolvimento.

## Conversar entre computadores

Cada instalação em modo local possui contas e mensagens próprias. **Instalar em dois computadores não os conecta.** Os serviços LiveKit e TURN usados no desenvolvimento Linux não estão incluídos no EXE. Voz, ligações e compartilhamento de tela ficam indisponíveis no modo local.

Para acessar um servidor Órbita compartilhado já publicado com HTTPS, crie `%LOCALAPPDATA%\Orbita\server.json`:

```json
{ "serverUrl": "https://seu-servidor.example" }
```

Substitua o exemplo pelo endereço real, encerre o Órbita e reabra. Nesse modo o iniciador abre a aplicação do servidor e não inicia uma API local. O endereço deve usar HTTPS e não pode conter credenciais, consulta ou fragmento. Remover o arquivo restaura o modo local. O banco local não é migrado para o servidor. Nenhuma credencial LiveKit deve ser distribuída aos computadores; ela pertence ao backend compartilhado. [Requisitos do servidor de mídia](media.md).

## Gerar novamente na nuvem

Neste ambiente Debian 13 amd64:

```bash
cd /workspace/orbita
export npm_config_cache=/workspace/.npm-cache
npm ci
npm run windows:tools
npm run build:windows
npm run test:windows-package
```

`windows:tools` baixa NSIS e MinGW de repositório Debian com verificação de assinatura e checksums do APT, extraindo-os sem modificar o sistema. Requer os utilitários Debian, o chaveiro oficial e bibliotecas Linux compatíveis. A pasta padrão das ferramentas é `/workspace/.tools/windows-build`. `WINDOWS_BUILD_TOOLS`, `WINDOWS_CC`, `MAKENSIS` e `NSISDIR` permitem selecionar ferramentas equivalentes instaladas em outros locais. A geração do pacote é destinada a Linux; não foi criada uma cadeia de build nativa para Windows.

`build:windows` executa a verificação TypeScript, compila a interface e o backend, baixa o ZIP oficial do Node para Windows x64, confere seu SHA-256 fixado e compila o iniciador C com MinGW. O NSIS gera o instalador; avisos do compilador do instalador são tratados como erros. A versão do instalador está fixada em `desktop/installer.nsi` e deve acompanhar `package.json` em futuras versões.

Artefatos: instalador `.exe`, checksum `.sha256`, pasta `release/windows-x64` e `release/windows-manifest.json` com hashes de todos os arquivos distribuídos. `release/` é ignorado no código-fonte.

## Evidências e limites

O build cruzado do instalador foi executado em Linux. O relatório [windows-package-report.json](evidence/windows-package-report.json) cobre cinco grupos: interface de produção e mídia local desativada, cadastro/WebSocket/mensagens, reutilização de processo, persistência após encerrar/reabrir e modo remoto HTTPS. O teste copia o servidor e a interface para uma pasta temporária fora do projeto, sem `node_modules` acessível pela árvore do pacote.

Os 12 testes do backend e o build TypeScript também passaram. A integridade do conteúdo do instalador é conferida por extração e comparação com o manifesto. Isso não substitui executar o instalador: **instalação, atalhos, abertura do navegador e desinstalação ainda precisam de validação em Windows real**. O relatório identifica o host Linux e não afirma teste Windows.

O instalador não possui certificado de assinatura de editor. Para distribuição pública, o próximo passo é validar em Windows e assinar com um certificado do responsável pelo produto.
