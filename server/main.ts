import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Store } from './store.js';
import { createApp } from './http.js';

const databasePath = resolve(process.env.DATABASE_PATH ?? '.data/orbita.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const store = new Store(databasePath);
const server = createApp(store, resolve('dist'));
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
server.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(
    `Órbita API listening on port ${port}. Authenticated chat; database: ${databasePath}`,
  );
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    server.realtime.io.close(() => {
      store.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  });
