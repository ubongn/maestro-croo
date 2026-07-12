import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsxPath = join(__dirname, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const serverPath = join(__dirname, 'src', 'server.ts');

const child = spawn(process.execPath, [tsxPath, serverPath], {
  stdio: 'inherit',
  cwd: __dirname,
});

child.on('exit', (code) => process.exit(code ?? 1));
