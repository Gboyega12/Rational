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
  const MEMORY_KEY = 'rational_user';

  // User Memory — persistent profile that learns over time
  const UserMemory = {
    _profile: null,

    _defaults() {
      return {
        name: '',
        location: '',
        lifeStage: '',
        dependents: '',
        riskTolerance: '',
        runway: '',
        cultural: '',
        questionsAsked: 0,
        topCategories: {},       // { daily: 5, career: 3, ... }
        recentMoods: [],         // last 10 moods
        recentPatterns: [],      // last 10 patterns
        lastSeen: null,
        firstSeen: null,
        preferences: {},         // learned from past answers
        version: 1,
      };
    },

    load() {
      try {
        const raw = localStorage.getItem(MEMORY_KEY);
        this._profile = raw ? JSON.parse(raw) : this._defaults();
        if (!this._profile.version) this._profile = { ...this._defaults(), ...this._profile, version: 1 };
      } catch { this._profile = this._defaults(); }
      return this._profile;
    },

    save() {
      try { localStorage.setItem(MEMORY_KEY, JSON.stringify(this._profile)); } catch {}
    },

    get profile() { return this._profile; },

    // Learn from a follow-up answer — store it permanently if it's a stable trait
    learnFromAnswer(questionId, value) {
      if (!value) return;
      const stableTraits = ['location', 'life_stage', 'dependents', 'risk_tolerance', 'runway', 'cultural'];
      if (stableTraits.includes(questionId)) {
        const key = questionId.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); // snake_case to camelCase
        this._profile[key] = value;
      }
      if (questionId === 'mood_right_now' || questionId === 'emotional_state') {
        this._profile.recentMoods.push({ value, ts: Date.now() });
        if (this._profile.recentMoods.length > 10) this._profile.recentMoods.shift();
      }
      if (questionId === 'recent_pattern') {
        this._profile.recentPatterns.push({ value, ts: Date.now() });
        if (this._profile.recentPatterns.length > 10) this._profile.recentPatterns.shift();
      }
      this._profile.preferences[questionId] = value;
      this.save();
    },

    // Record that a question was asked in a category
    recordQuestion(category) {
      this._profile.questionsAsked++;
      if (category) {
        this._profile.topCategories[category] = (this._profile.topCategories[category] || 0) + 1;
      }
      this._profile.lastSeen = Date.now();
      if (!this._profile.firstSeen) this._profile.firstSeen = Date.now();
      this.save();
    },

    // Check if we already know a stable trait (skip the question)
    knows(questionId) {
      const key = questionId.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      return !!this._profile[key];
    },

    // Get stored value for a trait
    get(questionId) {
      const key = questionId.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      return this._profile[key] || this._profile.preferences[questionId] || '';
    },

    // Get greeting based on history
    getGreeting() {
      const p = this._profile;
      if (!p.firstSeen) return { headline: "What's on your mind?", sub: "Ask me anything — big life decisions or what to eat for dinner." };

      const days = Math.floor((Date.now() - p.firstSeen) / 86400000);
      const total = p.questionsAsked;
      const topCat = Object.entries(p.topCategories).sort((a, b) => b[1] - a[1])[0];
      const name = p.name ? `, ${p.name}` : '';

      if (total === 0) return { headline: "What's on your mind?", sub: "Ask me anything — big life decisions or what to eat for dinner." };

      const lastMood = p.recentMoods[p.recentMoods.length - 1];
      const hoursSinceLast = p.lastSeen ? (Date.now() - p.lastSeen) / 3600000 : 999;

      if (hoursSinceLast < 2) return { headline: `Back again${name}?`, sub: `You've asked ${total} question${total > 1 ? 's' : ''} — what's next?` };
      if (hoursSinceLast < 24) return { headline: `Hey${name}`, sub: "What are we figuring out today?" };
      if (days > 7) return { headline: `Been a minute${name}`, sub: `${total} decisions logged over ${days} days. What's new?` };
      return { headline: `What's the move${name}?`, sub: topCat ? `You ask about ${topCat[0]} a lot — is this another one?` : "Big or small, I'm here." };
    },

    // Get the dominant mood pattern
    getMoodPattern() {
      const moods = this._profile.recentMoods;
      if (moods.length < 3) return null;
      const counts = {};
      moods.forEach(m => { counts[m.value] = (counts[m.value] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (top[1] >= 3) return top[0]; // dominant mood if 3+ of last 10
      return null;
    },
  };

  UserMemory.load();

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
    const el = $(`#${id}`);
    if (el) el.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Trigger animations on answer screen
    if (id === 'answer') {
      spawnParticles();
      setTimeout(observeRevealSections, 100);
    }
  }

  // ================================================================
  // HOME — Two-door hub + decision input screen
  // ================================================================
  const decisionInput = $('#decision-input');
  const sendBtn = $('#send-btn');

  // "Make a decision" door
  $('#decide-entry-btn').addEventListener('click', () => {
    showScreen('decide-input');
    decisionInput.value = '';
    validateInput();
    decisionInput.focus();
  });

  // "Decide" screen back button
  $('#decide-back').addEventListener('click', () => {
    showScreen('home');
    initHome();
  });

  function initHome() {
    // Set dynamic greeting from UserMemory
    const greeting = UserMemory.getGreeting();
    $('#home-heading').textContent = greeting.headline;
    $('#greeting-sub').textContent = greeting.sub;

    // Show recent questions
    const decisions = Store._data.decisions.slice(0, 5);
    const recentEl = $('#recent-questions');
    const recentList = $('#recent-list');
    if (decisions.length > 0) {
      recentEl.hidden = false;
      recentList.innerHTML = decisions.map(d => {
        const short = d.decision.length > 60 ? d.decision.slice(0, 57) + '...' : d.decision;
        return `<button type="button" class="recent-item" data-question="${escapeHtml(d.decision)}">
          <span class="recent-text">${escapeHtml(short)}</span>
          <span class="recent-answer">${escapeHtml(d.recommendation || '')}</span>
        </button>`;
      }).join('');

      // Click recent to re-ask
      $$('.recent-item', recentList).forEach(btn => {
        btn.addEventListener('click', () => {
          showScreen('decide-input');
          decisionInput.value = btn.dataset.question;
          autoResize();
          validateInput();
        });
      });
    } else {
      recentEl.hidden = true;
    }

    decisionInput.value = '';
    validateInput();
  }

  function validateInput() {
    const valid = decisionInput.value.trim().length >= 5;
    sendBtn.disabled = !valid;
  }

  function autoResize() {
    decisionInput.style.height = 'auto';
    decisionInput.style.height = Math.min(decisionInput.scrollHeight, 160) + 'px';
  }

  decisionInput.addEventListener('input', () => {
    autoResize();
    validateInput();
  });
  decisionInput.addEventListener('change', () => validateInput());
  decisionInput.addEventListener('paste', () => setTimeout(validateInput, 0));

  // Send button — start analysis flow
  sendBtn.addEventListener('click', () => {
    if (decisionInput.value.trim().length >= 5) startAnalysisFlow();
  });

  // Enter to send (shift+enter for newline)
  decisionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && decisionInput.value.trim().length >= 5) {
      e.preventDefault();
      startAnalysisFlow();
    }
  });

  function startAnalysisFlow() {
    state.decision = decisionInput.value.trim();
    state.category = '';
    state.timeHorizon = '';
    state.deadline = '';
    state.context = {};

    // Auto-detect category
    const parsed = parseDescription(state.decision, '');
    state.category = parsed.category || '';

    // Record in memory
    UserMemory.recordQuestion(state.category);

    // Pre-fill known context from memory
    const mem = UserMemory.profile;
    state.context = {
      location: mem.location || '',
      lifeStage: mem.lifeStage || '',
      dependents: mem.dependents || '',
      runway: mem.runway || '',
      riskTolerance: mem.riskTolerance || '',
      cultural: mem.cultural || '',
    };

    // Go to follow-up questions
    showScreen('followup');
    startFollowupChat();
  }

  // Back buttons — all go to hub
  $('#followup-back').addEventListener('click', () => { showScreen('home'); initHome(); });
  $('#answer-back').addEventListener('click', () => { showScreen('home'); initHome(); });
  $('#history-btn').addEventListener('click', () => { renderHistory(); showScreen('history'); });
  $('#history-back').addEventListener('click', () => { showScreen('home'); initHome(); });

  // Init on load
  initHome();

  // ================================================================
  // OPTIONS — Auto-generated from parsed description
  // ================================================================
  function collectOptionsFromParsed() {
    const parsed = parseDescription(state.decision, state.category);
    if (parsed.options.length >= 2) {
      state.options = parsed.options.map(opt => ({
        name: opt.name,
        bestDesc: opt.bestDesc,
        bestProb: (opt.bestProb || 50) / 100,
        bestPayoff: opt.bestPayoff || 0,
        worstDesc: opt.worstDesc,
        worstProb: (opt.worstProb || 50) / 100,
        worstPayoff: opt.worstPayoff || 0,
      }));
    } else if (parsed.options.length === 1) {
      state.options = [{
        name: parsed.options[0].name,
        bestDesc: parsed.options[0].bestDesc,
        bestProb: (parsed.options[0].bestProb || 50) / 100,
        bestPayoff: parsed.options[0].bestPayoff || 0,
        worstDesc: parsed.options[0].worstDesc,
        worstProb: (parsed.options[0].worstProb || 50) / 100,
        worstPayoff: parsed.options[0].worstPayoff || 0,
      }, {
        name: 'Stay on current path',
        bestDesc: 'Stability, no disruption',
        bestProb: 0.65,
        bestPayoff: Math.round((parsed.options[0].bestPayoff || 10) * 0.6),
        worstDesc: 'Missed opportunity',
        worstProb: 0.35,
        worstPayoff: Math.round((parsed.options[0].bestPayoff || 10) * 0.3),
      }];
    } else {
      // Fallback: generic two-option split
      state.options = [
        { name: 'Option A', bestDesc: 'Things go well', bestProb: 0.6, bestPayoff: 8, worstDesc: 'Things go badly', worstProb: 0.4, worstPayoff: 2 },
        { name: 'Option B', bestDesc: 'Things go well', bestProb: 0.5, bestPayoff: 7, worstDesc: 'Things go badly', worstProb: 0.5, worstPayoff: 3 },
      ];
    }

    // Store suggested base rate
    state._suggestedBaseRate = parsed.suggestedBaseRate;
    state._suggestedBaseFact = parsed.suggestedBaseFact;
    if (parsed.suggestedBaseRate) state.biases.baseRate = parsed.suggestedBaseRate;
  }

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

  // ================================================================
  // RENDER AI RESULTS — Flowing narrative, not rigid cards
  // ================================================================
  function formatAIContent(text) {
    // Convert AI markdown-like content to HTML
    if (!text) return '';
    return text
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Bullet points — lines starting with *
      .replace(/(?:^|\n)\* (.+)/g, (_, b) => `<li>${b}</li>`)
      // Wrap consecutive <li> in <ul>
      .replace(/(<li>.*?<\/li>(?:\s*<li>.*?<\/li>)*)/gs, '<ul>$1</ul>')
      // Paragraphs — double newlines
      .split(/\n\n+/)
      .map(p => {
        p = p.trim();
        if (!p || p.startsWith('<ul>')) return p;
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      })
      .join('\n');
  }

  function renderAIResults(ai) {
    // Verdict hero
    $('#answer-heading').innerHTML = escapeHtml(ai.verdict?.title || 'Analysis complete');
    $('#answer-subtitle').textContent = ai.verdict?.subtitle || '';

    // Build flowing narrative into #analysis-content
    const container = $('#analysis-content');
    container.innerHTML = '';

    if (ai.sections && ai.sections.length > 0) {
      ai.sections.forEach((section, i) => {
        const sectionEl = document.createElement('div');
        sectionEl.className = 'analysis-section reveal-section';
        sectionEl.innerHTML = `
          <h3 class="analysis-section-title">
            <span class="why-num">${String(i + 1).padStart(2, '0')}</span>
            ${escapeHtml(section.title)}
          </h3>
          <div class="narrative">${formatAIContent(section.content)}</div>`;
        container.appendChild(sectionEl);
      });
    }

    // Verdict detail — the full recommendation
    if (ai.verdict_detail) {
      const verdictEl = document.createElement('div');
      verdictEl.className = 'analysis-section analysis-verdict reveal-section';
      let verdictHtml = '<h3 class="analysis-section-title">The bottom line</h3><div class="narrative">';
      if (ai.verdict_detail.recommendation) {
        verdictHtml += formatAIContent(ai.verdict_detail.recommendation);
      }
      if (ai.verdict_detail.next_step) {
        verdictHtml += `<div class="callout"><strong>Next 30 days:</strong> ${escapeHtml(ai.verdict_detail.next_step)}</div>`;
      }
      if (ai.verdict_detail.hidden_insight) {
        verdictHtml += `<div class="callout">${escapeHtml(ai.verdict_detail.hidden_insight)}</div>`;
      }
      verdictHtml += '</div>';
      verdictEl.innerHTML = verdictHtml;
      container.appendChild(verdictEl);
    }

    // AI-generated follow-up questions
    if (ai.followup_questions && ai.followup_questions.length > 0) {
      state._aiFollowups = ai.followup_questions;
      renderAIFollowups(ai.followup_questions);
    }

    // Expiry
    renderExpiryBanner();

    // Save AI analysis in state
    state.analysisResults = { ai, mode: 'ai' };
  }

  function renderAIFollowups(questions) {
    // Show AI-suggested follow-up questions at the bottom of the answer
    const existing = $('#ai-followups');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'ai-followups';
    container.className = 'ai-followups';
    container.innerHTML = `
      <h4>Want a sharper answer?</h4>
      <p class="ai-followups-sub">These details would help me be more specific:</p>
      ${questions.map((q, i) => `
        <div class="ai-followup-item">
          <p class="ai-followup-q">${escapeHtml(q.question)}</p>
          ${q.why ? `<p class="ai-followup-why">${escapeHtml(q.why)}</p>` : ''}
        </div>
      `).join('')}
    `;

    const actions = $('.answer-actions');
    if (actions) actions.parentElement.insertBefore(container, actions);
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

  function runLocalAnalysis() {
    const evs = calculateEV();
    const bayesResults = calculateBayes(evs);
    const kellyResults = isDailyDecision() ? null : calculateKelly(evs);

    state.analysisResults = { evs, bayesResults, kellyResults };

    const sorted = [...evs].sort((a, b) => b.ev - a.ev);
    const best = sorted[0];
    const second = sorted[1];
    const evGap = sorted.length > 1 ? best.ev - second.ev : 0;
    const daily = isDailyDecision();
    const unit = daily ? getDailyUnit() : '';

    // Verdict hero
    if (evGap > 0) {
      $('#answer-heading').textContent = `Go with "${best.name}"`;
      $('#answer-subtitle').textContent = daily
        ? `It scores ${formatValue(best.ev)} on ${unit} — ${formatValue(evGap)} higher than the alternative.`
        : `The numbers give it an edge of ${formatNumber(evGap)} over your next best option.`;
    } else {
      $('#answer-heading').textContent = daily ? 'Both are solid picks' : 'Too close to call on numbers alone';
      $('#answer-subtitle').textContent = daily
        ? 'They score about the same — go with your gut on this one.'
        : 'Consider what matters most beyond the math — timing, energy, optionality.';
    }

    // Build flowing sections into #analysis-content
    const container = $('#analysis-content');
    container.innerHTML = '';
    const sections = [];

    // --- Expected Value ---
    let evHtml = '';
    evs.forEach(opt => {
      evHtml += `<p><strong>${escapeHtml(opt.name)}:</strong> `;
      if (daily) {
        evHtml += `If it goes well (${escapeHtml(opt.bestDesc)}, ~${Math.round(opt.bestProb * 100)}% chance), ${unit} score: ${formatValue(opt.bestPayoff)}. `;
        evHtml += `If it doesn't land (${escapeHtml(opt.worstDesc)}, ~${Math.round(opt.worstProb * 100)}% chance), score: ${formatValue(opt.worstPayoff)}. `;
        evHtml += `Weighted score: <em>${formatValue(opt.ev)}</em>.</p>`;
      } else {
        evHtml += `If things go well (${escapeHtml(opt.bestDesc)}, ~${Math.round(opt.bestProb * 100)}% chance), the value is ${formatNumber(opt.bestPayoff)}. `;
        evHtml += `If things go badly (${escapeHtml(opt.worstDesc)}, ~${Math.round(opt.worstProb * 100)}% chance), it's ${formatNumber(opt.worstPayoff)}. `;
        evHtml += `Weighted together: <em>${formatNumber(opt.ev)}</em>.</p>`;
      }
    });
    if (evs.length > 1 && best.ev > evs.filter(e => e.index !== best.index)[0]?.ev) {
      evHtml += daily
        ? `<div class="callout">By ${unit} score, <strong>"${escapeHtml(best.name)}"</strong> wins this round.</div>`
        : `<div class="callout">By expected value alone, <strong>"${escapeHtml(best.name)}"</strong> is the stronger path.</div>`;
    }
    sections.push({ title: 'Expected Value — what does the math say?', content: evHtml });

    // --- Base Rate ---
    if (state.biases.baseRate) {
      const br = state.biases.baseRate;
      const bestSuccessProb = Math.round(best.bestProb * 100);
      let brHtml = '';
      if (bestSuccessProb > br * 2) {
        Store.addBiasTrigger('overconfidence');
        brHtml += `<p>You estimated a <strong>${bestSuccessProb}%</strong> chance of a good outcome for "${escapeHtml(best.name)}" — but the typical success rate is only <strong>${br}%</strong>.</p>`;
        brHtml += `<p>That's a <em>${(bestSuccessProb / br).toFixed(1)}x gap</em>. You might have genuine reasons to be more optimistic, but most people overestimate their chances.</p>`;
        brHtml += `<div class="callout">What specifically makes your situation different from the average?</div>`;
      } else if (bestSuccessProb > br) {
        brHtml += `<p>Your estimate (${bestSuccessProb}%) is somewhat above the typical rate (${br}%). Could be justified if you have a real edge.</p>`;
      } else {
        brHtml += `<p>Your estimate (${bestSuccessProb}%) lines up with the base rate (${br}%). You're being realistic — that's a strong signal.</p>`;
      }
      sections.push({ title: 'Base Rate — what does the denominator say?', content: brHtml });
    }

    // --- Sunk Cost ---
    if (state.biases.sunkCost && state.biases.sunkCost !== 'none') {
      let sunkHtml = '';
      if (state.biases.sunkCost === 'heavy') {
        Store.addBiasTrigger('sunkCost');
        const optIdx = parseInt(state.biases.sunkCostOption, 10);
        const optName = state.options[optIdx]?.name || 'one option';
        const isBestEV = best.index === optIdx;
        if (isBestEV) {
          sunkHtml = `<p>You've invested heavily in <strong>"${escapeHtml(optName)}"</strong> and it happens to be the best option by the numbers. But ask yourself: if you were starting from zero today, would you still pick it?</p><div class="callout">If the answer is yes, proceed. The past investment is irrelevant — it's the future value that matters.</div>`;
        } else {
          sunkHtml = `<p>You've put a lot into <strong>"${escapeHtml(optName)}"</strong> — but the numbers say <strong>"${escapeHtml(best.name)}"</strong> has a higher expected value. This is the classic sunk cost trap.</p><div class="callout">The only question that matters: <strong>starting from today, which option gives you the most going forward?</strong></div>`;
        }
      } else {
        Store.addBiasTrigger('sunkCost');
        sunkHtml = '<p>You mentioned some prior investment. Watch for this — sometimes we stick with something just because we started it.</p>';
      }
      sections.push({ title: 'Sunk Cost — are you throwing good money after bad?', content: sunkHtml });
    }

    // --- Bayesian Update ---
    if (bayesResults) {
      let bayesHtml = '<p>When we blend your estimates with the real-world base rate, here\'s how the picture shifts:</p>';
      bayesResults.forEach(b => {
        const shift = b.posterior - b.prior;
        const dir = shift > 0.01 ? 'up' : shift < -0.01 ? 'down' : 'roughly the same';
        bayesHtml += `<p><strong>${escapeHtml(b.name)}:</strong> Your estimate of ${Math.round(b.prior * 100)}% adjusts ${dir} to <em>${Math.round(b.posterior * 100)}%</em>.</p>`;
      });
      const bestBayes = bayesResults.find(b => b.name === best.name);
      if (bestBayes && bestBayes.posterior < bestBayes.prior - 0.05) {
        bayesHtml += `<div class="callout">The evidence pulls "${escapeHtml(best.name)}" down from ${Math.round(bestBayes.prior * 100)}% to ${Math.round(bestBayes.posterior * 100)}%. Plan for lower odds than your gut says.</div>`;
      }
      sections.push({ title: 'Evidence Update — what the data says about your odds', content: bayesHtml });
    }

    // --- Survivorship ---
    if (state.biases.survivorship === 'yes') {
      Store.addBiasTrigger('survivorship');
      sections.push({ title: 'Survivorship Bias — are you comparing to the right people?', content: '<p>You mentioned being influenced by a specific success story. For every person who succeeded, there are usually <strong>dozens or hundreds who tried and failed</strong>. You never hear about them.</p><div class="callout">How many people actually attempted this, and what percentage succeeded?</div>' });
    }

    // --- Kelly Criterion ---
    if (!daily && kellyResults) {
      const bankroll = kellyResults[0]?.bankroll || 0;
      const hasEdge = kellyResults.some(k => k.fullKelly > 0);
      let kellyHtml = '';
      if (!hasEdge) {
        kellyHtml = '<p>None of your options have a clear mathematical edge worth betting aggressively. Commit cautiously.</p>';
      } else {
        kellyHtml = `<p>Given your total budget of <strong>${formatCurrency(bankroll)}</strong>:</p>`;
        kellyResults.forEach(k => {
          kellyHtml += k.fullKelly > 0
            ? `<p><strong>${escapeHtml(k.name)}:</strong> Commit up to <em>${formatCurrency(k.amount)}</em> (${(k.quarterKelly * 100).toFixed(1)}% of budget). Conservative but mathematically sound.</p>`
            : `<p><strong>${escapeHtml(k.name)}:</strong> The math says don't commit significant resources here.</p>`;
        });
      }
      sections.push({ title: 'How much to commit — sizing the bet', content: kellyHtml });
    }

    // --- Opportunity Cost ---
    if (!daily && evs.length >= 2) {
      const gap = Math.abs(best.ev - second.ev);
      let oppHtml = `<p>Choosing <strong>"${escapeHtml(second.name)}"</strong> over "${escapeHtml(best.name)}" costs you approximately <em>${formatNumber(gap)}</em> in expected value. That's the price of being wrong.</p>`;
      const ctx = state.context || {};
      if (ctx.emotionalState === 'burned-out' || ctx.emotionalState === 'pressured') {
        oppHtml += `<div class="callout">Hidden cost: the energy you're spending deliberating. Set a deadline to decide and commit.</div>`;
      }
      sections.push({ title: 'Opportunity Cost — what are you giving up?', content: oppHtml });
    }

    // --- Regret Minimization ---
    if (!daily) {
      let regretHtml = '';
      const bestUpside = best.bestPayoff;
      const bestDownside = Math.abs(best.worstPayoff);
      const ratio = bestUpside / Math.max(bestDownside, 1);
      if (ratio > 3) {
        regretHtml = `<p><strong>This is an asymmetric bet.</strong> The upside (${formatNumber(bestUpside)}) is ${ratio.toFixed(1)}x the downside (${formatNumber(best.worstPayoff)}). At 80 years old, you'll regret the things you didn't try far more than the things you tried and failed at.</p><div class="callout">When the upside is unbounded and the downside is survivable, the regret-minimizing choice is almost always to try.</div>`;
      } else {
        regretHtml = `<p><strong>The regret test:</strong> Imagine you're 80 years old, looking back at this moment. Which version of the story would you rather tell?</p>`;
        regretHtml += `<p>Research on end-of-life regrets consistently shows people regret the bold paths they <em>didn't</em> take more than the ones they tried and failed at — as long as the failure was survivable.</p>`;
      }
      sections.push({ title: 'Regret Minimization — what would 80-year-old you choose?', content: regretHtml });
    }

    // --- Reversibility ---
    if (!daily) {
      const name = (best.name || '').toLowerCase();
      const desc = state.decision.toLowerCase();
      const oneWay = ['marry', 'divorce', 'child', 'baby', 'tattoo', 'surgery', 'sell house', 'emigrate', 'drop out'];
      const hardReverse = ['buy house', 'mortgage', 'sign lease', 'commit', 'enroll', 'accept offer', 'quit', 'resign', 'relocate'];
      const easyReverse = ['try', 'test', 'experiment', 'freelance', 'side', 'part-time', 'course', 'pilot', 'beta'];
      let revLabel = 'Reversible with effort';
      if (oneWay.some(s => name.includes(s) || desc.includes(s))) revLabel = 'One-way door — take extra time';
      else if (hardReverse.some(s => name.includes(s) || desc.includes(s))) revLabel = 'Hard to reverse — get more data first';
      else if (easyReverse.some(s => name.includes(s) || desc.includes(s))) revLabel = 'Easily reversible — decide quickly';
      sections.push({ title: 'Reversibility — one-way door or two-way door?', content: `<p><strong>"${escapeHtml(best.name)}":</strong> ${revLabel}.</p><p>Amazon's framework: one-way doors demand careful deliberation. Two-way doors should be made fast — the cost of delay usually exceeds the cost of being wrong.</p>` });
    }

    // --- Pre-Mortem ---
    if (!daily) {
      let pmHtml = `<p><strong>Pre-mortem exercise:</strong> Imagine it's 12 months from now and "${escapeHtml(best.name)}" has failed spectacularly. What went wrong?</p>`;
      const failureModes = [];
      if (state.biases.baseRate && state.biases.baseRate < 50) {
        failureModes.push(`The base rate is ${state.biases.baseRate}% — the most likely failure is simply regression to the mean.`);
      }
      failureModes.push('The timing was wrong — the decision was sound but the context shifted.');
      failureModes.push('Execution killed it — the plan was right but you got distracted or under-resourced it.');
      pmHtml += '<ul>' + failureModes.map(m => `<li>${m}</li>`).join('') + '</ul>';
      pmHtml += '<div class="callout"><strong>The antidote:</strong> For each failure mode, write down one thing you\'ll do to detect it early — within 30-60 days instead of 6-12 months.</div>';
      sections.push({ title: 'Pre-Mortem — how does this fail?', content: pmHtml });
    }

    // Render all sections into #analysis-content
    sections.forEach((sec, i) => {
      const el = document.createElement('div');
      el.className = 'analysis-section reveal-section';
      el.innerHTML = `
        <h3 class="analysis-section-title">
          <span class="why-num">${String(i + 1).padStart(2, '0')}</span>
          ${escapeHtml(sec.title)}
        </h3>
        <div class="narrative">${sec.content}</div>`;
      container.appendChild(el);
    });

    // Final verdict
    const verdictEl = document.createElement('div');
    verdictEl.className = 'analysis-section analysis-verdict reveal-section';
    let verdictHtml = '<h3 class="analysis-section-title">The bottom line</h3><div class="narrative">';
    if (evs.length >= 2 && best.ev > second.ev) {
      verdictHtml += daily
        ? `<p><strong>Go with "${escapeHtml(best.name)}"</strong> — it scores ${formatValue(best.ev)} on ${unit}, beating "${escapeHtml(second.name)}" by ${formatValue(best.ev - second.ev)}.</p>`
        : `<p><strong>Your optimal path is "${escapeHtml(best.name)}"</strong> — expected value of ${formatNumber(best.ev)}, which is ${formatNumber(best.ev - second.ev)} more than "${escapeHtml(second.name)}".</p>`;
    } else {
      verdictHtml += daily
        ? '<p>Both options score about the same — pick whichever feels right in the moment.</p>'
        : '<p>The options are very close. The decision probably comes down to your energy, timing, and which path excites you more.</p>';
    }
    verdictHtml += '</div>';
    verdictEl.innerHTML = verdictHtml;
    container.appendChild(verdictEl);

    // Expiry banner
    renderExpiryBanner();
  }

  // Old static render functions removed — all rendering now goes through
  // renderAIResults (AI path) or runLocalAnalysis (local fallback)

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
  // AUTO-SAVE — save every analysis automatically
  // ================================================================
  function autoSaveDecision() {
    const results = state.analysisResults;
    if (!results) return;

    let recommendation, bestEV, options, outcomes;

    if (results.mode === 'ai' && results.ai) {
      recommendation = results.ai.verdict?.title || 'See analysis';
      bestEV = results.ai.ev?.sections?.[0]?.evValue || 0;
      options = (results.ai.ev?.sections || []).map(s => s.optionName);
      outcomes = {};
      (results.ai.ev?.sections || []).forEach((s, i) => {
        outcomes[i] = [{ description: s.evCalculation || s.optionName, probability: 0.5, payoff: s.evValue || 0 }];
      });
    } else {
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
      context: { ...state.context },
      timestamp: Date.now(),
      outcomeLogged: false,
      mode: results.mode || 'local',
    });
    state.currentDecisionId = Store._data.decisions[0].id;
  }

  // Export
  $('#export-btn').addEventListener('click', () => {
    let text = `RATIONAL ANALYSIS\n${'='.repeat(40)}\n\nDecision: ${state.decision}\n\n`;
    const heading = $('#answer-heading');
    const sub = $('#answer-subtitle');
    if (heading) text += `Answer: ${heading.textContent}\n`;
    if (sub) text += `${sub.textContent}\n\n`;
    $$('.why-card').forEach(card => {
      const summary = card.querySelector('summary');
      const body = card.querySelector('.why-body .narrative');
      if (summary) text += `${summary.textContent.trim()}\n${'-'.repeat(30)}\n`;
      if (body) text += body.textContent.trim() + '\n\n';
    });
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rational-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ================================================================
  // HISTORY
  // ================================================================
  function renderHistory() {
    const data = Store._data;
    const decisions = data.decisions;
    const hl = $('#history-list');
    const sub = $('#history-sub');
    const stats = $('#history-stats');

    if (decisions.length === 0) {
      hl.innerHTML = '<p class="empty">Nothing yet. Ask your first question.</p>';
      sub.textContent = '';
      stats.innerHTML = '';
      return;
    }

    sub.textContent = `${decisions.length} decision${decisions.length !== 1 ? 's' : ''} logged`;

    // Stats
    const accuracy = Store.getAccuracy();
    const categories = {};
    decisions.forEach(d => { if (d.category) categories[d.category] = (categories[d.category] || 0) + 1; });
    const topCat = Object.entries(categories).sort((a, b) => b[1] - a[1])[0];

    stats.innerHTML = `
      <div class="history-stat"><span class="stat-num">${decisions.length}</span><span class="stat-label">Total</span></div>
      <div class="history-stat"><span class="stat-num">${accuracy !== null ? Math.round(accuracy * 100) + '%' : '—'}</span><span class="stat-label">Accuracy</span></div>
      <div class="history-stat"><span class="stat-num">${topCat ? topCat[0] : '—'}</span><span class="stat-label">Top category</span></div>
    `;

    hl.innerHTML = decisions.map(d => {
      const short = d.decision.length > 80 ? d.decision.slice(0, 77) + '...' : d.decision;
      let badge = '';
      if (d.outcomeLogged) badge = '<span class="history-badge logged">Tracked</span>';
      else badge = '<span class="history-badge pending">Pending</span>';

      return `<div class="history-item" data-id="${d.id}">
        <div class="history-item-body">
          <div class="history-item-decision">${escapeHtml(short)}</div>
          <div class="history-item-meta">
            <span>${formatDate(d.timestamp)}</span>
            <span class="history-rec">${escapeHtml(d.recommendation || '')}</span>
            ${badge}
          </div>
        </div>
        ${!d.outcomeLogged ? `<button type="button" class="log-outcome-trigger" data-decision-id="${d.id}" aria-label="Log outcome">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.3 4.7L6 12 2.7 8.7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>` : ''}
      </div>`;
    }).join('');

    // Wire outcome logging
    $$('.log-outcome-trigger', hl).forEach(btn => {
      btn.addEventListener('click', () => openOutcomeModal(btn.dataset.decisionId));
    });

    // Bias profile
    const bp = data.biasProfile;
    const total = Object.values(bp).reduce((a, b) => a + b, 0);
    const bpSection = $('#bias-profile-section');
    if (total >= 2 && bpSection) {
      bpSection.hidden = false;
      const biasLabels = { sunkCost: 'Past investments', survivorship: 'Success stories', overconfidence: 'Overestimating odds', lossAversion: 'Avoiding risk' };
      const max = Math.max(...Object.values(bp), 1);
      $('#dash-bias-profile').innerHTML = Object.entries(bp).map(([k, v]) => `<div class="bias-bar">
        <div class="bias-bar-header"><span class="bias-bar-name">${biasLabels[k]}</span><span class="bias-bar-count">${v}×</span></div>
        <div class="bias-bar-track"><div class="bias-bar-fill ${k === 'sunkCost' ? 'sunk-cost' : k}" style="width:${(v / max) * 100}%"></div></div>
      </div>`).join('');
    }
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
    (d.options || []).forEach((name, i) => { os.innerHTML += `<option value="${i}">${letterForIndex(i)}. ${escapeHtml(name)}</option>`; });

    os.addEventListener('change', () => {
      const oi = os.value;
      const rs = $('#outcome-which-result');
      rs.innerHTML = '<option value="">—</option>';
      if (oi !== '' && d.outcomes && d.outcomes[oi]) {
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

    if (cr !== 'other' && d.outcomes && d.outcomes[co]) {
      const idx = parseInt(cr, 10);
      Store.addCalibrationPoint(d.outcomes[co][idx]?.probability || 0, 1);
      d.outcomes[co].forEach((o, i) => { if (i !== idx) Store.addCalibrationPoint(o.probability, 0); });
    }

    Store.updateDecision(currentLoggingId, {
      outcomeLogged: true,
      actualOutcome: { chosenOption: co, resultIndex: cr, actualPayoff: ap, loggedAt: Date.now() },
    });
    outcomeModal.close();
    renderHistory();
  });

  // Clear data
  $('#clear-data-btn').addEventListener('click', () => {
    if (confirm('Delete all decisions, patterns, and accuracy data?')) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(MEMORY_KEY);
      Store.load();
      UserMemory.load();
      renderHistory();
    }
  });

  // ================================================================
  // CONVERSATIONAL FOLLOW-UP — Hyper-personalization
  // ================================================================
  // Build contextual questions based on the user's actual input
  function buildContextualQuestions(description, category) {
    const desc = description.toLowerCase();
    const questions = [];

    // === ALWAYS: Where are you based? ===
    if (!UserMemory.knows('location')) {
      questions.push({
        id: 'location',
        question: "Where are you based? This shapes salaries, costs, and what's realistic.",
        type: 'text',
        placeholder: 'e.g. London, UK / Lagos, Nigeria / Austin, TX',
      });
    }

    // === MONEY — triggered by financial signals ===
    if (/salary|job|career|startup|funding|invest|business|freelance|income|quit|money|debt|savings|afford|budget|rent|mortgage|loan/i.test(desc)) {
      if (!UserMemory.knows('runway')) {
        questions.push({
          id: 'runway',
          question: "How long could you cover expenses with no income?",
          type: 'options',
          options: [
            { label: 'Less than a month', value: '0' },
            { label: '1–3 months', value: '1-3' },
            { label: '3–6 months', value: '3-6' },
            { label: '6–12 months', value: '6-12' },
            { label: '12+ months', value: '12+' },
          ],
        });
      }
    }

    // === WORK/ENERGY — triggered by demanding situations ===
    if (/labour|working|hours|exhausted|tired|burnout|overtime|grind|hustle|juggling|busy|10.?hr|12.?hr/i.test(desc)) {
      questions.push({
        id: 'energy_situation',
        question: "How's your energy day-to-day right now?",
        type: 'options',
        options: [
          { label: 'Good — I have bandwidth', value: 'good' },
          { label: 'Tight — stretched', value: 'tight' },
          { label: 'Running on fumes', value: 'low' },
          { label: 'Burned out', value: 'burned-out' },
        ],
      });
    }

    // === DEPENDENTS — triggered by family signals ===
    if (/family|wife|husband|partner|child|kid|baby|parent|depend|support|mortgage/i.test(desc) && !UserMemory.knows('dependents')) {
      questions.push({
        id: 'dependents',
        question: "Who depends on you financially?",
        type: 'options',
        options: [
          { label: 'Just me', value: 'none' },
          { label: 'Partner', value: 'partner' },
          { label: 'Small family', value: 'family-small' },
          { label: 'Larger family', value: 'family-large' },
        ],
      });
    }

    // === DEADLINE — triggered by urgency signals ===
    if (/deadline|offer|expir|window|closing|soon|urgent|running out|before|by next/i.test(desc)) {
      questions.push({
        id: 'time_pressure',
        question: "When does the window close?",
        type: 'text',
        placeholder: 'e.g. "offer expires Friday" or "no hard deadline"',
      });
    }

    // === STARTUP — triggered by entrepreneurship ===
    if (/startup|founder|mvp|beta|launch|app|saas|fintech|build|product|users|pitch|investor|funding|raise/i.test(desc)) {
      questions.push({
        id: 'traction',
        question: "What traction do you have? Users, revenue, interest — anything concrete.",
        type: 'text',
        placeholder: 'e.g. "built MVP, 0 users" or "50 beta users, 3 paying"',
      });
    }

    // === CAREER — triggered by job signals ===
    if (/job|career|role|position|offer|interview|promotion|switch|resign|quit|salary|boss|company|hire/i.test(desc)) {
      if (!UserMemory.knows('life_stage')) {
        questions.push({
          id: 'life_stage',
          question: "Where are you in your career?",
          type: 'options',
          options: [
            { label: 'Just starting', value: 'student' },
            { label: 'Early career (0-5 years)', value: 'early-career' },
            { label: 'Mid-career', value: 'mid-career' },
            { label: 'Pivoting to something new', value: 'career-change' },
          ],
        });
      }
    }

    // === EDUCATION/CERT — triggered by learning signals ===
    if (/cert|course|degree|master|mba|phd|exam|study|qualification|credential|training|bootcamp/i.test(desc)) {
      questions.push({
        id: 'cert_status',
        question: "How far along are you — and how much have you invested?",
        type: 'text',
        placeholder: 'e.g. "paid £500, halfway, exam in 3 months"',
      });
    }

    // === RELATIONSHIP ===
    if (/partner|relationship|marry|marriage|move in|break up|divorce|together|dating|commit/i.test(desc)) {
      questions.push({
        id: 'relationship_length',
        question: "How long have you been together?",
        type: 'text',
        placeholder: 'e.g. "3 years, they want to move in"',
      });
    }

    // === RELOCATION ===
    if (/move|relocat|city|country|abroad|emigrat|immigrat/i.test(desc)) {
      questions.push({
        id: 'relocation_ties',
        question: "What keeps you where you are now?",
        type: 'text',
        placeholder: 'e.g. "close family, cheap rent, good friends"',
      });
    }

    // === PAST ATTEMPTS ===
    if (/again|before|tried|attempt|retry|failed|last time|previous|second time/i.test(desc)) {
      questions.push({
        id: 'past_attempts',
        question: "What happened last time?",
        type: 'text',
        placeholder: 'e.g. "tried in 2022, couldn\'t find clients"',
      });
    }

    // === CULTURAL PRESSURE ===
    if (/family expect|parents want|culture|tradition|pressure|community|disapprov/i.test(desc) && !UserMemory.knows('cultural')) {
      questions.push({
        id: 'cultural',
        question: "How much weight do family expectations carry here?",
        type: 'options',
        options: [
          { label: 'None — my call', value: 'none' },
          { label: 'Some, but I can push back', value: 'some' },
          { label: 'Strong expectations', value: 'strong' },
          { label: 'Defying has consequences', value: 'dominant' },
        ],
      });
    }

    // === DAILY DECISIONS — lighter, faster ===
    if (isDaily(category, description)) {
      questions.length = 0;

      if (/eat|food|restaurant|cook|hungry|lunch|dinner|pizza|sushi|order/i.test(desc)) {
        questions.push({
          id: 'mood_right_now',
          question: "What sounds good — comfort or adventure?",
          type: 'options',
          options: [
            { label: 'Comfort — something reliable', value: 'chill' },
            { label: 'Adventure — try something new', value: 'energized' },
            { label: 'Healthy — feel good after', value: 'health' },
            { label: 'Quick — I\'m starving', value: 'tired' },
          ],
        });
      } else {
        questions.push({
          id: 'mood_right_now',
          question: "What's your energy like right now?",
          type: 'options',
          options: [
            { label: 'Energized', value: 'energized' },
            { label: 'Chill', value: 'chill' },
            { label: 'Tired', value: 'tired' },
            { label: 'Bored', value: 'bored' },
          ],
        });
      }

      if (/eat|food|buy|shop|ticket|trip|go out|order|delivery/i.test(desc)) {
        questions.push({
          id: 'budget_today',
          question: "Budget?",
          type: 'options',
          options: [
            { label: 'Free', value: 'free' },
            { label: '$5-20', value: 'low' },
            { label: '$20-50', value: 'moderate' },
            { label: 'Treat yourself', value: 'splurge' },
          ],
        });
      }

      return questions.slice(0, 2);
    }

    return questions.filter(q => !UserMemory.knows(q.id)).slice(0, 4);
  }

  // Legacy compat — kept for reference but unused
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
    return buildContextualQuestions(description, category);
  }

  function startFollowupChat() {
    const messagesEl = $('#chat-messages');
    const inputArea = $('#chat-input-area');
    const doneArea = $('#chat-done');

    messagesEl.innerHTML = '';
    inputArea.hidden = true;
    doneArea.hidden = true;
    followupAnswers = {};
    followupIndex = 0;
    followupQueue = buildFollowupQueue(state.decision, state.category);

    // Filter out questions we already know from memory
    followupQueue = followupQueue.filter(q => {
      if (UserMemory.knows(q.id)) {
        // Pre-fill from memory
        followupAnswers[q.id] = UserMemory.get(q.id);
        return false;
      }
      return true;
    });

    // If no questions needed, go straight to analysis
    if (followupQueue.length === 0) {
      collectContextFromAnswers();
      runFullAnalysis();
      return;
    }

    // Short delay then show first question
    setTimeout(() => showNextFollowupQuestion(), 600);
  }

  function showNextFollowupQuestion() {
    const messagesEl = $('#chat-messages');
    const inputArea = $('#chat-input-area');
    const optionsEl = $('#chat-options');
    const textWrap = $('#chat-text-wrap');
    const doneArea = $('#chat-done');

    if (followupIndex >= followupQueue.length) {
      // All questions asked — show done
      inputArea.hidden = true;
      doneArea.hidden = false;
      // Collect into state.context
      collectContextFromAnswers();
      return;
    }

    // Skip if we already know this from memory
    const q = followupQueue[followupIndex];
    if (UserMemory.knows(q.id)) {
      followupAnswers[q.id] = UserMemory.get(q.id);
      followupIndex++;
      showNextFollowupQuestion();
      return;
    }

    // Add question bubble with typing indicator first
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-msg chat-bot chat-typing';
    typingEl.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    messagesEl.appendChild(typingEl);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    setTimeout(() => {
      // Replace typing with actual question
      typingEl.classList.remove('chat-typing');
      typingEl.innerHTML = `<p>${escapeHtml(q.question)}</p>`;
      typingEl.classList.add('chat-fade-in');
      messagesEl.scrollTop = messagesEl.scrollHeight;

      // Show input area
      inputArea.hidden = false;

      if (q.type === 'options') {
        optionsEl.innerHTML = '';
        textWrap.hidden = true;
        q.options.forEach(opt => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'chat-option-btn';
          btn.textContent = opt.label;
          btn.addEventListener('click', () => handleFollowupAnswer(q.id, opt.value, opt.label));
          optionsEl.appendChild(btn);
        });
        // Add skip
        const skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.className = 'chat-option-btn chat-skip';
        skipBtn.textContent = 'Skip';
        skipBtn.addEventListener('click', () => handleFollowupAnswer(q.id, '', 'Skipped'));
        optionsEl.appendChild(skipBtn);
        optionsEl.hidden = false;
      } else {
        optionsEl.hidden = true;
        textWrap.hidden = false;
        const input = $('#chat-text-input');
        input.placeholder = q.placeholder || 'Type your answer...';
        input.value = '';
        input.focus();
        input.onkeydown = (e) => {
          if (e.key === 'Enter' && input.value.trim()) {
            handleFollowupAnswer(q.id, input.value.trim(), input.value.trim());
          }
        };
        $('#chat-send').onclick = () => {
          if (input.value.trim()) {
            handleFollowupAnswer(q.id, input.value.trim(), input.value.trim());
          }
        };
      }
    }, 800);
  }

  function collectContextFromAnswers() {
    // Merge all answers — both new contextual IDs and legacy IDs
    const a = followupAnswers;
    state.context = {
      location: a.location || UserMemory.get('location') || '',
      lifeStage: a.life_stage || UserMemory.get('life_stage') || '',
      dependents: a.dependents || UserMemory.get('dependents') || '',
      runway: a.runway || UserMemory.get('runway') || '',
      emotionalState: a.energy_situation || a.emotional_state || '',
      riskTolerance: a.risk_tolerance || UserMemory.get('risk_tolerance') || '',
      cultural: a.cultural || UserMemory.get('cultural') || '',
      timePressure: a.time_pressure || '',
      pastAttempts: a.past_attempts || '',
      traction: a.traction || '',
      certStatus: a.cert_status || '',
      relationshipLength: a.relationship_length || '',
      relocationTies: a.relocation_ties || '',
      mood_right_now: a.mood_right_now || '',
      budget_today: a.budget_today || '',
    };
  }

  function handleFollowupAnswer(questionId, value, displayText) {
    const messagesEl = $('#chat-messages');
    const inputArea = $('#chat-input-area');

    // Store answer
    followupAnswers[questionId] = value;

    // Learn from answer — persist stable traits
    UserMemory.learnFromAnswer(questionId, value);

    // Add user answer bubble
    const userMsg = document.createElement('div');
    userMsg.className = 'chat-msg chat-user chat-fade-in';
    userMsg.innerHTML = `<p>${escapeHtml(displayText)}</p>`;
    messagesEl.appendChild(userMsg);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Hide input while transitioning
    inputArea.hidden = true;

    followupIndex++;
    setTimeout(() => showNextFollowupQuestion(), 400);
  }

  // Wire "Run my analysis" button
  $('#chat-run-btn').addEventListener('click', () => {
    runFullAnalysis();
  });

  async function runFullAnalysis() {
    // Show thinking screen
    showScreen('thinking');

    // Collect options from parsed description
    collectOptionsFromParsed();

    // Animate thinking steps
    const stepsEl = $('#thinking-steps');
    stepsEl.innerHTML = '';

    function addStep(text) {
      const s = document.createElement('div');
      s.className = 'thinking-step chat-fade-in';
      s.textContent = text;
      stepsEl.appendChild(s);
    }

    addStep('Reading your question');

    // Try AI-powered analysis first
    try {
      await new Promise(r => setTimeout(r, 600));
      addStep('Connecting to AI');

      const personalContext = {};
      const mem = UserMemory.profile;
      if (mem.location) personalContext.location = mem.location;
      if (mem.lifeStage) personalContext.lifeStage = mem.lifeStage;
      if (mem.dependents) personalContext.dependents = mem.dependents;
      if (mem.riskTolerance) personalContext.riskTolerance = mem.riskTolerance;
      if (mem.runway) personalContext.runway = mem.runway;
      if (mem.cultural) personalContext.cultural = mem.cultural;
      const ctx = state.context || {};
      Object.entries(ctx).forEach(([k, v]) => { if (v) personalContext[k] = v; });

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: state.decision,
          category: state.category,
          timeHorizon: state.timeHorizon,
          deadline: state.deadline,
          personalContext,
        }),
      });

      if (!res.ok) throw new Error('API ' + res.status);
      const data = await res.json();

      if (data.analysis) {
        addStep('Building your answer');
        await new Promise(r => setTimeout(r, 400));
        renderAIResults(data.analysis);
        autoSaveDecision();
        showScreen('answer');
        return;
      }
      throw new Error('No analysis in response');
    } catch (err) {
      console.warn('AI analysis unavailable, using local engine:', err.message);
      addStep('Using local analysis');
      await new Promise(r => setTimeout(r, 400));
    }

    // Fallback: local engine
    runLocalAnalysis();
    autoSaveDecision();
    showScreen('answer');
  }

  // ================================================================
  // VOICE INPUT — Reusable voice-to-text for any input
  // ================================================================
  const hasSpeechAPI = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

  // Creates a voice input controller for a mic button + target textarea/input
  // Returns { start, stop, destroy } or null if Speech API unavailable
  function createVoiceInput(opts) {
    // opts: { micBtn, micHint, micRing, canvas, targetEl, hintText, listeningText, onUpdate }
    if (!hasSpeechAPI || !opts.micBtn) return null;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    const micBtn = opts.micBtn;
    const micIcon = micBtn.querySelector('.mic-icon');
    const micStop = micBtn.querySelector('.mic-stop');
    const micRing = opts.micRing || null;
    const micHint = opts.micHint || null;
    const canvas = opts.canvas || null;
    const hintText = opts.hintText || 'Tap to speak';
    const listeningText = opts.listeningText || 'Listening...';

    let finalTranscript = '';
    let stream = null;
    let animFrame = null;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript + ' ';
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      if (opts.targetEl) {
        opts.targetEl.value = finalTranscript + interim;
        // Auto-resize for textareas
        if (opts.targetEl.tagName === 'TEXTAREA') {
          opts.targetEl.style.height = 'auto';
          opts.targetEl.style.height = opts.targetEl.scrollHeight + 'px';
        }
      }
      if (opts.onUpdate) opts.onUpdate(finalTranscript + interim);
    };

    rec.onerror = () => stop();
    rec.onend = () => stop();

    function start() {
      finalTranscript = opts.targetEl ? opts.targetEl.value : '';
      micBtn.classList.add('recording');
      if (micIcon) micIcon.style.display = 'none';
      if (micStop) micStop.style.display = 'block';
      if (micRing) micRing.classList.add('active');
      if (micHint) micHint.textContent = listeningText;
      rec.start();

      navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
        stream = s;
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(s);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        const freqData = new Uint8Array(analyser.frequencyBinCount);
        if (!canvas) return;
        canvas.style.display = 'block';
        const cCtx = canvas.getContext('2d');
        function drawWave() {
          animFrame = requestAnimationFrame(drawWave);
          analyser.getByteFrequencyData(freqData);
          cCtx.clearRect(0, 0, canvas.width, canvas.height);
          const bars = 20, w = 3, gap = 3;
          for (let i = 0; i < bars; i++) {
            const v = freqData[i] / 255;
            const h = Math.max(2, v * canvas.height);
            const x = i * (w + gap);
            cCtx.fillStyle = v > 0.5 ? '#D71921' : 'rgba(255,255,255,0.3)';
            cCtx.fillRect(x, canvas.height / 2 - h / 2, w, h);
          }
        }
        drawWave();
      }).catch(() => {});
    }

    function stop() {
      micBtn.classList.remove('recording');
      if (micIcon) micIcon.style.display = '';
      if (micStop) micStop.style.display = 'none';
      if (micRing) micRing.classList.remove('active');
      if (micHint) micHint.textContent = hintText;
      try { rec.stop(); } catch {}
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      if (canvas) {
        canvas.style.display = 'none';
        const cCtx = canvas.getContext('2d');
        cCtx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    micBtn.addEventListener('click', () => {
      if (micBtn.classList.contains('recording')) stop(); else start();
    });

    return { start, stop };
  }

  // --- Home screen voice input ---
  const micBtn = $('#mic-btn');
  const homeVoice = createVoiceInput({
    micBtn,
    micHint: $('#mic-hint'),
    micRing: $('#mic-ring'),
    canvas: $('#voice-waveform'),
    targetEl: decisionInput,
    hintText: 'Tap to speak',
    listeningText: 'Listening...',
    onUpdate: () => { autoResize(); validateInput(); },
  });
  if (!homeVoice && micBtn) {
    micBtn.style.display = 'none';
    const hint = $('#mic-hint');
    if (hint) hint.style.display = 'none';
  }

  // --- Debate voice input ---
  const debateMicBtn = $('#debate-mic-btn');
  const debateVoice = createVoiceInput({
    micBtn: debateMicBtn,
    micHint: $('#debate-mic-hint'),
    micRing: $('#debate-mic-ring'),
    canvas: $('#debate-voice-waveform'),
    targetEl: $('#debate-argument-input'),
    hintText: 'Tap to speak your argument',
    listeningText: 'Listening — speak your side...',
  });
  if (!debateVoice && debateMicBtn) {
    debateMicBtn.style.display = 'none';
    const hint = $('#debate-mic-hint');
    if (hint) hint.style.display = 'none';
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
    const verdict = $('#answer-heading')?.textContent || 'My Rational Analysis';
    const sub = $('#answer-subtitle')?.textContent || '';
    const shareText = `${verdict}\n${sub}\n\nAnalyzed with Rational — 12 frameworks, 1 clear answer.`;

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

  // PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  // ================================================================
  // DEBATE — Multi-user argument settler
  // ================================================================
  const debateState = {
    roomCode: null,
    participantId: null,
    pollInterval: null,
    lastStatus: null,
    personality: 'straight',
  };

  // Personality picker chip selection
  const personalityOptions = $('#personality-options');
  if (personalityOptions) {
    personalityOptions.addEventListener('click', (e) => {
      const chip = e.target.closest('.personality-chip');
      if (!chip) return;
      personalityOptions.querySelectorAll('.personality-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      debateState.personality = chip.dataset.personality;
    });
  }

  // Entry point
  const debateEntryBtn = $('#debate-entry-btn');
  if (debateEntryBtn) {
    debateEntryBtn.addEventListener('click', () => {
      showScreen('debate');
      resetDebateLobby();
    });
  }

  $('#debate-back').addEventListener('click', () => {
    stopDebatePolling();
    if (debateVoice) debateVoice.stop();
    showScreen('home');
    initHome();
  });

  function resetDebateLobby() {
    $('#debate-lobby').hidden = false;
    $('#debate-room').hidden = true;
    $('#debate-verdict').hidden = true;
    $('#debate-create-card').hidden = false;
    $('#debate-create-fields').hidden = true;
    $('#debate-join-fields').hidden = true;
    $('#debate-create-link').hidden = true;
    $('#debate-error').hidden = true;
    debateState.roomCode = null;
    debateState.participantId = null;
    stopDebatePolling();
  }

  // "Or start a new debate instead" link from invite landing
  $('#debate-show-create').addEventListener('click', (e) => {
    e.preventDefault();
    $('#debate-create-card').hidden = false;
    $('#debate-create-link').hidden = true;
    $('#debate-join-fields').hidden = true;
    $('#debate-join-code').value = '';
    $('#debate-create-fields').hidden = false;
    $('#debate-topic').focus();
  });

  // Toggle create/join forms
  $('#debate-create-card').addEventListener('click', (e) => {
    if (e.target.closest('input, button')) return;
    const fields = $('#debate-create-fields');
    fields.hidden = !fields.hidden;
    if (!fields.hidden) {
      $('#debate-join-fields').hidden = true;
      $('#debate-topic').focus();
    }
  });

  $('#debate-join-card').addEventListener('click', (e) => {
    if (e.target.closest('input, button')) return;
    const fields = $('#debate-join-fields');
    fields.hidden = !fields.hidden;
    if (!fields.hidden) {
      $('#debate-create-fields').hidden = true;
      $('#debate-join-code').focus();
    }
  });

  // CREATE room
  $('#debate-create-btn').addEventListener('click', async () => {
    const topic = $('#debate-topic').value.trim();
    const name = $('#debate-creator-name').value.trim() || 'Person 1';
    if (topic.length < 5) return showDebateError('Topic needs to be at least 5 characters.');

    showDebateError('');
    $('#debate-create-btn').disabled = true;
    $('#debate-create-btn').textContent = 'Creating...';

    try {
      const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', topic, creatorName: name, personality: debateState.personality }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create room');

      debateState.roomCode = data.room.code;
      debateState.participantId = data.participantId;
      enterDebateRoom(data.room);
    } catch (err) {
      showDebateError(err.message);
    } finally {
      $('#debate-create-btn').disabled = false;
      $('#debate-create-btn').textContent = 'Create room';
    }
  });

  // JOIN room
  $('#debate-join-btn').addEventListener('click', async () => {
    const code = $('#debate-join-code').value.trim().toUpperCase();
    const name = $('#debate-join-name').value.trim() || '';
    if (code.length !== 6) return showDebateError('Enter a 6-letter room code.');

    showDebateError('');
    $('#debate-join-btn').disabled = true;
    $('#debate-join-btn').textContent = 'Joining...';

    try {
      const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join');

      debateState.roomCode = data.room.code;
      debateState.participantId = data.participantId;
      enterDebateRoom(data.room);
    } catch (err) {
      showDebateError(err.message);
    } finally {
      $('#debate-join-btn').disabled = false;
      $('#debate-join-btn').textContent = 'Join';
    }
  });

  function showDebateError(msg) {
    const el = $('#debate-error');
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    el.hidden = false;
  }

  // Enter room view
  function enterDebateRoom(room) {
    $('#debate-lobby').hidden = true;
    $('#debate-room').hidden = false;
    $('#debate-verdict').hidden = true;

    $('#debate-room-topic').textContent = room.topic;
    $('#debate-room-code').textContent = room.code;

    // Show personality badge
    const personalityLabels = { straight: '🎯 Straight up', roast: '🔥 Roast mode', chill: '😎 Chill vibes', hype: '🚀 Hype man' };
    const pBadge = $('#debate-room-personality');
    if (room.personality && personalityLabels[room.personality]) {
      pBadge.textContent = personalityLabels[room.personality];
      pBadge.hidden = false;
    } else {
      pBadge.hidden = true;
    }

    // Show/hide argument input based on whether we already submitted
    const me = room.participants.find(p => p.id === debateState.participantId);
    if (me && me.hasArgument) {
      $('#debate-my-arg').hidden = true;
      $('#debate-my-arg-done').hidden = false;
      $('#debate-submitted-text').textContent = me.argument;
    } else {
      $('#debate-my-arg').hidden = false;
      $('#debate-my-arg-done').hidden = true;
    }

    updateDebateParticipants(room);
    startDebatePolling();
  }

  function updateDebateParticipants(room) {
    const container = $('#debate-participants');
    const withArgs = room.participants.filter(p => p.hasArgument);
    const waiting = room.participants.filter(p => !p.hasArgument);

    container.innerHTML = room.participants.map(p => {
      const isMe = p.id === debateState.participantId;
      return `<div class="debate-participant ${p.hasArgument ? 'has-arg' : 'no-arg'} ${isMe ? 'is-me' : ''}">
        <span class="debate-p-name">${escapeHtml(p.name)}${isMe ? ' (you)' : ''}</span>
        <span class="debate-p-status">${p.hasArgument ? 'Ready' : 'Thinking...'}</span>
        ${p.hasArgument && p.argument ? `<p class="debate-p-arg">${escapeHtml(p.argument)}</p>` : ''}
      </div>`;
    }).join('');

    // Show "Settle this" button when 2+ arguments are in
    const canDecide = withArgs.length >= 2 && room.status === 'arguing';
    $('#debate-decide-btn').hidden = !canDecide;

    // Show waiting indicator
    $('#debate-waiting').hidden = waiting.length === 0 || room.status !== 'arguing';
  }

  // Submit argument
  $('#debate-submit-arg-btn').addEventListener('click', async () => {
    if (debateVoice) debateVoice.stop();
    const argument = $('#debate-argument-input').value.trim();
    if (argument.length < 5) return showDebateError('Write at least a sentence for your argument.');

    showDebateError('');
    $('#debate-submit-arg-btn').disabled = true;
    $('#debate-submit-arg-btn').textContent = 'Submitting...';

    try {
      const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'argue',
          code: debateState.roomCode,
          participantId: debateState.participantId,
          argument,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit');

      $('#debate-my-arg').hidden = true;
      $('#debate-my-arg-done').hidden = false;
      $('#debate-submitted-text').textContent = argument;
      updateDebateParticipants(data.room);
    } catch (err) {
      showDebateError(err.message);
    } finally {
      $('#debate-submit-arg-btn').disabled = false;
      $('#debate-submit-arg-btn').textContent = 'Submit my argument';
    }
  });

  // Trigger AI verdict
  $('#debate-decide-btn').addEventListener('click', async () => {
    $('#debate-decide-btn').disabled = true;
    $('#debate-decide-btn').querySelector('span').textContent = 'Analyzing...';

    try {
      const res = await fetch('/api/room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decide', code: debateState.roomCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');

      renderDebateVerdict(data.room);
    } catch (err) {
      showDebateError(err.message);
      $('#debate-decide-btn').disabled = false;
      $('#debate-decide-btn').querySelector('span').textContent = 'Settle this';
    }
  });

  // Copy room code
  $('#debate-copy-btn').addEventListener('click', () => {
    const code = debateState.roomCode;
    const url = `${window.location.origin}?debate=${code}`;
    if (navigator.share) {
      navigator.share({ title: 'Join my Rational debate', text: `Join the debate: ${$('#debate-room-topic').textContent}`, url }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        $('#debate-copy-btn').innerHTML = '<span style="font-size:12px">Copied!</span>';
        setTimeout(() => {
          $('#debate-copy-btn').innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 11V3h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
        }, 2000);
      });
    }
  });

  // Polling — sync room state every 3s
  function startDebatePolling() {
    stopDebatePolling();
    debateState.pollInterval = setInterval(pollDebateRoom, 3000);
  }

  function stopDebatePolling() {
    if (debateState.pollInterval) {
      clearInterval(debateState.pollInterval);
      debateState.pollInterval = null;
    }
  }

  async function pollDebateRoom() {
    if (!debateState.roomCode) return;
    try {
      const res = await fetch(`/api/room?code=${debateState.roomCode}`);
      if (!res.ok) return;
      const data = await res.json();
      const room = data.room;

      // If verdict came in (someone else triggered it), show it
      if (room.status === 'decided' && debateState.lastStatus !== 'decided') {
        renderDebateVerdict(room);
      } else if (room.status === 'analyzing' && debateState.lastStatus !== 'analyzing') {
        // Show analyzing state
        $('#debate-decide-btn').hidden = true;
        $('#debate-waiting').hidden = false;
        $('#debate-waiting').querySelector('p').textContent = 'AI is analyzing all arguments...';
      } else {
        updateDebateParticipants(room);
      }

      debateState.lastStatus = room.status;
    } catch {}
  }

  // Render verdict
  function renderDebateVerdict(room) {
    stopDebatePolling();
    const v = room.verdict;
    if (!v) return;

    $('#debate-room').hidden = true;
    $('#debate-verdict').hidden = false;

    $('#debate-verdict-headline').textContent = v.headline || 'The verdict is in';
    $('#debate-verdict-winner').textContent = v.winner ? `Winner: ${v.winner}` : '';
    $('#debate-verdict-summary').textContent = v.summary || '';

    // Sections
    const sectionsEl = $('#debate-verdict-sections');
    sectionsEl.innerHTML = '';
    if (v.sections && v.sections.length > 0) {
      v.sections.forEach((sec, i) => {
        const el = document.createElement('div');
        el.className = 'analysis-section reveal-section';
        el.innerHTML = `
          <h3 class="analysis-section-title">
            <span class="why-num">${String(i + 1).padStart(2, '0')}</span>
            ${escapeHtml(sec.title)}
          </h3>
          <div class="narrative">${formatAIContent(sec.content)}</div>`;
        sectionsEl.appendChild(el);
      });
    }

    // Common ground
    if (v.common_ground) {
      $('#debate-common-ground').hidden = false;
      $('#debate-common-ground-text').textContent = v.common_ground;
    }

    // Compromise
    if (v.compromise) {
      $('#debate-compromise').hidden = false;
      $('#debate-compromise-text').textContent = v.compromise;
    }

    // Follow-up questions
    if (v.followup_questions && v.followup_questions.length > 0) {
      const fuEl = $('#debate-verdict-followups');
      fuEl.hidden = false;
      fuEl.innerHTML = `
        <h4>Questions that could help resolve this further</h4>
        ${v.followup_questions.map(q => `
          <div class="ai-followup-item">
            <p class="ai-followup-q">${escapeHtml(q.question)}</p>
            ${q.for ? `<p class="ai-followup-why">For ${escapeHtml(q.for)}</p>` : ''}
          </div>
        `).join('')}`;
    }

    // Trigger reveal animations
    setTimeout(observeRevealSections, 100);
  }

  // New debate button
  $('#debate-new-btn').addEventListener('click', () => {
    showScreen('debate');
    resetDebateLobby();
  });

  // Share verdict
  $('#debate-share-btn').addEventListener('click', () => {
    const headline = $('#debate-verdict-headline').textContent;
    const summary = $('#debate-verdict-summary').textContent;
    if (navigator.share) {
      navigator.share({ title: 'Rational Verdict', text: `${headline}\n\n${summary}` }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(`${headline}\n\n${summary}`);
    }
  });

  // ================================================================
  // HOT SEAT — Game mode
  // ================================================================
  const spinState = {
    gameCode: null,
    participantId: null,
    pollInterval: null,
    vibe: 'random',
    wheelSegments: 8,
    currentRotation: 0,
  };

  // Vibe picker
  const spinVibeOptions = $('#spin-vibe-options');
  if (spinVibeOptions) {
    spinVibeOptions.addEventListener('click', (e) => {
      const chip = e.target.closest('.personality-chip');
      if (!chip) return;
      spinVibeOptions.querySelectorAll('.personality-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      spinState.vibe = chip.dataset.vibe;
    });
  }

  // Entry point
  const spinEntryBtn = $('#spin-entry-btn');
  if (spinEntryBtn) {
    spinEntryBtn.addEventListener('click', () => {
      showScreen('spin');
      resetSpinLobby();
    });
  }

  $('#spin-back').addEventListener('click', () => {
    stopSpinPolling();
    showScreen('home');
    initHome();
  });

  function resetSpinLobby() {
    $('#spin-lobby').hidden = false;
    $('#spin-room').hidden = true;
    $('#spin-results').hidden = true;
    $('#spin-create-card').hidden = false;
    $('#spin-create-fields').hidden = true;
    $('#spin-join-fields').hidden = true;
    $('#spin-create-link').hidden = true;
    $('#spin-error').hidden = true;
    spinState.gameCode = null;
    spinState.participantId = null;
    stopSpinPolling();
  }

  function showSpinError(msg) {
    const el = $('#spin-error');
    if (msg) { el.textContent = msg; el.hidden = false; }
    else el.hidden = true;
  }

  // "Or start a new game instead" link from invite landing
  $('#spin-show-create').addEventListener('click', (e) => {
    e.preventDefault();
    $('#spin-create-card').hidden = false;
    $('#spin-create-link').hidden = true;
    $('#spin-join-fields').hidden = true;
    $('#spin-join-code').value = '';
    $('#spin-create-fields').hidden = false;
    $('#spin-creator-name').focus();
  });

  // Toggle create/join
  $('#spin-create-card').addEventListener('click', (e) => {
    if (e.target.closest('input, button')) return;
    const fields = $('#spin-create-fields');
    fields.hidden = !fields.hidden;
    if (!fields.hidden) {
      $('#spin-join-fields').hidden = true;
      $('#spin-creator-name').focus();
    }
  });

  $('#spin-join-card').addEventListener('click', (e) => {
    if (e.target.closest('input, button')) return;
    const fields = $('#spin-join-fields');
    fields.hidden = !fields.hidden;
    if (!fields.hidden) {
      $('#spin-create-fields').hidden = true;
      $('#spin-join-code').focus();
    }
  });

  // CREATE game
  $('#spin-create-btn').addEventListener('click', async () => {
    const name = $('#spin-creator-name').value.trim() || 'Player 1';
    showSpinError('');
    $('#spin-create-btn').disabled = true;
    $('#spin-create-btn').textContent = 'Creating...';

    try {
      const res = await fetch('/api/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', creatorName: name, vibe: spinState.vibe }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create game');

      spinState.gameCode = data.game.code;
      spinState.participantId = data.participantId;
      enterSpinRoom(data.game);
    } catch (err) {
      showSpinError(err.message);
    } finally {
      $('#spin-create-btn').disabled = false;
      $('#spin-create-btn').textContent = 'Create game';
    }
  });

  // JOIN game
  $('#spin-join-btn').addEventListener('click', async () => {
    const code = $('#spin-join-code').value.trim().toUpperCase();
    const name = $('#spin-join-name').value.trim() || '';
    if (code.length !== 6) return showSpinError('Enter a 6-letter game code.');

    showSpinError('');
    $('#spin-join-btn').disabled = true;
    $('#spin-join-btn').textContent = 'Joining...';

    try {
      const res = await fetch('/api/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join');

      spinState.gameCode = data.game.code;
      spinState.participantId = data.participantId;
      enterSpinRoom(data.game);
    } catch (err) {
      showSpinError(err.message);
    } finally {
      $('#spin-join-btn').disabled = false;
      $('#spin-join-btn').textContent = 'Join';
    }
  });

  function enterSpinRoom(game) {
    $('#spin-lobby').hidden = true;
    $('#spin-room').hidden = false;
    $('#spin-results').hidden = true;

    const vibeLabels = { random: '🎲 Random', 'pop-culture': '🎬 Pop culture', 'deep-thinks': '🧠 Deep thinks', 'hot-takes': '🌶️ Hot takes', 'animal-sounds': '🐒 Animal sounds' };
    $('#spin-vibe-badge').textContent = vibeLabels[game.vibe] || vibeLabels.random;
    $('#spin-room-code').textContent = game.code;

    buildWheel(game);
    updateSpinParticipants(game);
    updateSpinUI(game);
    startSpinPolling();
  }

  function updateSpinParticipants(game) {
    const container = $('#spin-participants');
    container.innerHTML = game.participants.map(p => {
      const isMe = p.id === spinState.participantId;
      const isHotSeat = p.id === game.hotSeatPlayerId;
      return `<span class="participant-chip${isMe ? ' is-me' : ''}${isHotSeat ? ' hot-seat' : ''}${p.hasAnswer ? ' has-arg' : ''}">
        ${isHotSeat ? '🔥 ' : ''}${escapeHtml(p.name)}${p.score ? ` (${p.score}pts)` : ''}
      </span>`;
    }).join('');
  }

  function updateSpinUI(game) {
    const wheelArea = $('#spin-wheel-area');
    const questionArea = $('#spin-question-area');
    const answerInput = $('#spin-answer-input');
    const answerDone = $('#spin-answer-done');
    const waitingEl = $('#spin-waiting');
    const judgeBtn = $('#spin-judge-btn');
    const goBtn = $('#spin-go-btn');
    const isMyTurn = game.hotSeatPlayerId === spinState.participantId;
    const hotSeatName = game.hotSeatPlayerName || 'someone';

    if (game.status === 'waiting') {
      wheelArea.hidden = false;
      questionArea.hidden = true;
      goBtn.hidden = false;

      if (game.participants.length < 2) {
        goBtn.disabled = true;
        goBtn.textContent = 'Waiting for players...';
      } else if (isMyTurn) {
        goBtn.disabled = false;
        goBtn.textContent = "You're up — Spin it!";
      } else {
        goBtn.disabled = true;
        goBtn.textContent = `${hotSeatName}'s turn to spin...`;
      }
    } else if (game.status === 'answering') {
      wheelArea.hidden = true;
      questionArea.hidden = false;
      $('#spin-question-text').textContent = game.question;
      $('#spin-question-label').textContent = isMyTurn ? "You're in the hot seat!" : `${hotSeatName} is in the hot seat!`;

      // Only the hot seat player can answer
      if (isMyTurn) {
        const hotSeatPlayer = game.participants.find(p => p.id === game.hotSeatPlayerId);
        if (hotSeatPlayer && hotSeatPlayer.hasAnswer) {
          answerInput.hidden = true;
          answerDone.hidden = false;
          waitingEl.hidden = false;
          waitingEl.querySelector('p').textContent = 'Waiting for the host to judge...';
        } else {
          answerInput.hidden = false;
          answerDone.hidden = true;
          waitingEl.hidden = true;
        }
      } else {
        // Not my turn — just watching
        answerInput.hidden = true;
        const hotSeatPlayer = game.participants.find(p => p.id === game.hotSeatPlayerId);
        if (hotSeatPlayer && hotSeatPlayer.hasAnswer) {
          answerDone.hidden = true;
          waitingEl.hidden = false;
          waitingEl.querySelector('p').textContent = `${hotSeatName} answered! Waiting for the host to judge...`;
        } else {
          answerDone.hidden = true;
          waitingEl.hidden = false;
          waitingEl.querySelector('p').textContent = `${hotSeatName} is in the hot seat... waiting for their answer`;
        }
      }

      // Show judge button for creator once the hot seat player has answered
      const isCreator = game.participants[0]?.id === spinState.participantId;
      const hotSeatPlayer = game.participants.find(p => p.id === game.hotSeatPlayerId);
      judgeBtn.hidden = !(isCreator && hotSeatPlayer && hotSeatPlayer.hasAnswer);
    } else if (game.status === 'judging') {
      wheelArea.hidden = true;
      questionArea.hidden = false;
      answerInput.hidden = true;
      answerDone.hidden = true;
      judgeBtn.hidden = true;
      waitingEl.hidden = false;
      waitingEl.querySelector('p').textContent = `AI is rating ${hotSeatName}'s answer...`;
    } else if (game.status === 'judged' && game.result) {
      renderSpinResults(game);
    }
  }

  // Build the wheel SVG
  function buildWheel(game) {
    const svg = $('#wheel-svg');
    const segments = spinState.wheelSegments;
    const colors = [
      'rgba(215,25,33,0.7)', 'rgba(168,85,247,0.7)',
      'rgba(68,138,255,0.7)', 'rgba(0,230,118,0.7)',
      'rgba(255,145,0,0.7)', 'rgba(215,25,33,0.5)',
      'rgba(168,85,247,0.5)', 'rgba(68,138,255,0.5)',
    ];
    const labels = ['?', '!', '???', '!!', '?!', '!!?', '?', '!'];
    const cx = 150, cy = 150, r = 140;
    let html = '';

    for (let i = 0; i < segments; i++) {
      const startAngle = (i * 360 / segments - 90) * Math.PI / 180;
      const endAngle = ((i + 1) * 360 / segments - 90) * Math.PI / 180;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const largeArc = (360 / segments > 180) ? 1 : 0;

      html += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z" fill="${colors[i % colors.length]}" stroke="rgba(0,0,0,0.3)" stroke-width="1"/>`;

      // Label
      const midAngle = ((i + 0.5) * 360 / segments - 90) * Math.PI / 180;
      const lx = cx + (r * 0.65) * Math.cos(midAngle);
      const ly = cy + (r * 0.65) * Math.sin(midAngle);
      html += `<text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="central" fill="white" font-size="18" font-weight="700" opacity="0.7">${labels[i]}</text>`;
    }

    // Center circle
    html += `<circle cx="${cx}" cy="${cy}" r="22" fill="#111" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>`;

    svg.innerHTML = html;
  }

  // SPIN action
  $('#spin-go-btn').addEventListener('click', async () => {
    const goBtn = $('#spin-go-btn');
    goBtn.disabled = true;
    goBtn.textContent = 'Spinning...';

    // Animate the wheel
    const svg = $('#wheel-svg');
    const extraSpins = 5 + Math.floor(Math.random() * 5);
    const landAngle = Math.floor(Math.random() * 360);
    const totalRotation = spinState.currentRotation + (extraSpins * 360) + landAngle;
    spinState.currentRotation = totalRotation;

    svg.classList.add('spinning');
    svg.style.transform = `rotate(${totalRotation}deg)`;

    // Wait for animation, then call API
    setTimeout(async () => {
      try {
        const res = await fetch('/api/spin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'spin', code: spinState.gameCode, participantId: spinState.participantId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Spin failed');

        updateSpinUI(data.game);
        updateSpinParticipants(data.game);
      } catch (err) {
        showSpinError(err.message);
      } finally {
        goBtn.disabled = false;
        goBtn.textContent = 'Spin it!';
      }
    }, 4200);
  });

  // Copy game code as invite link
  $('#spin-copy-btn').addEventListener('click', () => {
    const code = spinState.gameCode;
    const url = `${window.location.origin}?spin=${code}`;
    if (navigator.share) {
      navigator.share({ title: 'Join my Hot Seat game', text: 'Hot Seat — random question drops, best answer wins!', url }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        $('#spin-copy-btn').innerHTML = '<span style="font-size:12px">Copied!</span>';
        setTimeout(() => {
          $('#spin-copy-btn').innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 11V3h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
        }, 2000);
      });
    }
  });

  // Voice input for spin answers
  const spinMicBtn = $('#spin-mic-btn');
  const spinVoice = createVoiceInput({
    micBtn: spinMicBtn,
    micHint: $('#spin-mic-hint'),
    micRing: $('#spin-mic-ring'),
    canvas: $('#spin-voice-waveform'),
    targetEl: $('#spin-answer-textarea'),
    hintText: 'Tap to speak your answer',
    listeningText: 'Listening...',
    onUpdate: () => {},
  });
  if (!spinVoice && spinMicBtn) {
    spinMicBtn.style.display = 'none';
    const hint = $('#spin-mic-hint');
    if (hint) hint.style.display = 'none';
  }

  // Submit answer
  $('#spin-submit-answer').addEventListener('click', async () => {
    const answer = $('#spin-answer-textarea').value.trim();
    if (answer.length < 2) return;

    $('#spin-submit-answer').disabled = true;
    $('#spin-submit-answer').textContent = 'Submitting...';

    try {
      const res = await fetch('/api/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'answer', code: spinState.gameCode, participantId: spinState.participantId, answer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Submit failed');

      $('#spin-answer-input').hidden = true;
      $('#spin-answer-done').hidden = false;
      $('#spin-submitted-text').textContent = answer;
      updateSpinParticipants(data.game);
      updateSpinUI(data.game);
    } catch (err) {
      showSpinError(err.message);
    } finally {
      $('#spin-submit-answer').disabled = false;
      $('#spin-submit-answer').textContent = 'Lock in answer';
    }
  });

  // Judge answers
  $('#spin-judge-btn').addEventListener('click', async () => {
    $('#spin-judge-btn').disabled = true;
    $('#spin-judge-btn').querySelector('span').textContent = 'Judging...';

    try {
      const res = await fetch('/api/spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'judge', code: spinState.gameCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Judging failed');

      renderSpinResults(data.game);
    } catch (err) {
      showSpinError(err.message);
    } finally {
      $('#spin-judge-btn').disabled = false;
      $('#spin-judge-btn').querySelector('span').textContent = 'Judge the answers';
    }
  });

  function renderSpinResults(game) {
    stopSpinPolling();
    const r = game.result;
    if (!r) return;

    $('#spin-room').hidden = true;
    $('#spin-results').hidden = false;

    // Single-player hot seat rating
    const scoreDisplay = r.score ? `${r.score}/10` : '';
    $('#spin-winner-name').textContent = `${r.player || 'Player'} — ${scoreDisplay}`;
    $('#spin-winner-reason').textContent = r.reaction || '';

    const rankingsEl = $('#spin-rankings');
    rankingsEl.innerHTML = '';

    // Show the breakdown as a single card
    const hotSeatPlayer = game.participants.find(p => p.name === r.player);
    const el = document.createElement('div');
    el.className = 'spin-ranking-card winner reveal-section';
    el.innerHTML = `
      <div class="spin-rank-header">
        <span class="spin-rank-num" style="font-size:1.5rem">${scoreDisplay}</span>
        <span class="spin-rank-name">${escapeHtml(r.player || '')}</span>
      </div>
      <p class="spin-rank-answer">"${escapeHtml(hotSeatPlayer?.answer || '')}"</p>
      <p class="spin-rank-reason">${escapeHtml(r.breakdown || '')}</p>`;
    rankingsEl.appendChild(el);

    // Show scoreboard
    const scoreboardEl = document.createElement('div');
    scoreboardEl.className = 'spin-scoreboard reveal-section';
    scoreboardEl.style.animationDelay = '200ms';
    const sorted = [...game.participants].sort((a, b) => (b.score || 0) - (a.score || 0));
    scoreboardEl.innerHTML = `
      <h4 style="margin-bottom:var(--space-3);opacity:0.6">Scoreboard</h4>
      ${sorted.map((p, i) => `
        <div class="spin-rank-header" style="margin-bottom:var(--space-2)">
          <span class="spin-rank-num">#${i + 1}</span>
          <span class="spin-rank-name">${escapeHtml(p.name)}</span>
          <span style="margin-left:auto;font-weight:700;color:var(--green)">${p.score || 0}pts</span>
        </div>
      `).join('')}`;
    rankingsEl.appendChild(scoreboardEl);

    if (r.fun_fact) {
      $('#spin-fun-fact').hidden = false;
      $('#spin-fun-fact-text').textContent = r.fun_fact;
    }

    setTimeout(observeRevealSections, 100);
  }

  // Spin again (new round, same game)
  $('#spin-again-btn').addEventListener('click', () => {
    $('#spin-results').hidden = true;
    $('#spin-room').hidden = false;
    $('#spin-answer-textarea').value = '';
    $('#spin-answer-input').hidden = false;
    $('#spin-answer-done').hidden = true;
    $('#spin-question-area').hidden = true;
    $('#spin-wheel-area').hidden = false;
    $('#spin-fun-fact').hidden = true;
    startSpinPolling();
  });

  // New game
  $('#spin-new-game-btn').addEventListener('click', () => {
    resetSpinLobby();
  });

  // Polling
  function startSpinPolling() {
    stopSpinPolling();
    spinState.pollInterval = setInterval(async () => {
      if (!spinState.gameCode) return;
      try {
        const res = await fetch(`/api/spin?code=${spinState.gameCode}`);
        if (!res.ok) return;
        const data = await res.json();
        updateSpinParticipants(data.game);
        updateSpinUI(data.game);
      } catch {}
    }, 3000);
  }

  function stopSpinPolling() {
    if (spinState.pollInterval) {
      clearInterval(spinState.pollInterval);
      spinState.pollInterval = null;
    }
  }

  // URL shortcuts
  const urlParams = new URLSearchParams(window.location.search);
  const urlAction = urlParams.get('action');
  const urlDebate = urlParams.get('debate');
  const urlSpin = urlParams.get('spin');

  if (urlSpin) {
    // Deep link into spin game — show ONLY join card
    showScreen('spin');
    resetSpinLobby();
    $('#spin-create-card').hidden = true;
    $('#spin-join-card').hidden = false;
    $('#spin-join-fields').hidden = false;
    $('#spin-join-code').value = urlSpin.toUpperCase();
    $('#spin-create-link').hidden = false;
    $('#spin-join-name').focus();
    window.history.replaceState({}, '', '/');
  } else if (urlDebate) {
    // Deep link into debate room — show ONLY join card
    showScreen('debate');
    resetDebateLobby();
    $('#debate-create-card').hidden = true;
    $('#debate-join-card').hidden = false;
    $('#debate-join-fields').hidden = false;
    $('#debate-join-code').value = urlDebate.toUpperCase();
    $('#debate-create-link').hidden = false;
    $('#debate-join-name').focus();
    window.history.replaceState({}, '', '/');
  } else if (urlAction === 'debate') {
    showScreen('debate');
    resetDebateLobby();
    window.history.replaceState({}, '', '/');
  } else if (urlAction === 'spin') {
    showScreen('spin');
    resetSpinLobby();
    window.history.replaceState({}, '', '/');
  } else if (urlAction === 'new') {
    showScreen('decide-input');
    decisionInput.focus();
    window.history.replaceState({}, '', '/');
  } else if (urlAction === 'dashboard') {
    renderHistory();
    showScreen('history');
    window.history.replaceState({}, '', '/');
  }

})();
