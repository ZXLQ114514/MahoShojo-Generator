import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const child = spawn(command, ['dev'], {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    MAHOSHOJO_RUNTIME_MODE: 'local',
  },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
