// Server entrypoint: the only server module that reads process.env.
// The bootstrap config loader (M0.2) replaces the ad hoc PORT read below.
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createBroadcaster } from './broadcaster.js';

const DEFAULT_PORT = 4400;

const port = Number(process.env['PORT'] ?? DEFAULT_PORT);

// Built layout: dist/server/main.js next to dist/client (vite build).
// Under `npm run dev` this points at src/client, which Vite serves instead;
// open the Vite URL in development.
const clientDist = fileURLToPath(new URL('../client', import.meta.url));

// One hub for the process: M1's poll jobs and M2's writes publish to it.
const broadcaster = createBroadcaster();

const app = createApp({ clientDist, broadcaster });

app.listen(port, () => {
  // Replaced by the structured logger in M0.3.
  console.log(`Hearth listening on port ${String(port)}`);
});
