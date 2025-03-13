const axios = require('axios');
const HttpsProxyAgent = require('https-proxy-agent');
const cache = require('./cache');

class API {
  constructor() {
    // Danh sách proxy để rotate
    this.proxies = [
      'http://proxy1.example.com:8080',
      'http://proxy2.example.com:8080',
      // Thêm các proxy khác
    ];
    this.currentProxyIndex = 0;

    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://www.okx.com',
      'Referer': 'https://www.okx.com/'
    };

    this.retryDelays = [1000, 2000, 5000];

    // Bind các methods với instance
    this.fetchTraderPositions = this.fetchTraderPositions.bind(this);
    this.fetchAllTradersPositions = this.fetchAllTradersPositions.bind(this);
  }

  // Lấy proxy tiếp theo theo vòng tròn
  getNextProxy() {
    const proxy = this.proxies[this.currentProxyIndex];
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
    return proxy;
  }

  // Tạo axios instance mới với proxy
  createAxiosInstance() {
    const proxy = this.getNextProxy();
    const httpsAgent = new HttpsProxyAgent(proxy);

    return axios.create({
      headers: this.headers,
      httpsAgent,
      proxy: false // Disable axios proxy handling
    });
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
    let attempts = 0;
    const maxAttempts = this.proxies.length;

    while (attempts < maxAttempts) {
      try {
        const http = this.createAxiosInstance();
        const timestamp = Date.now();
        const url = `https://www.okx.com/priapi/v5/ecotrade/public/trader/position-detail?instType=SWAP&uniqueName=${traderId}&t=${timestamp}`;
        
        const response = await http.get(url);
        
        if (response.data && response.data.data) {
          return response.data.data;
        }
        return [];
      } catch (error) {
        attempts++;
        console.error(`Attempt ${attempts} failed for trader ${traderId}:`, error.message);
        
        if (attempts === maxAttempts) {
          throw error;
        }
        
        // Đợi trước khi thử lại với proxy khác
        await new Promise(resolve => setTimeout(resolve, this.retryDelays[0]));
      }
    }
  }

  async fetchAllTradersPositions(traders) {
    const promises = traders.map(trader => 
      this.fetchTraderPositions(trader.id)
        .then(data => ({
          trader,
          positions: data || []
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