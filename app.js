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
    step1Next.disabled = decisionInput.value.trim().length < 20;
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
  // NAVIGATION
  // ================================================================
  $('#start-btn').addEventListener('click', () => {
    showScreen('wizard');
    showStep(1);
    seedOptions();
    state.currentDecisionId = null;
    decisionInput.value = '';
    $('#char-count').textContent = '0 / 3,000';
    decisionInput.focus();
  });

  $('#back-to-landing').addEventListener('click', () => showScreen('landing'));

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
      }
      if (next === 3) {
        collectOptions();
        sunkCostInput.value = '';
        sunkCostOptionGroup.hidden = true;
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
  function runAnalysis() {
    const evs = calculateEV();
    const bayesResults = calculateBayes(evs);
    const kellyResults = calculateKelly(evs);

    state.analysisResults = { evs, bayesResults, kellyResults };

    const sorted = [...evs].sort((a, b) => b.ev - a.ev);
    const best = sorted[0];
    const second = sorted[1];
    const evGap = sorted.length > 1 ? best.ev - second.ev : 0;

    // Verdict hero
    if (evGap > 0) {
      $('.verdict-heading').textContent = `Go with "${best.name}"`;
      $('#verdict-sub').textContent = `The numbers give it an edge of ${formatNumber(evGap)} over your next best option.`;
    } else {
      $('.verdict-heading').textContent = 'Too close to call on numbers alone';
      $('#verdict-sub').textContent = 'Consider what matters most beyond the math — timing, energy, optionality.';
    }

    renderEV(evs, best);
    renderBaseRate(evs, best);
    renderSunkCost(evs, best);
    renderBayes(evs, bayesResults, best);
    renderSurvivorship();
    renderKelly(kellyResults, evs);
    renderSensitivity(evs);
    renderFinalVerdict(evs, best, second, bayesResults, kellyResults);
    renderExpiryBanner();
    renderPersonalBiasProfile();
  }

  // --- Section 1: Expected Value ---
  function renderEV(evs, best) {
    let html = '';
    evs.forEach(opt => {
      html += `<p><strong>${escapeHtml(opt.name)}:</strong> `;
      html += `If things go well (${escapeHtml(opt.bestDesc)}, ~${Math.round(opt.bestProb * 100)}% chance), the value is ${formatNumber(opt.bestPayoff)}. `;
      html += `If things go badly (${escapeHtml(opt.worstDesc)}, ~${Math.round(opt.worstProb * 100)}% chance), it's ${formatNumber(opt.worstPayoff)}. `;
      html += `Weighted together: <em>${formatNumber(opt.ev)}</em>.</p>`;
    });

    if (evs.length > 1 && best.ev > evs.filter(e => e.index !== best.index)[0]?.ev) {
      html += `<span class="callout">By expected value alone, <strong>"${escapeHtml(best.name)}"</strong> is the stronger path.</span>`;
    }

    $('#ev-narrative').innerHTML = html;

    const maxAbsEV = Math.max(...evs.map(e => Math.abs(e.ev)), 1);
    $('#ev-bars').innerHTML = evs.map(opt => {
      const isBest = opt.index === best.index;
      const width = Math.max(2, (Math.abs(opt.ev) / maxAbsEV) * 100);
      return `<div class="ev-bar-item">
        <div class="ev-bar-header">
          <span class="ev-bar-name">${letterForIndex(opt.index)}. ${escapeHtml(opt.name)}</span>
          <span class="ev-bar-value ${isBest ? 'best' : 'not-best'}">${formatNumber(opt.ev)}</span>
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

    if (evs.length >= 2 && best.ev > second.ev) {
      html += `<p><strong>Your optimal path is "${escapeHtml(best.name)}"</strong> — expected value of ${formatNumber(best.ev)}, which is ${formatNumber(best.ev - second.ev)} more than "${escapeHtml(second.name)}".</p>`;
    } else {
      html += '<p>The options are very close. The decision probably comes down to factors the math can\'t capture — your energy, timing, and which path excites you more.</p>';
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
    const evs = state.analysisResults?.evs;
    if (!evs) return;
    const best = [...evs].sort((a, b) => b.ev - a.ev)[0];

    Store.addDecision({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      decision: state.decision,
      category: state.category,
      timeHorizon: state.timeHorizon,
      deadline: state.deadline,
      options: state.options.map(o => o.name),
      outcomes: state.options.reduce((acc, o, i) => {
        acc[i] = [
          { description: o.bestDesc, probability: o.bestProb, payoff: o.bestPayoff },
          { description: o.worstDesc, probability: o.worstProb, payoff: o.worstPayoff },
        ];
        return acc;
      }, {}),
      recommendation: best.name,
      bestEV: best.ev,
      biases: { ...state.biases },
      timestamp: Date.now(),
      outcomeLogged: false,
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
