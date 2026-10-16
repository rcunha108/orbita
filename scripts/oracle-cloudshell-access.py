#!/usr/bin/env python3
"""Create an expiring managed SSH session from the user's OCI Cloud Shell.

The private key is generated and retained in that Cloud Shell. This helper never
downloads a private key, opens network rules, or creates Compute instances.
"""

import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time
import urllib.request


class AccessError(Exception):
    pass


def oci(*arguments, allow_empty_list=False, allow_empty_response=False):
    command = []
    for argument in arguments:
        if argument.startswith('--'):
            break
        command.append(argument)
    label = ' '.join(command)
    result = subprocess.run(
        ['oci', *arguments, '--output', 'json'],
        text=True, capture_output=True, timeout=120,
    )
    if result.returncode:
        # No private key or credential value is supplied to the OCI CLI.
        detail = result.stderr.strip()[:1400]
        if not detail:
            # Standard output can contain resource metadata. Only an explicit
            # service error message may be included in the diagnostic.
            output = result.stdout.strip()
            if output.startswith('ServiceError:'):
                output = output[len('ServiceError:'):].strip()
            try:
                error = json.loads(output)
            except json.JSONDecodeError:
                error = {}
            if isinstance(error, dict) and 'code' in error and 'message' in error and 'data' not in error:
                detail = str(error['code']) + ': ' + str(error['message'])[:1000]
        if not detail:
            detail = 'A CLI terminou sem mensagem de erro; nenhuma resposta de recurso foi exibida.'
        status = f'sinal {-result.returncode}' if result.returncode < 0 else f'codigo {result.returncode}'
        raise AccessError(f'Falha em "oci {label}" ({status}): {detail}')
    output = result.stdout.strip()
    if not output:
        # Some OCI CLI list commands print nothing when there are no resources.
        if allow_empty_list:
            return []
        if allow_empty_response:
            return {}
        raise AccessError(f'A OCI retornou resposta vazia em: {label}.')
    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        raise AccessError(f'A OCI retornou uma resposta fora do formato JSON em: {label}.') from None
    if not isinstance(payload, dict) or 'data' not in payload:
        raise AccessError(f'A OCI retornou um formato inesperado em: {label}.')
    if payload['data'] is None:
        if allow_empty_list:
            return []
        if allow_empty_response:
            return {}
        raise AccessError(f'A OCI retornou dados ausentes em: {label}.')
    return payload['data']


def records(value):
    if isinstance(value, dict):
        value = value.get('items')
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise AccessError('A OCI retornou uma lista em formato inesperado.')
    return value


def resolve_instance(resource_id):
    if resource_id.startswith('ocid1.instance.'):
        return resource_id, None
    vnic = oci('network', 'vnic', 'get', '--vnic-id', resource_id)
    attachments = records(oci('compute', 'vnic-attachment', 'list',
                              '--compartment-id', vnic['compartment-id'],
                              '--vnic-id', resource_id, '--all', allow_empty_list=True))
    matches = [item for item in attachments if item.get('lifecycle-state') == 'ATTACHED'
               and item.get('vnic-id') == resource_id and item.get('instance-id')]
    if len(matches) != 1:
        raise AccessError('A VNIC nao identifica uma unica instancia anexada. Nenhuma alteracao foi feita.')
    return matches[0]['instance-id'], resource_id


def wait_for(label, getter, ready, timeout=360):
    deadline = time.monotonic() + timeout
    while True:
        value = getter()
        state = value.get('lifecycle-state') if isinstance(value, dict) else None
        if state in {'FAILED', 'DELETED', 'DELETING'}:
            raise AccessError(f'{label}: estado {state}. Confira os detalhes no console Oracle.')
        if ready(value):
            return value
        if time.monotonic() >= deadline:
            raise AccessError(f'{label} ainda nao ficou pronto. Aguarde alguns minutos e execute novamente.')
        print(f'Aguardando {label}...', flush=True)
        time.sleep(10)


def source_cidr(explicit=None):
    if explicit:
        network = ipaddress.ip_network(explicit, strict=True)
        if network.version != 4 or network.prefixlen != 32 or not network.network_address.is_global:
            raise AccessError('Use somente o IPv4 publico do Cloud Shell com /32.')
        return str(network)
    with urllib.request.urlopen('https://api.ipify.org', timeout=15) as response:
        address = ipaddress.ip_address(response.read(80).decode().strip())
    if address.version != 4 or not address.is_global:
        raise AccessError('Nao foi possivel identificar o IPv4 publico do Cloud Shell.')
    return str(address) + '/32'


def enable_bastion(instance_id, instance):
    compartment = instance['compartment-id']
    arguments = ('instance-agent', 'plugin', 'list', '--instanceagent-id', instance_id,
                 '--compartment-id', compartment, '--all')
    plugins = records(oci(*arguments, allow_empty_list=True))
    bastion = next((plugin for plugin in plugins if plugin.get('name') == 'Bastion'), None)
    if bastion is None or bastion.get('status') == 'NOT_SUPPORTED':
        raise AccessError('A imagem nao informou suporte ao plugin Bastion. Nenhum bastion foi criado.')
    if bastion.get('status') == 'RUNNING':
        return
    current = instance.get('agent-config') or {}
    if current.get('are-all-plugins-disabled'):
        raise AccessError('O Oracle Cloud Agent esta desativado. Ative o agent/plugin Bastion pelo console primeiro.')
    config = {}
    for old, new in [('are-all-plugins-disabled', 'areAllPluginsDisabled'),
                     ('is-management-disabled', 'isManagementDisabled'),
                     ('is-monitoring-disabled', 'isMonitoringDisabled')]:
        if current.get(old) is not None:
            config[new] = current[old]
    entries = [
        {'name': item['name'], 'desiredState': item['desired-state']}
        for item in current.get('plugins-config') or []
        if item.get('name') != 'Bastion'
    ]
    entries.append({'name': 'Bastion', 'desiredState': 'ENABLED'})
    config['pluginsConfig'] = entries
    print('Ativando apenas o plugin Bastion; as outras configuracoes do agent serao preservadas.', flush=True)
    oci('compute', 'instance', 'update', '--instance-id', instance_id,
        '--agent-config', json.dumps(config), '--force', allow_empty_response=True)
    wait_for('plugin Bastion', lambda: records(oci(*arguments, allow_empty_list=True)),
             lambda items: any(item.get('name') == 'Bastion' and item.get('status') == 'RUNNING'
                               for item in items))


def ssh_arguments(key, directory, session_id, region, address, diagnostic=False):
    if not re.fullmatch(r'ocid1\.bastionsession\.[a-zA-Z0-9_.-]+', session_id):
        raise AccessError('A OCI retornou um identificador de sessao inesperado.')
    ipaddress.ip_address(address)
    host = f'host.bastion.{region}.oci.oraclecloud.com'
    common = ['-i', str(key), '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
              '-o', 'UserKnownHostsFile=' + str(directory / 'known_hosts')]
    if diagnostic:
        common += ['-v', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
                   '-o', 'ConnectionAttempts=1']
    proxy = shlex.join(['ssh', *common, '-W', '%h:%p', '-p', '22', session_id + '@' + host])
    return ['ssh', *common, '-o', 'HostKeyAlias=orbita-' + directory.name,
            '-o', 'ProxyCommand=' + proxy, '-p', '22', 'ubuntu@' + address]


def access_directory(instance_id):
    return Path.home() / '.ssh' / ('orbita-' + hashlib.sha256(instance_id.encode()).hexdigest()[:12])


def diagnose_access(instance_id, instance, primary, region):
    directory = access_directory(instance_id)
    state_file = directory / 'session.json'
    if not state_file.is_file():
        raise AccessError('Nao existe cache de sessao neste Cloud Shell. Execute --connect primeiro.')
    try:
        saved = json.loads(state_file.read_text())
    except json.JSONDecodeError:
        raise AccessError('O cache de sessao esta incompleto. Execute --connect para recupera-lo.') from None
    if not isinstance(saved, dict) or not saved.get('bastion') or not saved.get('session'):
        raise AccessError('O cache nao identifica uma sessao. Execute --connect para recupera-lo.')
    bastion = oci('bastion', 'bastion', 'get', '--bastion-id', saved['bastion'])
    session = oci('bastion', 'session', 'get', '--session-id', saved['session'])
    if session.get('bastion-id') != bastion.get('id'):
        raise AccessError('A sessao em cache nao pertence ao bastion informado.')
    plugins = records(oci('instance-agent', 'plugin', 'list', '--instanceagent-id', instance_id,
                          '--compartment-id', instance['compartment-id'], '--all', allow_empty_list=True))
    plugin = next((item for item in plugins if item.get('name') == 'Bastion'), {})
    current = source_cidr()
    allowlist = bastion.get('client-cidr-block-allow-list') or []
    print('Diagnostico sem criar recursos ou alterar regras:', flush=True)
    print('Plugin Bastion:', plugin.get('status', 'nao informado'), flush=True)
    print('Estado do bastion:', bastion.get('lifecycle-state'), flush=True)
    print('Estado da sessao:', session.get('lifecycle-state'), flush=True)
    print('Inicio da sessao:', session.get('time-created'), flush=True)
    print('Duracao da sessao:', session.get('session-ttl-in-seconds'), 'segundos', flush=True)
    print('IPv4 de saida HTTPS atual:', current, flush=True)
    print('Origens permitidas no bastion:', ', '.join(allowlist), flush=True)
    print('IPv4 HTTPS coincide com a regra:', 'sim' if current in allowlist else 'nao', flush=True)
    print('Origem registrada na sessao em cache:', saved.get('source-cidr', 'nao registrada'), flush=True)
    print('IP privado de destino:', primary['private-ip'], flush=True)
    print('IP privado do bastion:', bastion.get('private-endpoint-ip-address', 'nao informado'), flush=True)
    if session.get('lifecycle-state') != 'ACTIVE':
        print('A sessao nao esta ativa; nao sera feita tentativa SSH.', flush=True)
        return
    key = directory / 'id_rsa_3072'
    if not key.is_file():
        raise AccessError('A chave RSA da sessao nao foi encontrada. Nenhuma nova chave foi criada.')
    derived = subprocess.check_output(['ssh-keygen', '-y', '-f', str(key)])
    if hashlib.sha256(derived).hexdigest() != saved.get('key'):
        raise AccessError('A chave local difere da sessao em cache. Execute --connect para criar a sessao correta.')
    print('Chave local corresponde ao cache da sessao: sim', flush=True)
    print('Testando autenticacao SSH com o comando remoto true...', flush=True)
    arguments = ssh_arguments(key, directory, session['id'], region, primary['private-ip'], diagnostic=True)
    try:
        result = subprocess.run([*arguments, 'true'], text=True, capture_output=True, timeout=45)
    except subprocess.TimeoutExpired:
        raise AccessError('O teste SSH excedeu 45 segundos. Confira a conectividade Bastion -> VM na porta 22.') from None
    print('Resultado SSH:', result.returncode, flush=True)
    patterns = ('Connecting to ', 'Remote protocol version', 'Offering public key', 'Server accepts key',
                'Authenticated to ', 'Authentications that can continue', 'sign_and_send_pubkey',
                'no mutual', 'no matching', 'Permission denied', 'Connection closed',
                'closed by remote host', 'kex_exchange_identification', 'connect failed', 'open failed',
                'administratively prohibited', 'Connection timed out', 'Host key verification failed')
    selected = [line for line in result.stderr.splitlines() if any(term in line for term in patterns)]
    for line in selected[-40:]:
        print(line, flush=True)
    if result.returncode == 0:
        print('Autenticacao ate a VM confirmada. Execute --connect para abrir o terminal.', flush=True)


def prepare_key(directory):
    # Cloud Shell can enforce FIPS: use RSA and keep any older ED25519 key intact.
    key = directory / 'id_rsa_3072'
    if not key.exists():
        subprocess.run(['ssh-keygen', '-q', '-t', 'rsa', '-b', '3072', '-N', '',
                        '-C', 'orbita-cloudshell', '-f', str(key)], check=True)
    key.chmod(0o600)
    derived = subprocess.check_output(['ssh-keygen', '-y', '-f', str(key)])
    if derived.split()[0] != b'ssh-rsa':
        raise AccessError('A chave existente id_rsa_3072 nao e RSA. Nenhuma chave foi substituida.')
    public = directory / 'id_rsa_3072.pub'
    public.write_bytes(derived)
    return key, public, derived


def can_reuse_session(saved, bastion_id, fingerprint, cidr, allowlist_changed):
    # OCI snapshots the bastion allowlist for each session. Changing the bastion
    # does not update an existing session, even if its lifecycle state is ACTIVE.
    return (not allowlist_changed and saved.get('bastion') == bastion_id
            and saved.get('key') == fingerprint and saved.get('source-cidr') == cidr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('resource_id', help='OCID da instancia (ocid1.instance.) ou VNIC (ocid1.vnic.).')
    parser.add_argument('--expected-public-ip', help='Confere se a VM tem o IP publico informado.')
    parser.add_argument('--source-cidr', help='Opcional: IPv4 publico do Cloud Shell com /32.')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--connect', action='store_true', help='Autoriza preparar Bastion e iniciar SSH.')
    mode.add_argument('--diagnose', action='store_true', help='Consulta a sessao existente e testa SSH sem criar recursos.')
    args = parser.parse_args()
    match = re.fullmatch(r'ocid1\.(?:instance|vnic)\.oc1\.([a-z0-9-]+)\.[a-zA-Z0-9.]+', args.resource_id)
    if not match:
        raise AccessError('Informe o OCID da instancia ou VNIC, comecando com ocid1.instance.oc1. ou ocid1.vnic.oc1.')
    if not shutil.which('oci') or not shutil.which('ssh-keygen') or not shutil.which('ssh'):
        raise AccessError('Execute este helper no Oracle Cloud Shell, onde OCI CLI e SSH estao instalados.')
    os.umask(0o077)
    os.environ['OCI_CLI_REGION'] = match.group(1)
    instance_id, supplied_vnic = resolve_instance(args.resource_id)
    instance = oci('compute', 'instance', 'get', '--instance-id', instance_id)
    if instance['lifecycle-state'] != 'RUNNING':
        raise AccessError('A instancia precisa estar Running.')
    vnics = records(oci('compute', 'instance', 'list-vnics', '--instance-id', instance_id,
                        '--all', allow_empty_list=True))
    primary = next((vnic for vnic in vnics if (vnic.get('id') == supplied_vnic
                   if supplied_vnic else vnic.get('is-primary'))), None)
    if primary is None:
        raise AccessError('Nao foi possivel identificar a VNIC principal.')
    if args.expected_public_ip and primary.get('public-ip') != str(ipaddress.ip_address(args.expected_public_ip)):
        raise AccessError('O IP publico da instancia nao coincide com o informado. Nenhuma alteracao foi feita.')
    print('VM encontrada:', instance['display-name'], flush=True)
    if args.diagnose:
        diagnose_access(instance_id, instance, primary, match.group(1))
        return
    if not args.connect:
        print('Modo de consulta: nenhuma chave ou recurso foi criado. Use --connect para preparar o acesso.')
        return
    cidr = source_cidr(args.source_cidr)
    print('Verificando plugin Bastion...', flush=True)
    enable_bastion(instance_id, instance)
    directory = access_directory(instance_id)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    print('Preparando chave RSA no Cloud Shell...', flush=True)
    key, public, derived = prepare_key(directory)
    compartment = instance['compartment-id']
    name = directory.name
    print('Consultando bastions existentes...', flush=True)
    bastions = records(oci('bastion', 'bastion', 'list', '--compartment-id', compartment,
                           '--all', allow_empty_list=True))
    candidates = [item for item in bastions if item.get('name') == name
                  and item.get('target-subnet-id') == primary['subnet-id']
                  and item.get('lifecycle-state') in {'ACTIVE', 'CREATING'}]
    if len(candidates) > 1:
        raise AccessError('Ha mais de um bastion com esse nome. Revise no console antes de continuar.')
    if candidates:
        bastion_id = candidates[0]['id']
    else:
        print('Criando Oracle Bastion para esta VM; acesso restrito ao Cloud Shell (/32).', flush=True)
        result = oci('bastion', 'bastion', 'create', '--bastion-type', 'standard',
                     '--compartment-id', compartment, '--target-subnet-id', primary['subnet-id'],
                     '--client-cidr-list', json.dumps([cidr]), '--max-session-ttl', '3600', '--name', name)
        bastion_id = result['id']
    bastion = wait_for('bastion', lambda: oci('bastion', 'bastion', 'get', '--bastion-id', bastion_id),
                       lambda item: item.get('lifecycle-state') == 'ACTIVE')
    allowlist_changed = bastion.get('client-cidr-block-allow-list') != [cidr]
    if allowlist_changed:
        # This helper owns only its specifically named bastion; it never broadens access.
        oci('bastion', 'bastion', 'update', '--bastion-id', bastion_id,
            '--client-cidr-list', json.dumps([cidr]), '--force', allow_empty_response=True)
        wait_for('bastion', lambda: oci('bastion', 'bastion', 'get', '--bastion-id', bastion_id),
                 lambda item: item.get('lifecycle-state') == 'ACTIVE')
    state_file = directory / 'session.json'
    fingerprint = hashlib.sha256(derived).hexdigest()
    session = None
    if state_file.exists():
        try:
            saved = json.loads(state_file.read_text())
        except json.JSONDecodeError:
            print('Cache de sessao incompleto; as chaves serao preservadas e o cache sera reconstruido.', flush=True)
            saved = {}
        if not isinstance(saved, dict):
            saved = {}
        if can_reuse_session(saved, bastion_id, fingerprint, cidr, allowlist_changed):
            previous = oci('bastion', 'session', 'get', '--session-id', saved['session'])
            if (previous.get('bastion-id') == bastion_id
                    and previous.get('lifecycle-state') in {'ACTIVE', 'CREATING'}):
                session = previous
    if session is None:
        print('Criando sessao Managed SSH com validade de uma hora.', flush=True)
        session = oci('bastion', 'session', 'create-managed-ssh', '--bastion-id', bastion_id,
                      '--key-type', 'PUB', '--ssh-public-key-file', str(public),
                      '--target-resource-id', instance_id, '--target-os-username', 'ubuntu',
                      '--target-private-ip', primary['private-ip'], '--target-port', '22', '--session-ttl', '3600')
        temporary = state_file.with_suffix('.tmp')
        temporary.write_text(json.dumps({'bastion': bastion_id, 'session': session['id'],
                                         'key': fingerprint, 'source-cidr': cidr}))
        temporary.chmod(0o600)
        temporary.replace(state_file)
    session = wait_for('sessao SSH', lambda: oci('bastion', 'session', 'get', '--session-id', session['id']),
                       lambda item: item.get('lifecycle-state') == 'ACTIVE')
    print('Sessao pronta. A chave privada permanece neste Cloud Shell. Abrindo a VM...', flush=True)
    arguments = ssh_arguments(key, directory, session['id'], match.group(1), primary['private-ip'])
    os.execvp(arguments[0], arguments)


if __name__ == '__main__':
    try:
        main()
    except (AccessError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
