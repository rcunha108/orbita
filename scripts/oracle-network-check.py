#!/usr/bin/env python3
"""Read the network rules for a VNIC and its cached Bastion; never modify them."""

import argparse
import ipaddress
import json
from pathlib import Path
import runpy
import sys


def tcp_rules(rules):
    return [rule for rule in rules if str(rule.get('protocol')) in {'6', 'all'}]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('vnic_id')
    args = parser.parse_args()
    if not args.vnic_id.startswith('ocid1.vnic.oc1.'):
        raise ValueError('Informe o OCID da VNIC da instancia.')
    helper = Path(__file__).with_name('oracle-cloudshell-access.py')
    if not helper.is_file():
        helper = Path.home() / 'orbita-acesso.py'
    module = runpy.run_path(str(helper))
    oci = module['oci']
    records = module['records']
    module['os'].environ['OCI_CLI_REGION'] = args.vnic_id.split('.')[3]
    instance_id, _ = module['resolve_instance'](args.vnic_id)
    state_file = module['access_directory'](instance_id) / 'session.json'
    state = json.loads(state_file.read_text())
    bastion = oci('bastion', 'bastion', 'get', '--bastion-id', state['bastion'])
    vnic = oci('network', 'vnic', 'get', '--vnic-id', args.vnic_id)
    subnet = oci('network', 'subnet', 'get', '--subnet-id', vnic['subnet-id'])
    source = str(ipaddress.ip_address(bastion['private-endpoint-ip-address']))
    report = {
        'read_only': True,
        'bastion_private_ip': source,
        'vm_private_ip': vnic['private-ip'],
        'subnet': subnet.get('display-name'),
        'security_lists': [],
        'network_security_groups': [],
    }
    for identifier in subnet.get('security-list-ids') or []:
        item = oci('network', 'security-list', 'get', '--security-list-id', identifier)
        report['security_lists'].append({
            'name': item.get('display-name'),
            'ingress_tcp_or_all': tcp_rules(item.get('ingress-security-rules') or []),
            'egress_tcp_or_all': tcp_rules(item.get('egress-security-rules') or []),
        })
    for identifier in vnic.get('nsg-ids') or []:
        rules = records(oci('network', 'nsg', 'rules', 'list',
                            '--network-security-group-id', identifier, '--all', allow_empty_list=True))
        report['network_security_groups'].append({'id': identifier, 'tcp_or_all': tcp_rules(rules)})
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Falha na consulta de rede: ' + str(error), file=sys.stderr)
        sys.exit(1)
