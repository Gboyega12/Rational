// Vercel Serverless Function — Claude-powered decision analysis
// Env var required: ANTHROPIC_API_KEY

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const { description, category, timeHorizon, deadline } = req.body;
  if (!description || description.length < 20) {
    return res.status(400).json({ error: 'Description too short' });
  }

  const systemPrompt = `You are Rational, a decision analysis engine. The user will describe a decision they're facing. Your job is to produce a deeply personalized, research-backed analysis using these 7 frameworks, then a final verdict.

IMPORTANT RULES:
- Be specific to THEIR situation. Reference details they mentioned. Don't be generic.
- Use real research numbers: base rates, industry stats, success rates. Cite them.
- Do the actual math. Show EV calculations with their specific numbers.
- Read between the lines. Identify things they didn't explicitly ask about but should consider.
- Be direct and opinionated. Give a clear recommendation, not "it depends."
- Write like a smart friend who happens to know statistics — warm but rigorous.
- Use bullet points for data, prose for analysis.
- Currency/units: match whatever the user uses. If unclear, use $.

Return ONLY valid JSON in this exact structure (no markdown, no code fences):
{
  "verdict": {
    "title": "Short imperative recommendation (e.g. 'Go with Option B')",
    "subtitle": "One sentence summary of why"
  },
  "ev": {
    "title": "Expected Value — what does the math say?",
    "sections": [
      {
        "optionName": "Option A name",
        "bullets": ["bullet point 1", "bullet point 2", "..."],
        "evCalculation": "EV = ... = $X",
        "evValue": 12345
      }
    ],
    "conclusion": "Which option has higher EV and why"
  },
  "baseRate": {
    "title": "Base Rate — what does the denominator say?",
    "bullets": ["research-backed bullet 1", "..."],
    "conclusion": "Base rate verdict sentence"
  },
  "sunkCost": {
    "title": "Sunk Cost — what should you ignore?",
    "narrative": "Full paragraph(s) analyzing sunk costs in their specific situation. Identify what they've already spent that's irrecoverable and how it might be distorting their thinking."
  },
  "bayesian": {
    "title": "Bayesian Update — how should new evidence shift your view?",
    "prior": "What they likely believed before",
    "evidence": ["New evidence point 1", "New evidence point 2", "..."],
    "posterior": "How the probability should shift and why"
  },
  "survivorship": {
    "title": "Survivorship Bias — are you pattern-matching to the wrong survivors?",
    "narrative": "Who they might be comparing to, why that's misleading, who the RIGHT comparison cohort is"
  },
  "kelly": {
    "title": "Kelly Criterion — how much should you bet?",
    "currentAllocation": "How they're currently splitting resources",
    "recommendations": [
      { "action": "Stop/Reduce/Double down", "target": "what", "reason": "why" }
    ]
  },
  "finalVerdict": {
    "title": "The verdict",
    "recommendation": "Clear, specific recommendation",
    "nextStep": "The single most valuable thing to do in the next 30 days",
    "hiddenInsight": "The thing they didn't ask about but should have — the cognitive bias in their framing"
  }
}`;

  const userMessage = `Here's my situation:

${description}

${category ? `Category: ${category}` : ''}
${timeHorizon ? `Time horizon: ${timeHorizon}` : ''}
${deadline ? `Deadline: ${deadline}` : ''}

Analyze this decision using all 7 frameworks. Be specific to MY situation — use real numbers, do the math, and give me a straight answer.`;

  try {
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
      console.error('Anthropic API error:', err);
      return res.status(502).json({ error: 'AI service error', details: err });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;

    if (!text) return res.status(502).json({ error: 'Empty response from AI' });

    // Parse the JSON from Claude's response
    let analysis;
    try {
      // Handle potential markdown code fences
      const cleaned = text.replace(/^```json?\s*/m, '').replace(/\s*```$/m, '').trim();
      analysis = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message, '\nRaw:', text.slice(0, 500));
      return res.status(502).json({ error: 'Failed to parse AI response', raw: text });
    }

    return res.status(200).json({ analysis, mode: 'ai' });
  } catch (err) {
    console.error('Request error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
