/* ============================================================
   Rational — Decision Engine
   EV, Bayes, Kelly, Bias Detection, Sensitivity Analysis,
   Decision Memory, Calibration Scoring, Bias Profiling
   ============================================================ */

(function () {
  'use strict';

  // ================================================================
  // STORAGE LAYER — localStorage persistence
  // ================================================================
  const STORAGE_KEY = 'rational_data';

  const Store = {
    _data: null,

    _defaults() {
      return {
        decisions: [],       // Full decision history
        biasProfile: {       // Cumulative bias counts
          sunkCost: 0,
          survivorship: 0,
          overconfidence: 0,
          lossAversion: 0,
        },
        calibration: [],     // [{ predicted, actual, timestamp }]
        version: 2,
      };
    },

    load() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        this._data = raw ? JSON.parse(raw) : this._defaults();
        if (!this._data.version || this._data.version < 2) {
          this._data = { ...this._defaults(), ...this._data, version: 2 };
        }
      } catch {
        this._data = this._defaults();
      }
      return this._data;
    },

    save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
      } catch { /* quota exceeded — fail silently */ }
    },

    get data() {
      if (!this._data) this.load();
      return this._data;
    },

    addDecision(decision) {
      this.data.decisions.unshift(decision);
      this.save();
    },

    updateDecision(id, updates) {
      const d = this.data.decisions.find(d => d.id === id);
      if (d) Object.assign(d, updates);
      this.save();
    },

    getDecision(id) {
      return this.data.decisions.find(d => d.id === id);
    },

    addBiasTrigger(biasType) {
      if (this.data.biasProfile[biasType] !== undefined) {
        this.data.biasProfile[biasType]++;
        this.save();
      }
    },

    addCalibrationPoint(predicted, actual) {
      this.data.calibration.push({ predicted, actual, timestamp: Date.now() });
      this.save();
    },

    getBrierScore() {
      const pts = this.data.calibration;
      if (pts.length === 0) return null;
      const sum = pts.reduce((s, p) => s + Math.pow(p.predicted - p.actual, 2), 0);
      return sum / pts.length;
    },

    getAccuracy() {
      const pts = this.data.calibration;
      if (pts.length === 0) return null;
      const correct = pts.filter(p => {
        const predicted = p.predicted >= 0.5;
        const actual = p.actual >= 0.5;
        return predicted === actual;
      }).length;
      return correct / pts.length;
    },

    clearAll() {
      this._data = this._defaults();
      this.save();
    },
  };

  Store.load();

  // ================================================================
  // STATE — current decision being analyzed
  // ================================================================
  const state = {
    decision: '',
    category: '',
    timeHorizon: '',
    deadline: '',
    options: [],
    outcomes: {},
    biases: {
      sunkCost: '',
      sunkCostOption: '',
      survivorship: '',
      baseRate: null,
      bankroll: null,
    },
    // Analysis results (kept for sensitivity + save)
    analysisResults: null,
    currentDecisionId: null,
  };

  // ================================================================
  // DOM UTILITIES
  // ================================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const screens = {
    landing: $('#landing'),
    wizard: $('#wizard'),
    results: $('#results'),
    dashboard: $('#dashboard'),
  };

  const steps = $$('.wizard-step');
  const stepIndicators = $$('.stepper-list .step');

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showStep(n) {
    steps.forEach(s => s.classList.remove('active'));
    stepIndicators.forEach((s, i) => {
      s.classList.remove('active');
      s.removeAttribute('aria-current');
      if (i + 1 < n) s.classList.add('completed');
      else s.classList.remove('completed');
    });
    const target = $(`.wizard-step[data-wizard-step="${n}"]`);
    if (target) {
      target.classList.add('active');
      stepIndicators[n - 1].classList.add('active');
      stepIndicators[n - 1].setAttribute('aria-current', 'step');
    }
  }

  function letterForIndex(i) { return String.fromCharCode(65 + i); }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatNumber(n) {
    if (Math.abs(n) >= 1000) {
      return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    }
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const diff = new Date(dateStr).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  function formatDate(ts) {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ================================================================
  // LANDING SCREEN
  // ================================================================
  function updateLandingStats() {
    const decisions = Store.data.decisions;
    if (decisions.length === 0) {
      $('#returning-stats').hidden = true;
      return;
    }
    $('#returning-stats').hidden = false;
    $('#stat-decisions').textContent = decisions.length;

    const brier = Store.getBrierScore();
    $('#stat-brier').textContent = brier !== null ? brier.toFixed(3) : '—';

    const calibrated = Store.data.calibration.length;
    $('#stat-streak').textContent = calibrated;
  }

  updateLandingStats();

  // ================================================================
  // STEP 1 — Describe
  // ================================================================
  const decisionInput = $('#decision-input');
  const decisionCounter = $('#decision-counter');
  const step1Next = $('.next-step[data-next="2"]');

  decisionInput.addEventListener('input', () => {
    const len = decisionInput.value.trim().length;
    decisionCounter.textContent = `${decisionInput.value.length} / 1000`;
    step1Next.disabled = len < 10;
  });

  // ================================================================
  // STEP 2 — Options
  // ================================================================
  const optionsList = $('#options-list');
  const step2Next = $('.next-step[data-next="3"]');

  function createOptionRow(index, value = '') {
    const row = document.createElement('div');
    row.className = 'option-row';
    row.innerHTML = `
      <span class="option-letter" aria-hidden="true">${letterForIndex(index)}</span>
      <input type="text" class="input option-input" placeholder="e.g. Stay at current job"
             aria-label="Option ${letterForIndex(index)} name" value="${escapeHtml(value)}" maxlength="120">
      <button type="button" class="option-remove" aria-label="Remove option ${letterForIndex(index)}">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    `;
    optionsList.appendChild(row);
    row.querySelector('.option-input').addEventListener('input', validateOptions);
    row.querySelector('.option-remove').addEventListener('click', () => {
      if (optionsList.children.length > 2) {
        row.remove();
        reindexOptions();
        validateOptions();
      }
    });
    return row;
  }

  function reindexOptions() {
    $$('.option-row', optionsList).forEach((row, i) => {
      row.querySelector('.option-letter').textContent = letterForIndex(i);
      row.querySelector('.option-input').setAttribute('aria-label', `Option ${letterForIndex(i)} name`);
      row.querySelector('.option-remove').setAttribute('aria-label', `Remove option ${letterForIndex(i)}`);
    });
  }

  function validateOptions() {
    const filled = $$('.option-input', optionsList).filter(i => i.value.trim().length > 0);
    step2Next.disabled = filled.length < 2;
  }

  function seedOptions() {
    optionsList.innerHTML = '';
    createOptionRow(0);
    createOptionRow(1);
    validateOptions();
  }

  $('#add-option-btn').addEventListener('click', () => {
    if (optionsList.children.length >= 6) return;
    const row = createOptionRow(optionsList.children.length);
    row.querySelector('.option-input').focus();
  });

  // ================================================================
  // STEP 3 — Outcomes
  // ================================================================
  const outcomesContainer = $('#outcomes-container');
  const step3Next = $('.next-step[data-next="4"]');

  function buildOutcomesUI() {
    state.options = $$('.option-input', optionsList).map(i => ({ name: i.value.trim() }));
    outcomesContainer.innerHTML = '';

    state.options.forEach((opt, oi) => {
      const group = document.createElement('div');
      group.className = 'outcome-group';
      group.dataset.optionIndex = oi;
      group.innerHTML = `
        <div class="outcome-group-header">
          <h4><span class="option-letter">${letterForIndex(oi)}</span> ${escapeHtml(opt.name)}</h4>
          <span class="prob-total invalid" aria-live="polite">0%</span>
        </div>
        <div class="outcome-label-header" aria-hidden="true">
          <span>Outcome</span><span>Prob. (%)</span><span>Payoff ($)</span><span></span>
        </div>
        <div class="outcome-rows"></div>
        <button type="button" class="btn btn-outline btn-sm add-outcome-btn" aria-label="Add outcome to ${escapeHtml(opt.name)}">+ Add Outcome</button>
      `;
      outcomesContainer.appendChild(group);

      const rows = group.querySelector('.outcome-rows');
      addOutcomeRow(rows, oi);
      addOutcomeRow(rows, oi);

      group.querySelector('.add-outcome-btn').addEventListener('click', () => {
        if (rows.children.length < 8) addOutcomeRow(rows, oi);
      });
    });
  }

  function addOutcomeRow(container, optionIndex) {
    const row = document.createElement('div');
    row.className = 'outcome-row';
    row.innerHTML = `
      <input type="text" class="input outcome-desc" placeholder="e.g. Startup succeeds" aria-label="Outcome description" maxlength="100">
      <input type="number" class="input outcome-prob" placeholder="50" min="0" max="100" step="1" aria-label="Probability (%)">
      <input type="number" class="input outcome-payoff" placeholder="250000" step="1" aria-label="Payoff value ($)">
      <button type="button" class="option-remove" aria-label="Remove outcome">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    `;
    container.appendChild(row);

    row.querySelector('.option-remove').addEventListener('click', () => {
      if (container.children.length > 1) {
        row.remove();
        updateProbTotal(container.closest('.outcome-group'));
        validateOutcomes();
      }
    });

    ['outcome-prob', 'outcome-payoff', 'outcome-desc'].forEach(cls => {
      row.querySelector(`.${cls}`).addEventListener('input', () => {
        updateProbTotal(container.closest('.outcome-group'));
        validateOutcomes();
      });
    });
  }

  function updateProbTotal(group) {
    const total = $$('.outcome-prob', group).reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
    const badge = group.querySelector('.prob-total');
    badge.textContent = `${Math.round(total)}%`;
    badge.className = Math.abs(total - 100) < 0.5 ? 'prob-total valid' : 'prob-total invalid';
  }

  function validateOutcomes() {
    let allValid = true;
    $$('.outcome-group', outcomesContainer).forEach(group => {
      const probs = $$('.outcome-prob', group).map(i => parseFloat(i.value) || 0);
      const total = probs.reduce((a, b) => a + b, 0);
      const hasFilled = $$('.outcome-desc', group).some(i => i.value.trim().length > 0)
        && $$('.outcome-payoff', group).some(i => i.value.trim().length > 0);
      if (!hasFilled || Math.abs(total - 100) > 0.5) allValid = false;
    });
    step3Next.disabled = !allValid;
  }

  function collectOutcomes() {
    state.outcomes = {};
    $$('.outcome-group', outcomesContainer).forEach(group => {
      const oi = parseInt(group.dataset.optionIndex, 10);
      state.outcomes[oi] = $$('.outcome-row', group).map(row => ({
        description: row.querySelector('.outcome-desc').value.trim(),
        probability: (parseFloat(row.querySelector('.outcome-prob').value) || 0) / 100,
        payoff: parseFloat(row.querySelector('.outcome-payoff').value) || 0,
      }));
    });
  }

  // ================================================================
  // STEP 4 — Bias & Context
  // ================================================================
  const sunkCostInput = $('#sunk-cost-input');
  const sunkCostOptionGroup = $('#sunk-cost-option-group');
  const sunkCostWhich = $('#sunk-cost-which');

  sunkCostInput.addEventListener('change', () => {
    if (sunkCostInput.value === 'moderate' || sunkCostInput.value === 'heavy') {
      sunkCostOptionGroup.hidden = false;
      sunkCostWhich.innerHTML = '<option value="">Select option</option>';
      state.options.forEach((o, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `${letterForIndex(i)}. ${o.name}`;
        sunkCostWhich.appendChild(opt);
      });
    } else {
      sunkCostOptionGroup.hidden = true;
    }
  });

  // ================================================================
  // AUTO MODEL SELECTION
  // ================================================================
  function detectModels() {
    const models = [];

    // EV always applies
    models.push({ name: 'Expected Value', active: true });

    // Base rate — if provided or if category has known base rates
    const hasBaseRate = !!$('#base-rate-input').value;
    models.push({ name: 'Base Rate', active: hasBaseRate });

    // Sunk cost — if user indicates investment
    const hasSunk = sunkCostInput.value === 'moderate' || sunkCostInput.value === 'heavy';
    models.push({ name: 'Sunk Cost', active: hasSunk });

    // Bayes — activated if base rate provided
    models.push({ name: 'Bayesian Update', active: hasBaseRate });

    // Survivorship — if user indicates
    const hasSurv = $('#survivorship-input').value === 'yes';
    models.push({ name: 'Survivorship Bias', active: hasSurv });

    // Kelly — if bankroll provided
    const hasKelly = !!$('#bankroll-input').value;
    models.push({ name: 'Kelly Criterion', active: hasKelly });

    // Sensitivity always runs
    models.push({ name: 'Sensitivity Analysis', active: true });

    // Loss aversion — auto-detected from outcomes
    const hasNeg = Object.values(state.outcomes).some(outs => outs.some(o => o.payoff < 0));
    if (hasNeg) models.push({ name: 'Loss Aversion', active: true });

    return models;
  }

  function renderAutoModels(models) {
    const list = $('#auto-models-list');
    list.innerHTML = models.map(m =>
      `<span class="model-tag ${m.active ? 'active-tag' : ''}">${escapeHtml(m.name)}</span>`
    ).join('');
  }

  // ================================================================
  // NAVIGATION
  // ================================================================
  $('#start-btn').addEventListener('click', () => {
    showScreen('wizard');
    showStep(1);
    seedOptions();
    state.currentDecisionId = null;
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
      if (next === 3) buildOutcomesUI();
      if (next === 4) {
        collectOutcomes();
        sunkCostInput.value = '';
        sunkCostOptionGroup.hidden = true;
        // Show auto models after a tick so DOM updates
        setTimeout(() => {
          const models = detectModels();
          renderAutoModels(models);
        }, 50);
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

    collectOutcomes();
    runAnalysis();
    showScreen('results');
  });

  function runAnalysis() {
    const evs = calculateEV();
    const bayesResults = calculateBayes(evs);
    const kellyResults = calculateKelly(evs);
    const biasWarnings = detectBiases(evs);
    const models = detectModels();

    state.analysisResults = { evs, bayesResults, kellyResults, biasWarnings, models };

    renderResults(evs, bayesResults, kellyResults, biasWarnings, models);
    renderSensitivity(evs);
    renderExpiryBanner();
    renderPersonalBiasProfile();
  }

  // ================================================================
  // CALCULATION ENGINE
  // ================================================================
  function calculateEV() {
    return state.options.map((opt, i) => {
      const outcomes = state.outcomes[i] || [];
      const ev = outcomes.reduce((sum, o) => sum + o.probability * o.payoff, 0);
      return { name: opt.name, index: i, ev, outcomes };
    });
  }

  function calculateBayes(evs) {
    if (!state.biases.baseRate) return null;
    const baseRate = state.biases.baseRate / 100;

    return evs.map(optData => {
      const successOutcomes = optData.outcomes.filter(o => o.payoff > 0);
      const priorSuccess = successOutcomes.reduce((s, o) => s + o.probability, 0);

      const pEvidenceGivenSuccess = 0.8;
      const pEvidenceGivenFailure = 0.2;
      const pEvidence = pEvidenceGivenSuccess * baseRate + pEvidenceGivenFailure * (1 - baseRate);
      const posterior = (pEvidenceGivenSuccess * baseRate) / pEvidence;
      const adjusted = (priorSuccess + posterior) / 2;

      return { name: optData.name, prior: priorSuccess, baseRate, posterior: adjusted };
    });
  }

  function calculateKelly(evs) {
    if (!state.biases.bankroll) return null;
    const bankroll = state.biases.bankroll;

    return evs.map(optData => {
      const bestOutcome = optData.outcomes.reduce((best, o) => o.payoff > best.payoff ? o : best, { payoff: 0, probability: 0 });
      const worstOutcome = optData.outcomes.reduce((worst, o) => o.payoff < worst.payoff ? o : worst, { payoff: 0, probability: 0 });

      if (bestOutcome.payoff <= 0 || worstOutcome.payoff >= 0) {
        return { name: optData.name, fullKelly: 0, quarterKelly: 0, amount: 0, ev: optData.ev };
      }

      const b = Math.abs(bestOutcome.payoff / worstOutcome.payoff);
      const p = bestOutcome.probability;
      const q = 1 - p;
      let kellyFraction = Math.max(0, Math.min(1, (p * b - q) / b));
      const quarterKelly = kellyFraction * 0.25;

      return { name: optData.name, fullKelly: kellyFraction, quarterKelly, amount: Math.round(quarterKelly * bankroll), bankroll, b, p, q, ev: optData.ev };
    });
  }

  function detectBiases(evs) {
    const warnings = [];

    // Sunk cost
    if (state.biases.sunkCost === 'heavy') {
      Store.addBiasTrigger('sunkCost');
      const optIdx = parseInt(state.biases.sunkCostOption, 10);
      const optName = state.options[optIdx]?.name || 'one option';
      const isBestEV = evs.reduce((best, e) => e.ev > best.ev ? e : best).index === optIdx;
      warnings.push({
        type: isBestEV ? 'ok' : 'warn',
        text: isBestEV
          ? `You've invested heavily in "${optName}" and it has the best EV. Make sure you'd still choose it starting fresh.`
          : `You've invested heavily in "${optName}" but it does NOT have the best EV. Classic sunk cost trap. Would you choose this starting from scratch?`,
      });
    } else if (state.biases.sunkCost === 'moderate') {
      Store.addBiasTrigger('sunkCost');
      warnings.push({ type: 'warn', text: 'Moderate prior investment detected. Don\'t let past costs anchor you — focus on future value.' });
    } else {
      warnings.push({ type: 'ok', text: 'No significant sunk cost detected.' });
    }

    // Survivorship
    if (state.biases.survivorship === 'yes') {
      Store.addBiasTrigger('survivorship');
      warnings.push({ type: 'warn', text: 'Survivorship bias detected. You\'re reasoning from a success story — but you\'re not seeing the thousands who failed. What\'s the denominator?' });
    } else {
      warnings.push({ type: 'ok', text: 'Reasoning from broad data, not individual stories.' });
    }

    // Base rate
    if (state.biases.baseRate !== null) {
      const br = state.biases.baseRate;
      const bestOption = evs.reduce((best, e) => e.ev > best.ev ? e : best);
      const bestSuccessProb = bestOption.outcomes.filter(o => o.payoff > 0).reduce((s, o) => s + o.probability, 0) * 100;

      if (bestSuccessProb > br * 2) {
        Store.addBiasTrigger('overconfidence');
        warnings.push({ type: 'warn', text: `Your success estimate (${Math.round(bestSuccessProb)}%) for "${bestOption.name}" is ${(bestSuccessProb / br).toFixed(1)}x the base rate (${br}%). Significant overconfidence risk.` });
      } else if (bestSuccessProb > br) {
        warnings.push({ type: 'warn', text: `Success estimate (${Math.round(bestSuccessProb)}%) above base rate (${br}%). Could be justified if you have a real edge.` });
      } else {
        warnings.push({ type: 'ok', text: `Estimate aligns with base rate (${br}%). Realistic assessment.` });
      }
    }

    // Loss aversion
    const bestEV = evs.reduce((best, e) => e.ev > best.ev ? e : best);
    const hasRiskierBest = bestEV.outcomes.some(o => o.payoff < 0);
    const safeOption = evs.find(e => e.outcomes.every(o => o.payoff >= 0));

    if (hasRiskierBest && safeOption && safeOption.index !== bestEV.index) {
      Store.addBiasTrigger('lossAversion');
      const evGap = bestEV.ev - safeOption.ev;
      warnings.push({ type: 'warn', text: `"${bestEV.name}" has the best EV but includes downside risk, while "${safeOption.name}" feels safer. EV gap: ${formatNumber(evGap)}. Loss aversion may be distorting your judgment.` });
    }

    return warnings;
  }

  // ================================================================
  // SENSITIVITY ANALYSIS — interactive sliders
  // ================================================================
  function renderSensitivity(evs) {
    const container = $('#sensitivity-sliders');
    const resultBox = $('#sensitivity-result');
    container.innerHTML = '';

    const originalBestIdx = evs.reduce((best, e) => e.ev > best.ev ? e : best).index;

    // Create sliders for each option's outcome probabilities
    evs.forEach(optData => {
      const group = document.createElement('div');
      group.className = 'sens-group';

      let html = `<div class="sens-group-header"><span class="sens-group-title">${letterForIndex(optData.index)}. ${escapeHtml(optData.name)}</span></div>`;

      optData.outcomes.forEach((o, oi) => {
        const pct = Math.round(o.probability * 100);
        html += `
          <div class="sens-slider-row">
            <label for="sens-${optData.index}-${oi}" title="${escapeHtml(o.description)}">${escapeHtml(o.description || `Outcome ${oi + 1}`)}</label>
            <input type="range" id="sens-${optData.index}-${oi}" min="0" max="100" step="1" value="${pct}"
                   data-option="${optData.index}" data-outcome="${oi}"
                   aria-label="Probability for ${escapeHtml(o.description)}">
            <span class="sens-value" id="sens-val-${optData.index}-${oi}">${pct}%</span>
          </div>
        `;
      });

      group.innerHTML = html;
      container.appendChild(group);
    });

    // Listen to all sliders
    $$('input[type="range"]', container).forEach(slider => {
      slider.addEventListener('input', () => {
        const oi = parseInt(slider.dataset.option, 10);
        const outIdx = parseInt(slider.dataset.outcome, 10);
        const val = parseInt(slider.value, 10);
        $(`#sens-val-${oi}-${outIdx}`).textContent = `${val}%`;
        recalcSensitivity(evs, originalBestIdx, resultBox);
      });
    });

    // Initial state
    resultBox.className = 'sensitivity-result sens-stable';
    resultBox.innerHTML = '<strong>Baseline:</strong> Move the sliders above to test how changes in probability affect the recommendation.';
  }

  function recalcSensitivity(originalEvs, originalBestIdx, resultBox) {
    // Recalculate EVs with slider values
    const newEvs = originalEvs.map(optData => {
      const newOutcomes = optData.outcomes.map((o, oi) => {
        const slider = $(`#sens-${optData.index}-${oi}`);
        const newProb = slider ? parseInt(slider.value, 10) / 100 : o.probability;
        return { ...o, probability: newProb };
      });
      const ev = newOutcomes.reduce((sum, o) => sum + o.probability * o.payoff, 0);
      return { ...optData, outcomes: newOutcomes, ev };
    });

    const newBestIdx = newEvs.reduce((best, e) => e.ev > best.ev ? e : best).index;
    const changed = newBestIdx !== originalBestIdx;

    if (changed) {
      const newBest = newEvs.find(e => e.index === newBestIdx);
      const oldBest = newEvs.find(e => e.index === originalBestIdx);
      resultBox.className = 'sensitivity-result sens-changed';
      resultBox.innerHTML = `<strong>Recommendation flipped!</strong> With these probabilities, "${escapeHtml(newBest.name)}" (EV: ${formatNumber(newBest.ev)}) now beats "${escapeHtml(oldBest.name)}" (EV: ${formatNumber(oldBest.ev)}). Your original conclusion is sensitive to these probability changes.`;
    } else {
      const evSummary = newEvs.map(e => `${letterForIndex(e.index)}: ${formatNumber(e.ev)}`).join(' · ');
      resultBox.className = 'sensitivity-result sens-stable';
      resultBox.innerHTML = `<strong>Recommendation holds.</strong> ${evSummary}`;
    }
  }

  // ================================================================
  // DECISION EXPIRY TRACKING
  // ================================================================
  function renderExpiryBanner() {
    const banner = $('#expiry-banner');
    if (!state.deadline) {
      banner.hidden = true;
      return;
    }

    const days = daysUntil(state.deadline);
    banner.hidden = false;

    if (days !== null && days < 0) {
      banner.className = 'expiry-banner expiry-urgent';
      banner.innerHTML = `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v5l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> This decision window has <strong>expired</strong> (${Math.abs(days)} days ago). Act now or reassess.`;
    } else if (days !== null && days <= 3) {
      banner.className = 'expiry-banner expiry-urgent';
      banner.innerHTML = `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v5l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> <strong>${days} day${days !== 1 ? 's' : ''}</strong> until your decision deadline. Time-pressure can trigger impulsive choices.`;
    } else if (days !== null && days <= 14) {
      banner.className = 'expiry-banner expiry-soon';
      banner.innerHTML = `<svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.6"/><path d="M10 6v5l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> ${days} days until deadline. You have time for deliberate analysis.`;
    } else {
      banner.className = 'expiry-banner expiry-ok';
      banner.innerHTML = `Deadline: ${state.deadline} (${days} days). Plenty of time.`;
    }
  }

  // ================================================================
  // PERSONAL BIAS PROFILE (across history)
  // ================================================================
  function renderPersonalBiasProfile() {
    const profile = Store.data.biasProfile;
    const total = Object.values(profile).reduce((a, b) => a + b, 0);

    if (total < 2) {
      $('#personal-bias-card').hidden = true;
      return;
    }

    $('#personal-bias-card').hidden = false;
    const maxCount = Math.max(...Object.values(profile), 1);

    const biasLabels = {
      sunkCost: 'Sunk Cost',
      survivorship: 'Survivorship Bias',
      overconfidence: 'Overconfidence',
      lossAversion: 'Loss Aversion',
    };

    const biasClasses = {
      sunkCost: 'sunk-cost',
      survivorship: 'survivorship',
      overconfidence: 'overconfidence',
      lossAversion: 'loss-aversion',
    };

    const content = $('#bias-profile-content');
    const sorted = Object.entries(profile).sort((a, b) => b[1] - a[1]);

    content.innerHTML = sorted.map(([key, count]) => `
      <div class="bias-profile-bar">
        <div class="bias-bar-header">
          <span class="bias-bar-name">${biasLabels[key]}</span>
          <span class="bias-bar-count">${count} trigger${count !== 1 ? 's' : ''}</span>
        </div>
        <div class="bias-bar-track">
          <div class="bias-bar-fill ${biasClasses[key]}" style="width: ${(count / maxCount * 100)}%"></div>
        </div>
      </div>
    `).join('');

    // Add insight text
    const topBias = sorted[0];
    if (topBias[1] >= 3) {
      content.innerHTML += `<p style="font-size:var(--text-sm); color:var(--color-warning); margin-top:var(--space-4);">
        Pattern: <strong>${biasLabels[topBias[0]]}</strong> has been triggered ${topBias[1]} times. This is your most frequent blind spot. Pay extra attention when it appears.
      </p>`;
    }
  }

  // ================================================================
  // RENDER RESULTS
  // ================================================================
  function renderResults(evs, bayesResults, kellyResults, biasWarnings, models) {
    $('#results-decision-summary').textContent = `"${state.decision}"`;

    // Models used badges
    $('#results-models-used').innerHTML = models.filter(m => m.active).map(m =>
      `<span class="model-tag active-tag">${escapeHtml(m.name)}</span>`
    ).join('');

    const bestEV = evs.reduce((best, e) => e.ev > best.ev ? e : best);
    const secondBest = evs.filter(e => e.index !== bestEV.index).reduce((best, e) => e.ev > best.ev ? e : best, { ev: -Infinity });
    const evGap = bestEV.ev - (secondBest.ev === -Infinity ? 0 : secondBest.ev);

    // Recommendation
    const banner = $('#recommendation-banner');
    const warnCount = biasWarnings.filter(w => w.type === 'warn').length;

    let bannerClass, recText, recSub;
    if (evs.length === 1 || evGap === 0) {
      bannerClass = 'neutral';
      recText = 'Options are too close to call on EV alone';
      recSub = 'Consider qualitative factors and risk tolerance.';
    } else if (warnCount >= 2) {
      bannerClass = 'neutral';
      recText = `"${bestEV.name}" has the highest EV — proceed with caution`;
      recSub = `${warnCount} cognitive biases detected. Review warnings below.`;
    } else {
      bannerClass = 'positive';
      recText = `"${bestEV.name}" is the mathematically strongest option`;
      recSub = `EV of ${formatNumber(bestEV.ev)} — ${formatNumber(evGap)} more than the next best.`;
    }

    banner.className = `recommendation-banner ${bannerClass}`;
    banner.innerHTML = `<p class="rec-label">Recommendation</p><p class="rec-title">${escapeHtml(recText)}</p><p class="rec-subtitle">${escapeHtml(recSub)}</p>`;

    // EV bars
    const maxEV = Math.max(...evs.map(e => Math.abs(e.ev)), 1);
    $('#ev-results').innerHTML = evs.map(e => {
      const isBest = e.index === bestEV.index && evs.length > 1;
      const barWidth = Math.max(3, (Math.abs(e.ev) / maxEV) * 100);
      return `
        <div class="ev-item">
          <div class="ev-item-header">
            <span class="ev-option-name">${letterForIndex(e.index)}. ${escapeHtml(e.name)}</span>
            <span class="ev-value ${isBest ? 'best' : ''}">${formatNumber(e.ev)}</span>
          </div>
          <div class="ev-bar-track" role="progressbar" aria-valuenow="${Math.round(e.ev)}" aria-label="EV for ${escapeHtml(e.name)}">
            <div class="ev-bar-fill ${isBest ? 'best' : ''}" style="width: ${barWidth}%"></div>
          </div>
        </div>`;
    }).join('');

    // EV math
    $('#ev-math').textContent = evs.map(e => {
      const calcs = e.outcomes.map(o =>
        `  ${(o.probability * 100).toFixed(0)}% x ${formatNumber(o.payoff)} = ${formatNumber(o.probability * o.payoff)}`
      ).join('\n');
      return `${letterForIndex(e.index)}. ${e.name}\n${calcs}\n  EV = ${formatNumber(e.ev)}`;
    }).join('\n\n');

    // Bayes
    const bayesContainer = $('#bayes-results');
    if (bayesResults) {
      bayesContainer.innerHTML = bayesResults.map(b => `
        <div class="bayes-item">
          <div><span class="bayes-label">Your estimate</span><span class="bayes-prior">${(b.prior * 100).toFixed(1)}%</span></div>
          <span class="bayes-arrow" aria-hidden="true">&rarr;</span>
          <div><span class="bayes-label">Base rate adjusted</span><span class="bayes-posterior">${(b.posterior * 100).toFixed(1)}%</span></div>
          <span style="margin-left:auto; font-size:var(--text-sm); font-weight:500;">${escapeHtml(b.name)}</span>
        </div>`).join('');
      $('#bayes-math').textContent = bayesResults.map(b =>
        `${b.name}:\n  Prior P(success) = ${(b.prior * 100).toFixed(1)}%\n  Base rate = ${(b.baseRate * 100).toFixed(1)}%\n  Bayesian adjusted = ${(b.posterior * 100).toFixed(1)}%`
      ).join('\n\n');
    } else {
      bayesContainer.innerHTML = '<p style="color:var(--color-text-muted);font-size:var(--text-sm);">No base rate provided. Add one in Step 4 to see Bayesian adjustment.</p>';
      $('#bayes-math').textContent = 'No base rate provided.';
    }

    // Kelly
    const kellyContainer = $('#kelly-results');
    if (kellyResults) {
      kellyContainer.innerHTML = kellyResults.map(k => {
        if (k.fullKelly === 0) return `<div class="kelly-item"><span class="kelly-label">${escapeHtml(k.name)}</span><span class="kelly-value" style="color:var(--color-text-muted);">No edge — don't bet</span></div>`;
        return `<div class="kelly-item"><div><span class="kelly-label">${escapeHtml(k.name)}</span><span style="display:block;font-size:var(--text-xs);color:var(--color-text-muted);">Full: ${(k.fullKelly * 100).toFixed(1)}% · Quarter: ${(k.quarterKelly * 100).toFixed(1)}%</span></div><span class="kelly-value">Allocate ${formatNumber(k.amount)}</span></div>`;
      }).join('');
      $('#kelly-math').textContent = kellyResults.map(k => {
        if (k.fullKelly === 0) return `${k.name}: No positive edge. Kelly = 0.`;
        return `${k.name}:\n  p = ${(k.p * 100).toFixed(1)}%, b = ${k.b.toFixed(2)}, q = ${(k.q * 100).toFixed(1)}%\n  f* = (p*b - q)/b = ${(k.fullKelly * 100).toFixed(1)}%\n  Quarter Kelly = ${(k.quarterKelly * 100).toFixed(1)}%\n  Allocation = ${formatNumber(k.amount)}`;
      }).join('\n\n');
    } else {
      kellyContainer.innerHTML = '<p style="color:var(--color-text-muted);font-size:var(--text-sm);">No bankroll provided. Add one in Step 4 for optimal sizing.</p>';
      $('#kelly-math').textContent = 'No bankroll provided.';
    }

    // Bias warnings
    const warnSvg = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 2L1 18h18L10 2z" stroke="#FBBF24" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 8v4M10 14.5v.5" stroke="#FBBF24" stroke-width="1.6" stroke-linecap="round"/></svg>';
    const okSvg = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#34D399" stroke-width="1.4"/><path d="M7 10l2 2 4-4" stroke="#34D399" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    $('#bias-warnings').innerHTML = biasWarnings.map(w => `
      <li class="bias-item ${w.type}" role="listitem">
        <span class="bias-icon" aria-hidden="true">${w.type === 'warn' ? warnSvg : okSvg}</span>
        <span>${escapeHtml(w.text)}</span>
      </li>`).join('');
  }

  // ================================================================
  // SAVE DECISION
  // ================================================================
  $('#save-decision-btn').addEventListener('click', () => {
    const id = state.currentDecisionId || generateId();
    const bestEV = state.analysisResults.evs.reduce((best, e) => e.ev > best.ev ? e : best);

    const decisionRecord = {
      id,
      timestamp: Date.now(),
      decision: state.decision,
      category: state.category,
      timeHorizon: state.timeHorizon,
      deadline: state.deadline || null,
      options: state.options.map(o => o.name),
      outcomes: state.outcomes,
      biases: { ...state.biases },
      recommendation: bestEV.name,
      recommendationEV: bestEV.ev,
      bestOptionIndex: bestEV.index,
      outcomeLogged: false,
      actualOutcome: null,
    };

    if (state.currentDecisionId) {
      Store.updateDecision(id, decisionRecord);
    } else {
      Store.addDecision(decisionRecord);
      state.currentDecisionId = id;
    }

    const btn = $('#save-decision-btn');
    btn.textContent = 'Saved!';
    btn.disabled = true;
    setTimeout(() => {
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 2h9l3 3v9H2V2z" stroke="currentColor" stroke-width="1.4"/><path d="M5 2v4h5V2M4 9h8" stroke="currentColor" stroke-width="1.2"/></svg> Saved';
    }, 1500);
  });

  // ================================================================
  // EXPORT
  // ================================================================
  $('#export-btn').addEventListener('click', () => {
    const evMath = $('#ev-math').textContent;
    const bayesMath = $('#bayes-math').textContent;
    const kellyMath = $('#kelly-math').textContent;
    const biases = $$('.bias-item').map(li => `- ${li.textContent.trim()}`).join('\n');
    const recTitle = $('.rec-title')?.textContent || '';

    const text = `RATIONAL — Decision Analysis\n${'='.repeat(40)}\n\nDecision: "${state.decision}"\nCategory: ${state.category || 'N/A'}\nTime Horizon: ${state.timeHorizon || 'N/A'}\nDeadline: ${state.deadline || 'N/A'}\n\nRECOMMENDATION\n${recTitle}\n\nEXPECTED VALUE\n${evMath}\n\nBAYESIAN ANALYSIS\n${bayesMath}\n\nKELLY CRITERION\n${kellyMath}\n\nCOGNITIVE BIAS CHECK\n${biases}\n\nGenerated by Rational\n`;

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rational-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ================================================================
  // START OVER
  // ================================================================
  $('#start-over-btn').addEventListener('click', () => {
    updateLandingStats();
    showScreen('landing');
  });

  // ================================================================
  // DASHBOARD
  // ================================================================
  $('#dashboard-btn').addEventListener('click', () => {
    renderDashboard();
    showScreen('dashboard');
  });

  $('#dash-back-btn').addEventListener('click', () => {
    updateLandingStats();
    showScreen('landing');
  });

  $('#clear-data-btn').addEventListener('click', () => {
    if (confirm('This will permanently delete all your decision history, calibration data, and bias profile. This cannot be undone.')) {
      Store.clearAll();
      renderDashboard();
      updateLandingStats();
    }
  });

  function renderDashboard() {
    const data = Store.data;

    // Stats
    $('#dash-total').textContent = data.decisions.length;
    $('#dash-calibrated').textContent = data.calibration.length;

    const brier = Store.getBrierScore();
    $('#dash-brier').textContent = brier !== null ? brier.toFixed(3) : '—';

    const accuracy = Store.getAccuracy();
    $('#dash-accuracy').textContent = accuracy !== null ? `${Math.round(accuracy * 100)}%` : '—';

    // Bias profile
    const profile = data.biasProfile;
    const totalBias = Object.values(profile).reduce((a, b) => a + b, 0);
    const dashBias = $('#dash-bias-profile');

    if (totalBias < 1) {
      dashBias.innerHTML = '<p class="empty-state">Analyze a few decisions to start building your profile.</p>';
    } else {
      const maxCount = Math.max(...Object.values(profile), 1);
      const labels = { sunkCost: 'Sunk Cost', survivorship: 'Survivorship Bias', overconfidence: 'Overconfidence', lossAversion: 'Loss Aversion' };
      const classes = { sunkCost: 'sunk-cost', survivorship: 'survivorship', overconfidence: 'overconfidence', lossAversion: 'loss-aversion' };
      const sorted = Object.entries(profile).sort((a, b) => b[1] - a[1]);

      dashBias.innerHTML = sorted.map(([key, count]) => `
        <div class="bias-profile-bar">
          <div class="bias-bar-header"><span class="bias-bar-name">${labels[key]}</span><span class="bias-bar-count">${count}x</span></div>
          <div class="bias-bar-track"><div class="bias-bar-fill ${classes[key]}" style="width:${(count / maxCount * 100)}%"></div></div>
        </div>`).join('');

      const top = sorted[0];
      if (top[1] >= 3) {
        dashBias.innerHTML += `<p style="font-size:var(--text-sm);color:var(--color-warning);margin-top:var(--space-3);">Your top blind spot: <strong>${labels[top[0]]}</strong> (${top[1]} triggers). Watch for this pattern.</p>`;
      }
    }

    // Expiring decisions
    const now = Date.now();
    const expiring = data.decisions.filter(d => d.deadline && !d.outcomeLogged && daysUntil(d.deadline) !== null && daysUntil(d.deadline) <= 7);
    const expiringSection = $('#expiring-section');

    if (expiring.length > 0) {
      expiringSection.hidden = false;
      $('#expiring-list').innerHTML = expiring.map(d => renderHistoryItem(d, true)).join('');
    } else {
      expiringSection.hidden = true;
    }

    // History list
    const historyList = $('#history-list');
    if (data.decisions.length === 0) {
      historyList.innerHTML = '<p class="empty-state">No decisions saved yet.</p>';
    } else {
      historyList.innerHTML = data.decisions.map(d => renderHistoryItem(d, false)).join('');
    }

    // Bind history item buttons
    $$('.log-outcome-trigger', historyList).forEach(btn => {
      btn.addEventListener('click', () => openOutcomeModal(btn.dataset.decisionId));
    });
    $$('.log-outcome-trigger', expiringSection).forEach(btn => {
      btn.addEventListener('click', () => openOutcomeModal(btn.dataset.decisionId));
    });
  }

  function renderHistoryItem(d, isExpiring) {
    const days = d.deadline ? daysUntil(d.deadline) : null;
    let badge = '';
    if (d.outcomeLogged) {
      badge = '<span class="history-badge logged">Logged</span>';
    } else if (days !== null && days < 0) {
      badge = '<span class="history-badge expired">Expired</span>';
    } else if (days !== null && days <= 7) {
      badge = `<span class="history-badge pending">${days}d left</span>`;
    } else {
      badge = '<span class="history-badge pending">Pending</span>';
    }

    return `
      <div class="history-item">
        <div class="history-item-body">
          <div class="history-item-decision">${escapeHtml(d.decision)}</div>
          <div class="history-item-meta">
            <span>${formatDate(d.timestamp)}</span>
            <span>${d.category || ''}</span>
            <span>Rec: ${escapeHtml(d.recommendation)}</span>
            ${badge}
          </div>
        </div>
        <div class="history-item-actions">
          ${!d.outcomeLogged ? `<button type="button" class="btn btn-success btn-sm log-outcome-trigger" data-decision-id="${d.id}">Log Outcome</button>` : ''}
        </div>
      </div>
    `;
  }

  // ================================================================
  // OUTCOME LOGGING + CALIBRATION
  // ================================================================
  const outcomeModal = $('#outcome-modal');
  let currentLoggingId = null;

  function openOutcomeModal(decisionId) {
    const d = Store.getDecision(decisionId);
    if (!d) return;
    currentLoggingId = decisionId;

    $('#outcome-modal-decision').textContent = d.decision;

    // Populate option select
    const optSelect = $('#outcome-which-option');
    optSelect.innerHTML = '<option value="">Select the option you chose</option>';
    d.options.forEach((name, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${letterForIndex(i)}. ${name}`;
      optSelect.appendChild(opt);
    });

    // Populate result select based on chosen option
    optSelect.addEventListener('change', () => {
      const oi = optSelect.value;
      const resultSelect = $('#outcome-which-result');
      resultSelect.innerHTML = '<option value="">What happened?</option>';
      if (oi !== '' && d.outcomes[oi]) {
        d.outcomes[oi].forEach((o, idx) => {
          const opt = document.createElement('option');
          opt.value = idx;
          opt.textContent = o.description || `Outcome ${idx + 1}`;
          resultSelect.appendChild(opt);
        });
        // Add "something else" option
        const other = document.createElement('option');
        other.value = 'other';
        other.textContent = 'Something else entirely';
        resultSelect.appendChild(other);
      }
    }, { once: false });

    outcomeModal.showModal();
  }

  $('#outcome-modal-close').addEventListener('click', () => outcomeModal.close());
  outcomeModal.addEventListener('click', (e) => {
    if (e.target === outcomeModal) outcomeModal.close();
  });

  $('#log-outcome-btn').addEventListener('click', () => {
    if (!currentLoggingId) return;
    const d = Store.getDecision(currentLoggingId);
    if (!d) return;

    const chosenOption = parseInt($('#outcome-which-option').value, 10);
    const chosenResult = $('#outcome-which-result').value;
    const actualPayoff = parseFloat($('#outcome-actual-payoff').value) || null;

    if (isNaN(chosenOption) || chosenResult === '') return;

    // Calculate calibration point
    // The predicted probability was what the user assigned to this outcome
    if (chosenResult !== 'other' && d.outcomes[chosenOption]) {
      const outcomeIdx = parseInt(chosenResult, 10);
      const predictedProb = d.outcomes[chosenOption][outcomeIdx]?.probability || 0;
      // actual = 1 (this outcome occurred)
      Store.addCalibrationPoint(predictedProb, 1);

      // Also log calibration for outcomes that DIDN'T happen
      d.outcomes[chosenOption].forEach((o, idx) => {
        if (idx !== outcomeIdx) {
          Store.addCalibrationPoint(o.probability, 0);
        }
      });
    }

    Store.updateDecision(currentLoggingId, {
      outcomeLogged: true,
      actualOutcome: {
        chosenOption,
        resultIndex: chosenResult,
        actualPayoff,
        loggedAt: Date.now(),
      },
    });

    outcomeModal.close();
    renderDashboard();
  });

  // ================================================================
  // MODALS
  // ================================================================
  const howModal = $('#how-it-works-modal');
  $('#how-it-works-btn').addEventListener('click', () => howModal.showModal());
  $('#modal-close-btn').addEventListener('click', () => howModal.close());
  howModal.addEventListener('click', (e) => {
    if (e.target === howModal) howModal.close();
  });

})();
