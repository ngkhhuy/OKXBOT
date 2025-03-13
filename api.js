const axios = require('axios');
const cache = require('./cache');

class API {
  constructor() {
    // Tạo instance axios với headers mặc định
    this.http = axios.create({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.okx.com',
        'Referer': 'https://www.okx.com/'
      }
    });

    this.retryDelays = [1000, 2000, 5000]; // Thời gian chờ retry

    // Bind các methods với instance
    this.fetchTraderPositions = this.fetchTraderPositions.bind(this);
    this.fetchAllTradersPositions = this.fetchAllTradersPositions.bind(this);
  }

  async fetchWithRetry(url, options = {}, attempt = 0) {
    try {
      // Kiểm tra cache
      const cacheKey = `${url}_${JSON.stringify(options)}`;
      const cachedData = cache.get(cacheKey);
      
      if (cachedData) {
        return cachedData;
      }

      const response = await this.http.get(url, options);
      
      // Lưu vào cache
      cache.set(cacheKey, response.data);
      
      return response.data;
    } catch (error) {
      if (attempt >= this.retryDelays.length) {
        throw error;
      }

      // Chờ theo thời gian retry
      await new Promise(resolve => 
        setTimeout(resolve, this.retryDelays[attempt])
      );

      // Thử lại
      return this.fetchWithRetry(url, options, attempt + 1);
    }
  }

  async fetchTraderPositions(traderId) {
    try {
      const timestamp = Date.now();
      const url = `https://www.okx.com/priapi/v5/ecotrade/public/trader/position-detail?instType=SWAP&uniqueName=${traderId}&t=${timestamp}`;
      
      const response = await this.http.get(url);
      
      if (response.data && response.data.data) {
        return response.data.data;
      }
      return [];
    } catch (error) {
      console.error(`Error fetching positions for trader ${traderId}:`, error.message);
      return [];
    }
  }

  async fetchAllTradersPositions(traders) {
    const promises = traders.map(trader => 
      this.fetchTraderPositions(trader.id)
        .then(positions => ({
          trader,
          positions: positions || []
        }))
        .catch(error => ({
          trader,
          error
        }))
    );

    return Promise.all(promises);
  }
}

// Export instance của API class
const api = new API();
module.exports = api; 