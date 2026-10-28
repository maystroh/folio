import { spawn } from 'node:child_process';
import electronPath from 'electron';

const appArgs = process.argv.slice(2);
const env = { ...process.env };
// The harness that launches this project may run tools with Electron's Node
// mode flag set. Folio itself must always start as a real Electron app.
delete env.ELECTRON_RUN_AS_NODE;

function launch(extraArgs) {
  const child = spawn(electronPath, [...extraArgs, ...appArgs], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  const onSigint = () => forward('SIGINT');
  const onSigterm = () => forward('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      resolve({ code, signal });
    });
  });
}

const first = await launch([]);
// Chromium's sandbox cannot initialize under some locked-down Windows test
// tokens and exits before Electron's main process runs. Retry only that case.
const sandboxCrashCodes = new Set([2147483651, 3221225477, -1073740791]);
if (first.code !== null && sandboxCrashCodes.has(first.code)) {
  console.warn('Electron sandbox was unavailable; relaunching Folio with --no-sandbox.');
  const second = await launch(['--no-sandbox']);
  process.exit(second.code ?? 0);
}
process.exit(first.code ?? 0);
