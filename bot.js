const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const HttpsProxyAgent = require('https-proxy-agent');

//config
const TELEGRAM_BOT_TOKEN = '7791302769:AAGhs5-eBH50eoZW_mATccvKeJBesxCJS8g';
const TELEGRAM_GROUP_ID = '-4740067865';
const INTERVAL = 10000;

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Luu trang thai cac lenh da xu ly
const processedOrders = new Map();

// Trang thai chinh sua
const editStates = {};

// Cac lenh dang mo
const activePositions = new Map();

let TRADERS = [
  {
    id: '3C0A650E43C9F05F',
    name: 'Bot 1'
  },
  {
    id: '6808DD0322B6F642',
    name: 'Bot 2'
  },
  {
    id: '4D1E99B9DDD85A98',
    name: 'Bot 3'
  }
];

let isShuttingDown = false;

// Thêm định nghĩa headers
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.okx.com',
  'Referer': 'https://www.okx.com/',
  'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin'
};

// Thêm hàm xử lý lỗi và khởi động lại
async function handleError(error, context = '') {
  console.error(`Error in ${context}:`, error);
  
  try {
    await bot.sendMessage(TELEGRAM_GROUP_ID, 
      `❌ Bot gặp lỗi: ${context}\n` +
      `Chi tiết: ${error.message}\n` +
      `Bot sẽ tự khởi động lại sau 5 giây.`
    );
  } catch (err) {
    console.error('Failed to send error message:', err);
  }

  if (!isShuttingDown) {
    console.log('Triggering bot restart...');
    process.exit(1); // Thoát với mã lỗi để wrapper khởi động lại
  }
}

// Xu ly lenh /edit
bot.onText(/\/edit/, (msg) => {
  const chatId = msg.chat.id;
  
  const keyboard = {
    inline_keyboard: TRADERS.map((trader, index) => [
      {
        text: `${trader.name} (${trader.id})`,
        callback_data: `edit_${index}`
      }
    ])
  };

  bot.sendMessage(chatId, 'Chọn Bot cần chỉnh sửa:', {
    reply_markup: keyboard
  });
});

// Xử lý callback query
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  console.log('Received callback query:', data);

  if (data.startsWith('edit_')) {
    const index = parseInt(data.split('_')[1]);
    console.log(`Setting edit state for index ${index}`);

      // Luu trang thai chinh sua
    editStates[chatId] = {
      index: index,
      isEditing: true
    };
    
    console.log('Current edit states:', editStates);

    // Dam bao nhan duoc phan hoi
    await bot.sendMessage(chatId, 
      `Nhập ID API mới cho ${TRADERS[index].name}:\n` +
      `ID hiện tại: ${TRADERS[index].id}`,
      {
        reply_markup: {
          force_reply: true
        }
      }
    );
  }
});

// Xu ly tin nhan
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  console.log('Received message:', {
    chatId,
    text,
    reply: msg.reply_to_message
  });

  // Bo qua cac lenh
  if (text && text.startsWith('/')) return;

  // Kiem tra xem co phai la reply cho tin nhan cua bot khong
  if (msg.reply_to_message && msg.reply_to_message.from.id === bot.me.id) {
    const editState = editStates[chatId];
    if (!editState || !editState.isEditing) return;

    console.log('Processing edit message:', text);
    console.log('Edit state:', editState);

    // Kiem tra dinh dang ID
    if (!text || text.length < 5) {
      await bot.sendMessage(chatId, '❌ ID khong hop le. Vui long thu lai.', {
        reply_markup: {
          force_reply: true
        }
      });
      return;
    }

    try {
      const index = editState.index;
      const oldId = TRADERS[index].id;
      
      // Cap nhat ID moi
      TRADERS[index].id = text;
      
      // Xoa du lieu da xu ly cua trader cu
      processedOrders.delete(oldId);
      
      console.log('Updated TRADERS:', TRADERS);

      await bot.sendMessage(chatId, 
        `✅ Đã cập nhật thành công!\n\n` +
        `Bot: ${TRADERS[index].name}\n` +
        `ID cũ: ${oldId}\n` +
        `ID mới: ${text}`
      );

      // Xoa trang thai chinh sua
      delete editStates[chatId];
      
      // Gui trang thai hien tai
      const status = TRADERS.map(t => `${t.name}: ${t.id}`).join('\n');
      await bot.sendMessage(chatId, 
        '📊 Trang thai hien tai:\n\n' + status
      );

    } catch (error) {
      console.error('Error updating trader ID:', error);
      await bot.sendMessage(chatId, '❌ Có lỗi xảy ra khi cập nhật ID. Vui lòng thử lại.');
    }
  }
});

async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await axios.get(url, options);
      return response;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Retry ${i + 1}/${maxRetries} after error:`, error.message);
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

async function fetchTraderPositions(traderId) {
  try {
    const timestamp = Date.now();
    const url = `https://www.okx.com/priapi/v5/ecotrade/public/trader/position-detail?instType=SWAP&uniqueName=${traderId}&t=${timestamp}`;
    
    const response = await fetchWithRetry(url, { headers });
    console.log(`Data from ${traderId}:`, response.data); // Thêm log để debug
    return response.data.data;
  } catch (error) {
    console.error(`Error fetching data for trader ${traderId}:`, error.message);
    if (error.response) {
      console.error('Error response:', {
        status: error.response.status,
        headers: error.response.headers,
        data: error.response.data
      });
    }
    return [];
  }
}

function formatMessage(trader, position, isClose = false) {
  const timestamp = new Date(parseInt(position.openTime)).toLocaleString();
  if (isClose) {
    return `
🔔 Đóng tín hiệu - ${trader.name}
Cặp giao dịch: ${position.instId}
Tín hiệu: ${position.posSide.toUpperCase()}
Giá mở: ${position.openAvgPx}
Thời gian mở: ${timestamp}
`;
  }
  return `
🔔 Tín hiệu mới - ${trader.name}
Cặp giao dịch: ${position.instId}
Tín hiệu: ${position.posSide.toUpperCase()}
Giá mở: ${position.openAvgPx}
Thời gian mở: ${timestamp}
`;
}

async function checkNewPositions() {
  try {
    console.log('Checking new positions...');
    for (const trader of TRADERS) {
      try {
        const positions = await fetchTraderPositions(trader.id);
        const currentPositions = new Map();
        
        if (positions && positions.length > 0) {
          // Luu cac vi the hien tai vao map theo instId va posSide
          positions.forEach(pos => {
            const key = `${pos.instId}_${pos.posSide}`;
            currentPositions.set(key, pos);
          });

          // Kiem tra lenh moi
          positions.sort((a, b) => parseInt(b.openTime) - parseInt(a.openTime));
          const latestPosition = positions[0];
          const lastProcessedTime = processedOrders.get(trader.id);

          if (!lastProcessedTime || parseInt(latestPosition.openTime) > lastProcessedTime) {
            const message = formatMessage(trader, latestPosition);
            try {
              console.log(`Sending new position message for ${trader.name}:`, message);
              await bot.sendMessage(TELEGRAM_GROUP_ID, message);
              processedOrders.set(trader.id, parseInt(latestPosition.openTime));
            } catch (error) {
              console.error('Error sending new position message:', error.message);
            }
          }
        }

        // Kiem tra lenh dong
        const previousPositions = activePositions.get(trader.id) || new Map();
        
        // Tim cac lenh da dong (co trong previous nhưng khong co trong current)
        for (const [key, position] of previousPositions.entries()) {
          if (!currentPositions.has(key)) {
            // Lenh da dong
            const closeMessage = formatMessage(trader, position, true);
            try {
              console.log(`Sending close position message for ${trader.name}:`, closeMessage);
              await bot.sendMessage(TELEGRAM_GROUP_ID, closeMessage);
            } catch (error) {
              console.error('Error sending close position message:', error.message);
            }
          }
        }

        // Cap nhat danh sach lenh dang mo
        activePositions.set(trader.id, currentPositions);
        
      } catch (error) {
        await handleError(error, `Processing positions for ${trader.name}`);
      }
    }
  } catch (error) {
    await handleError(error, 'checkNewPositions');
  }
}

// Khoi dong bot
async function startBot() {
  console.log('Bot started...');
  // Chay ngay lap tuc mot lan
  await checkNewPositions();
  // Sau do moi bat dau interval
  setInterval(checkNewPositions, INTERVAL);
}

// Them xu ly loi chung
process.on('unhandledRejection', async (error) => {
  await handleError(error, 'Unhandled Promise Rejection');
});

process.on('uncaughtException', async (error) => {
  await handleError(error, 'Uncaught Exception');
});

// Xử lý tắt bot an toàn
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM signal');
  await gracefulShutdown();
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT signal');
  await gracefulShutdown();
});

async function gracefulShutdown() {
  try {
    isShuttingDown = true;
    console.log('Starting graceful shutdown...');
    
    // Gửi thông báo đang tắt bot
    await bot.sendMessage(TELEGRAM_GROUP_ID, '🔄 Bot đang được khởi động lại...');
    
    // Dừng polling
    bot.stopPolling();
    
    console.log('Bot stopped polling');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Them lenh test
bot.onText(/\/test/, async (msg) => {
  try {
    await bot.sendMessage(TELEGRAM_GROUP_ID, 'Test message');
    console.log('Test message sent successfully');
  } catch (error) {
    console.error('Error sending test message:', error);
  }
});

// Them lenh de kiem tra trang thai
bot.onText(/\/status/, async (msg) => {
  const status = TRADERS.map(t => `${t.name}: ${t.id}`).join('\n');
  await bot.sendMessage(msg.chat.id, 
    '📊 Trang thai hien tai:\n\n' + status
  );
});

// Them doan nay vao dau file sau khi khoi tao bot
bot.getMe().then((me) => {
  bot.me = me;
  console.log('Bot info:', me);
});

startBot(); 