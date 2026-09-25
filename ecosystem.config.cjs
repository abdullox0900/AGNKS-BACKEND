// pm2 process definitions. Run from the repo root:
//   pm2 start ecosystem.config.cjs
// The API and the background worker are separate OS processes on purpose —
// see apps/api/src/worker.module.ts for why.
module.exports = {
  apps: [
    {
      name: 'agnks-api',
      cwd: './apps/api',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env_production: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
      restart_delay: 2000,
      autorestart: true,
    },
    {
      name: 'agnks-worker',
      cwd: './apps/api',
      script: 'dist/worker.js',
      instances: 1,
      exec_mode: 'fork',
      env_production: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
      restart_delay: 2000,
      autorestart: true,
    },
  ],
};
