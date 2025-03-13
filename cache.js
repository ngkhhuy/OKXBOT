const NodeCache = require('node-cache');

// Cache với TTL 5 giây
const cache = new NodeCache({ 
  stdTTL: 5,
  checkperiod: 2
});

module.exports = cache; 