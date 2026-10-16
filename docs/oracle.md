# Hospedar o Órbita na Oracle Cloud

Criar a conta Oracle não cria automaticamente uma máquina virtual. A implantação precisa de uma instância Compute acessível por SSH, um endereço público, HTTPS e as credenciais do LiveKit no backend. Este guia mantém o banco SQLite em volume persistente e usa uma única réplica do aplicativo.

## 1. Criar uma máquina elegível ao Always Free

No console Oracle, abra **Compute → Instances → Create instance**. Use Ubuntu 24.04 LTS oficial compatível com a arquitetura escolhida. Uma instância ARM **VM.Standard.A1.Flex**, com 1 OCPU e 6 GB de memória, é uma configuração inicial possível dentro das franquias Always Free, desde que o console confirme elegibilidade e disponibilidade e sua conta tenha cota livre. Use somente recursos e disco dentro da franquia gratuita mostrada no console. A disponibilidade varia por região e a conta gratuita não garante capacidade nem continuidade de instâncias ociosas.

Configure uma subnet pública, uma rota para Internet Gateway e a atribuição de IPv4 público. Em **Add SSH keys**, escolha a opção de fornecer sua chave pública. A chave pública entregue pelo responsável pela implantação autoriza a conexão; guarde a chave privada fora do repositório e não envie senhas ou chaves privadas pelo chat. O usuário padrão da imagem Ubuntu é `ubuntu`.

Depois de a instância ficar **Running**, informe o IPv4 público ao responsável pela implantação. Se o console não oferecer capacidade Always Free, não selecione uma máquina paga para contornar a falta de capacidade.

## 2. Permitir o tráfego necessário

Na Security List ou no NSG associado à interface da instância, permita entrada TCP **80** e **443** da internet (`0.0.0.0/0`) para a aplicação pública. A porta **22** serve para administração SSH; restrinja a origem ao endereço ou à rede de quem fará a configuração. Preserve as regras existentes necessárias e confira também o firewall do Ubuntu. Não exponha a porta 3001, o SQLite ou a API administrativa do Caddy.

O app se conecta ao LiveKit Cloud por saída HTTPS/WSS. Os navegadores também precisam alcançar o serviço de mídia e seus endpoints de transporte. Não é necessário instalar LiveKit ou TURN nesta VM quando se usa LiveKit Cloud.

## 3. Preparar Docker e código

### Acesso pelo Cloud Shell sem transferir chave privada

Se o ambiente desta conversa não consegue abrir SSH ou os links de download da chave não funcionam, é possível usar uma **sessão Managed SSH do Oracle Bastion**. A chave é gerada diretamente no seu Cloud Shell e permanece nele; a autorização temporária na VM é feita pelo plugin Bastion, sem depender da chave que foi adicionada na criação da instância. Bastion é um serviço listado no Free Tier da Oracle; não é necessário criar outra instância, disco ou gateway pago para esse acesso. Confira os termos atuais da conta.

O helper abaixo usa a autenticação da OCI CLI já disponível no Cloud Shell. Por padrão, ele consulta a VM e não cria recursos. Aceita o OCID da instância ou da VNIC. Substitua `OCID-DA-INSTANCIA-OU-VNIC` pelo identificador do console:

```bash
git clone https://github.com/rcunha108/orbita.git ~/orbita-acesso
python3 ~/orbita-acesso/scripts/oracle-cloudshell-access.py OCID-DA-INSTANCIA-OU-VNIC --expected-public-ip 163.176.214.149
```

Para autorizar a preparação do acesso, repita o segundo comando com `--connect`. Isso ativa o plugin Bastion preservando as outras configurações do Oracle Cloud Agent, cria ou reutiliza um bastion específico dessa VM, restringe a origem ao IPv4 público atual do Cloud Shell (`/32`) e cria uma sessão de uma hora. A identificação do IPv4 usa `api.ipify.org` por HTTPS; `--source-cidr IP/32` permite informá-lo explicitamente. O SSH mantém a verificação de identidade e registra a primeira conexão em um arquivo `known_hosts` próprio.

Pré-requisitos: imagem Linux com Oracle Cloud Agent e suporte ao plugin Bastion, permissões OCI para os recursos, gateway/rota já existentes e acesso TCP 22 do endereço privado do Bastion à VM. O helper não modifica Security Lists, NSGs ou o firewall. Se algum requisito estiver ausente, ele informa o erro e para; não recrie a VM nem substitua uma instância gratuita por uma paga para contornar a falha.

O helper é preparação de acesso, não uma comprovação de implantação: a consulta e a conexão precisam ser executadas na sua conta Oracle. Ele não instala o Órbita automaticamente. A sessão expira após uma hora; o bastion pode ser removido pelo console quando não for mais necessário.

Verificações locais do helper: `python3 -m unittest discover -s tests -p oracle_access_test.py -v`. Os testes simulam respostas da OCI para verificar a resolução da VNIC, impedir alterações no modo de consulta ou em uma VM com IP diferente, preservar configurações do agent e recusar uma origem mais ampla que `/32`. Esses testes não criam recursos nem comprovam conectividade na sua conta.

### Instalação dentro da VM

Após entrar por SSH, obtenha o repositório e execute o helper no servidor:

```bash
git clone https://github.com/rcunha108/orbita.git ~/orbita-setup
sudo bash ~/orbita-setup/scripts/prepare-oracle-vm.sh
```

O script aceita Ubuntu 24.04, instala pacotes dos repositórios do sistema, ativa o Docker e prepara `/opt/orbita`. Ele preserva o arquivo de ambiente já existente, não redefine alterações do Git, não altera regras de firewall e não inicia o aplicativo automaticamente. A instalação de pacotes deve ocorrer apenas na VM destinada ao Órbita, não em outra máquina existente sem revisar seu estado.

## 4. Configurar HTTPS e LiveKit

Defina um hostname que resolva para o IPv4 público da VM. Pode ser um domínio próprio ou um hostname de DNS gratuito. Um serviço como `sslip.io` permite um nome no formato `orbita.IP-PUBLICO.sslip.io`; substitua `IP-PUBLICO` pelos quatro números do endereço, separados por pontos. Confira resolução DNS, disponibilidade e limites do serviço. Esse endereço não é reservado ao seu produto e deixa de apontar corretamente se o IP mudar.

No servidor, edite o arquivo privado:

```bash
sudo nano /opt/orbita/.env.oracle
sudo chmod 600 /opt/orbita/.env.oracle
```

Preencha `ORBITA_DOMAIN` com o hostname do **chat**, sem `https://` nem caminhos. `LIVEKIT_URL` já contém `wss://orbita-06z7utuf.livekit.cloud`. Insira `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET` reais do mesmo projeto diretamente no arquivo privado do servidor. Não envie as chaves em conversas e não as coloque no código, instalador ou arquivos de exemplo.

## 5. Iniciar

```bash
cd /opt/orbita
sudo docker compose --env-file .env.oracle -f deploy/oracle/compose.yaml up -d --build
sudo docker compose --env-file .env.oracle -f deploy/oracle/compose.yaml ps
sudo docker compose --env-file .env.oracle -f deploy/oracle/compose.yaml exec app npm run media:check
```

O Caddy solicita e renova certificados HTTPS automaticamente. DNS e portas 80/443 precisam estar corretos para isso. O banco e os certificados ficam em volumes Docker nomeados. **Não use `down -v`**: esse comando remove os volumes e pode apagar contas, mensagens e certificados. Faça backups do banco com o app parado ou com uma ferramenta de backup consistente do SQLite.

O verificador confirma apenas a autenticação da API LiveKit. Teste o endereço HTTPS público, cadastro, mensagem entre duas contas, áudio em dois sentidos, ligação aceita e tela entre dispositivos reais. Não considere mídia validada apenas porque o healthcheck passou.

## 6. Conectar os computadores

Use o mesmo endereço HTTPS público do chat em todos os instaladores, por meio do `serverUrl` em [Windows](windows.md). O endereço `wss://` do LiveKit não substitui o endereço HTTPS do chat. As contas locais não são migradas automaticamente.

## Estado da preparação

Os arquivos de implantação podem ser verificados localmente, mas isso não cria a instância Oracle, concede acesso SSH, abre portas na nuvem ou emite certificados públicos. Esses passos dependem da instância, do IP e da configuração do projeto. Registre autenticação Cloud, certificado e testes entre dispositivos como pendentes até executá-los de fato.

O [relatório de preparação](evidence/oracle-preparation-report.json) registra os testes locais do Compose, healthcheck, cadastro e persistência após reinício. O Caddyfile também passou na validação do Caddy. O helper de preparação Ubuntu foi conferido quanto à sintaxe; sua execução na VM Oracle ainda depende da criação da instância e do acesso SSH.
