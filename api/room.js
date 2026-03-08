// Vercel Serverless Function — Shared debate rooms
// In-memory store (resets on cold start — fine for real-time sessions)
// For production, swap with Vercel KV or a database.

const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function cleanOldRooms() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
  for (const [code, room] of rooms) {
    if (room.createdAt < cutoff) rooms.delete(code);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  cleanOldRooms();

  const { action } = req.body || {};

  // GET — poll room state
  if (req.method === 'GET') {
    const code = (req.query.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    return res.status(200).json({ room: sanitizeRoom(room) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // CREATE — start a new debate room
  if (action === 'create') {
    const { topic, creatorName } = req.body;
    if (!topic || topic.length < 5) return res.status(400).json({ error: 'Topic too short' });

    const code = generateCode();
    const room = {
      code,
      topic,
      createdAt: Date.now(),
      status: 'arguing', // arguing → voting → analyzing → decided
      participants: [{
        id: generateParticipantId(),
        name: creatorName || 'Person 1',
        joinedAt: Date.now(),
        argument: null,
      }],
      verdict: null,
    };
    rooms.set(code, room);

    return res.status(200).json({
      room: sanitizeRoom(room),
      participantId: room.participants[0].id,
    });
  }

  // JOIN — join an existing room
  if (action === 'join') {
    const code = (req.body.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: 'Room not found. Check the code and try again.' });
    if (room.participants.length >= 8) return res.status(400).json({ error: 'Room is full (max 8 people)' });

    const name = req.body.name || `Person ${room.participants.length + 1}`;
    // Check for duplicate names
    const displayName = room.participants.some(p => p.name === name) ? `${name} (${room.participants.length + 1})` : name;
    const participant = {
      id: generateParticipantId(),
      name: displayName,
      joinedAt: Date.now(),
      argument: null,
    };
    room.participants.push(participant);

    return res.status(200).json({
      room: sanitizeRoom(room),
      participantId: participant.id,
    });
  }

  // ARGUE — submit your argument
  if (action === 'argue') {
    const code = (req.body.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (room.status !== 'arguing') return res.status(400).json({ error: 'Arguments are closed' });

    const { participantId, argument } = req.body;
    if (!argument || argument.length < 5) return res.status(400).json({ error: 'Argument too short' });

    const participant = room.participants.find(p => p.id === participantId);
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    participant.argument = argument;

    return res.status(200).json({ room: sanitizeRoom(room) });
  }

  // DECIDE — trigger AI analysis
  if (action === 'decide') {
    const code = (req.body.code || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const withArgs = room.participants.filter(p => p.argument);
    if (withArgs.length < 2) return res.status(400).json({ error: 'Need at least 2 arguments before deciding' });

    room.status = 'analyzing';

    // Call AI to settle the argument
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      room.status = 'arguing';
      return res.status(500).json({ error: 'AI not configured' });
    }

    try {
      const verdict = await analyzeDebate(apiKey, room);
      room.verdict = verdict;
      room.status = 'decided';
      return res.status(200).json({ room: sanitizeRoom(room) });
    } catch (err) {
      console.error('Debate analysis error:', err);
      room.status = 'arguing';
      return res.status(502).json({ error: 'AI analysis failed' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}

function generateParticipantId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sanitizeRoom(room) {
  return {
    code: room.code,
    topic: room.topic,
    status: room.status,
    createdAt: room.createdAt,
    participants: room.participants.map(p => ({
      id: p.id,
      name: p.name,
      hasArgument: !!p.argument,
      argument: p.argument, // visible to all — it's a debate
    })),
    verdict: room.verdict,
  };
}

async function analyzeDebate(apiKey, room) {
  const argList = room.participants
    .filter(p => p.argument)
    .map((p, i) => `**${p.name}** says:\n"${p.argument}"`)
    .join('\n\n');

  const systemPrompt = `You are Rational, a decision partner that settles arguments with facts, data, and clear reasoning. You're the smart friend everyone trusts to be fair.

You are analyzing a group debate/argument. Multiple people have submitted their positions on a topic. Your job:

1. ACKNOWLEDGE each person's argument fairly — show you understood their point
2. FACT-CHECK with real data — cite sources like "(ONS 2024)", "(WHO data)", "(peer-reviewed meta-analysis)"
3. APPLY relevant decision frameworks — Expected Value, Base Rate, Opportunity Cost, etc. Only the ones that matter.
4. GIVE A CLEAR VERDICT — don't cop out with "everyone has a point". Pick the strongest position and explain why.
5. FIND COMMON GROUND — where do the arguments actually agree?
6. SUGGEST A COMPROMISE if the truth is somewhere in the middle

WRITING RULES:
- Plain English. No jargon, no academic language.
- Use each person's NAME when addressing their points.
- Bullet points for facts and data. Prose for insights.
- Be specific with numbers and sources.
- Be diplomatic but honest. If someone's argument has a fatal flaw, say so kindly.

Return ONLY valid JSON (no markdown fences):
{
  "winner": "Name of person with strongest argument (or 'Compromise' if no clear winner)",
  "headline": "One sentence verdict — clear and decisive",
  "summary": "2-3 sentence summary of the decision",
  "sections": [
    {
      "title": "Section title — e.g. 'What the data says' or 'Where Alex is right'",
      "content": "Full analysis. Use **bold**, * bullets. Write as much as needed."
    }
  ],
  "common_ground": "What everyone actually agrees on, even if they don't realize it",
  "compromise": "A practical middle-ground solution if applicable, or null",
  "followup_questions": [
    {
      "question": "Question that would help resolve remaining disagreement",
      "for": "Name of person this question is for"
    }
  ]
}`;

  const userMessage = `Topic of debate: "${room.topic}"

${argList}

Settle this. Use facts and data. Be fair but decisive.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
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
