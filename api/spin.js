// Vercel Serverless Function — Hot Seat game rooms
// In-memory store (resets on cold start)

const games = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function cleanOldGames() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [code, game] of games) {
    if (game.createdAt < cutoff) games.delete(code);
  }
}

// Question bank by vibe
const questionBank = {
  'random': [
    "If you could only eat one meal for the rest of your life, what would it be and why?",
    "What's the most overrated thing in society right now?",
    "If you had to convince an alien that humans are worth keeping around, what would you say?",
    "What's a skill everyone should learn before turning 25?",
    "If you could witness any event in history firsthand, what would you pick?",
    "What invention do we need that doesn't exist yet?",
    "What's the best way to spend $1,000 you found on the street?",
    "If animals could talk, which species would be the rudest?",
    "What's something people pretend to enjoy but actually don't?",
    "You have 60 seconds on every TV screen in the world. What do you say?",
    "What's the most useless talent you have?",
    "If you were president for one day, what's the first thing you'd do?",
  ],
  'pop-culture': [
    "Which movie villain actually had a point?",
    "What's the most iconic song of the last 10 years and why?",
    "If you could live in any TV show universe, which one and why?",
    "What cancelled show deserves a comeback the most?",
    "Who's the most talented artist of our generation — defend your pick.",
    "If you could recast any role in any movie, who would you pick?",
    "What's the most overrated movie of all time?",
    "Which fictional character would make the best roommate?",
    "What's the best album to listen to front-to-back, no skips?",
    "If you could collab with any artist dead or alive, who and what would you make?",
    "What video game world would be the worst to actually live in?",
    "Which celebrity would survive the longest in a zombie apocalypse?",
  ],
  'deep-thinks': [
    "Is it better to be feared or respected? Why?",
    "If you could know the absolute truth to one question, what would you ask?",
    "Is free will real, or are we just reacting to everything around us?",
    "What's more important: being right or being kind?",
    "If everyone on earth had the same amount of money, what would happen?",
    "Would you rather be the smartest person alive or the happiest?",
    "Is social media making us more connected or more lonely?",
    "If you could eliminate one human emotion, which would it be?",
    "Is it ethical to eat meat in 2025? Make your case.",
    "Does money buy happiness? Give a nuanced answer.",
    "If you could redesign the education system from scratch, what would it look like?",
    "Are humans naturally good or naturally selfish?",
  ],
  'hot-takes': [
    "Drop your most controversial food opinion. Defend it.",
    "What's something everyone loves that you think is mid?",
    "What's a 'fact' most people believe that's actually wrong?",
    "Who's the most overrated person in history?",
    "What's the worst advice that people keep giving?",
    "Is college worth it anymore? Make your case.",
    "What popular trend will people cringe at in 10 years?",
    "What's something that should be illegal but isn't?",
    "Is hustle culture helping or hurting our generation?",
    "What's the biggest lie adults told us growing up?",
    "Remote work vs office — what's actually better for society?",
    "What's a hill you're willing to die on that most people disagree with?",
  ],
  'animal-sounds': [
    "Do your best impression of an angry cat. Type out exactly how it sounds!",
    "What does a rooster sound like at 5am? Write it out!",
    "Type out the sound a dolphin makes — get creative!",
    "How does a goat scream? Write it out in text!",
    "Do your best monkey impression! Type out every sound!",
    "What noise does an elephant make when it's excited? Write it!",
    "Type out the sound of a really dramatic parrot!",
    "What does a whale song sound like? Write it in words!",
    "How would you text someone the sound a hyena makes laughing?",
    "Do your best snake hiss impression. Make it dramatic!",
    "What sound does a penguin make? Type it out!",
    "Write out what a wolf howl sounds like — full commitment!",
    "Type the sound of a chicken getting surprised!",
    "What does an owl sound like at midnight? Write it out!",
    "Do your best impression of a seal clapping and barking!",
    "What does a frog sound like when it's trying to impress another frog?",
    "Write out exactly how a donkey sounds when it's being dramatic!",
    "What noise does a turkey make? Go all out!",
    "Type out the sound of a hawk swooping down for the kill!",
    "Do your best impression of two pigeons having an argument!",
  ],
};

function pickQuestion(vibe) {
  const bank = questionBank[vibe] || questionBank['random'];
  return bank[Math.floor(Math.random() * bank.length)];
}

function sanitizeGame(game) {
  const hotSeatPlayer = game.participants[game.currentTurnIndex] || null;
  return {
    code: game.code,
    vibe: game.vibe,
    status: game.status,
    round: game.round,
    question: game.question,
    createdAt: game.createdAt,
    currentTurnIndex: game.currentTurnIndex,
    hotSeatPlayerId: hotSeatPlayer ? hotSeatPlayer.id : null,
    hotSeatPlayerName: hotSeatPlayer ? hotSeatPlayer.name : null,
    participants: game.participants.map(p => ({
      id: p.id,
      name: p.name,
      hasAnswer: !!p.answer,
      answer: game.status === 'judged' ? p.answer : (p.answer ? '(submitted)' : null),
      score: p.score || 0,
    })),
    result: game.result,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  cleanOldGames();

  // GET — poll game state
  if (req.method === 'GET') {
    const code = (req.query.code || '').toUpperCase();
    const game = games.get(code);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    return res.status(200).json({ game: sanitizeGame(game) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};

  // CREATE game
  if (action === 'create') {
    const { creatorName, vibe } = req.body;
    const validVibes = ['random', 'pop-culture', 'deep-thinks', 'hot-takes', 'animal-sounds'];
    const gameVibe = validVibes.includes(vibe) ? vibe : 'random';

    const code = generateCode();
    const game = {
      code,
      vibe: gameVibe,
      createdAt: Date.now(),
      status: 'waiting', // waiting → answering → judging → judged
      round: 1,
      currentTurnIndex: 0,
      question: null,
      participants: [{
        id: generateId(),
        name: creatorName || 'Player 1',
        joinedAt: Date.now(),
        answer: null,
        score: 0,
      }],
      result: null,
      usedQuestions: [],
    };
    games.set(code, game);

    return res.status(200).json({
      game: sanitizeGame(game),
      participantId: game.participants[0].id,
    });
  }

  // JOIN game
  if (action === 'join') {
    const code = (req.body.code || '').toUpperCase();
    const game = games.get(code);
    if (!game) return res.status(404).json({ error: 'Game not found. Check the code.' });
    if (game.participants.length >= 8) return res.status(400).json({ error: 'Game is full (max 8)' });

    const name = req.body.name || `Player ${game.participants.length + 1}`;
    const displayName = game.participants.some(p => p.name === name) ? `${name} (${game.participants.length + 1})` : name;
    const participant = {
      id: generateId(),
      name: displayName,
      joinedAt: Date.now(),
      answer: null,
      score: 0,
    };
    game.participants.push(participant);

    return res.status(200).json({
      game: sanitizeGame(game),
      participantId: participant.id,
    });
  }

  // SPIN — pick a random question (only hot seat player can spin)
  if (action === 'spin') {
    const code = (req.body.code || '').toUpperCase();
    const { participantId } = req.body;
    const game = games.get(code);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    // Verify it's the hot seat player's turn
    const hotSeatPlayer = game.participants[game.currentTurnIndex];
    if (participantId && hotSeatPlayer && hotSeatPlayer.id !== participantId) {
      return res.status(400).json({ error: `It's ${hotSeatPlayer.name}'s turn to spin!` });
    }

    // Pick a question not yet used
    const bank = questionBank[game.vibe] || questionBank['random'];
    const available = bank.filter(q => !game.usedQuestions.includes(q));
    const pool = available.length > 0 ? available : bank;
    const question = pool[Math.floor(Math.random() * pool.length)];

    game.question = question;
    game.usedQuestions.push(question);
    game.status = 'answering';
    // Clear previous answers
    game.participants.forEach(p => { p.answer = null; });
    game.result = null;

    return res.status(200).json({ game: sanitizeGame(game) });
  }

  // ANSWER — submit your answer (only hot seat player can answer)
  if (action === 'answer') {
    const code = (req.body.code || '').toUpperCase();
    const game = games.get(code);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.status !== 'answering') return res.status(400).json({ error: 'Not accepting answers right now' });

    const { participantId, answer } = req.body;
    if (!answer || answer.length < 2) return res.status(400).json({ error: 'Answer too short' });

    const participant = game.participants.find(p => p.id === participantId);
    if (!participant) return res.status(404).json({ error: 'Player not found' });

    // Only the hot seat player can answer
    const hotSeatPlayer = game.participants[game.currentTurnIndex];
    if (hotSeatPlayer && hotSeatPlayer.id !== participantId) {
      return res.status(400).json({ error: `Only ${hotSeatPlayer.name} can answer — they're in the hot seat!` });
    }

    participant.answer = answer;

    return res.status(200).json({ game: sanitizeGame(game) });
  }

  // JUDGE — AI rates the hot seat player's answer
  if (action === 'judge') {
    const code = (req.body.code || '').toUpperCase();
    const game = games.get(code);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const hotSeatPlayer = game.participants[game.currentTurnIndex];
    if (!hotSeatPlayer || !hotSeatPlayer.answer) {
      return res.status(400).json({ error: 'The hot seat player hasn\'t answered yet' });
    }

    game.status = 'judging';

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      game.status = 'answering';
      return res.status(500).json({ error: 'AI not configured' });
    }

    try {
      const result = await judgeHotSeatAnswer(apiKey, game, hotSeatPlayer);
      game.result = result;
      game.status = 'judged';

      // Award points based on AI score (1-10)
      if (result.score) {
        hotSeatPlayer.score += result.score;
      }

      // Advance turn to next player
      game.currentTurnIndex = (game.currentTurnIndex + 1) % game.participants.length;
      // If we've gone full circle, increment round
      if (game.currentTurnIndex === 0) {
        game.round++;
      }

      return res.status(200).json({ game: sanitizeGame(game) });
    } catch (err) {
      console.error('Judge error:', err);
      game.status = 'answering';
      return res.status(502).json({ error: 'AI judging failed' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}

async function judgeHotSeatAnswer(apiKey, game, hotSeatPlayer) {
  const isAnimalSounds = game.vibe === 'animal-sounds';

  const systemPrompt = isAnimalSounds
    ? `You are the judge of a hilarious group game called "Animal Sounds". One player had to type out their best animal sound impression. Your job is to rate how accurate, creative, and funny their attempt is.

JUDGING CRITERIA:
- Accuracy — does it actually sound like the animal?
- Creativity — did they go above and beyond?
- Comedy value — is it hilarious to read?
- Commitment — did they fully send it or phone it in?

SCORING: Give a score from 1-10. A basic attempt gets 4-5, a decent one gets 6-7, a hilarious one gets 8-9, an absolute masterpiece gets 10.

PERSONALITY: Be absolutely hilarious. React like you're dying laughing or deeply confused. Roast bad attempts. Hype up good ones. Use gen-z language. Be dramatic.`
    : `You are the judge of a fun group game called "Hot Seat". One player is in the hot seat — they got a random question and had to answer on the spot while everyone watches. Your job is to rate their answer.

JUDGING CRITERIA:
- Creativity and originality (did they bring something unique?)
- How well they argued/explained their point
- Humor and entertainment value
- Actual knowledge/insight shown

SCORING: Give a score from 1-10. Be fair but generous — a solid answer gets 6-7, great gets 8-9, legendary gets 10. Don't be too harsh.

PERSONALITY: Be fun, engaging, and a bit dramatic — like a game show host. Use gen-z language where it fits. Be encouraging even for weaker answers. Roast them lightly if the answer is funny.`;

Return ONLY valid JSON (no markdown fences):
{
  "player": "Name of the player",
  "score": 8,
  "reaction": "A fun, hype 1-2 sentence reaction to their answer — like a game show host announcing the score",
  "breakdown": "Short breakdown of what was good/bad about the answer (2-3 sentences)",
  "fun_fact": "An interesting real fact related to the question topic (1-2 sentences)"
}`;

  const userMessage = `Question: "${game.question}"

${hotSeatPlayer.name} is in the hot seat. Their answer:
"${hotSeatPlayer.answer}"

Rate this answer. Be fair but entertaining.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error: ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text;
  if (!text) throw new Error('Empty AI response');

  const cleaned = text.replace(/^```json?\s*/m, '').replace(/\s*```$/m, '').trim();
  return JSON.parse(cleaned);
}
