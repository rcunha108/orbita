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


def oci(*arguments):
    result = subprocess.run(
        ['oci', *arguments, '--output', 'json'],
        text=True, capture_output=True, timeout=120,
    )
    if result.returncode:
        # No private key or credential value is supplied to the OCI CLI.
        raise AccessError('A OCI recusou o comando: ' + result.stderr.strip()[:1400])
    return json.loads(result.stdout)['data']


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
                              '--vnic-id', resource_id, '--all'))
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
    plugins = records(oci(*arguments))
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
        '--agent-config', json.dumps(config), '--force')
    wait_for('plugin Bastion', lambda: records(oci(*arguments)),
             lambda items: any(item.get('name') == 'Bastion' and item.get('status') == 'RUNNING'
                               for item in items))


def ssh_arguments(key, directory, session_id, region, address):
    if not re.fullmatch(r'ocid1\.bastionsession\.[a-zA-Z0-9_.-]+', session_id):
        raise AccessError('A OCI retornou um identificador de sessao inesperado.')
    ipaddress.ip_address(address)
    host = f'host.bastion.{region}.oci.oraclecloud.com'
    common = ['-i', str(key), '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
              '-o', 'UserKnownHostsFile=' + str(directory / 'known_hosts')]
    proxy = shlex.join(['ssh', *common, '-W', '%h:%p', '-p', '22', session_id + '@' + host])
    return ['ssh', *common, '-o', 'HostKeyAlias=orbita-' + directory.name,
            '-o', 'ProxyCommand=' + proxy, '-p', '22', 'ubuntu@' + address]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('resource_id', help='OCID da instancia (ocid1.instance.) ou VNIC (ocid1.vnic.).')
    parser.add_argument('--expected-public-ip', help='Confere se a VM tem o IP publico informado.')
    parser.add_argument('--source-cidr', help='Opcional: IPv4 publico do Cloud Shell com /32.')
    parser.add_argument('--connect', action='store_true', help='Autoriza preparar Bastion e iniciar SSH.')
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
    vnics = records(oci('compute', 'instance', 'list-vnics', '--instance-id', instance_id, '--all'))
    primary = next((vnic for vnic in vnics if (vnic.get('id') == supplied_vnic
                   if supplied_vnic else vnic.get('is-primary'))), None)
    if primary is None:
        raise AccessError('Nao foi possivel identificar a VNIC principal.')
    if args.expected_public_ip and primary.get('public-ip') != str(ipaddress.ip_address(args.expected_public_ip)):
        raise AccessError('O IP publico da instancia nao coincide com o informado. Nenhuma alteracao foi feita.')
    print('VM encontrada:', instance['display-name'], flush=True)
    if not args.connect:
        print('Modo de consulta: nenhuma chave ou recurso foi criado. Use --connect para preparar o acesso.')
        return
    cidr = source_cidr(args.source_cidr)
    enable_bastion(instance_id, instance)
    directory = Path.home() / '.ssh' / ('orbita-' + hashlib.sha256(instance_id.encode()).hexdigest()[:12])
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    key = directory / 'id_ed25519'
    if not key.exists():
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'orbita-cloudshell', '-f', str(key)], check=True)
    key.chmod(0o600)
    derived = subprocess.check_output(['ssh-keygen', '-y', '-f', str(key)])
    public = directory / 'id_ed25519.pub'
    public.write_bytes(derived)
    compartment = instance['compartment-id']
    name = directory.name
    bastions = records(oci('bastion', 'bastion', 'list', '--compartment-id', compartment, '--all'))
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
    if bastion.get('client-cidr-block-allow-list') != [cidr]:
        # This helper owns only its specifically named bastion; it never broadens access.
        oci('bastion', 'bastion', 'update', '--bastion-id', bastion_id,
            '--client-cidr-list', json.dumps([cidr]), '--force')
        wait_for('bastion', lambda: oci('bastion', 'bastion', 'get', '--bastion-id', bastion_id),
                 lambda item: item.get('lifecycle-state') == 'ACTIVE')
    state_file = directory / 'session.json'
    fingerprint = hashlib.sha256(derived).hexdigest()
    session = None
    if state_file.exists():
        saved = json.loads(state_file.read_text())
        if saved.get('bastion') == bastion_id and saved.get('key') == fingerprint:
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
        state_file.write_text(json.dumps({'bastion': bastion_id, 'session': session['id'], 'key': fingerprint}))
        state_file.chmod(0o600)
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
