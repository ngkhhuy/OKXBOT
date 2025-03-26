const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { connectDB, checkSignalExists, saveSignal, getPositionsByTrader, deleteSignal } = require('./db');
const api = require('./api');
const config = require('./config');

const TRADERS_FILE = path.join(__dirname, 'traders.json');
const editStates = new Map();

// Khởi tạo Express app
const app = express();
const port = process.env.PORT || 3000;

// Basic route để kiểm tra server đang chạy
app.get('/', (req, res) => {
  res.send('Bot is running!');
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Khởi động Express server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Thêm rate limit handling
class MessageQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.retryDelay = 1000;
  }

  async add(chatId, message, options = {}) {
    // Sử dụng chatId được truyền vào (không dùng config.TELEGRAM_GROUP_ID)
    if (config.TOPIC_ID) {
      options.message_thread_id = config.TOPIC_ID;
    }
    
    console.log('Queuing message with:', {
      chatId,
      topicId: config.TOPIC_ID,
      options
    });

    this.queue.push({ chatId, message, options });
    if (!this.isProcessing) {
      this.process();
    }
  }

  async process() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const { chatId, message, options } = this.queue.shift();

    try {
      console.log('Sending message to:', {
        chatId,
        messageThreadId: options.message_thread_id,
        messageLength: message.length
      });

      await bot.sendMessage(chatId, message, options);
      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
    } catch (error) {
      console.error('Error sending message:', {
        error: error.message,
        chatId,
        options
      });

      if (error.response && error.response.statusCode === 429) {
        const retryAfter = error.response.body.parameters.retry_after || 30;
        console.log(`Rate limited. Waiting ${retryAfter} seconds...`);
        this.queue.unshift({ chatId, message, options });
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      }
    }

    this.process();
  }
}

const messageQueue = new MessageQueue();

// Cập nhật cấu hình bot với các tùy chọn SSL/TLS
const botOptions = {
  polling: {
    interval: 1000, // Tăng interval lên 1 giây
    autoStart: true,
    params: {
      timeout: 30 // Tăng timeout lên 30 giây
    }
  },
  request: {
    timeout: 60000, // Timeout cho requests
    family: 4, // Chỉ sử dụng IPv4
    forever: true, // Keep-alive connections
    strictSSL: true, // Bắt buộc SSL
    pool: { maxSockets: 10 } // Giới hạn số lượng kết nối
  }
};

// Biến lưu thông tin bot
let botInfo = null;

// Khởi tạo bot và lưu thông tin
const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, botOptions);
let db;

// Cải thiện error handling
let isReconnecting = false;

bot.on('polling_error', async (error) => {
  console.error('Polling error:', error);
  
  if (error.code === 'EFATAL' && !isReconnecting) {
    isReconnecting = true;
    console.log('Connection lost. Attempting to reconnect...');
    
    try {
      await bot.stopPolling();
      console.log('Polling stopped');
      
      // Tăng thời gian chờ trước khi thử lại
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      await bot.startPolling();
      console.log('Polling restarted successfully');
      isReconnecting = false;
    } catch (e) {
      console.error('Failed to restart polling:', e);
      isReconnecting = false;
      
      // Thử lại sau 30 giây nếu vẫn thất bại
      setTimeout(() => {
        bot.startPolling();
      }, 30000);
    }
  }
});

// Thêm error handler cho network errors
bot.on('error', (error) => {
  console.error('Bot error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Thêm graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down bot...');
  try {
    await bot.stopPolling();
    console.log('Bot stopped');
    process.exit(0);
  } catch (error) {
    console.error('Error stopping bot:', error);
    process.exit(1);
  }
});

// Các hàm tiện ích
async function loadTraders() {
  try {
    // Kiểm tra file có tồn tại không
    try {
      await fs.access(TRADERS_FILE);
    } catch (e) {
      // Nếu file không tồn tại, tạo file mới với dữ liệu mẫu
      const defaultTraders = {
        traders: [
          {
            id: "3C0A650E43C9F05F",
            name: "Trader 1",
            description: "Top Trader OKX"
          }
          // Thêm các trader mẫu khác nếu cần
        ]
      };
      await fs.writeFile(TRADERS_FILE, JSON.stringify(defaultTraders, null, 2));
      return defaultTraders.traders;
    }

    // Đọc và parse dữ liệu
    const data = await fs.readFile(TRADERS_FILE, 'utf8');
    const parsed = JSON.parse(data);
    
    if (!parsed.traders || !Array.isArray(parsed.traders)) {
      throw new Error('Invalid traders data format');
    }
    
    return parsed.traders;
  } catch (error) {
    console.error('Error loading traders:', error);
    return [];
  }
}

async function saveTraders(traders) {
  try {
    await fs.writeFile(TRADERS_FILE, JSON.stringify({ traders }, null, 2));
  } catch (error) {
    console.error('Error saving traders:', error);
  }
}

// Bot commands
bot.onText(/\/bots/, async (msg) => {
  const traders = await loadTraders();
  const message = traders.map((t, i) => 
    `${i + 1}. ${t.name}\nID: ${t.id}\n${t.description}\n`
  ).join('\n');
  
  await bot.sendMessage(msg.chat.id, 
    '📊 Danh sách Bot đang chạy:\n\n' + message
  );
});

bot.onText(/\/changeid/, async (msg) => {
  const traders = await loadTraders();
  
  const keyboard = {
    inline_keyboard: traders.map((trader, index) => ([
      {
        text: `${trader.name} (${trader.id})`,
        callback_data: `edit_${index}`
      }
    ]))
  };

  await bot.sendMessage(msg.chat.id,
    '🔄 Chọn Bot cần thay đổi ID:',
    { reply_markup: keyboard }
  );
});

// Xử lý callbacks
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  
  if (query.data.startsWith('edit_')) {
    const index = parseInt(query.data.split('_')[1]);
    const traders = await loadTraders();
    const trader = traders[index];

    editStates.set(chatId, { index, trader });

    await bot.sendMessage(chatId,
      `📝 Nhập ID mới cho ${trader.name}:\n` +
      `ID hiện tại: ${trader.id}`,
      { reply_markup: { force_reply: true } }
    );
  }
});

// Xử lý tin nhắn với kiểm tra an toàn
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  // Đảm bảo có reply_to_message và botInfo
  if (!msg.reply_to_message || !editStates.has(chatId)) return;

  // Lấy thông tin bot nếu chưa có
  if (!botInfo) {
    try {
      botInfo = await bot.getMe();
    } catch (error) {
      console.error('Error getting bot info:', error);
      return;
    }
  }

  // Kiểm tra xem tin nhắn có phải là reply cho bot không
  if (msg.reply_to_message.from.id === botInfo.id) {
    const newId = msg.text.trim();
    const { index, trader } = editStates.get(chatId);

    if (newId.length < 16) {
      await bot.sendMessage(chatId, '❌ ID không hợp lệ. Vui lòng thử lại.');
      return;
    }

    try {
      const traders = await loadTraders();
      const oldId = traders[index].id;
      
      traders[index].id = newId;
      await saveTraders(traders);

      await bot.sendMessage(chatId,
        `✅ Đã cập nhật thành công!\n\n` +
        `Bot: ${trader.name}\n` +
        `ID cũ: ${oldId}\n` +
        `ID mới: ${newId}`
      );

      editStates.delete(chatId);

    } catch (error) {
      console.error('Error updating trader:', error);
      await bot.sendMessage(chatId, 
        '❌ Có lỗi xảy ra khi cập nhật. Vui lòng thử lại.'
      );
    }
  }
});

// Hàm chính để kiểm tra vị thế mới
async function checkNewPositions() {
  try {
    const traders = await loadTraders();
    
    for (const trader of traders) {
      try {
        // Lấy vị thế từ API
        const apiPositions = await api.fetchTraderPositions(trader.id);
        
        // Lấy vị thế từ DB của trader này
        const dbPositions = await getPositionsByTrader(trader.id);

        // Kiểm tra các vị thế mới từ API
        if (apiPositions && apiPositions.length > 0) {
          for (const apiPosition of apiPositions) {
            const signalId = `${apiPosition.instId}_${apiPosition.posSide}_${apiPosition.openTime}`;
            const existingSignal = dbPositions.find(pos => pos.signalId === signalId);

            if (!existingSignal) {
              // Xử lý vị thế mới như cũ
              console.log(`New position detected for ${trader.name}:`, {
                signalId,
                instId: apiPosition.instId,
                posSide: apiPosition.posSide,
                openTime: new Date(parseInt(apiPosition.openTime))
              });

              const signal = {
                signalId,
                traderId: trader.id,
                traderName: trader.name,
                instId: apiPosition.instId,
                posSide: apiPosition.posSide,
                openAvgPx: apiPosition.openAvgPx,
                openTime: new Date(parseInt(apiPosition.openTime)),
                lever: apiPosition.lever,
                pos: apiPosition.pos,
                createdAt: new Date()
              };

              await saveSignal(signal);
              const message = formatSignalMessage(trader, apiPosition);
              
              
              await messageQueue.add('-1002071355788', message, { parse_mode: 'HTML' });
            }
          }
        }

        // Kiểm tra các vị thế đã đóng
        for (const dbPosition of dbPositions) {
          const isStillOpen = apiPositions?.some(apiPos => 
            `${apiPos.instId}_${apiPos.posSide}_${apiPos.openTime}` === dbPosition.signalId
          );

          if (!isStillOpen) {
            console.log(`Closed position detected for ${trader.name}:`, dbPosition.signalId);
            
            // Format và gửi thông báo đóng lệnh
            const closeMessage = formatClosePositionMessage(trader, dbPosition);
            
           
              await messageQueue.add('-1002071355788', closeMessage, { parse_mode: 'HTML' });

            // Xóa signal đã đóng khỏi database
            await deleteSignal(dbPosition.signalId);
            console.log(`Deleted closed signal: ${dbPosition.signalId}`);
          }
        }

      } catch (error) {
        console.error(`Error checking positions for trader ${trader.name}:`, error);
      }
    }
  } catch (error) {
    console.error('Error in checkNewPositions:', error);
  }
}

// Format thông báo chi tiết hơn
function formatSignalMessage(trader, position) {
  const side = position.posSide === 'long' ? '🟢 LONG' : '🔴 SHORT';
  
  // Lấy thời gian hiện tại
  const currentTime = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh'
  });

  return `
🔔 Tín Hiệu Mới!

👤 Bot: ${trader.name}
${side} ${position.instId}
💰 Giá Mở: ${position.openAvgPx}
⏰ Thời Gian: ${currentTime}
`;
}

// Hàm format thông báo đóng lệnh
function formatClosePositionMessage(trader, position) {
  const side = position.posSide === 'long' ? '🟢 LONG' : '🔴 SHORT';
  
  // Lấy thời gian hiện tại
  const currentTime = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh'
  });
  
  return `
🔔 <b>ĐÓNG LỆNH</b>

👤 Bot: ${trader.name}
${side} ${position.instId}
💰 Giá Mở: ${position.openAvgPx}
⏰ Thời Gian: ${currentTime}
`;
}

// Tăng interval lên 10-15 giây
const INTERVAL = 7000;

// Thêm random delay
setInterval(async () => {
  const randomDelay = Math.floor(Math.random() * 5000);
  setTimeout(checkNewPositions, randomDelay);
}, INTERVAL);

// Hàm ping website
async function pingWebsite() {
  try {
    const response = await axios.get('https://okxbot-ox6z.onrender.com');
    console.log('Ping successful:', response.status);
  } catch (error) {
    console.error('Ping failed:', error.message);
  }
}

// Chạy ping mỗi 10 giây
setInterval(pingWebsite, 9000);

// Khởi động bot
async function initBot() {
  try {
    await connectDB();
    
    // Kiểm tra tín hiệu mới mỗi 10 giây
    setInterval(checkNewPositions, config.INTERVAL);
    
    console.log(`Bot started successfully`);
    
    return bot;
  } catch (error) {
    console.error('Error initializing bot:', error);
    process.exit(1);
  }
}

// Khởi chạy bot
initBot();

// Command để set topic ID
bot.onText(/\/setTopicId/, async (msg) => {
  try {
    // Kiểm tra xem tin nhắn có message_thread_id không
    if (!msg.message_thread_id) {
      await bot.sendMessage(msg.chat.id, '❌ Vui lòng sử dụng lệnh này trong một Topic!');
      return;
    }

    // Lưu topic ID vào config
    config.TOPIC_ID = msg.message_thread_id;
    
    // Gửi tin nhắn xác nhận
    await bot.sendMessage(
      msg.chat.id, 
      `✅ Đã set Topic ID thành công!\n\nGroup ID: ${msg.chat.id}\nTopic ID: ${msg.message_thread_id}`,
      {
        message_thread_id: msg.message_thread_id
      }
    );

    console.log('Configuration updated:', {
      chatId: msg.chat.id,
      topicId: msg.message_thread_id
    });

  } catch (error) {
    console.error('Error setting topic ID:', error);
    await bot.sendMessage(msg.chat.id, '❌ Có lỗi xảy ra khi set Topic ID.');
  }
});

// Thêm command để test gửi tin nhắn
bot.onText(/\/test/, async (msg) => {
  try {
    const testMessage = `
🔔 Tin nhắn test

⏰ Thời gian: ${new Date().toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh'
    })}
`;

    await messageQueue.add(msg.chat.id, testMessage, {
      parse_mode: 'HTML'
    });

  } catch (error) {
    console.error('Error in test command:', error);
    await bot.sendMessage(msg.chat.id, '❌ Có lỗi xảy ra khi gửi tin nhắn test.');
  }
});

// Command để hiển thị trợ giúp
bot.onText(/\/gethelp/, async (msg) => {
  try {
    const helpMessage = `
🤖 *Danh sách các lệnh:*

📋 *Quản lý Bot*
• */bots* - Xem danh sách các bot đang chạy
• */changeid* - Thay đổi ID của bot
  - Chọn bot cần thay đổi ID
  - Nhập ID mới cho bot

🔧 *Cài đặt Hệ thống*
• */setTopicId* - Set topic để nhận thông báo
  - Sử dụng trong topic muốn nhận thông báo
  - Bot sẽ gửi tất cả thông báo vào topic này

• */checkconfig* - Kiểm tra cấu hình hiện tại
  - Xem Group ID và Topic ID đang được set

• */test* - Gửi tin nhắn test
  - Kiểm tra việc gửi tin nhắn vào topic

ℹ️ *Trợ giúp*
• */gethelp* - Hiển thị danh sách lệnh này

💡 *Lưu ý:*
• Topic ID sẽ reset khi bot khởi động lại
• Đảm bảo bot có quyền gửi tin nhắn trong group/topic
• Một số thao tác có thể yêu cầu reply tin nhắn của bot
`;

    await bot.sendMessage(msg.chat.id, helpMessage, {
      parse_mode: 'Markdown',
      message_thread_id: msg.message_thread_id
    });

  } catch (error) {
    console.error('Error in gethelp command:', error);
    await bot.sendMessage(msg.chat.id, '❌ Có lỗi xảy ra khi hiển thị trợ giúp.', {
      message_thread_id: msg.message_thread_id
    });
  }
});

// Command để kiểm tra cấu hình
bot.onText(/\/checkconfig/, async (msg) => {
  try {
    const configInfo = `
📋 *Cấu hình hiện tại:*

• Group ID: ${config.TELEGRAM_GROUP_ID}
• Topic ID: ${config.TOPIC_ID || 'Chưa set'}
`;

    await bot.sendMessage(msg.chat.id, configInfo, {
      parse_mode: 'Markdown',
      message_thread_id: msg.message_thread_id
    });

  } catch (error) {
    console.error('Error checking config:', error);
    await bot.sendMessage(msg.chat.id, '❌ Có lỗi xảy ra khi kiểm tra cấu hình.');
  }
});