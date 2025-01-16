const { spawn } = require('child_process');
const path = require('path');

function startBot() {
  const bot = spawn('node', [path.join(__dirname, 'bot.js')], {
    stdio: 'inherit'
  });

  console.log('Bot process started with PID:', bot.pid);

  bot.on('close', (code) => {
    console.log('Bot process exited with code:', code);
    console.log('Restarting bot in 5 seconds...');
    setTimeout(startBot, 5000);
  });

  bot.on('error', (err) => {
    console.error('Error starting bot process:', err);
    console.log('Restarting bot in 5 seconds...');
    setTimeout(startBot, 5000);
  });
}

console.log('Bot wrapper started');
startBot(); 