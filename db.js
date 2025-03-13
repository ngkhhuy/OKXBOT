const { MongoClient } = require('mongodb');
const config = require('./config');

let db;

async function connectDB() {
  try {
    const client = await MongoClient.connect(config.MONGODB_URI);
    db = client.db(config.DB_NAME);
    console.log('Connected to MongoDB');
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    throw error;
  }
}

async function getPositionsCollection() {
  if (!db) {
    await connectDB();
  }
  return db.collection('positions');
}

async function savePosition(position, traderId) {
  const collection = await getPositionsCollection();
  const positionData = {
    ...position,
    traderId,
    createdAt: new Date(),
    orderId: `${position.instId}_${position.posSide}_${position.openTime}`
  };

  await collection.updateOne(
    { orderId: positionData.orderId },
    { $set: positionData },
    { upsert: true }
  );
  return positionData;
}

async function getPositionsByTrader(traderId) {
  try {
    return await db.collection('signals')
      .find({ traderId })
      .sort({ openTime: -1 })
      .toArray();
  } catch (error) {
    console.error('Error getting positions:', error);
    return [];
  }
}

async function positionExists(position, traderId) {
  const collection = await getPositionsCollection();
  const orderId = `${position.instId}_${position.posSide}_${position.openTime}`;
  const exists = await collection.findOne({ orderId });
  return !!exists;
}

async function checkSignalExists(signalId) {
  try {
    const signal = await db.collection('signals').findOne({ signalId });
    return !!signal;
  } catch (error) {
    console.error('Error checking signal:', error);
    return false;
  }
}

async function saveSignal(signal) {
  try {
    const signalData = {
      signalId: signal.signalId,
      traderId: signal.traderId,
      traderName: signal.traderName,
      instId: signal.instId,
      posSide: signal.posSide,
      openPrice: signal.openAvgPx,
      openTime: signal.openTime,
      leverage: signal.lever,
      size: signal.pos,
      createdAt: new Date()
    };

    await db.collection('signals').insertOne(signalData);
    console.log('Signal saved:', signalData.signalId);
  } catch (error) {
    console.error('Error saving signal:', error);
    throw error;
  }
}

module.exports = {
  connectDB,
  savePosition,
  getPositionsByTrader,
  positionExists,
  checkSignalExists,
  saveSignal
}; 