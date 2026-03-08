/* ============================================================
   Rational — Decision Engine v3
   Simplified input → Rich narrative analysis
   ============================================================ */

(function () {
  'use strict';

  // ================================================================
  // HELPERS
  // ================================================================
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => [...(c || document).querySelectorAll(s)];

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatNumber(n) {
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function formatCurrency(n) {
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  function letterForIndex(i) {
    return String.fromCharCode(65 + i);
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ================================================================
  // STORAGE
  // ================================================================
  const STORAGE_KEY = 'rational_data';

  const Store = {
    _data: null,

    _defaults() {
      return {
        decisions: [],
        biasProfile: { sunkCost: 0, survivorship: 0, overconfidence: 0, lossAversion: 0 },
        calibration: [],
        version: 3,
      };
    },

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        this._data = raw ? JSON.parse(raw) : this._defaults();
        if (!this._data.version || this._data.version < 3) {
          this._data = { ...this._defaults(), ...this._data, version: 3 };
        }
      } catch { this._data = this._defaults(); }
      return this._data;
    },

    save() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data)); } catch {}
    },

    addDecision(d) {
      this._data.decisions.unshift(d);
      this.save();
    },

    getDecision(id) {
      return this._data.decisions.find(d => d.id === id);
    },

    updateDecision(id, updates) {
      const d = this.getDecision(id);
      if (d) { Object.assign(d, updates); this.save(); }
    },

    addBiasTrigger(type) {
      if (this._data.biasProfile[type] !== undefined) {
        this._data.biasProfile[type]++;
        this.save();
      }
    },

    addCalibrationPoint(predicted, actual) {
      this._data.calibration.push({ predicted, actual, timestamp: Date.now() });
      this.save();
    },

    getBrierScore() {
      const c = this._data.calibration;
      if (c.length < 3) return null;
      return c.reduce((sum, p) => sum + Math.pow(p.predicted - p.actual, 2), 0) / c.length;
    },

    getAccuracy() {
      const c = this._data.calibration.filter(p => p.actual !== undefined);
      if (c.length < 3) return null;
      const correct = c.filter(p => (p.predicted >= 0.5 && p.actual === 1) || (p.predicted < 0.5 && p.actual === 0));
      return correct.length / c.length;
    },
  };

  Store.load();

  // ================================================================
  // STATE
  // ================================================================
  const state = {
    decision: '',
    category: '',
    timeHorizon: '',
    deadline: '',
    options: [],
    biases: {},
    context: {},
    analysisResults: null,
    currentDecisionId: null,
  };

  // ================================================================
  // SCREEN MANAGEMENT
  // ================================================================
  function showScreen(id) {
    $$('.screen').forEach(s => s.classList.remove('active'));
    $(`#${id}`).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showStep(n) {
    $$('.wizard-step').forEach(s => s.classList.remove('active'));
    $(`.wizard-step[data-wizard-step="${n}"]`).classList.add('active');
    const pct = (n / 3) * 100;
    $('#progress-fill').style.width = pct + '%';
    $('#progress-label').textContent = `${n} of 3`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ================================================================
  // LANDING
  // ================================================================
  function updateLandingStats() {
    const data = Store._data;
    const statsEl = $('#returning-stats');
    if (data.decisions.length > 0) {
      statsEl.hidden = false;
      $('#stat-decisions').textContent = data.decisions.length;
      const brier = Store.getBrierScore();
      $('#stat-brier').textContent = brier !== null ? brier.toFixed(3) : '—';
      $('#stat-streak').textContent = data.calibration.length;
    }
  }

  updateLandingStats();

  // ================================================================
  // STEP 1 — Describe
  // ================================================================
  const decisionInput = $('#decision-input');
  const step1Next = $('.next-step[data-next="2"]');
  function validateStep1() {
    const valid = decisionInput.value.trim().length >= 10;
    step1Next.disabled = !valid;
    const aiBtn = $('#ai-analyze-btn');
    if (aiBtn) aiBtn.disabled = !valid;
  }

  decisionInput.addEventListener('input', () => {
    const len = decisionInput.value.length;
    $('#char-count').textContent = `${len.toLocaleString()} / 3,000`;
    validateStep1();
  });

  // ================================================================
  // STEP 2 — Options (best case / worst case)
  // ================================================================
  const optionsContainer = $('#options-container');
  const step2Next = $('.next-step[data-next="3"]');

  function createOptionCard(index) {
    const card = document.createElement('div');
    card.className = 'option-card';
    card.dataset.index = index;
    card.innerHTML = `
      <div class="option-card-header">
        <span class="option-letter">${letterForIndex(index)}</span>
        <input type="text" class="input option-name" placeholder="Option name" maxlength="80" aria-label="Option ${letterForIndex(index)} name">
        ${index >= 2 ? '<button type="button" class="option-remove" aria-label="Remove option"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>' : ''}
      </div>
      <div class="scenario">
        <div class="scenario-label best">Best case</div>
        <div class="scenario-row">
          <input type="text" class="input best-desc" placeholder="What happens if this goes well?" aria-label="Best case description">
          <input type="number" class="input best-prob" placeholder="%" min="0" max="100" step="1" aria-label="Best case likelihood">
          <input type="number" class="input best-payoff" placeholder="Value" step="1" aria-label="Best case value">
        </div>
      </div>
      <div class="scenario">
        <div class="scenario-label worst">Worst case</div>
        <div class="scenario-row">
          <input type="text" class="input worst-desc" placeholder="What happens if this goes badly?" aria-label="Worst case description">
          <input type="number" class="input worst-prob" placeholder="%" min="0" max="100" step="1" aria-label="Worst case likelihood">
          <input type="number" class="input worst-payoff" placeholder="Value" step="1" aria-label="Worst case value">
        </div>
      </div>`;

    optionsContainer.appendChild(card);

    const remove = card.querySelector('.option-remove');
    if (remove) {
      remove.addEventListener('click', () => {
        card.remove();
        reindexOptions();
        validateOptions();
      });
    }

    card.querySelectorAll('.input').forEach(inp => inp.addEventListener('input', validateOptions));
    return card;
  }

  function reindexOptions() {
    $$('.option-card', optionsContainer).forEach((card, i) => {
      card.dataset.index = i;
      card.querySelector('.option-letter').textContent = letterForIndex(i);
    });
  }

  function validateOptions() {
    const cards = $$('.option-card', optionsContainer);
    if (cards.length < 2) { step2Next.disabled = true; return; }

    let valid = true;
    cards.forEach(card => {
      const name = card.querySelector('.option-name').value.trim();
      const bestProb = parseFloat(card.querySelector('.best-prob').value);
      const bestPayoff = card.querySelector('.best-payoff').value.trim();
      const worstProb = parseFloat(card.querySelector('.worst-prob').value);
      const worstPayoff = card.querySelector('.worst-payoff').value.trim();
      if (!name || isNaN(bestProb) || !bestPayoff || isNaN(worstProb) || !worstPayoff) valid = false;
    });
    step2Next.disabled = !valid;
  }

  function seedOptions() {
    optionsContainer.innerHTML = '';
    createOptionCard(0);
    createOptionCard(1);
    validateOptions();
  }

  $('#add-option-btn').addEventListener('click', () => {
    if (optionsContainer.children.length >= 5) return;
    const card = createOptionCard(optionsContainer.children.length);
    card.querySelector('.option-name').focus();
  });

  function collectOptions() {
    state.options = $$('.option-card', optionsContainer).map(card => ({
      name: card.querySelector('.option-name').value.trim(),
      bestDesc: card.querySelector('.best-desc').value.trim() || 'Good outcome',
      bestProb: (parseFloat(card.querySelector('.best-prob').value) || 50) / 100,
      bestPayoff: parseFloat(card.querySelector('.best-payoff').value) || 0,
      worstDesc: card.querySelector('.worst-desc').value.trim() || 'Bad outcome',
      worstProb: (parseFloat(card.querySelector('.worst-prob').value) || 50) / 100,
      worstPayoff: parseFloat(card.querySelector('.worst-payoff').value) || 0,
    }));
  }

  // ================================================================
  // STEP 3 — Context
  // ================================================================
  const sunkCostInput = $('#sunk-cost-input');
  const sunkCostOptionGroup = $('#sunk-cost-option-group');
  const sunkCostWhich = $('#sunk-cost-which');

  sunkCostInput.addEventListener('change', () => {
    if (sunkCostInput.value === 'moderate' || sunkCostInput.value === 'heavy') {
      sunkCostOptionGroup.hidden = false;
      sunkCostWhich.innerHTML = '<option value="">Which one?</option>';
      state.options.forEach((o, i) => {
        sunkCostWhich.innerHTML += `<option value="${i}">${letterForIndex(i)}. ${escapeHtml(o.name)}</option>`;
      });
    } else {
      sunkCostOptionGroup.hidden = true;
    }
  });

  // ================================================================
  // SMART PARSER — Extract options + research-backed numbers
  // ================================================================
  const RESEARCH = {
    // Each entry: { keywords, bestProb, worstProb, bestPayoff, worstPayoff, bestDesc, worstDesc, baseRate }
    // Probabilities are 0-100 integers. Payoffs are typical USD values.
    startup: {
      keywords: ['startup', 'start-up', 'founder', 'co-founder', 'fintech', 'saas', 'app idea', 'mvp', 'venture', 'launch my', 'build a company', 'my company', 'go all-in', 'entrepreneurship'],
      bestProb: 20, worstProb: 80,
      bestDesc: 'Company gains traction, raises funding or reaches profitability',
      worstDesc: 'Company fails — time and savings lost',
      bestPayoff: 500000, worstPayoff: -50000,
      baseRate: 10,
      baseFact: 'About 10% of startups succeed. Fintech with founder-market fit runs 15-20%.',
    },
    job_new: {
      keywords: ['new job', 'job offer', 'take the job', 'switch jobs', 'new role', 'new position', 'join a company', 'accept the offer'],
      bestProb: 65, worstProb: 35,
      bestDesc: 'Role works out — better pay, growth, satisfaction',
      worstDesc: 'Bad fit — stress, culture mismatch, or layoff within a year',
      bestPayoff: 95000, worstPayoff: -15000,
      baseRate: 70,
      baseFact: 'About 70% of job transitions are rated positively after 1 year.',
    },
    job_stay: {
      keywords: ['stay at', 'current job', 'keep my job', 'stay put', 'remain at', 'current role', 'current position', 'where i am'],
      bestProb: 60, worstProb: 40,
      bestDesc: 'Steady income, promotion over time, work-life balance maintained',
      worstDesc: 'Stagnation, missed opportunity window, growing dissatisfaction',
      bestPayoff: 80000, worstPayoff: 65000,
      baseRate: null,
    },
    certification: {
      keywords: ['certification', 'certificate', 'cert', 'cfa', 'cpa', 'pmp', 'aws cert', 'exam', 'get certified', 'professional qualification', 'credential'],
      bestProb: 45, worstProb: 55,
      bestDesc: 'Pass the exam, credential opens doors to better roles',
      worstDesc: 'Fail or pass but market doesn\'t value it enough — time and fee lost',
      bestPayoff: 15000, worstPayoff: -5000,
      baseRate: 45,
      baseFact: 'First-attempt pass rates vary: CFA ~40%, PMP ~60%, AWS ~70%.',
    },
    degree: {
      keywords: ['degree', 'masters', 'mba', 'phd', 'graduate school', 'grad school', 'university', 'college', 'go back to school', 'enrol', 'enroll'],
      bestProb: 55, worstProb: 45,
      bestDesc: 'Complete degree, improved career prospects and earning power',
      worstDesc: 'Debt burden without proportional salary increase',
      bestPayoff: 25000, worstPayoff: -60000,
      baseRate: 65,
      baseFact: 'About 65% of master\'s students complete their degree. MBA ROI varies widely by program tier.',
    },
    invest_market: {
      keywords: ['invest', 'stock', 'crypto', 'bitcoin', 'index fund', 'etf', 'portfolio', 'real estate investment', 'property invest', 'shares', 'trading'],
      bestProb: 55, worstProb: 45,
      bestDesc: 'Investment grows — returns above market average',
      worstDesc: 'Market drops or asset loses value',
      bestPayoff: 30000, worstPayoff: -20000,
      baseRate: 55,
      baseFact: 'S&P 500 is positive ~55% of months, ~73% of years. Individual stock picking underperforms index 85% of the time.',
    },
    buy_house: {
      keywords: ['buy a house', 'buy a home', 'buy property', 'mortgage', 'first home', 'real estate', 'buy a flat', 'buy an apartment'],
      bestProb: 60, worstProb: 40,
      bestDesc: 'Property appreciates, stable housing, equity builds',
      worstDesc: 'Market dips, maintenance costs, or unable to keep up payments',
      bestPayoff: 80000, worstPayoff: -40000,
      baseRate: 65,
      baseFact: 'Historically homes appreciate ~3-4% annually. About 1-2% of mortgages default.',
    },
    relocate: {
      keywords: ['move to', 'relocate', 'moving abroad', 'move abroad', 'different city', 'emigrate', 'immigration', 'new country'],
      bestProb: 55, worstProb: 45,
      bestDesc: 'Better opportunities, quality of life, personal growth',
      worstDesc: 'Loneliness, higher cost of living, career disruption',
      bestPayoff: 30000, worstPayoff: -20000,
      baseRate: 60,
      baseFact: 'About 60% of relocators report being happy with the move after 2 years.',
    },
    relationship: {
      keywords: ['marry', 'marriage', 'move in', 'break up', 'divorce', 'partner', 'relationship', 'propose', 'commit to'],
      bestProb: 55, worstProb: 45,
      bestDesc: 'Relationship deepens, mutual growth and support',
      worstDesc: 'Relationship deteriorates, emotional and financial cost',
      bestPayoff: 50000, worstPayoff: -30000,
      baseRate: null,
    },
    freelance: {
      keywords: ['freelance', 'consulting', 'self-employed', 'go independent', 'contractor', 'side hustle scale', 'quit to freelance'],
      bestProb: 40, worstProb: 60,
      bestDesc: 'Client pipeline builds, income exceeds previous salary',
      worstDesc: 'Inconsistent income, isolation, back to job market',
      bestPayoff: 120000, worstPayoff: -25000,
      baseRate: 35,
      baseFact: 'About 35% of freelancers earn more than their previous salary within 2 years.',
    },
    save_money: {
      keywords: ['save money', 'savings', 'emergency fund', 'pay off debt', 'pay down', 'frugal'],
      bestProb: 70, worstProb: 30,
      bestDesc: 'Financial cushion built, reduced stress, options open up',
      worstDesc: 'Lifestyle sacrifice without meaningful progress',
      bestPayoff: 20000, worstPayoff: -2000,
      baseRate: null,
    },
    health: {
      keywords: ['surgery', 'treatment', 'therapy', 'medication', 'lose weight', 'fitness', 'health plan', 'diet', 'rehab'],
      bestProb: 60, worstProb: 40,
      bestDesc: 'Health improves, quality of life increases',
      worstDesc: 'Treatment doesn\'t work, side effects, cost without benefit',
      bestPayoff: 50000, worstPayoff: -15000,
      baseRate: null,
    },
    raise_funding: {
      keywords: ['raise', 'funding', 'pre-seed', 'seed round', 'angel', 'investor', 'pitch', 'vc', 'venture capital', 'fundraise'],
      bestProb: 18, worstProb: 82,
      bestDesc: 'Funded — runway to build, implied valuation validates the idea',
      worstDesc: 'Rejected by investors — months spent pitching with no result',
      bestPayoff: 150000, worstPayoff: -10000,
      baseRate: 15,
      baseFact: 'About 15-20% of startups that actively pitch investors get pre-seed funding.',
    },
    // ---- Everyday / daily decisions ----
    food_eat_out: {
      keywords: ['eat out', 'restaurant', 'takeout', 'take-out', 'dine out', 'grab food', 'order food', 'delivery', 'uber eats', 'doordash'],
      bestProb: 70, worstProb: 30,
      bestDesc: 'Enjoyable meal, no cooking hassle, social time',
      worstDesc: 'Overpriced, unhealthy, regret spending',
      bestPayoff: 8, worstPayoff: -3,
      baseRate: null, unit: 'satisfaction',
    },
    food_cook: {
      keywords: ['cook', 'cook at home', 'make food', 'meal prep', 'home cook', 'homemade'],
      bestProb: 65, worstProb: 35,
      bestDesc: 'Healthier, cheaper, satisfying to make',
      worstDesc: 'Time-consuming, cleanup, might not turn out great',
      bestPayoff: 7, worstPayoff: 2,
      baseRate: null, unit: 'satisfaction',
    },
    food_choice: {
      keywords: ['what to eat', 'what should i eat', 'pizza or', 'sushi or', 'burger or', 'salad or', 'chicken or', 'pasta or', 'tacos or', 'chinese or', 'indian or', 'thai or', 'mexican or', 'breakfast', 'lunch', 'dinner', 'snack', 'hungry'],
      bestProb: 60, worstProb: 40,
      bestDesc: 'Hits the spot — satisfying and enjoyable',
      worstDesc: 'Meh — not what you were craving',
      bestPayoff: 8, worstPayoff: 3,
      baseRate: null, unit: 'satisfaction',
    },
    watch_series: {
      keywords: ['watch', 'series', 'show', 'movie', 'netflix', 'binge', 'stream', 'tv', 'film', 'anime', 'youtube', 'documentary', 'hulu', 'disney'],
      bestProb: 65, worstProb: 35,
      bestDesc: 'Great entertainment, relaxing, discover something good',
      worstDesc: 'Time wasted on something boring, couch guilt',
      bestPayoff: 7, worstPayoff: 1,
      baseRate: null, unit: 'enjoyment',
    },
    creative_activity: {
      keywords: ['paint', 'draw', 'write', 'sketch', 'create', 'craft', 'photography', 'music', 'play guitar', 'sing', 'design', 'build something', 'journal', 'creative'],
      bestProb: 55, worstProb: 45,
      bestDesc: 'Flow state, genuine satisfaction, skill growth',
      worstDesc: 'Frustration, creative block, feels like wasted effort',
      bestPayoff: 9, worstPayoff: 2,
      baseRate: null, unit: 'fulfillment',
    },
    exercise_activity: {
      keywords: ['gym', 'run', 'running', 'workout', 'exercise', 'swim', 'yoga', 'hike', 'walk', 'bike', 'cycling', 'lift', 'jog', 'sports', 'basketball', 'football', 'tennis'],
      bestProb: 75, worstProb: 25,
      bestDesc: 'Energy boost, mood lift, health benefit',
      worstDesc: 'Sore, tired, takes time from other things',
      bestPayoff: 9, worstPayoff: 3,
      baseRate: null, unit: 'wellbeing',
    },
    social_activity: {
      keywords: ['hang out', 'friends', 'meet up', 'go out', 'party', 'date', 'social', 'visit', 'see someone', 'coffee with', 'drinks with', 'call someone'],
      bestProb: 70, worstProb: 30,
      bestDesc: 'Connection, fun, good memories',
      worstDesc: 'Draining, awkward, wish you stayed home',
      bestPayoff: 8, worstPayoff: 1,
      baseRate: null, unit: 'enjoyment',
    },
    stay_in: {
      keywords: ['stay home', 'stay in', 'relax', 'rest', 'do nothing', 'chill', 'lazy day', 'sleep in', 'recharge', 'alone time', 'introvert'],
      bestProb: 65, worstProb: 35,
      bestDesc: 'Recharged, restful, peaceful',
      worstDesc: 'Bored, lonely, feel like you wasted the day',
      bestPayoff: 7, worstPayoff: 2,
      baseRate: null, unit: 'rest',
    },
    go_somewhere: {
      keywords: ['where to go', 'trip', 'travel', 'vacation', 'weekend', 'road trip', 'day trip', 'explore', 'adventure', 'beach', 'mountain', 'park', 'museum', 'concert', 'event'],
      bestProb: 70, worstProb: 30,
      bestDesc: 'New experience, great memories, refreshing',
      worstDesc: 'Expensive, exhausting, not worth the effort',
      bestPayoff: 9, worstPayoff: 1,
      baseRate: null, unit: 'experience',
    },
    shopping: {
      keywords: ['buy', 'purchase', 'shop', 'get a new', 'upgrade', 'iphone', 'laptop', 'shoes', 'clothes', 'gadget', 'splurge', 'treat myself', 'worth buying'],
      bestProb: 55, worstProb: 45,
      bestDesc: 'Love it, gets good use, worth the money',
      worstDesc: 'Buyer\'s remorse, didn\'t need it, money wasted',
      bestPayoff: 7, worstPayoff: -4,
      baseRate: null, unit: 'satisfaction',
    },
    learn_something: {
      keywords: ['learn', 'course', 'tutorial', 'read a book', 'study', 'podcast', 'practice', 'skill', 'hobby', 'new language', 'online class'],
      bestProb: 60, worstProb: 40,
      bestDesc: 'New skill, personal growth, sense of progress',
      worstDesc: 'Boring, doesn\'t stick, abandoned halfway',
      bestPayoff: 8, worstPayoff: 2,
      baseRate: null, unit: 'growth',
    },
  };

  // Extract money amounts from text (handles $, £, €, K, M suffixes)
  function extractAmounts(text) {
    const amounts = [];
    const regex = /[\$£€]?\s*(\d[\d,]*\.?\d*)\s*(k|m|thousand|million)?/gi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      let val = parseFloat(match[1].replace(/,/g, ''));
      const suffix = (match[2] || '').toLowerCase();
      if (suffix === 'k' || suffix === 'thousand') val *= 1000;
      if (suffix === 'm' || suffix === 'million') val *= 1000000;
      if (val >= 100 && val <= 100000000) amounts.push(val); // Filter noise
    }
    return amounts;
  }

  // Extract percentage mentions
  function extractPercentages(text) {
    const percs = [];
    const regex = /(\d{1,3})\s*%/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const val = parseInt(match[1], 10);
      if (val > 0 && val <= 100) percs.push(val);
    }
    return percs;
  }

  // Try to split "should I X or Y" patterns
  function extractOptionsFromText(text) {
    const lower = text.toLowerCase();

    // Pattern: "between X and/or Y"
    const betweenMatch = lower.match(/between\s+(.+?)\s+(?:and|or|vs\.?|versus)\s+(.+?)[\.\,\?\!]/);
    if (betweenMatch) return [betweenMatch[1].trim(), betweenMatch[2].trim()];

    // Pattern: "should I X or Y"
    const shouldMatch = lower.match(/should\s+i\s+(.+?)\s+or\s+(.+?)[\.\,\?\!]/);
    if (shouldMatch) return [shouldMatch[1].trim(), shouldMatch[2].trim()];

    // Pattern: "deciding between X and Y"
    const decidingMatch = lower.match(/deciding\s+(?:between|whether\s+to)\s+(.+?)\s+(?:and|or|vs\.?|versus)\s+(.+?)[\.\,\?\!]/);
    if (decidingMatch) return [decidingMatch[1].trim(), decidingMatch[2].trim()];

    // Pattern: "X vs Y" or "X or Y"
    const vsMatch = lower.match(/^(.+?)\s+(?:vs\.?|versus|or)\s+(.+?)$/m);
    if (vsMatch) return [vsMatch[1].trim(), vsMatch[2].trim()];

    return null;
  }

  // Match text against research database
  function matchResearch(text) {
    const lower = text.toLowerCase();
    const matches = [];

    for (const [key, data] of Object.entries(RESEARCH)) {
      const score = data.keywords.reduce((s, kw) => {
        return s + (lower.includes(kw) ? (kw.length > 5 ? 3 : 1) : 0);
      }, 0);
      if (score > 0) matches.push({ key, data, score });
    }

    matches.sort((a, b) => b.score - a.score);
    return matches;
  }

  // Capitalize first letter
  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Truncate and clean extracted option name
  function cleanOptionName(raw) {
    let name = raw.replace(/^(to |going |doing |taking |pursuing |getting |starting |accepting |keeping )/i, '');
    name = capitalize(name.trim());
    if (name.length > 60) name = name.slice(0, 57) + '...';
    return name;
  }

  // Main parser: returns array of pre-filled option objects
  function parseDescription(text, category) {
    const extracted = extractOptionsFromText(text);
    const amounts = extractAmounts(text);
    const percentages = extractPercentages(text);
    const matches = matchResearch(text);

    const options = [];

    if (extracted && extracted.length >= 2) {
      // We found explicit options in the text
      extracted.forEach((rawName, i) => {
        const name = cleanOptionName(rawName);
        // Try to match this specific option text against research
        const optMatches = matchResearch(rawName);
        const research = optMatches[0]?.data || matches[i]?.data || null;

        const opt = {
          name,
          bestDesc: research?.bestDesc || 'Things go well',
          bestProb: research?.bestProb || 50,
          bestPayoff: research?.bestPayoff || (amounts[0] || 0),
          worstDesc: research?.worstDesc || 'Things go badly',
          worstProb: research?.worstProb || 50,
          worstPayoff: research?.worstPayoff || 0,
        };

        // If we found amounts in text, use them to calibrate payoffs
        if (amounts.length > 0) {
          const relevantAmount = amounts[Math.min(i, amounts.length - 1)];
          if (research) {
            // Scale research payoffs relative to mentioned amounts
            const scale = relevantAmount / Math.max(Math.abs(research.bestPayoff), 1);
            if (scale > 0.1 && scale < 100) {
              opt.bestPayoff = Math.round(relevantAmount * (research.bestPayoff > 0 ? 1 : -1));
              opt.worstPayoff = Math.round(relevantAmount * (research.worstPayoff / Math.max(Math.abs(research.bestPayoff), 1)));
            }
          } else {
            opt.bestPayoff = Math.round(relevantAmount);
            opt.worstPayoff = Math.round(-relevantAmount * 0.3);
          }
        }

        // If percentages found, use first ones for probabilities
        if (percentages.length > i * 2) {
          opt.bestProb = percentages[i * 2] || opt.bestProb;
        }

        options.push(opt);
      });
    } else if (matches.length >= 2) {
      // Couldn't parse explicit options but matched 2+ research categories
      matches.slice(0, 2).forEach((m, i) => {
        const d = m.data;
        options.push({
          name: capitalize(m.key.replace(/_/g, ' ')),
          bestDesc: d.bestDesc,
          bestProb: d.bestProb,
          bestPayoff: amounts[i] || d.bestPayoff,
          worstDesc: d.worstDesc,
          worstProb: d.worstProb,
          worstPayoff: d.worstPayoff,
        });
      });
    } else if (matches.length === 1) {
      // One match — create option A from research, option B as status quo
      const d = matches[0].data;
      options.push({
        name: capitalize(matches[0].key.replace(/_/g, ' ')),
        bestDesc: d.bestDesc,
        bestProb: d.bestProb,
        bestPayoff: amounts[0] || d.bestPayoff,
        worstDesc: d.worstDesc,
        worstProb: d.worstProb,
        worstPayoff: d.worstPayoff,
      });
      options.push({
        name: 'Stay on current path',
        bestDesc: 'Stability, predictable income, no disruption',
        bestProb: 65,
        bestPayoff: amounts[1] || Math.round((amounts[0] || d.bestPayoff) * 0.6),
        worstDesc: 'Missed opportunity, growing regret',
        worstProb: 35,
        worstPayoff: Math.round((amounts[1] || amounts[0] || d.bestPayoff) * 0.4),
      });
    }

    // Auto-detect category if not set
    if (!category && matches.length > 0) {
      const topKey = matches[0].key;
      if (['startup', 'job_new', 'job_stay', 'freelance', 'certification'].includes(topKey)) category = 'career';
      else if (['invest_market', 'buy_house', 'save_money'].includes(topKey)) category = 'finance';
      else if (['raise_funding'].includes(topKey)) category = 'business';
      else if (['degree'].includes(topKey)) category = 'education';
      else if (['health'].includes(topKey)) category = 'health';
      else if (['relationship', 'relocate'].includes(topKey)) category = 'relationship';
      else if (['food_eat_out', 'food_cook', 'food_choice', 'watch_series', 'creative_activity', 'exercise_activity', 'social_activity', 'stay_in', 'go_somewhere', 'shopping', 'learn_something'].includes(topKey)) category = 'daily';
    }

    // Also try to auto-fill base rate from best match
    let suggestedBaseRate = null;
    let suggestedBaseFact = null;
    if (matches.length > 0 && matches[0].data.baseRate) {
      suggestedBaseRate = matches[0].data.baseRate;
      suggestedBaseFact = matches[0].data.baseFact;
    }

    return { options, category, suggestedBaseRate, suggestedBaseFact, matches };
  }

  // Populate option cards from parsed data
  function autoFillOptions(parsed) {
    optionsContainer.innerHTML = '';

    if (parsed.options.length === 0) {
      // Fallback: empty cards
      createOptionCard(0);
      createOptionCard(1);
      $('#autofill-banner').hidden = true;
      validateOptions();
      return;
    }

    parsed.options.forEach((opt, i) => {
      const card = createOptionCard(i);
      card.querySelector('.option-name').value = opt.name;
      card.querySelector('.best-desc').value = opt.bestDesc;
      card.querySelector('.best-prob').value = opt.bestProb;
      card.querySelector('.best-payoff').value = opt.bestPayoff;
      card.querySelector('.worst-desc').value = opt.worstDesc;
      card.querySelector('.worst-prob').value = opt.worstProb;
      card.querySelector('.worst-payoff').value = opt.worstPayoff;
    });

    // Ensure at least 2 cards
    while (optionsContainer.children.length < 2) {
      createOptionCard(optionsContainer.children.length);
    }

    // Show banner
    $('#autofill-banner').hidden = false;

    // Auto-fill category
    if (parsed.category && !$('#decision-category').value) {
      $('#decision-category').value = parsed.category;
    }

    // Store suggested base rate for Step 3
    state._suggestedBaseRate = parsed.suggestedBaseRate;
    state._suggestedBaseFact = parsed.suggestedBaseFact;

    validateOptions();
  }

  // ================================================================
  // NAVIGATION
  // ================================================================
  $('#start-btn').addEventListener('click', () => {
    showScreen('wizard');
    showStep(1);
    seedOptions();
    state.currentDecisionId = null;
    state.context = {};
    decisionInput.value = '';
    $('#char-count').textContent = '0 / 3,000';
    resetFollowupChat();
    decisionInput.focus();
  });

  function resetFollowupChat() {
    const chatEl = $('#followup-chat');
    if (chatEl) chatEl.hidden = true;
    const methodPreview = $('#methodology-preview');
    if (methodPreview) methodPreview.hidden = false;
    const stepNav = $('[data-wizard-step="1"] .step-nav');
    if (stepNav) stepNav.hidden = false;
    const loading = $('#ai-loading');
    if (loading) loading.hidden = true;
  }

  $('#back-to-landing').addEventListener('click', () => {
    resetFollowupChat();
    showScreen('landing');
  });

  $('#logo-home').addEventListener('click', (e) => {
    e.preventDefault();
    updateLandingStats();
    showScreen('landing');
  });

  $$('.next-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = parseInt(btn.dataset.next, 10);
      if (next === 2) {
        state.decision = decisionInput.value.trim();
        state.category = $('#decision-category').value;
        state.timeHorizon = $('#time-horizon').value;
        state.deadline = $('#decision-deadline').value;

        // Parse description and auto-fill options
        const parsed = parseDescription(state.decision, state.category);
        autoFillOptions(parsed);
      }
      if (next === 3) {
        collectOptions();
        sunkCostInput.value = '';
        sunkCostOptionGroup.hidden = true;

        // Auto-fill base rate if parser found one
        if (state._suggestedBaseRate && !$('#base-rate-input').value) {
          $('#base-rate-input').value = state._suggestedBaseRate;
        }
        // Show research fact
        const factEl = $('#base-rate-fact');
        if (state._suggestedBaseFact) {
          factEl.hidden = false;
          factEl.textContent = '📊 ' + state._suggestedBaseFact;
        } else {
          factEl.hidden = true;
        }
      }
      showStep(next);
    });
  });

  $$('.prev-step').forEach(btn => {
    btn.addEventListener('click', () => showStep(parseInt(btn.dataset.prev, 10)));
  });

  // ================================================================
  // RUN ANALYSIS
  // ================================================================
  $('#run-analysis-btn').addEventListener('click', () => {
    state.biases.sunkCost = sunkCostInput.value;
    state.biases.sunkCostOption = sunkCostWhich.value;
    state.biases.survivorship = $('#survivorship-input').value;
    state.biases.baseRate = parseFloat($('#base-rate-input').value) || null;
    state.biases.bankroll = parseFloat($('#bankroll-input').value) || null;

    collectOptions();
    runAnalysis();
    showScreen('results');
  });

  // ================================================================
  // AI ANALYSIS FLOW
  // ================================================================
  // (AI analyze handler is now in the follow-up conversation section below)

  function confidenceBadge(level) {
    if (!level) return '';
    const labels = { high: 'High confidence', medium: 'Verify numbers', low: 'Rough estimate' };
    return `<span class="confidence-badge confidence-${level}" title="${labels[level] || level}">${labels[level] || level}</span>`;
  }

  function renderAIResults(ai) {
    // Hide loading, restore methodology preview
    $('#ai-loading').hidden = true;
    const mp = $('#methodology-preview');
    if (mp) mp.hidden = false;
    validateStep1();

    // Verdict hero
    $('.verdict-heading').innerHTML = escapeHtml(ai.verdict?.title || 'Analysis complete') + '<span class="ai-badge">AI</span>';
    $('#verdict-sub').textContent = ai.verdict?.subtitle || '';

    // Accuracy disclaimer
    const disclaimerEl = document.getElementById('ai-disclaimer');
    if (disclaimerEl) disclaimerEl.remove();
    const disclaimer = document.createElement('div');
    disclaimer.id = 'ai-disclaimer';
    disclaimer.className = 'ai-disclaimer';
    disclaimer.innerHTML = 'Numbers are AI estimates sourced from public data. Always verify critical figures (salaries, costs, rates) against official sources before making final decisions.';
    const verdictEl = $('.verdict-heading');
    if (verdictEl && verdictEl.parentElement) {
      verdictEl.parentElement.insertBefore(disclaimer, verdictEl.nextSibling?.nextSibling || null);
    }

    // Section 1: Expected Value
    if (ai.ev) {
      const evEl = $('#ev-narrative');
      let evHtml = confidenceBadge(ai.ev.confidence);
      if (ai.ev.sections) {
        ai.ev.sections.forEach(sec => {
          evHtml += `<div class="ev-option-block"><h4>${escapeHtml(sec.optionName)}</h4>`;
          if (sec.bullets && sec.bullets.length) {
            evHtml += '<ul>' + sec.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('') + '</ul>';
          }
          if (sec.evCalculation) {
            evHtml += `<div class="ev-calc">${escapeHtml(sec.evCalculation)}</div>`;
          }
          evHtml += '</div>';
        });
      }
      if (ai.ev.conclusion) {
        evHtml += `<p><strong>${escapeHtml(ai.ev.conclusion)}</strong></p>`;
      }
      evEl.innerHTML = evHtml;

      // EV bars
      const evValues = (ai.ev.sections || []).filter(s => s.evValue != null);
      if (evValues.length > 0) {
        const maxEV = Math.max(...evValues.map(s => Math.abs(s.evValue)), 1);
        const bestIdx = evValues.reduce((bi, s, i) => s.evValue > evValues[bi].evValue ? i : bi, 0);
        $('#ev-bars').innerHTML = evValues.map((s, i) => {
          const isBest = i === bestIdx;
          const w = Math.max(3, (Math.abs(s.evValue) / maxEV) * 100);
          return `<div class="ev-bar-item">
            <div class="ev-bar-header">
              <span class="ev-bar-name">${escapeHtml(s.optionName)}</span>
              <span class="ev-bar-value ${isBest ? 'best' : 'not-best'}">${formatNumber(s.evValue)}</span>
            </div>
            <div class="ev-bar-track"><div class="ev-bar-fill ${isBest ? 'best' : 'not-best'}" style="width:${w}%"></div></div>
          </div>`;
        }).join('');
      } else {
        $('#ev-bars').innerHTML = '';
      }
      $('#ev-math').textContent = (ai.ev.sections || []).map(s => `${s.optionName}: ${s.evCalculation || 'N/A'}`).join('\n\n');
    }

    // Section 2: Base Rate
    if (ai.baseRate) {
      let brHtml = confidenceBadge(ai.baseRate.confidence);
      if (ai.baseRate.bullets && ai.baseRate.bullets.length) {
        brHtml += '<ul>' + ai.baseRate.bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('') + '</ul>';
      }
      if (ai.baseRate.conclusion) {
        brHtml += `<span class="callout">${escapeHtml(ai.baseRate.conclusion)}</span>`;
      }
      $('#base-narrative').innerHTML = brHtml;
      $('#base-visual').innerHTML = '';
      $('#bayes-math').textContent = ai.baseRate.bullets?.join('\n') || '';
    }

    // Section 3: Sunk Cost
    if (ai.sunkCost) {
      $('#sunk-narrative').innerHTML = confidenceBadge(ai.sunkCost.confidence) + `<div class="narrative">${ai.sunkCost.narrative.split('\n').map(p => p.trim() ? `<p>${escapeHtml(p)}</p>` : '').join('')}</div>`;
    }

    // Section 4: Bayesian Update
    if (ai.bayesian) {
      let bayesHtml = confidenceBadge(ai.bayesian.confidence);
      if (ai.bayesian.prior) bayesHtml += `<p><strong>Prior:</strong> ${escapeHtml(ai.bayesian.prior)}</p>`;
      if (ai.bayesian.evidence && ai.bayesian.evidence.length) {
        bayesHtml += '<p><strong>New evidence:</strong></p><ul>' + ai.bayesian.evidence.map(e => `<li>${escapeHtml(e)}</li>`).join('') + '</ul>';
      }
      if (ai.bayesian.posterior) bayesHtml += `<span class="callout">${escapeHtml(ai.bayesian.posterior)}</span>`;
      $('#bayes-narrative').innerHTML = bayesHtml;
      $('#bayes-visual').innerHTML = '';
    }

    // Section 5: Survivorship
    if (ai.survivorship) {
      $('#surv-narrative').innerHTML = confidenceBadge(ai.survivorship.confidence) + ai.survivorship.narrative.split('\n').map(p => p.trim() ? `<p>${escapeHtml(p)}</p>` : '').join('');
    }

    // Section 6: Kelly
    if (ai.kelly) {
      let kellyHtml = confidenceBadge(ai.kelly.confidence);
      if (ai.kelly.currentAllocation) {
        kellyHtml += `<p>${escapeHtml(ai.kelly.currentAllocation)}</p>`;
      }
      if (ai.kelly.recommendations && ai.kelly.recommendations.length) {
        kellyHtml += ai.kelly.recommendations.map(r => {
          const actionClass = (r.action || '').toLowerCase().includes('stop') ? 'stop'
            : (r.action || '').toLowerCase().includes('reduce') ? 'reduce' : 'double';
          return `<div class="kelly-rec">
            <span class="kelly-action ${actionClass}">${escapeHtml(r.action)}</span>
            <div class="kelly-rec-body"><strong>${escapeHtml(r.target)}</strong> — ${escapeHtml(r.reason)}</div>
          </div>`;
        }).join('');
      }
      $('#kelly-narrative').innerHTML = kellyHtml;
      $('#kelly-visual').innerHTML = '';
      $('#kelly-math').textContent = ai.kelly.recommendations?.map(r => `${r.action}: ${r.target} — ${r.reason}`).join('\n') || '';
    }

    // Section 7: Sensitivity — hide in AI mode (AI handles uncertainty in narrative)
    $('#sensitivity-sliders').innerHTML = '';
    $('#sensitivity-result').innerHTML = '';

    // Final Verdict
    if (ai.finalVerdict) {
      let verdictHtml = '<div class="narrative">';
      if (ai.finalVerdict.recommendation) {
        verdictHtml += `<p><strong>${escapeHtml(ai.finalVerdict.recommendation)}</strong></p>`;
      }
      if (ai.finalVerdict.nextStep) {
        verdictHtml += `<p>${escapeHtml(ai.finalVerdict.nextStep)}</p>`;
      }
      if (ai.finalVerdict.hiddenInsight) {
        verdictHtml += `<span class="callout">${escapeHtml(ai.finalVerdict.hiddenInsight)}</span>`;
      }
      verdictHtml += '</div>';
      $('#final-verdict').innerHTML = verdictHtml;
    }

    // Expiry
    renderExpiryBanner();

    // Save AI analysis in state for saving
    state.analysisResults = { ai, mode: 'ai' };
  }

  // ================================================================
  // CALCULATION ENGINE
  // ================================================================
  function calculateEV() {
    return state.options.map((opt, i) => {
      const totalProb = opt.bestProb + opt.worstProb;
      const normBest = totalProb > 0 ? opt.bestProb / totalProb : 0.5;
      const normWorst = totalProb > 0 ? opt.worstProb / totalProb : 0.5;
      const ev = normBest * opt.bestPayoff + normWorst * opt.worstPayoff;

      return {
        name: opt.name, index: i, ev,
        bestDesc: opt.bestDesc, bestProb: opt.bestProb, bestPayoff: opt.bestPayoff,
        worstDesc: opt.worstDesc, worstProb: opt.worstProb, worstPayoff: opt.worstPayoff,
        normBest, normWorst,
      };
    });
  }

  function calculateBayes(evs) {
    if (!state.biases.baseRate) return null;
    const baseRate = state.biases.baseRate / 100;

    return evs.map(opt => {
      const pEgivenS = 0.8;
      const pEgivenF = 0.2;
      const pEvidence = pEgivenS * baseRate + pEgivenF * (1 - baseRate);
      const posterior = (pEgivenS * baseRate) / pEvidence;
      const adjusted = (opt.bestProb + posterior) / 2;
      return { name: opt.name, prior: opt.bestProb, baseRate, posterior: adjusted };
    });
  }

  function calculateKelly(evs) {
    if (!state.biases.bankroll) return null;
    const bankroll = state.biases.bankroll;

    return evs.map(opt => {
      if (opt.bestPayoff <= 0 || opt.worstPayoff >= 0) {
        return { name: opt.name, fullKelly: 0, quarterKelly: 0, amount: 0, bankroll, ev: opt.ev };
      }
      const b = Math.abs(opt.bestPayoff / opt.worstPayoff);
      const p = opt.normBest;
      const q = opt.normWorst;
      let kellyFraction = Math.max(0, Math.min(1, (p * b - q) / b));
      const quarterKelly = kellyFraction * 0.25;
      return { name: opt.name, fullKelly: kellyFraction, quarterKelly, amount: Math.round(quarterKelly * bankroll), bankroll, b, p, q, ev: opt.ev };
    });
  }

  // ================================================================
  // NARRATIVE GENERATION
  // ================================================================
  // Check if current decision is a daily/casual one
  function isDailyDecision() {
    return isDaily(state.category, state.decision);
  }

  // Format value — uses /10 for daily, numbers/currency for serious
  function formatValue(n) {
    if (isDailyDecision()) {
      return n.toFixed(1) + '/10';
    }
    return formatNumber(n);
  }

  // Get the unit label for daily decisions
  function getDailyUnit() {
    const matches = matchResearch(state.decision);
    if (matches.length > 0 && matches[0].data.unit) return matches[0].data.unit;
    return 'satisfaction';
  }

  function runAnalysis() {
    const evs = calculateEV();
    const bayesResults = calculateBayes(evs);
    const kellyResults = isDailyDecision() ? null : calculateKelly(evs);

    state.analysisResults = { evs, bayesResults, kellyResults };

    const sorted = [...evs].sort((a, b) => b.ev - a.ev);
    const best = sorted[0];
    const second = sorted[1];
    const evGap = sorted.length > 1 ? best.ev - second.ev : 0;

    // Verdict hero
    if (evGap > 0) {
      if (isDailyDecision()) {
        const unit = getDailyUnit();
        $('.verdict-heading').textContent = `Go with "${best.name}"`;
        $('#verdict-sub').textContent = `It scores ${formatValue(best.ev)} on ${unit} — ${formatValue(evGap)} higher than the alternative.`;
      } else {
        $('.verdict-heading').textContent = `Go with "${best.name}"`;
        $('#verdict-sub').textContent = `The numbers give it an edge of ${formatNumber(evGap)} over your next best option.`;
      }
    } else {
      if (isDailyDecision()) {
        $('.verdict-heading').textContent = 'Both are solid picks';
        $('#verdict-sub').textContent = 'They score about the same — go with your gut on this one.';
      } else {
        $('.verdict-heading').textContent = 'Too close to call on numbers alone';
        $('#verdict-sub').textContent = 'Consider what matters most beyond the math — timing, energy, optionality.';
      }
    }

    renderEV(evs, best);
    renderBaseRate(evs, best);
    renderSunkCost(evs, best);
    renderBayes(evs, bayesResults, best);
    renderSurvivorship();
    if (!isDailyDecision()) renderKelly(kellyResults, evs);
    else { $('#kelly-narrative').innerHTML = '<p>For a daily decision, sizing doesn\'t apply — just commit and enjoy it.</p>'; $('#kelly-visual').innerHTML = ''; $('#kelly-math').textContent = ''; }
    renderSensitivity(evs);
    renderFinalVerdict(evs, best, second, bayesResults, kellyResults);
    renderExpiryBanner();
    renderPersonalBiasProfile();
  }

  // --- Section 1: Expected Value ---
  function renderEV(evs, best) {
    const daily = isDailyDecision();
    const unit = daily ? getDailyUnit() : '';
    let html = '';

    evs.forEach(opt => {
      html += `<p><strong>${escapeHtml(opt.name)}:</strong> `;
      if (daily) {
        html += `If it goes well (${escapeHtml(opt.bestDesc)}, ~${Math.round(opt.bestProb * 100)}% chance), ${unit} score: ${formatValue(opt.bestPayoff)}. `;
        html += `If it doesn't land (${escapeHtml(opt.worstDesc)}, ~${Math.round(opt.worstProb * 100)}% chance), score: ${formatValue(opt.worstPayoff)}. `;
        html += `Weighted score: <em>${formatValue(opt.ev)}</em>.</p>`;
      } else {
        html += `If things go well (${escapeHtml(opt.bestDesc)}, ~${Math.round(opt.bestProb * 100)}% chance), the value is ${formatNumber(opt.bestPayoff)}. `;
        html += `If things go badly (${escapeHtml(opt.worstDesc)}, ~${Math.round(opt.worstProb * 100)}% chance), it's ${formatNumber(opt.worstPayoff)}. `;
        html += `Weighted together: <em>${formatNumber(opt.ev)}</em>.</p>`;
      }
    });

    if (evs.length > 1 && best.ev > evs.filter(e => e.index !== best.index)[0]?.ev) {
      if (daily) {
        html += `<span class="callout">By ${unit} score, <strong>"${escapeHtml(best.name)}"</strong> wins this round.</span>`;
      } else {
        html += `<span class="callout">By expected value alone, <strong>"${escapeHtml(best.name)}"</strong> is the stronger path.</span>`;
      }
    }

    $('#ev-narrative').innerHTML = html;

    const maxAbsEV = Math.max(...evs.map(e => Math.abs(e.ev)), 1);
    $('#ev-bars').innerHTML = evs.map(opt => {
      const isBest = opt.index === best.index;
      const width = Math.max(2, (Math.abs(opt.ev) / maxAbsEV) * 100);
      return `<div class="ev-bar-item">
        <div class="ev-bar-header">
          <span class="ev-bar-name">${letterForIndex(opt.index)}. ${escapeHtml(opt.name)}</span>
          <span class="ev-bar-value ${isBest ? 'best' : 'not-best'}">${formatValue(opt.ev)}</span>
        </div>
        <div class="ev-bar-track"><div class="ev-bar-fill ${isBest ? 'best' : 'not-best'}" style="width:${width}%"></div></div>
      </div>`;
    }).join('');

    $('#ev-math').textContent = evs.map(opt =>
      `${opt.name}:\n  EV = (${(opt.normBest * 100).toFixed(0)}% × ${formatNumber(opt.bestPayoff)}) + (${(opt.normWorst * 100).toFixed(0)}% × ${formatNumber(opt.worstPayoff)}) = ${formatNumber(opt.ev)}`
    ).join('\n\n');
  }

  // --- Section 2: Base Rate ---
  function renderBaseRate(evs, best) {
    const narrative = $('#base-narrative');
    const visual = $('#base-visual');

    if (!state.biases.baseRate) {
      narrative.innerHTML = '<p>You didn\'t provide a success rate, so we can\'t compare your estimates to what usually happens. Even a rough guess — "about 15% of people succeed at this" — is one of the most powerful reality checks available.</p>';
      visual.innerHTML = '';
      $('#bayes-math').textContent = 'No base rate provided.';
      return;
    }

    const br = state.biases.baseRate;
    const bestSuccessProb = Math.round(best.bestProb * 100);
    let html = '';

    if (bestSuccessProb > br * 2) {
      Store.addBiasTrigger('overconfidence');
      html += `<p>You estimated a <strong>${bestSuccessProb}%</strong> chance of a good outcome for "${escapeHtml(best.name)}" — but the typical success rate is only <strong>${br}%</strong>.</p>`;
      html += `<p>That's a <em>${(bestSuccessProb / br).toFixed(1)}x gap</em>. You might have genuine reasons to be more optimistic — domain expertise, a head start, unique positioning. But most people overestimate their chances.</p>`;
      html += `<span class="callout">What specifically makes your situation different from the average?</span>`;
    } else if (bestSuccessProb > br) {
      html += `<p>Your estimate (${bestSuccessProb}%) is somewhat above the typical rate (${br}%). Could be justified if you have a real edge.</p>`;
    } else {
      html += `<p>Your estimate (${bestSuccessProb}%) lines up with the base rate (${br}%). You're being realistic.</p>`;
      html += `<span class="callout-ok">Your expectations match reality. That's a strong signal.</span>`;
    }

    narrative.innerHTML = html;
    visual.innerHTML = `<div class="base-comparison">
      <div class="base-num-block"><span class="base-num your-est">${bestSuccessProb}%</span><span class="base-num-label">Your estimate</span></div>
      <span class="base-arrow">→</span>
      <div class="base-num-block"><span class="base-num actual">${br}%</span><span class="base-num-label">Typical rate</span></div>
    </div>`;

    $('#bayes-math').textContent = `Base rate: ${br}%\nYour estimate for "${best.name}": ${bestSuccessProb}%\nRatio: ${(bestSuccessProb / br).toFixed(2)}x`;
  }

  // --- Section 3: Sunk Cost ---
  function renderSunkCost(evs, best) {
    const narrative = $('#sunk-narrative');

    if (state.biases.sunkCost === 'heavy') {
      Store.addBiasTrigger('sunkCost');
      const optIdx = parseInt(state.biases.sunkCostOption, 10);
      const optName = state.options[optIdx]?.name || 'one option';
      const isBestEV = best.index === optIdx;

      if (isBestEV) {
        narrative.innerHTML = `<p>You've invested heavily in <strong>"${escapeHtml(optName)}"</strong> and it also happens to be the best option by the numbers. But ask yourself: if you were starting from zero today, would you still pick it?</p><span class="callout-ok">If the answer is yes, proceed. The past investment is irrelevant — it's the future value that matters.</span>`;
      } else {
        narrative.innerHTML = `<p>You've put a lot into <strong>"${escapeHtml(optName)}"</strong> — but the numbers say <strong>"${escapeHtml(best.name)}"</strong> has a higher expected value.</p><p>This is the classic sunk cost trap. The time, money, and energy already spent are gone regardless. They shouldn't factor into a forward-looking decision.</p><span class="callout">The only question that matters: <strong>starting from today, which option gives you the most going forward?</strong></span>`;
      }
    } else if (state.biases.sunkCost === 'moderate') {
      Store.addBiasTrigger('sunkCost');
      narrative.innerHTML = '<p>You mentioned some prior investment in one option. Watch for this — sometimes we stick with something just because we started it. The money and time already spent don\'t determine whether you should continue.</p>';
    } else {
      narrative.innerHTML = '<p>No significant sunk cost here. You can evaluate each option purely on its future value — that\'s the ideal starting position.</p>';
    }
  }

  // --- Section 4: Bayesian Update ---
  function renderBayes(evs, bayesResults, best) {
    const narrative = $('#bayes-narrative');
    const visual = $('#bayes-visual');

    if (!bayesResults) {
      narrative.innerHTML = '<p>Without a base rate, we can\'t adjust your probabilities with real-world data. Your current estimates stand as-is.</p>';
      visual.innerHTML = '';
      return;
    }

    let html = '<p>When we blend your estimates with the real-world base rate, here\'s how the picture shifts:</p>';
    bayesResults.forEach(b => {
      const shift = b.posterior - b.prior;
      const dir = shift > 0.01 ? 'up' : shift < -0.01 ? 'down' : 'roughly the same';
      html += `<p><strong>${escapeHtml(b.name)}:</strong> Your estimate of ${Math.round(b.prior * 100)}% adjusts ${dir} to <em>${Math.round(b.posterior * 100)}%</em>.</p>`;
    });

    const bestBayes = bayesResults.find(b => b.name === best.name);
    if (bestBayes && bestBayes.posterior < bestBayes.prior - 0.05) {
      html += `<span class="callout">The evidence pulls "${escapeHtml(best.name)}" down from ${Math.round(bestBayes.prior * 100)}% to ${Math.round(bestBayes.posterior * 100)}%. Plan for lower odds than your gut says.</span>`;
    }

    narrative.innerHTML = html;
    visual.innerHTML = bayesResults.map(b => `<div class="bayes-row">
      <span class="bayes-label">Before</span>
      <span class="bayes-val" style="color:var(--white)">${Math.round(b.prior * 100)}%</span>
      <span style="color:var(--gray-2);margin:0 8px">→</span>
      <span class="bayes-label">After</span>
      <span class="bayes-val" style="color:var(--red)">${Math.round(b.posterior * 100)}%</span>
      <span style="flex:1;text-align:right;font-size:var(--text-xs);color:var(--gray-3)">${escapeHtml(b.name)}</span>
    </div>`).join('');
  }

  // --- Section 5: Survivorship ---
  function renderSurvivorship() {
    const narrative = $('#surv-narrative');
    if (state.biases.survivorship === 'yes') {
      Store.addBiasTrigger('survivorship');
      narrative.innerHTML = `<p>You mentioned being influenced by a specific success story. This is one of the most common and dangerous thinking traps.</p>
        <p>For every person who succeeded, there are usually <strong>dozens or hundreds who tried and failed</strong>. You never hear about them. The successes get all the attention while the failures stay invisible.</p>
        <span class="callout">How many people actually attempted this, and what percentage succeeded?</span>`;
    } else if (state.biases.survivorship === 'no') {
      narrative.innerHTML = '<p>You\'re looking at the broad picture rather than being pulled by individual success stories. That means your probability estimates are more likely to reflect reality.</p>';
    } else {
      narrative.innerHTML = '<p>No survivorship signal detected. If a particular success story is influencing your confidence, be honest about it — it\'s one of the hardest biases to spot.</p>';
    }
  }

  // --- Section 6: Kelly ---
  function renderKelly(kellyResults, evs) {
    const narrative = $('#kelly-narrative');
    const visual = $('#kelly-visual');

    if (!kellyResults) {
      narrative.innerHTML = '<p>You didn\'t provide a budget, so we can\'t calculate optimal sizing. Even a rough number helps.</p>';
      visual.innerHTML = '';
      $('#kelly-math').textContent = 'No budget provided.';
      return;
    }

    const bankroll = kellyResults[0]?.bankroll || 0;
    const hasEdge = kellyResults.some(k => k.fullKelly > 0);
    let html = '';

    if (!hasEdge) {
      html += '<p>None of your options have a clear mathematical edge worth betting aggressively. Commit cautiously.</p>';
    } else {
      html += `<p>Given your total budget of <strong>${formatCurrency(bankroll)}</strong>:</p>`;
      kellyResults.forEach(k => {
        if (k.fullKelly > 0) {
          html += `<p><strong>${escapeHtml(k.name)}:</strong> Commit up to <em>${formatCurrency(k.amount)}</em> (${(k.quarterKelly * 100).toFixed(1)}% of budget). Conservative but mathematically sound.</p>`;
        } else {
          html += `<p><strong>${escapeHtml(k.name)}:</strong> The math says don't commit significant resources here.</p>`;
        }
      });
    }

    narrative.innerHTML = html;

    if (hasEdge) {
      const maxAmount = Math.max(...kellyResults.map(k => k.amount), 1);
      visual.innerHTML = kellyResults.filter(k => k.fullKelly > 0).map(k => `<div class="kelly-bar-wrap">
        <div class="kelly-bar-header">
          <span class="kelly-bar-name">${escapeHtml(k.name)}</span>
          <span class="kelly-bar-amount">${formatCurrency(k.amount)}</span>
        </div>
        <div class="kelly-bar-track"><div class="kelly-bar-fill" style="width:${(k.amount / maxAmount) * 100}%"></div></div>
      </div>`).join('');
    } else {
      visual.innerHTML = '';
    }

    $('#kelly-math').textContent = kellyResults.map(k => {
      if (k.fullKelly === 0) return `${k.name}: No positive edge.`;
      return `${k.name}:\n  p=${(k.p * 100).toFixed(1)}%, b=${k.b.toFixed(2)}, q=${(k.q * 100).toFixed(1)}%\n  f*=(p×b−q)/b=${(k.fullKelly * 100).toFixed(1)}%\n  Quarter Kelly=${(k.quarterKelly * 100).toFixed(1)}%\n  Allocation=${formatCurrency(k.amount)}`;
    }).join('\n\n');
  }

  // --- Section 7: Sensitivity ---
  function renderSensitivity(evs) {
    const container = $('#sensitivity-sliders');
    const resultBox = $('#sensitivity-result');
    container.innerHTML = '';

    const originalBest = [...evs].sort((a, b) => b.ev - a.ev)[0];

    evs.forEach(opt => {
      const group = document.createElement('div');
      group.className = 'sens-group';
      group.innerHTML = `<div class="sens-group-title">${escapeHtml(opt.name)}</div>
        <div class="sens-row"><label>Best case</label>
          <input type="range" min="0" max="100" value="${Math.round(opt.bestProb * 100)}" data-opt="${opt.index}" data-type="best" aria-label="Adjust best case for ${escapeHtml(opt.name)}">
          <span class="sens-val">${Math.round(opt.bestProb * 100)}%</span>
        </div>
        <div class="sens-row"><label>Worst case</label>
          <input type="range" min="0" max="100" value="${Math.round(opt.worstProb * 100)}" data-opt="${opt.index}" data-type="worst" aria-label="Adjust worst case for ${escapeHtml(opt.name)}">
          <span class="sens-val">${Math.round(opt.worstProb * 100)}%</span>
        </div>`;
      container.appendChild(group);
    });

    resultBox.className = 'sensitivity-result sens-stable';
    resultBox.innerHTML = '<strong>Move the sliders</strong> to test how changes affect the answer.';

    container.addEventListener('input', (e) => {
      if (e.target.type !== 'range') return;
      e.target.nextElementSibling.textContent = e.target.value + '%';

      const newEVs = evs.map(opt => {
        const bs = container.querySelector(`input[data-opt="${opt.index}"][data-type="best"]`);
        const ws = container.querySelector(`input[data-opt="${opt.index}"][data-type="worst"]`);
        const bp = (parseInt(bs.value, 10) || 50) / 100;
        const wp = (parseInt(ws.value, 10) || 50) / 100;
        const total = bp + wp;
        const nb = total > 0 ? bp / total : 0.5;
        const nw = total > 0 ? wp / total : 0.5;
        return { ...opt, ev: nb * opt.bestPayoff + nw * opt.worstPayoff };
      });

      const newBest = [...newEVs].sort((a, b) => b.ev - a.ev)[0];

      if (newBest.index !== originalBest.index) {
        resultBox.className = 'sensitivity-result sens-changed';
        resultBox.innerHTML = `<strong>The answer changed!</strong> "${escapeHtml(newBest.name)}" (${formatNumber(newBest.ev)}) now beats "${escapeHtml(originalBest.name)}". Your conclusion depends on getting these probabilities right.`;
      } else {
        const summary = newEVs.map(e => `${escapeHtml(e.name)}: ${formatNumber(e.ev)}`).join(' · ');
        resultBox.className = 'sensitivity-result sens-stable';
        resultBox.innerHTML = `<strong>Still the same answer.</strong> "${escapeHtml(newBest.name)}" stays on top. ${summary}`;
      }
    });
  }

  // --- Final Verdict ---
  function renderFinalVerdict(evs, best, second, bayesResults, kellyResults) {
    const container = $('#final-verdict');
    let html = '<div class="narrative">';

    const daily = isDailyDecision();
    const unit = daily ? getDailyUnit() : '';

    if (evs.length >= 2 && best.ev > second.ev) {
      if (daily) {
        html += `<p><strong>Go with "${escapeHtml(best.name)}"</strong> — it scores ${formatValue(best.ev)} on ${unit}, beating "${escapeHtml(second.name)}" by ${formatValue(best.ev - second.ev)}.</p>`;
      } else {
        html += `<p><strong>Your optimal path is "${escapeHtml(best.name)}"</strong> — expected value of ${formatNumber(best.ev)}, which is ${formatNumber(best.ev - second.ev)} more than "${escapeHtml(second.name)}".</p>`;
      }
    } else {
      if (daily) {
        html += '<p>Both options score about the same — this is a coin-flip in the best way. Pick whichever feels right in the moment.</p>';
      } else {
        html += '<p>The options are very close. The decision probably comes down to factors the math can\'t capture — your energy, timing, and which path excites you more.</p>';
      }
    }

    // Daily context insights from follow-up
    if (daily && state.context) {
      const ctx = state.context;
      const dailyInsights = [];

      if (ctx.mood_right_now) {
        const moodAdvice = {
          'energized': 'You\'re feeling energized — lean into the more active or challenging option.',
          'chill': 'You\'re in chill mode — favor the lower-effort, more relaxing choice.',
          'tired': 'Low battery today. Go with whatever requires the least activation energy — you\'ll thank yourself.',
          'bored': 'You\'re bored — pick the option that breaks your routine or gives you something new.',
          'stressed': 'Stressed out — prioritize the option that gives you genuine relief, not just distraction.',
        };
        if (moodAdvice[ctx.mood_right_now]) dailyInsights.push(moodAdvice[ctx.mood_right_now]);
      }

      if (ctx.recent_pattern) {
        const patternAdvice = {
          'screens': 'You\'ve had too much screen time lately — if one option gets you off screens, that\'s a bonus.',
          'work': 'You\'ve been grinding — choose rest or play over more productivity.',
          'junk-food': 'Too much junk food recently — a healthier choice might actually feel better right now.',
          'staying-in': 'You\'ve been staying in a lot — getting out, even briefly, will probably do more for you.',
        };
        if (patternAdvice[ctx.recent_pattern]) dailyInsights.push(patternAdvice[ctx.recent_pattern]);
      }

      if (ctx.priority_today) {
        const priorityLabels = { fun: 'fun', health: 'health', productivity: 'progress', money: 'saving money', rest: 'rest' };
        dailyInsights.push(`Your priority right now is <strong>${priorityLabels[ctx.priority_today] || ctx.priority_today}</strong> — weigh that above the raw score.`);
      }

      if (dailyInsights.length > 0) {
        html += '<div class="context-insights"><h4>Tuned to your moment</h4>';
        dailyInsights.forEach(insight => { html += `<p>${insight}</p>`; });
        html += '</div>';
      }
    }

    const warnCount = [
      state.biases.sunkCost === 'heavy' || state.biases.sunkCost === 'moderate',
      state.biases.survivorship === 'yes',
      state.biases.baseRate && best.bestProb * 100 > state.biases.baseRate * 1.5,
    ].filter(Boolean).length;

    if (warnCount > 0) {
      html += `<p>We flagged <em>${warnCount} thinking trap${warnCount > 1 ? 's' : ''}</em> that could be clouding your judgment. Review the sections above before committing.</p>`;
    }

    if (kellyResults) {
      const bestKelly = kellyResults.find(k => k.name === best.name);
      if (bestKelly && bestKelly.amount > 0) {
        html += `<p>Smart allocation: around <strong>${formatCurrency(bestKelly.amount)}</strong> — meaningful exposure without catastrophic downside.</p>`;
      }
    }

    if (state.timeHorizon) {
      const map = { days: 'the next few days', weeks: 'the next few weeks', months: 'the next few months', '1year': 'the next year', years: 'the next few years', decade: 'the next decade' };
      html += `<p>This plays out over <strong>${map[state.timeHorizon] || 'time'}</strong> — you have room to course-correct if early signals don't match.</p>`;
    }

    // Hyper-personalization context insights
    const ctx = state.context || {};
    const contextInsights = [];

    if (ctx.runway) {
      const runwayLabels = { '0': 'virtually no financial runway', '1-3': '1–3 months of runway', '3-6': '3–6 months of buffer', '6-12': '6–12 months of cushion', '12+': 'over 12 months of runway' };
      const runwayRisk = ctx.runway === '0' || ctx.runway === '1-3';
      if (runwayRisk) {
        contextInsights.push(`With <strong>${runwayLabels[ctx.runway] || 'limited runway'}</strong>, prioritize options that preserve cash flow. A high-upside gamble isn't worth it if a bad month means you can't cover basics.`);
      } else {
        contextInsights.push(`With <strong>${runwayLabels[ctx.runway]}</strong>, you have breathing room to take a measured risk — but don't confuse a cushion with permission to be reckless.`);
      }
    }

    if (ctx.dependents && ctx.dependents !== 'none') {
      const depLabels = { 'partner': 'a partner', 'family-small': 'a small family', 'family-large': 'a larger family', 'extended': 'extended family' };
      contextInsights.push(`You're responsible for <strong>${depLabels[ctx.dependents] || 'others'}</strong>. Factor in their stability — a decision that's bold for a solo person may be irresponsible when others depend on the outcome.`);
    }

    if (ctx.emotionalState && ctx.emotionalState !== 'calm') {
      const emotionWarnings = {
        'excited': 'You said you\'re feeling excited and leaning toward something. Excitement narrows focus — make sure you\'re not overlooking downsides because momentum feels good.',
        'anxious': 'You flagged anxiety around this decision. Anxious minds overweight worst-case scenarios. The numbers above are your anchor — trust the math over the feeling.',
        'pressured': 'You\'re under external pressure to decide fast. Rushed decisions disproportionately favor the status quo or the loudest voice. If possible, buy yourself even 48 more hours.',
        'burned-out': 'You said you\'re burned out. Low energy means lower risk tolerance and worse pattern recognition. If this can wait, let it wait. If it can\'t, lean harder on the frameworks above.',
      };
      contextInsights.push(emotionWarnings[ctx.emotionalState] || '');
    }

    if (ctx.riskTolerance) {
      const riskNotes = {
        'very-cautious': 'Your natural preference is high certainty. The quarter-Kelly sizing above is especially relevant — it limits downside while keeping you in the game.',
        'cautious': 'You prefer calculated bets. Focus on the sensitivity section — if the answer holds even when you slide your estimates toward pessimistic, it\'s a go.',
        'aggressive': 'You lean into risk. That\'s a strength when the EV is positive, but double-check the base rate section — aggressive people tend to overweight their own odds.',
        'very-aggressive': 'You\'re wired to swing big. That works when the math supports it. But check: are you excited about this because the numbers are good, or because the story is good?',
      };
      if (riskNotes[ctx.riskTolerance]) contextInsights.push(riskNotes[ctx.riskTolerance]);
    }

    if (ctx.cultural && ctx.cultural !== 'none') {
      const culturalNotes = {
        'some': 'There are some cultural or family expectations in play. Weigh them, but don\'t let them override what the numbers say unless the social cost of defying them is genuinely high.',
        'strong': 'Strong cultural or family expectations are shaping your options. This is a real constraint — the "optimal" choice on paper may not be viable if it fractures key relationships.',
        'dominant': 'Cultural or family pressure is a dominant force here. Be honest about what\'s actually on the table. The best decision is the best <em>feasible</em> decision — and feasibility includes social reality.',
      };
      if (culturalNotes[ctx.cultural]) contextInsights.push(culturalNotes[ctx.cultural]);
    }

    if (ctx.lifeStage) {
      const stageNotes = {
        'student': 'As a student, your biggest asset is time and low obligations. This is the highest-risk-tolerance phase of your life — if you\'re ever going to take a shot, now is when.',
        'early-career': 'Early in your career, you\'re building reputation capital. Weigh whether this decision compounds your skills and network, not just the short-term payoff.',
        'career-change': 'Pivoting is expensive but often necessary. Your transferable skills are the bridge — make sure the path you choose actually uses them.',
        'parent': 'As a parent or caregiver, stability isn\'t just a preference — it\'s a responsibility. The right amount of risk is lower than it was before others depended on you.',
        'pre-retirement': 'At this stage, preservation matters more than growth. Avoid decisions that put a large percentage of your assets at risk for marginal upside.',
      };
      if (stageNotes[ctx.lifeStage]) contextInsights.push(stageNotes[ctx.lifeStage]);
    }

    if (ctx.location) {
      contextInsights.push(`Based in <strong>${escapeHtml(ctx.location)}</strong> — local cost of living, market conditions, and opportunity access all factor into whether the numbers above translate to your reality.`);
    }

    if (contextInsights.length > 0) {
      html += '<div class="context-insights"><h4>Personalized to your situation</h4>';
      contextInsights.forEach(insight => {
        if (insight) html += `<p>${insight}</p>`;
      });
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  function renderExpiryBanner() {
    const banner = $('#expiry-banner');
    if (!state.deadline) { banner.hidden = true; return; }
    const dl = new Date(state.deadline);
    const now = new Date();
    const days = Math.ceil((dl - now) / 86400000);
    banner.hidden = false;

    if (days < 0) {
      banner.className = 'expiry-banner expiry-urgent';
      banner.textContent = `Deadline passed (${formatDate(dl.getTime())}).`;
    } else if (days <= 3) {
      banner.className = 'expiry-banner expiry-urgent';
      banner.textContent = `${days} day${days !== 1 ? 's' : ''} left to decide.`;
    } else if (days <= 14) {
      banner.className = 'expiry-banner expiry-soon';
      banner.textContent = `${days} days until deadline (${formatDate(dl.getTime())}).`;
    } else {
      banner.className = 'expiry-banner expiry-ok';
      banner.textContent = `Deadline: ${formatDate(dl.getTime())} (${days} days away).`;
    }
  }

  function renderPersonalBiasProfile() {
    const bp = Store._data.biasProfile;
    const total = Object.values(bp).reduce((a, b) => a + b, 0);
    if (total < 2) { $('#personal-bias-card').hidden = true; return; }

    $('#personal-bias-card').hidden = false;
    const content = $('#bias-profile-content');
    const biasLabels = {
      sunkCost: 'Holding on to past investments',
      survivorship: 'Inspired by success stories',
      overconfidence: 'Overestimating your odds',
      lossAversion: 'Avoiding risk even when it pays off',
    };
    const maxCount = Math.max(...Object.values(bp), 1);

    content.innerHTML = Object.entries(bp).map(([key, count]) => `<div class="bias-bar">
      <div class="bias-bar-header"><span class="bias-bar-name">${biasLabels[key]}</span><span class="bias-bar-count">${count}×</span></div>
      <div class="bias-bar-track"><div class="bias-bar-fill ${key === 'sunkCost' ? 'sunk-cost' : key}" style="width:${(count / maxCount) * 100}%"></div></div>
    </div>`).join('');

    const topBias = Object.entries(bp).sort((a, b) => b[1] - a[1])[0];
    if (topBias[1] >= 2) {
      content.innerHTML += `<p style="font-size:var(--text-sm);color:var(--red);margin-top:var(--space-4);">Your biggest pattern: <strong>${biasLabels[topBias[0]]}</strong> (${topBias[1]}×). Watch for it.</p>`;
    }
  }

  // ================================================================
  // SAVE / EXPORT / DASHBOARD
  // ================================================================
  $('#save-decision-btn').addEventListener('click', () => {
    const results = state.analysisResults;
    if (!results) return;

    let recommendation, bestEV, options, outcomes;

    if (results.mode === 'ai' && results.ai) {
      // AI mode — extract from AI response
      recommendation = results.ai.verdict?.title || 'See analysis';
      bestEV = results.ai.ev?.sections?.[0]?.evValue || 0;
      options = (results.ai.ev?.sections || []).map(s => s.optionName);
      outcomes = {};
      (results.ai.ev?.sections || []).forEach((s, i) => {
        outcomes[i] = [{ description: s.evCalculation || s.optionName, probability: 0.5, payoff: s.evValue || 0 }];
      });
    } else {
      // Local mode
      const evs = results.evs;
      if (!evs) return;
      const best = [...evs].sort((a, b) => b.ev - a.ev)[0];
      recommendation = best.name;
      bestEV = best.ev;
      options = state.options.map(o => o.name);
      outcomes = state.options.reduce((acc, o, i) => {
        acc[i] = [
          { description: o.bestDesc, probability: o.bestProb, payoff: o.bestPayoff },
          { description: o.worstDesc, probability: o.worstProb, payoff: o.worstPayoff },
        ];
        return acc;
      }, {});
    }

    Store.addDecision({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      decision: state.decision,
      category: state.category,
      timeHorizon: state.timeHorizon,
      deadline: state.deadline,
      options,
      outcomes,
      recommendation,
      bestEV,
      biases: { ...state.biases },
      timestamp: Date.now(),
      outcomeLogged: false,
      mode: results.mode || 'local',
    });
    state.currentDecisionId = Store._data.decisions[0].id;
    alert('Decision saved.');
  });

  $('#export-btn').addEventListener('click', () => {
    let text = `RATIONAL ANALYSIS\n${'='.repeat(40)}\n\nDecision: ${state.decision}\n\n`;
    $$('.analysis-section').forEach(sec => {
      const h = sec.querySelector('h3');
      const n = sec.querySelector('.narrative');
      if (h) text += `${h.textContent}\n${'-'.repeat(h.textContent.length)}\n`;
      if (n) text += n.textContent.trim() + '\n\n';
    });
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rational-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#start-over-btn').addEventListener('click', () => { updateLandingStats(); showScreen('landing'); });

  // Dashboard
  $('#dashboard-btn').addEventListener('click', () => { renderDashboard(); showScreen('dashboard'); });
  $('#dash-back-btn').addEventListener('click', () => { updateLandingStats(); showScreen('landing'); });

  function renderDashboard() {
    const data = Store._data;
    $('#dash-total').textContent = data.decisions.length;
    $('#dash-calibrated').textContent = data.calibration.length;
    const brier = Store.getBrierScore();
    $('#dash-brier').textContent = brier !== null ? brier.toFixed(3) : '—';
    const accuracy = Store.getAccuracy();
    $('#dash-accuracy').textContent = accuracy !== null ? Math.round(accuracy * 100) + '%' : '—';

    renderDashBiasProfile();

    // Expiring
    const expiring = data.decisions.filter(d => {
      if (!d.deadline || d.outcomeLogged) return false;
      const dl = new Date(d.deadline);
      return dl > new Date() && (dl - new Date()) / 86400000 <= 14;
    });
    const es = $('#expiring-section');
    if (expiring.length > 0) { es.hidden = false; $('#expiring-list').innerHTML = expiring.map(renderHistoryItem).join(''); }
    else { es.hidden = true; }

    const hl = $('#history-list');
    if (data.decisions.length === 0) { hl.innerHTML = '<p class="empty">Nothing yet.</p>'; }
    else { hl.innerHTML = data.decisions.map(renderHistoryItem).join(''); }

    $$('.log-outcome-trigger').forEach(btn => {
      btn.addEventListener('click', () => openOutcomeModal(btn.dataset.decisionId));
    });
  }

  function renderDashBiasProfile() {
    const bp = Store._data.biasProfile;
    const total = Object.values(bp).reduce((a, b) => a + b, 0);
    const c = $('#dash-bias-profile');
    if (total < 2) { c.innerHTML = '<p class="empty">Not enough data yet.</p>'; return; }
    const biasLabels = { sunkCost: 'Past investments', survivorship: 'Success stories', overconfidence: 'Overestimating odds', lossAversion: 'Avoiding risk' };
    const max = Math.max(...Object.values(bp), 1);
    c.innerHTML = Object.entries(bp).map(([k, v]) => `<div class="bias-bar">
      <div class="bias-bar-header"><span class="bias-bar-name">${biasLabels[k]}</span><span class="bias-bar-count">${v}×</span></div>
      <div class="bias-bar-track"><div class="bias-bar-fill ${k === 'sunkCost' ? 'sunk-cost' : k}" style="width:${(v / max) * 100}%"></div></div>
    </div>`).join('');
  }

  function renderHistoryItem(d) {
    let badge = '';
    if (d.outcomeLogged) { badge = '<span class="history-badge logged">Tracked</span>'; }
    else if (d.deadline) {
      const days = Math.ceil((new Date(d.deadline) - new Date()) / 86400000);
      if (days < 0) badge = '<span class="history-badge expired">Expired</span>';
      else if (days <= 7) badge = `<span class="history-badge pending">${days}d left</span>`;
      else badge = '<span class="history-badge pending">Pending</span>';
    } else { badge = '<span class="history-badge pending">Pending</span>'; }

    return `<div class="history-item">
      <div class="history-item-body">
        <div class="history-item-decision">${escapeHtml(d.decision.slice(0, 100))}</div>
        <div class="history-item-meta">
          <span>${formatDate(d.timestamp)}</span><span>${d.category || ''}</span>
          <span>→ ${escapeHtml(d.recommendation)}</span>${badge}
        </div>
      </div>
      <div class="history-item-actions">
        ${!d.outcomeLogged ? `<button type="button" class="btn btn-success-soft btn-sm log-outcome-trigger" data-decision-id="${d.id}">Log outcome</button>` : ''}
      </div>
    </div>`;
  }

  // Outcome modal
  const outcomeModal = $('#outcome-modal');
  let currentLoggingId = null;

  function openOutcomeModal(id) {
    const d = Store.getDecision(id);
    if (!d) return;
    currentLoggingId = id;
    $('#outcome-modal-decision').textContent = d.decision.slice(0, 200);
    const os = $('#outcome-which-option');
    os.innerHTML = '<option value="">—</option>';
    d.options.forEach((name, i) => { os.innerHTML += `<option value="${i}">${letterForIndex(i)}. ${escapeHtml(name)}</option>`; });

    os.addEventListener('change', () => {
      const oi = os.value;
      const rs = $('#outcome-which-result');
      rs.innerHTML = '<option value="">—</option>';
      if (oi !== '' && d.outcomes[oi]) {
        d.outcomes[oi].forEach((o, idx) => { rs.innerHTML += `<option value="${idx}">${escapeHtml(o.description || 'Outcome ' + (idx + 1))}</option>`; });
        rs.innerHTML += '<option value="other">Something else</option>';
      }
    }, { once: false });

    outcomeModal.showModal();
  }

  $('#outcome-modal-close').addEventListener('click', () => outcomeModal.close());
  outcomeModal.addEventListener('click', (e) => { if (e.target === outcomeModal) outcomeModal.close(); });

  $('#log-outcome-btn').addEventListener('click', () => {
    if (!currentLoggingId) return;
    const d = Store.getDecision(currentLoggingId);
    if (!d) return;
    const co = parseInt($('#outcome-which-option').value, 10);
    const cr = $('#outcome-which-result').value;
    const ap = parseFloat($('#outcome-actual-payoff').value) || null;
    if (isNaN(co) || cr === '') return;

    if (cr !== 'other' && d.outcomes[co]) {
      const idx = parseInt(cr, 10);
      Store.addCalibrationPoint(d.outcomes[co][idx]?.probability || 0, 1);
      d.outcomes[co].forEach((o, i) => { if (i !== idx) Store.addCalibrationPoint(o.probability, 0); });
    }

    Store.updateDecision(currentLoggingId, {
      outcomeLogged: true,
      actualOutcome: { chosenOption: co, resultIndex: cr, actualPayoff: ap, loggedAt: Date.now() },
    });
    outcomeModal.close();
    renderDashboard();
  });

  // Clear data
  $('#clear-data-btn').addEventListener('click', () => {
    if (confirm('Delete all decisions, patterns, and accuracy data?')) {
      localStorage.removeItem(STORAGE_KEY);
      Store.load();
      renderDashboard();
    }
  });

  // Modals
  const howModal = $('#how-it-works-modal');
  $('#how-it-works-btn').addEventListener('click', () => howModal.showModal());
  $('#modal-close-btn').addEventListener('click', () => howModal.close());
  howModal.addEventListener('click', (e) => { if (e.target === howModal) howModal.close(); });

  // ================================================================
  // CONVERSATIONAL FOLLOW-UP — Hyper-personalization
  // ================================================================
  const FOLLOWUP_QUESTIONS = [
    {
      id: 'location',
      question: "Where are you based? Geography shapes cost of living, opportunity access, and what's realistic.",
      type: 'text',
      placeholder: 'e.g. Lagos, Nigeria / London, UK / Austin, TX',
      triggers: () => true, // always relevant
    },
    {
      id: 'life_stage',
      question: "What stage of life are you in right now?",
      type: 'options',
      options: [
        { label: 'Student', value: 'student' },
        { label: 'Early career', value: 'early-career' },
        { label: 'Mid-career', value: 'mid-career' },
        { label: 'Career pivot', value: 'career-change' },
        { label: 'Parent / caregiver', value: 'parent' },
        { label: 'Pre-retirement', value: 'pre-retirement' },
      ],
      triggers: () => true,
    },
    {
      id: 'dependents',
      question: "Who depends on you financially? This changes how much risk is responsible.",
      type: 'options',
      options: [
        { label: 'Just me', value: 'none' },
        { label: 'Partner', value: 'partner' },
        { label: 'Small family (1-2)', value: 'family-small' },
        { label: 'Larger family (3+)', value: 'family-large' },
        { label: 'Extended family', value: 'extended' },
      ],
      triggers: () => true,
    },
    {
      id: 'runway',
      question: "How many months could you sustain yourself without income?",
      type: 'options',
      options: [
        { label: 'Less than 1 month', value: '0' },
        { label: '1–3 months', value: '1-3' },
        { label: '3–6 months', value: '3-6' },
        { label: '6–12 months', value: '6-12' },
        { label: '12+ months', value: '12+' },
      ],
      triggers: (desc, cat) => ['career', 'business', 'finance', 'education'].includes(cat) || /startup|job|salary|money|quit|invest|business|funding|freelance|income|savings|debt/i.test(desc),
    },
    {
      id: 'emotional_state',
      question: "What's your headspace right now? Stress and excitement both warp judgment.",
      type: 'options',
      options: [
        { label: 'Calm & clear', value: 'calm' },
        { label: 'Excited — momentum pulling me', value: 'excited' },
        { label: 'Anxious about the wrong call', value: 'anxious' },
        { label: 'Pressured to decide fast', value: 'pressured' },
        { label: 'Burned out', value: 'burned-out' },
      ],
      triggers: () => true,
    },
    {
      id: 'risk_tolerance',
      question: "How do you actually handle uncertainty — not how you think you should, but how you do?",
      type: 'options',
      options: [
        { label: 'Very cautious — need certainty', value: 'very-cautious' },
        { label: 'Cautious — calculated bets', value: 'cautious' },
        { label: 'Moderate — measured risks', value: 'moderate' },
        { label: 'Aggressive — lean into uncertainty', value: 'aggressive' },
        { label: 'Very aggressive — swing big', value: 'very-aggressive' },
      ],
      triggers: () => true,
    },
    {
      id: 'cultural',
      question: "Are cultural or family expectations shaping your options?",
      type: 'options',
      options: [
        { label: 'No — independent decision', value: 'none' },
        { label: 'Some, but I can push back', value: 'some' },
        { label: 'Strong expectations', value: 'strong' },
        { label: 'Dominant — defying has consequences', value: 'dominant' },
      ],
      triggers: (desc) => /family|parents|mother|father|culture|tradition|expect|pressure|community|marry|marriage|partner/i.test(desc),
    },
    {
      id: 'health_energy',
      question: "How's your physical energy and health right now?",
      type: 'options',
      options: [
        { label: 'Great — high energy', value: 'high' },
        { label: 'Average — managing', value: 'average' },
        { label: 'Low — health or fatigue issues', value: 'low' },
        { label: 'Dealing with a health condition', value: 'condition' },
      ],
      triggers: (desc, cat) => cat === 'health' || /health|energy|tired|burnout|surgery|therapy|medication|fitness|sleep|exhausted|stress/i.test(desc),
    },
    {
      id: 'support_network',
      question: "Do you have people you can lean on — mentors, friends, a network?",
      type: 'options',
      options: [
        { label: 'Strong support system', value: 'strong' },
        { label: 'A few key people', value: 'moderate' },
        { label: 'Mostly on my own', value: 'weak' },
        { label: 'Isolated — no support', value: 'none' },
      ],
      triggers: (desc, cat) => ['career', 'business', 'education'].includes(cat) || /startup|relocat|move|alone|partner|mentor|network|lonely|isola/i.test(desc),
    },
    {
      id: 'time_pressure',
      question: "Is there a hard deadline forcing this decision, or can you take your time?",
      type: 'options',
      options: [
        { label: 'No rush — I have time', value: 'none' },
        { label: 'Soft deadline (weeks)', value: 'soft' },
        { label: 'Hard deadline (days)', value: 'hard' },
        { label: 'Urgent — need to decide now', value: 'urgent' },
      ],
      triggers: (desc) => !state.deadline && /deadline|urgent|soon|quickly|fast|running out|expir|offer expires|asap/i.test(desc),
    },
    {
      id: 'past_attempts',
      question: "Have you tried something similar before? What happened?",
      type: 'text',
      placeholder: "e.g. I tried freelancing in 2022 but couldn't find clients",
      triggers: (desc) => /again|before|tried|attempt|retry|failed|last time|previous/i.test(desc),
    },
  ];

  // Lighter follow-up questions for daily/casual decisions
  const DAILY_FOLLOWUP_QUESTIONS = [
    {
      id: 'mood_right_now',
      question: "What's your vibe right now?",
      type: 'options',
      options: [
        { label: 'Energized — ready to go', value: 'energized' },
        { label: 'Chill — want something easy', value: 'chill' },
        { label: 'Tired — low battery', value: 'tired' },
        { label: 'Bored — need stimulation', value: 'bored' },
        { label: 'Stressed — need relief', value: 'stressed' },
      ],
      triggers: () => true,
    },
    {
      id: 'time_available',
      question: "How much time do you have?",
      type: 'options',
      options: [
        { label: '30 min or less', value: '30min' },
        { label: '1–2 hours', value: '1-2h' },
        { label: 'Half the day', value: 'half-day' },
        { label: 'Whole day free', value: 'full-day' },
      ],
      triggers: () => true,
    },
    {
      id: 'solo_or_social',
      question: "Solo or with people?",
      type: 'options',
      options: [
        { label: 'Solo — me time', value: 'solo' },
        { label: 'With a friend or partner', value: 'duo' },
        { label: 'Group / social', value: 'group' },
        { label: 'Doesn\'t matter', value: 'any' },
      ],
      triggers: (desc) => /friend|hang|social|alone|partner|date|group|together|someone/i.test(desc) || !/eat|food|pizza|sushi|cook|hungry/i.test(desc),
    },
    {
      id: 'priority_today',
      question: "What matters most to you right now?",
      type: 'options',
      options: [
        { label: 'Fun / enjoyment', value: 'fun' },
        { label: 'Health / feeling good', value: 'health' },
        { label: 'Productivity / progress', value: 'productivity' },
        { label: 'Saving money', value: 'money' },
        { label: 'Rest / recovery', value: 'rest' },
      ],
      triggers: () => true,
    },
    {
      id: 'recent_pattern',
      question: "Have you been doing a lot of one thing lately?",
      type: 'options',
      options: [
        { label: 'Too much screen time', value: 'screens' },
        { label: 'Too much work / grind', value: 'work' },
        { label: 'Too much junk food', value: 'junk-food' },
        { label: 'Too much staying in', value: 'staying-in' },
        { label: 'Nah, pretty balanced', value: 'balanced' },
      ],
      triggers: () => true,
    },
    {
      id: 'budget_today',
      question: "What's your budget for this?",
      type: 'options',
      options: [
        { label: 'Free / $0', value: 'free' },
        { label: 'A little ($5-20)', value: 'low' },
        { label: 'Moderate ($20-50)', value: 'moderate' },
        { label: 'Treat yourself ($50+)', value: 'splurge' },
      ],
      triggers: (desc) => /eat|food|restaurant|buy|shop|ticket|movie|concert|trip|go out|order|delivery/i.test(desc),
    },
  ];

  let followupQueue = [];
  let followupIndex = 0;
  let followupAnswers = {};

  function isDaily(category, description) {
    if (category === 'daily') return true;
    const dailyKeys = ['food_eat_out', 'food_cook', 'food_choice', 'watch_series', 'creative_activity', 'exercise_activity', 'social_activity', 'stay_in', 'go_somewhere', 'shopping', 'learn_something'];
    const matches = matchResearch(description);
    return matches.length > 0 && dailyKeys.includes(matches[0].key);
  }

  function buildFollowupQueue(description, category) {
    if (isDaily(category, description)) {
      // Lighter, faster questions for everyday decisions
      const relevant = DAILY_FOLLOWUP_QUESTIONS.filter(q => q.triggers(description, category));
      return relevant.slice(0, 3); // Max 3 for daily — keep it snappy
    }
    // Serious decisions: full personalization
    const relevant = FOLLOWUP_QUESTIONS.filter(q => q.triggers(description, category));
    return relevant.slice(0, 6);
  }

  function startFollowupChat() {
    const chatEl = $('#followup-chat');
    const messagesEl = $('#followup-messages');
    const inputArea = $('#followup-input-area');
    const doneArea = $('#followup-done-area');

    chatEl.hidden = false;
    messagesEl.innerHTML = '';
    inputArea.hidden = true;
    doneArea.hidden = true;
    followupAnswers = {};
    followupIndex = 0;
    followupQueue = buildFollowupQueue(state.decision, state.category);

    // Adapt header for daily vs serious
    const daily = isDaily(state.category, state.decision);
    const headerH4 = chatEl.querySelector('.followup-header h4');
    const headerP = chatEl.querySelector('.followup-sub');
    if (daily) {
      headerH4.textContent = 'Quick context check';
      headerP.innerHTML = 'A couple fast questions so the answer fits <em>your</em> moment.';
    } else {
      headerH4.textContent = 'Let me understand your world';
      headerP.innerHTML = 'A few quick questions so the analysis fits <em>your</em> life, not a generic one.';
    }

    // Update done text for daily
    const doneText = chatEl.querySelector('.followup-done-text');
    if (doneText) {
      doneText.textContent = daily
        ? 'Got it — running the numbers on this real quick.'
        : 'Got it — I have what I need. Running your personalized analysis now.';
    }

    // Short delay then show first question
    setTimeout(() => showNextFollowupQuestion(), 600);
  }

  function showNextFollowupQuestion() {
    const messagesEl = $('#followup-messages');
    const inputArea = $('#followup-input-area');
    const optionsEl = $('#followup-options');
    const textWrap = $('#followup-text-wrap');
    const doneArea = $('#followup-done-area');

    if (followupIndex >= followupQueue.length) {
      // All questions asked — show done
      inputArea.hidden = true;
      doneArea.hidden = false;
      doneArea.classList.add('followup-fade-in');
      // Collect into state.context — merge all answers (serious + daily)
      state.context = {
        // Serious decision keys (camelCase)
        location: followupAnswers.location || '',
        lifeStage: followupAnswers.life_stage || '',
        dependents: followupAnswers.dependents || '',
        runway: followupAnswers.runway || '',
        emotionalState: followupAnswers.emotional_state || '',
        riskTolerance: followupAnswers.risk_tolerance || '',
        cultural: followupAnswers.cultural || '',
        healthEnergy: followupAnswers.health_energy || '',
        supportNetwork: followupAnswers.support_network || '',
        timePressure: followupAnswers.time_pressure || '',
        pastAttempts: followupAnswers.past_attempts || '',
        // Daily decision keys (keep underscores for direct access)
        mood_right_now: followupAnswers.mood_right_now || '',
        time_available: followupAnswers.time_available || '',
        solo_or_social: followupAnswers.solo_or_social || '',
        priority_today: followupAnswers.priority_today || '',
        recent_pattern: followupAnswers.recent_pattern || '',
        budget_today: followupAnswers.budget_today || '',
      };
      return;
    }

    const q = followupQueue[followupIndex];

    // Add question bubble with typing indicator first
    const typingEl = document.createElement('div');
    typingEl.className = 'followup-msg followup-bot followup-typing';
    typingEl.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    messagesEl.appendChild(typingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    setTimeout(() => {
      // Replace typing with actual question
      typingEl.classList.remove('followup-typing');
      typingEl.innerHTML = `<p>${escapeHtml(q.question)}</p>`;
      typingEl.classList.add('followup-fade-in');
      messagesEl.scrollTop = messagesEl.scrollHeight;

      // Show input area
      inputArea.hidden = false;

      if (q.type === 'options') {
        optionsEl.innerHTML = '';
        textWrap.hidden = true;
        q.options.forEach(opt => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'followup-option-btn';
          btn.textContent = opt.label;
          btn.addEventListener('click', () => handleFollowupAnswer(q.id, opt.value, opt.label));
          optionsEl.appendChild(btn);
        });
        // Add skip
        const skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.className = 'followup-option-btn followup-skip';
        skipBtn.textContent = 'Skip';
        skipBtn.addEventListener('click', () => handleFollowupAnswer(q.id, '', 'Skipped'));
        optionsEl.appendChild(skipBtn);
        optionsEl.hidden = false;
      } else {
        optionsEl.hidden = true;
        textWrap.hidden = false;
        const input = $('#followup-text');
        input.placeholder = q.placeholder || 'Type your answer...';
        input.value = '';
        input.focus();
        // Handle enter
        input.onkeydown = (e) => {
          if (e.key === 'Enter' && input.value.trim()) {
            handleFollowupAnswer(q.id, input.value.trim(), input.value.trim());
          }
        };
        $('#followup-send').onclick = () => {
          if (input.value.trim()) {
            handleFollowupAnswer(q.id, input.value.trim(), input.value.trim());
          }
        };
      }
    }, 800);
  }

  function handleFollowupAnswer(questionId, value, displayText) {
    const messagesEl = $('#followup-messages');
    const inputArea = $('#followup-input-area');

    // Store answer
    followupAnswers[questionId] = value;

    // Add user answer bubble
    const userMsg = document.createElement('div');
    userMsg.className = 'followup-msg followup-user followup-fade-in';
    userMsg.innerHTML = `<p>${escapeHtml(displayText)}</p>`;
    messagesEl.appendChild(userMsg);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Hide input while transitioning
    inputArea.hidden = true;

    followupIndex++;
    setTimeout(() => showNextFollowupQuestion(), 400);
  }

  // Wire "Run full analysis" to start conversation follow-up
  $('#ai-analyze-btn').addEventListener('click', () => {
    state.decision = decisionInput.value.trim();
    state.category = $('#decision-category').value;
    state.timeHorizon = $('#time-horizon').value;
    state.deadline = $('#decision-deadline').value;

    // Hide form and show conversation
    const methodPreview = $('#methodology-preview');
    if (methodPreview) methodPreview.hidden = true;
    $('#ai-analyze-btn').closest('.step-nav').hidden = true;

    startFollowupChat();
  });

  // Handle "Run analysis" from the follow-up done area
  $('#followup-run-btn').addEventListener('click', async () => {
    const chatEl = $('#followup-chat');
    const loading = $('#ai-loading');

    chatEl.hidden = true;
    loading.hidden = false;

    // Animate pipeline steps
    const pipelineSteps = $$('.pipeline-step', $('#loading-pipeline'));
    pipelineSteps.forEach(s => { s.classList.remove('active', 'done'); });
    let pipelineIdx = 0;
    const pipelineInterval = setInterval(() => {
      if (pipelineIdx > 0 && pipelineIdx <= pipelineSteps.length) {
        pipelineSteps[pipelineIdx - 1].classList.remove('active');
        pipelineSteps[pipelineIdx - 1].classList.add('done');
      }
      if (pipelineIdx < pipelineSteps.length) {
        pipelineSteps[pipelineIdx].classList.add('active');
        pipelineIdx++;
      } else {
        clearInterval(pipelineInterval);
      }
    }, 2200);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: state.decision,
          category: state.category,
          timeHorizon: state.timeHorizon,
          deadline: state.deadline,
          personalContext: state.context,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `API error ${res.status}`);
      }

      const { analysis } = await res.json();
      clearInterval(pipelineInterval);
      pipelineSteps.forEach(s => { s.classList.remove('active'); s.classList.add('done'); });
      renderAIResults(analysis);
      showScreen('results');
    } catch (err) {
      clearInterval(pipelineInterval);
      console.error('AI analysis failed:', err);
      loading.hidden = true;

      // Restore form controls
      const methodPreview = $('#methodology-preview');
      if (methodPreview) methodPreview.hidden = false;
      const stepNav = $('[data-wizard-step="1"] .step-nav');
      if (stepNav) stepNav.hidden = false;
      chatEl.hidden = true;
      validateStep1();
      alert(`Analysis unavailable: ${err.message}\n\nUse "Build manually" to analyze with the local engine instead.`);
    }
  });

  // ================================================================
  // VOICE INPUT
  // ================================================================
  const voiceBtn = $('#voice-btn');
  let recognition = null;
  let voiceStream = null;
  let voiceAnimFrame = null;

  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript + ' ';
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      decisionInput.value = finalTranscript + interim;
      const len = decisionInput.value.length;
      $('#char-count').textContent = `${len.toLocaleString()} / 3,000`;
      validateStep1();
    };

    recognition.onerror = () => stopVoice();
    recognition.onend = () => stopVoice();

    voiceBtn.addEventListener('click', () => {
      if (voiceBtn.classList.contains('recording')) {
        stopVoice();
      } else {
        startVoice();
      }
    });

    function startVoice() {
      finalTranscript = decisionInput.value;
      voiceBtn.classList.add('recording');
      recognition.start();
      // Start waveform visualization
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        voiceStream = stream;
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const canvas = $('#voice-waveform');
        const cCtx = canvas.getContext('2d');
        function drawWave() {
          voiceAnimFrame = requestAnimationFrame(drawWave);
          analyser.getByteFrequencyData(data);
          cCtx.clearRect(0, 0, 80, 24);
          const bars = 16;
          const w = 3;
          const gap = 2;
          for (let i = 0; i < bars; i++) {
            const v = data[i] / 255;
            const h = Math.max(2, v * 22);
            const x = i * (w + gap);
            cCtx.fillStyle = v > 0.5 ? '#D71921' : 'rgba(255,255,255,0.3)';
            cCtx.fillRect(x, 12 - h / 2, w, h);
          }
        }
        drawWave();
      }).catch(() => {});
    }

    function stopVoice() {
      voiceBtn.classList.remove('recording');
      try { recognition.stop(); } catch {}
      if (voiceStream) { voiceStream.getTracks().forEach(t => t.stop()); voiceStream = null; }
      if (voiceAnimFrame) { cancelAnimationFrame(voiceAnimFrame); voiceAnimFrame = null; }
      const canvas = $('#voice-waveform');
      const cCtx = canvas.getContext('2d');
      cCtx.clearRect(0, 0, 80, 24);
    }
  } else {
    voiceBtn.style.display = 'none';
  }

  // ================================================================
  // SCROLL REVEAL — sections animate in on scroll
  // ================================================================
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  function observeRevealSections() {
    $$('.reveal-section').forEach(el => {
      el.classList.remove('revealed');
      revealObserver.observe(el);
    });
  }

  // ================================================================
  // VERDICT PARTICLES
  // ================================================================
  function spawnParticles() {
    const container = $('#verdict-particles');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 24; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      const angle = (Math.PI * 2 * i) / 24 + (Math.random() - 0.5) * 0.5;
      const dist = 60 + Math.random() * 80;
      p.style.left = '50%';
      p.style.top = '50%';
      p.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
      p.style.setProperty('--ty', `${Math.sin(angle) * dist}px`);
      p.style.animationDelay = `${Math.random() * 0.5}s`;
      p.style.width = p.style.height = `${2 + Math.random() * 3}px`;
      if (Math.random() > 0.6) p.style.background = '#fff';
      container.appendChild(p);
    }
  }

  // ================================================================
  // BUTTON RIPPLE
  // ================================================================
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn || btn.disabled) return;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'btn-ripple';
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });

  // ================================================================
  // SHARE
  // ================================================================
  $('#share-btn').addEventListener('click', async () => {
    const verdict = $('.verdict-heading')?.textContent || 'My Rational Analysis';
    const sub = $('#verdict-sub')?.textContent || '';
    const shareText = `${verdict}\n${sub}\n\nAnalyzed with Rational — 7 frameworks, 1 clear answer.`;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'Rational Analysis', text: shareText, url: window.location.origin });
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(shareText + '\n' + window.location.origin);
        const toast = $('#share-toast');
        toast.hidden = false;
        requestAnimationFrame(() => toast.classList.add('visible'));
        setTimeout(() => {
          toast.classList.remove('visible');
          setTimeout(() => { toast.hidden = true; }, 400);
        }, 2500);
      } catch {}
    }
  });

  // Hook into screen transitions to trigger animations
  const _origShowScreen = showScreen;
  showScreen = function(id) {
    _origShowScreen(id);
    if (id === 'results') {
      spawnParticles();
      setTimeout(observeRevealSections, 100);
    }
  };

  // PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  const urlParams = new URLSearchParams(window.location.search);
  const urlAction = urlParams.get('action');
  if (urlAction === 'new') {
    showScreen('wizard'); showStep(1); seedOptions();
    setTimeout(() => decisionInput.focus(), 100);
    window.history.replaceState({}, '', '/');
  } else if (urlAction === 'dashboard') {
    renderDashboard(); showScreen('dashboard');
    window.history.replaceState({}, '', '/');
  }

})();
