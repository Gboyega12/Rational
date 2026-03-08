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
};

function pickQuestion(vibe) {
  const bank = questionBank[vibe] || questionBank['random'];
  return bank[Math.floor(Math.random() * bank.length)];
}

function sanitizeGame(game) {
  return {
    code: game.code,
    vibe: game.vibe,
    status: game.status,
    round: game.round,
    question: game.question,
    createdAt: game.createdAt,
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
    const validVibes = ['random', 'pop-culture', 'deep-thinks', 'hot-takes'];
    const gameVibe = validVibes.includes(vibe) ? vibe : 'random';

    const code = generateCode();
    const game = {
      code,
      vibe: gameVibe,
      createdAt: Date.now(),
      status: 'waiting', // waiting → spinning → answering → judging → judged
      round: 1,
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

  // SPIN — pick a random question
  if (action === 'spin') {
    const code = (req.body.code || '').toUpperCase();
    const game = games.get(code);
    if (!game) return res.status(404).json({ error: 'Game not found' });

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

  // ANSWER — submit your answer
  if (action === 'answer') {
    const code = (req.body.code || '').toUpperCase();
    const game = games.get(code);
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.status !== 'answering') return res.status(400).json({ error: 'Not accepting answers right now' });

    const { participantId, answer } = req.body;
    if (!answer || answer.length < 2) return res.status(400).json({ error: 'Answer too short' });

    const participant = game.participants.find(p => p.id === participantId);
    if (!participant) return res.status(404).json({ error: 'Player not found' });

    participant.answer = answer;

    return res.status(200).json({ game: sanitizeGame(game) });
  }

  // JUDGE — AI judges the answers
  if (action === 'judge') {
    const code = (req.body.code || '').toUpperCase();
    const game = games.get(code);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const withAnswers = game.participants.filter(p => p.answer);
    if (withAnswers.length < 2) return res.status(400).json({ error: 'Need at least 2 answers' });

    game.status = 'judging';

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      game.status = 'answering';
      return res.status(500).json({ error: 'AI not configured' });
    }

    try {
      const result = await judgeAnswers(apiKey, game);
      game.result = result;
      game.status = 'judged';

      // Update scores
      if (result.rankings) {
        result.rankings.forEach((r, i) => {
          const p = game.participants.find(pp => pp.name === r.name);
          if (p) p.score += (result.rankings.length - i);
        });
      }

      game.round++;
      return res.status(200).json({ game: sanitizeGame(game) });
    } catch (err) {
      console.error('Judge error:', err);
      game.status = 'answering';
      return res.status(502).json({ error: 'AI judging failed' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}

async function judgeAnswers(apiKey, game) {
  const answerList = game.participants
    .filter(p => p.answer)
    .map(p => `**${p.name}**: "${p.answer}"`)
    .join('\n\n');

  const systemPrompt = `You are the judge of a fun group game called "Hot Seat". A random question was asked and players gave their answers. Your job is to rank them and pick a winner.

JUDGING CRITERIA:
- Creativity and originality of the answer
- How well they argued their point
- Humor and entertainment value
- Actual knowledge/insight shown

PERSONALITY: Be fun, engaging, and a bit dramatic — like a game show host. Use gen-z language where it fits. Be encouraging even to lower-ranked answers.

Return ONLY valid JSON (no markdown fences):
{
  "winner": "Name of the winner",
  "winner_reason": "One fun sentence about why they won — make it hype",
  "rankings": [
    {
      "name": "Player name",
      "rank": 1,
      "comment": "Short, fun comment about their answer (1-2 sentences)"
    }
  ],
  "fun_fact": "An interesting real fact related to the question topic (1-2 sentences)"
}`;

  const userMessage = `Question: "${game.question}"

Answers:
${answerList}

Rank these answers. Be fair but entertaining. Pick a clear winner.`;

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
