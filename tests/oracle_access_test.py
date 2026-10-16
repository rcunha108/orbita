import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    'oracle_access', Path(__file__).resolve().parents[1] / 'scripts/oracle-cloudshell-access.py'
)
ACCESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ACCESS)
INSTANCE = 'ocid1.instance.oc1.sa-saopaulo-1.testinstance'
VNIC = 'ocid1.vnic.oc1.sa-saopaulo-1.testvnic'


class OracleAccessTests(unittest.TestCase):
    def test_empty_oci_lists_are_allowed_only_for_explicit_list_calls(self):
        for output in ['', ' \n', '{"data": null}']:
            result = subprocess.CompletedProcess([], 0, output, '')
            with self.subTest(output=output), patch.object(ACCESS.subprocess, 'run', return_value=result):
                self.assertEqual(ACCESS.oci('bastion', 'bastion', 'list', allow_empty_list=True), [])
                self.assertEqual(ACCESS.oci('bastion', 'bastion', 'update', allow_empty_response=True), {})
                with self.assertRaisesRegex(ACCESS.AccessError, 'bastion bastion get'):
                    ACCESS.oci('bastion', 'bastion', 'get')

    def test_oci_malformed_output_reports_command_without_disclosing_response(self):
        for output in ['sensitive-response-must-not-be-disclosed', '{}', '[]']:
            result = subprocess.CompletedProcess([], 0, output, '')
            with self.subTest(output=output), patch.object(ACCESS.subprocess, 'run', return_value=result):
                with self.assertRaises(ACCESS.AccessError) as raised:
                    ACCESS.oci('bastion', 'bastion', 'list', allow_empty_list=True)
                self.assertIn('bastion bastion list', str(raised.exception))
                self.assertNotIn('sensitive-response', str(raised.exception))

    def test_vnic_lookup_accepts_only_one_attached_instance(self):
        for attachments, expected in [
            ([], None),
            ([{'vnic-id': VNIC, 'instance-id': INSTANCE, 'lifecycle-state': 'DETACHED'}], None),
            ([{'vnic-id': VNIC, 'instance-id': INSTANCE, 'lifecycle-state': 'ATTACHED'}], INSTANCE),
        ]:
            with self.subTest(attachments=attachments), patch.object(
                ACCESS, 'oci', side_effect=[{'compartment-id': 'compartment'}, attachments]
            ) as client:
                if expected:
                    self.assertEqual(ACCESS.resolve_instance(VNIC), (INSTANCE, VNIC))
                else:
                    with self.assertRaises(ACCESS.AccessError):
                        ACCESS.resolve_instance(VNIC)
                self.assertEqual(client.call_count, 2)
                self.assertEqual(client.call_args.args[:3], ('compute', 'vnic-attachment', 'list'))

    def test_query_and_wrong_ip_do_not_modify_resources_or_create_keys(self):
        for expected_ip, should_fail in [('163.176.214.149', False), ('163.176.214.150', True)]:
            with self.subTest(expected_ip=expected_ip), patch.dict(ACCESS.os.environ, {}, clear=False), patch.object(
                ACCESS.sys, 'argv', ['access', INSTANCE, '--expected-public-ip', expected_ip]
            ), patch.object(ACCESS.shutil, 'which', return_value='/usr/bin/tool'), patch.object(
                ACCESS, 'oci', side_effect=[
                    {'lifecycle-state': 'RUNNING', 'display-name': 'Target'},
                    [{'id': VNIC, 'is-primary': True, 'public-ip': '163.176.214.149'}],
                ]
            ) as client, patch.object(ACCESS, 'enable_bastion') as enable, patch.object(
                ACCESS.os, 'execvp'
            ) as ssh, contextlib.redirect_stdout(io.StringIO()):
                if should_fail:
                    with self.assertRaises(ACCESS.AccessError):
                        ACCESS.main()
                else:
                    ACCESS.main()
                self.assertEqual(client.call_count, 2)
                self.assertEqual([call.args[2] for call in client.call_args_list], ['get', 'list-vnics'])
                enable.assert_not_called()
                ssh.assert_not_called()

    def test_source_allowlist_rejects_broad_private_and_ipv6_ranges(self):
        self.assertEqual(ACCESS.source_cidr('1.1.1.1/32'), '1.1.1.1/32')
        for cidr in ['0.0.0.0/0', '1.1.1.0/24', '10.0.0.1/32', '::/0', '2606:4700:4700::1111/128']:
            with self.subTest(cidr=cidr), self.assertRaises(ACCESS.AccessError):
                ACCESS.source_cidr(cidr)

    def test_enabling_bastion_preserves_other_agent_configuration(self):
        instance = {'compartment-id': 'compartment', 'agent-config': {
            'are-all-plugins-disabled': False, 'is-monitoring-disabled': True,
            'is-management-disabled': False,
            'plugins-config': [{'name': 'Compute Instance Monitoring', 'desired-state': 'DISABLED'}],
        }}
        with patch.object(ACCESS, 'oci', side_effect=[
            [{'name': 'Bastion', 'status': 'STOPPED'}], {},
            [{'name': 'Bastion', 'status': 'RUNNING'}],
        ]) as client, contextlib.redirect_stdout(io.StringIO()):
            ACCESS.enable_bastion(INSTANCE, instance)
        arguments = client.call_args_list[1].args
        config = json.loads(arguments[arguments.index('--agent-config') + 1])
        self.assertTrue(config['isMonitoringDisabled'])
        self.assertFalse(config['isManagementDisabled'])
        self.assertIn({'name': 'Compute Instance Monitoring', 'desiredState': 'DISABLED'}, config['pluginsConfig'])
        self.assertIn({'name': 'Bastion', 'desiredState': 'ENABLED'}, config['pluginsConfig'])

    def test_disabled_or_unsupported_agent_is_not_reconfigured(self):
        for plugins, config in [([], {}),
                                ([{'name': 'Bastion', 'status': 'NOT_SUPPORTED'}], {}),
                                ([{'name': 'Bastion', 'status': 'STOPPED'}], {'are-all-plugins-disabled': True})]:
            with self.subTest(plugins=plugins), patch.object(ACCESS, 'oci', return_value=plugins) as client:
                with self.assertRaises(ACCESS.AccessError):
                    ACCESS.enable_bastion(INSTANCE, {'compartment-id': 'c', 'agent-config': config})
                self.assertEqual(client.call_count, 1)

    def test_ssh_command_checks_identity_and_does_not_include_private_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory) / 'key folder'
            key = folder / 'id_rsa_3072'
            command = ACCESS.ssh_arguments(key, folder, 'ocid1.bastionsession.oc1.sa-saopaulo-1.session',
                                           'sa-saopaulo-1', '10.0.0.3')
            self.assertEqual(command[-1], 'ubuntu@10.0.0.3')
            self.assertIn('StrictHostKeyChecking=accept-new', command)
            self.assertNotIn('StrictHostKeyChecking=no', ' '.join(command))
            self.assertIn("'" + str(key) + "'", ' '.join(command))
            with self.assertRaises(ACCESS.AccessError):
                ACCESS.ssh_arguments(key, folder, 'session;whoami', 'sa-saopaulo-1', '10.0.0.3')

    def test_rsa_key_generation_and_reuse_leave_older_key_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            older = folder / 'id_ed25519'
            older.write_bytes(b'existing key must remain untouched')
            key, public, derived = ACCESS.prepare_key(folder)
            original = key.read_bytes()
            self.assertEqual(derived.split()[0], b'ssh-rsa')
            bits = subprocess.check_output(['ssh-keygen', '-l', '-f', str(public)], text=True).split()[0]
            self.assertEqual(int(bits), 3072)
            self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            repeated = ACCESS.prepare_key(folder)
            self.assertEqual(repeated[2], derived)
            self.assertEqual(key.read_bytes(), original)
            self.assertEqual(older.read_bytes(), b'existing key must remain untouched')


if __name__ == '__main__':
    unittest.main()
