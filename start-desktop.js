const { spawn } = require('child_process');
const path = require('path');

console.log('Starting Aria2 Desktop...');

// 启动 Vite 开发服务器
const vite = spawn('npx', ['vite'], {
  cwd: __dirname,
  stdio: 'inherit'
});

// 等待 Vite 启动后启动 Electron
setTimeout(() => {
  console.log('Starting Electron...');
  const electron = spawn('npx', ['electron', 'dist/electron/main.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' }
  });

  electron.on('close', () => {
    console.log('Electron closed, stopping Vite...');
    vite.kill();
    process.exit(0);
  });
}, 3000);

process.on('SIGINT', () => {
  console.log('Stopping all processes...');
  vite.kill();
  process.exit(0);
});
