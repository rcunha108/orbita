import { RoomServiceClient } from 'livekit-server-sdk';

const required = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Configure no backend: ${missing.join(', ')}. Não envie os valores em conversas.`);
  process.exit(1);
}

let url;
try {
  url = new URL(process.env.LIVEKIT_URL);
  if (
    url.protocol !== 'wss:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error();
} catch {
  console.error('LIVEKIT_URL deve ser a URL wss:// do projeto, sem credenciais nem caminho extra.');
  process.exit(1);
}

const timeout = setTimeout(() => {
  console.error('O LiveKit não respondeu em 15 segundos. Verifique a rede e a URL do projeto.');
  process.exit(1);
}, 15000);

try {
  const client = new RoomServiceClient(
    url.origin.replace(/^wss:/, 'https:'),
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
  );
  await client.listRooms();
  console.log(
    'LiveKit: conexão HTTPS e autenticação confirmadas. Falta validar voz e tela entre dois dispositivos.',
  );
} catch {
  console.error(
    'Não foi possível autenticar ou acessar o LiveKit. Confira URL, API Key, API Secret e acesso à rede nas configurações seguras do backend.',
  );
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
}
