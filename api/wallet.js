// Vercel Serverless Function — Coin Wallet System
// In-memory store (resets on cold start — production would use a DB)

const wallets = new Map();

const COIN_PACKS = {
  'pack-100': { coins: 100, price: 1.99, label: '100 Coins' },
  'pack-500': { coins: 500, price: 7.99, label: '500 Coins (Save 20%)' },
  'pack-1200': { coins: 1200, price: 14.99, label: '1,200 Coins (Save 37%)' },
};

const GIFT_CARDS = [
  { id: 'amazon-5', name: 'Amazon $5', cost: 350, value: 5 },
  { id: 'amazon-10', name: 'Amazon $10', cost: 650, value: 10 },
  { id: 'uber-5', name: 'Uber Eats $5', cost: 350, value: 5 },
  { id: 'starbucks-5', name: 'Starbucks $5', cost: 350, value: 5 },
  { id: 'steam-10', name: 'Steam $10', cost: 650, value: 10 },
  { id: 'spotify-10', name: 'Spotify $10', cost: 650, value: 10 },
];

const RAKE_PERCENT = 15; // 15% house cut from pots

function getOrCreateWallet(userId) {
  if (!wallets.has(userId)) {
    wallets.set(userId, {
      id: userId,
      balance: 0,
      transactions: [],
      createdAt: Date.now(),
    });
  }
  return wallets.get(userId);
}

function addTransaction(wallet, type, amount, description) {
  wallet.transactions.push({
    type,
    amount,
    description,
    timestamp: Date.now(),
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — wallet info + shop catalog
  if (req.method === 'GET') {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const wallet = getOrCreateWallet(userId);
    return res.status(200).json({
      balance: wallet.balance,
      transactions: wallet.transactions.slice(-20),
      coinPacks: COIN_PACKS,
      giftCards: GIFT_CARDS,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const wallet = getOrCreateWallet(userId);

  // BUY coins (simulated — in production this would verify payment)
  if (action === 'buy') {
    const { packId } = req.body;
    const pack = COIN_PACKS[packId];
    if (!pack) return res.status(400).json({ error: 'Invalid coin pack' });

    // In production: verify payment via Stripe/PayStack here
    wallet.balance += pack.coins;
    addTransaction(wallet, 'purchase', pack.coins, `Bought ${pack.label}`);

    return res.status(200).json({
      balance: wallet.balance,
      message: `Added ${pack.coins} coins!`,
    });
  }

  // REDEEM for gift card
  if (action === 'redeem') {
    const { giftCardId } = req.body;
    const card = GIFT_CARDS.find(g => g.id === giftCardId);
    if (!card) return res.status(400).json({ error: 'Invalid gift card' });
    if (wallet.balance < card.cost) {
      return res.status(400).json({ error: `Not enough coins. Need ${card.cost}, have ${wallet.balance}.` });
    }

    wallet.balance -= card.cost;
    addTransaction(wallet, 'redeem', -card.cost, `Redeemed ${card.name}`);

    // In production: trigger gift card delivery via Tango Card / Tremendous API
    return res.status(200).json({
      balance: wallet.balance,
      message: `Redeemed ${card.name}! Check your email for the code.`,
      redemption: { cardName: card.name, value: card.value },
    });
  }

  // STAKE — lock coins for a game
  if (action === 'stake') {
    const { amount } = req.body;
    if (!amount || amount < 10) return res.status(400).json({ error: 'Minimum stake is 10 coins' });
    if (wallet.balance < amount) {
      return res.status(400).json({ error: `Not enough coins. Need ${amount}, have ${wallet.balance}.` });
    }

    wallet.balance -= amount;
    addTransaction(wallet, 'stake', -amount, `Staked ${amount} coins on a game`);

    return res.status(200).json({
      balance: wallet.balance,
      staked: amount,
    });
  }

  // WIN — receive pot winnings
  if (action === 'win') {
    const { potTotal, playerCount } = req.body;
    if (!potTotal) return res.status(400).json({ error: 'potTotal required' });

    const rake = Math.ceil(potTotal * RAKE_PERCENT / 100);
    const winnings = potTotal - rake;

    wallet.balance += winnings;
    addTransaction(wallet, 'win', winnings, `Won ${winnings} coins (${rake} house fee)`);

    return res.status(200).json({
      balance: wallet.balance,
      winnings,
      rake,
      message: `You won ${winnings} coins!`,
    });
  }

  // REFUND — return stake if game cancelled
  if (action === 'refund') {
    const { amount } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });

    wallet.balance += amount;
    addTransaction(wallet, 'refund', amount, `Refund: ${amount} coins`);

    return res.status(200).json({
      balance: wallet.balance,
      message: `Refunded ${amount} coins`,
    });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
