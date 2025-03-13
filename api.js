const axios = require('axios');
const crypto = require('crypto');

class API {
  constructor() {
    // Danh sách User-Agents để rotate
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1'
    ];

    this.retryDelays = [2000, 5000, 10000]; // Tăng thời gian delay

    // Bind các methods với instance
    this.fetchTraderPositions = this.fetchTraderPositions.bind(this);
    this.fetchAllTradersPositions = this.fetchAllTradersPositions.bind(this);
  }

  // Tạo random fingerprint
  generateFingerprint() {
    return crypto.randomBytes(16).toString('hex');
  }

  // Lấy random User-Agent
  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  // Tạo axios instance mới cho mỗi request
  createAxiosInstance() {
    const fingerprint = this.generateFingerprint();
    
    return axios.create({
      headers: {
        'User-Agent': this.getRandomUserAgent(),
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Origin': 'https://www.okx.com',
        'Referer': 'https://www.okx.com/',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'x-cdn': 'https://www.okx.com',
        'x-utc': '7',
        'x-cdn-id': fingerprint,
        'x-trace-id': fingerprint,
        'Connection': 'keep-alive'
      },
      timeout: 10000
    });
  }

  async fetchTraderPositions(traderId) {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        const http = this.createAxiosInstance();
        const timestamp = Date.now();
        const url = `https://www.okx.com/priapi/v5/ecotrade/public/trader/position-detail`;
        
        const response = await http.get(url, {
          params: {
            instType: 'SWAP',
            uniqueName: traderId,
            t: timestamp
          }
        });
        
        if (response.data && response.data.data) {
          // Thêm delay ngẫu nhiên trước khi trả về kết quả
          const randomDelay = Math.floor(Math.random() * 1000) + 500;
          await new Promise(resolve => setTimeout(resolve, randomDelay));
          
          return response.data.data;
        }
        return [];
      } catch (error) {
        attempts++;
        console.error(`Attempt ${attempts} failed for trader ${traderId}:`, error.message);
        
        if (attempts === maxAttempts) {
          throw error;
        }
        
        // Đợi theo thời gian retry với thêm random delay
        const delay = this.retryDelays[attempts - 1] + Math.floor(Math.random() * 2000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async fetchAllTradersPositions(traders) {
    // Thêm delay giữa các traders
    const delayBetweenTraders = 2000;
    
    const results = [];
    for (const trader of traders) {
      try {
        const data = await this.fetchTraderPositions(trader.id);
        results.push({
          trader,
          positions: data || []
        });
        
        // Đợi trước khi xử lý trader tiếp theo
        await new Promise(resolve => 
          setTimeout(resolve, delayBetweenTraders + Math.random() * 1000)
        );
      } catch (error) {
        results.push({
          trader,
          error
        });
      }
    }
    
    return results;
  }
}

module.exports = new API(); 