import os
import unittest
from unittest.mock import MagicMock, patch

from nikke_mcp.server import main


class RenderConfigurationTests(unittest.TestCase):
    def test_render_port_and_exact_public_host_are_used(self):
        server = MagicMock()
        env = {'PORT': '10000', 'RENDER_EXTERNAL_HOSTNAME': 'nikke-example.onrender.com',
               'NIKKE_MCP_MAX_CONCURRENT': '1', 'NIKKE_MCP_TIMEOUT': '120'}
        argv = ['nikke_mcp', '--transport', 'streamable-http', '--host', '0.0.0.0', '--public']
        with patch.dict(os.environ, env, clear=True), patch('sys.argv', argv), \
             patch('nikke_mcp.server.create_server', return_value=server) as create:
            main()
        options = server.run.call_args.kwargs
        self.assertEqual(options['port'], 10000)
        self.assertIn('nikke-example.onrender.com', options['transport_security'].allowed_hosts)
        self.assertNotIn('*.onrender.com', options['transport_security'].allowed_hosts)
        self.assertEqual(create.call_args.kwargs, {'timeout': 120, 'max_concurrent': 1})

    def test_public_binding_still_requires_explicit_opt_in(self):
        with patch.dict(os.environ, {'RENDER_EXTERNAL_HOSTNAME': 'example.onrender.com'}, clear=True), \
             patch('sys.argv', ['nikke_mcp', '--transport', 'streamable-http', '--host', '0.0.0.0']), \
             self.assertRaises(SystemExit):
            main()


if __name__ == '__main__':
    unittest.main()
