/* ============================================================
   Rational — Decision Engine
   Core logic: EV, Bayes, Kelly, Bias Detection
   ============================================================ */

(function () {
  'use strict';

  // ---- State ----
  const state = {
    decision: '',
    category: '',
    options: [],   // [{ name: string }]
    outcomes: {},  // { optionIndex: [{ description, probability, payoff }] }
    biases: {
      sunkCost: '',
      sunkCostOption: '',
      survivorship: '',
      baseRate: null,
      bankroll: null,
    },
  };

  // ---- DOM refs ----
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const screens = {
    landing: $('#landing'),
    wizard: $('#wizard'),
    results: $('#results'),
  };

  const steps = $$('.wizard-step');
  const stepIndicators = $$('.stepper-list .step');

  // ---- Helpers ----
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // Announce to screen readers
    screens[name].focus({ preventScroll: true });
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

  function letterForIndex(i) {
    return String.fromCharCode(65 + i);
  }

  // ---- Step 1: Decision description ----
  const decisionInput = $('#decision-input');
  const decisionCounter = $('#decision-counter');
  const decisionCategory = $('#decision-category');
  const step1Next = $('.next-step[data-next="2"]');

  decisionInput.addEventListener('input', () => {
    const len = decisionInput.value.trim().length;
    decisionCounter.textContent = `${decisionInput.value.length} / 1000`;
    step1Next.disabled = len < 10;
  });

  // ---- Step 2: Options ----
  const optionsList = $('#options-list');
  const addOptionBtn = $('#add-option-btn');
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

    const input = row.querySelector('.option-input');
    input.addEventListener('input', validateOptions);

    const removeBtn = row.querySelector('.option-remove');
    removeBtn.addEventListener('click', () => {
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
    const inputs = $$('.option-input', optionsList);
    const filled = inputs.filter(i => i.value.trim().length > 0);
    step2Next.disabled = filled.length < 2;
  }

  addOptionBtn.addEventListener('click', () => {
    if (optionsList.children.length >= 6) return;
    const row = createOptionRow(optionsList.children.length);
    row.querySelector('.option-input').focus();
  });

  // Seed two blank options
  function seedOptions() {
    optionsList.innerHTML = '';
    createOptionRow(0);
    createOptionRow(1);
    validateOptions();
  }

  // ---- Step 3: Outcomes ----
  const outcomesContainer = $('#outcomes-container');
  const step3Next = $('.next-step[data-next="4"]');

  function buildOutcomesUI() {
    const optionInputs = $$('.option-input', optionsList);
    state.options = optionInputs.map(i => ({ name: i.value.trim() }));
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
          <span>Outcome</span>
          <span>Prob. (%)</span>
          <span>Payoff ($)</span>
          <span></span>
        </div>
        <div class="outcome-rows"></div>
        <button type="button" class="btn btn-outline btn-sm add-outcome-btn" aria-label="Add outcome to ${escapeHtml(opt.name)}">
          + Add Outcome
        </button>
      `;

      outcomesContainer.appendChild(group);

      const rowsContainer = group.querySelector('.outcome-rows');
      addOutcomeRow(rowsContainer, oi, 0);
      addOutcomeRow(rowsContainer, oi, 1);

      group.querySelector('.add-outcome-btn').addEventListener('click', () => {
        const count = rowsContainer.children.length;
        if (count >= 8) return;
        addOutcomeRow(rowsContainer, oi, count);
      });
    });
  }

  function addOutcomeRow(container, optionIndex, outcomeIndex) {
    const row = document.createElement('div');
    row.className = 'outcome-row';
    row.innerHTML = `
      <input type="text" class="input outcome-desc" placeholder="e.g. Startup succeeds"
             aria-label="Outcome description" maxlength="100">
      <input type="number" class="input outcome-prob" placeholder="50" min="0" max="100" step="1"
             aria-label="Probability (%)">
      <input type="number" class="input outcome-payoff" placeholder="250000" step="1"
             aria-label="Payoff value ($)">
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
    const probs = $$('.outcome-prob', group).map(i => parseFloat(i.value) || 0);
    const total = probs.reduce((a, b) => a + b, 0);
    const badge = group.querySelector('.prob-total');
    badge.textContent = `${Math.round(total)}%`;
    if (Math.abs(total - 100) < 0.5) {
      badge.className = 'prob-total valid';
    } else {
      badge.className = 'prob-total invalid';
    }
  }

  function validateOutcomes() {
    const groups = $$('.outcome-group', outcomesContainer);
    let allValid = true;

    groups.forEach(group => {
      const probs = $$('.outcome-prob', group).map(i => parseFloat(i.value) || 0);
      const payoffs = $$('.outcome-payoff', group).map(i => i.value.trim());
      const descs = $$('.outcome-desc', group).map(i => i.value.trim());
      const total = probs.reduce((a, b) => a + b, 0);

      const hasFilled = descs.some(d => d.length > 0) && payoffs.some(p => p.length > 0);
      if (!hasFilled || Math.abs(total - 100) > 0.5) allValid = false;
    });

    step3Next.disabled = !allValid;
  }

  // ---- Step 4: Bias check ----
  const sunkCostInput = $('#sunk-cost-input');
  const sunkCostOptionGroup = $('#sunk-cost-option-group');
  const sunkCostWhich = $('#sunk-cost-which');

  sunkCostInput.addEventListener('change', () => {
    if (sunkCostInput.value === 'moderate' || sunkCostInput.value === 'heavy') {
      sunkCostOptionGroup.hidden = false;
      // Populate options
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

  // ---- Navigation ----
  $('#start-btn').addEventListener('click', () => {
    showScreen('wizard');
    showStep(1);
    seedOptions();
    decisionInput.focus();
  });

  $('#back-to-landing').addEventListener('click', () => showScreen('landing'));

  $$('.next-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = parseInt(btn.dataset.next, 10);
      // Collect data before advancing
      if (next === 2) {
        state.decision = decisionInput.value.trim();
        state.category = decisionCategory.value;
      }
      if (next === 3) {
        buildOutcomesUI();
      }
      if (next === 4) {
        collectOutcomes();
        populateBiasStep();
      }
      showStep(next);
    });
  });

  $$('.prev-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const prev = parseInt(btn.dataset.prev, 10);
      showStep(prev);
    });
  });

  function collectOutcomes() {
    state.outcomes = {};
    $$('.outcome-group', outcomesContainer).forEach(group => {
      const oi = parseInt(group.dataset.optionIndex, 10);
      const rows = $$('.outcome-row', group);
      state.outcomes[oi] = rows.map(row => ({
        description: row.querySelector('.outcome-desc').value.trim(),
        probability: (parseFloat(row.querySelector('.outcome-prob').value) || 0) / 100,
        payoff: parseFloat(row.querySelector('.outcome-payoff').value) || 0,
      }));
    });
  }

  function populateBiasStep() {
    // Pre-populate sunk cost option dropdown
    sunkCostInput.value = '';
    sunkCostOptionGroup.hidden = true;
  }

  // ---- Run Analysis ----
  $('#run-analysis-btn').addEventListener('click', () => {
    // Collect bias data
    state.biases.sunkCost = sunkCostInput.value;
    state.biases.sunkCostOption = sunkCostWhich.value;
    state.biases.survivorship = $('#survivorship-input').value;
    state.biases.baseRate = parseFloat($('#base-rate-input').value) || null;
    state.biases.bankroll = parseFloat($('#bankroll-input').value) || null;

    runAnalysis();
    showScreen('results');
  });

  // ---- Analysis Engine ----
  function runAnalysis() {
    const evs = calculateEV();
    const bayesResults = calculateBayes(evs);
    const kellyResults = calculateKelly(evs);
    const biasWarnings = detectBiases(evs);

    renderResults(evs, bayesResults, kellyResults, biasWarnings);
  }

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
    const results = evs.map(optData => {
      // Estimate "success" probability from outcomes
      const successOutcomes = optData.outcomes.filter(o => o.payoff > 0);
      const priorSuccess = successOutcomes.reduce((s, o) => s + o.probability, 0);

      // P(evidence | success) — if base rate is known, use it to adjust
      // Simplified Bayesian: compare user's estimated probability against the base rate
      const pEvidenceGivenSuccess = 0.8; // Assume decent evidence quality
      const pEvidenceGivenFailure = 0.2;

      const pEvidence = pEvidenceGivenSuccess * baseRate + pEvidenceGivenFailure * (1 - baseRate);
      const posterior = (pEvidenceGivenSuccess * baseRate) / pEvidence;

      // Adjusted success probability blended with user estimate
      const adjusted = (priorSuccess + posterior) / 2;

      return {
        name: optData.name,
        prior: priorSuccess,
        baseRate,
        posterior: adjusted,
      };
    });

    return results;
  }

  function calculateKelly(evs) {
    if (!state.biases.bankroll) return null;

    const bankroll = state.biases.bankroll;

    return evs.map(optData => {
      // Find best positive outcome and worst negative outcome
      const bestOutcome = optData.outcomes.reduce((best, o) =>
        o.payoff > best.payoff ? o : best, { payoff: 0, probability: 0 });
      const worstOutcome = optData.outcomes.reduce((worst, o) =>
        o.payoff < worst.payoff ? o : worst, { payoff: 0, probability: 0 });

      if (bestOutcome.payoff <= 0 || worstOutcome.payoff >= 0) {
        return { name: optData.name, fullKelly: 0, quarterKelly: 0, amount: 0, ev: optData.ev };
      }

      // b = win/loss ratio (how much you win per dollar risked)
      const b = Math.abs(bestOutcome.payoff / worstOutcome.payoff);
      const p = bestOutcome.probability;
      const q = 1 - p;

      let kellyFraction = (p * b - q) / b;
      kellyFraction = Math.max(0, Math.min(1, kellyFraction));

      const quarterKelly = kellyFraction * 0.25;

      return {
        name: optData.name,
        fullKelly: kellyFraction,
        quarterKelly,
        amount: Math.round(quarterKelly * bankroll),
        bankroll,
        b,
        p,
        q,
        ev: optData.ev,
      };
    });
  }

  function detectBiases(evs) {
    const warnings = [];

    // Sunk cost
    if (state.biases.sunkCost === 'heavy') {
      const optIdx = parseInt(state.biases.sunkCostOption, 10);
      const optName = state.options[optIdx]?.name || 'one option';
      const isBestEV = evs.reduce((best, e) => e.ev > best.ev ? e : best).index === optIdx;
      warnings.push({
        type: isBestEV ? 'ok' : 'warn',
        text: isBestEV
          ? `You've invested heavily in "${optName}" and it also has the best EV. Your prior investment aligns with the math here — but make sure you'd still choose it starting fresh today.`
          : `You've invested heavily in "${optName}" but it does NOT have the best expected value. This is a classic sunk cost trap. The past investment is gone — only future value matters. Would you choose this option starting from scratch?`,
      });
    } else if (state.biases.sunkCost === 'moderate') {
      warnings.push({
        type: 'warn',
        text: 'You have moderate prior investment in one option. Be mindful not to let past costs anchor you — focus on which option has the best future value.',
      });
    } else {
      warnings.push({
        type: 'ok',
        text: 'No significant sunk cost detected. You can evaluate options on future merit alone.',
      });
    }

    // Survivorship bias
    if (state.biases.survivorship === 'yes') {
      warnings.push({
        type: 'warn',
        text: 'Your confidence may be inflated by survivorship bias. You\'re reasoning from a specific success story — but you\'re not seeing the thousands who tried the same thing and failed silently. Ask yourself: what\'s the denominator? How many people attempted this, and what percentage actually succeeded?',
      });
    } else {
      warnings.push({
        type: 'ok',
        text: 'Good — you\'re reasoning from broad data rather than individual success stories.',
      });
    }

    // Base rate
    if (state.biases.baseRate !== null) {
      const br = state.biases.baseRate;
      const bestOption = evs.reduce((best, e) => e.ev > best.ev ? e : best);
      const bestSuccessProb = bestOption.outcomes.filter(o => o.payoff > 0).reduce((s, o) => s + o.probability, 0) * 100;

      if (bestSuccessProb > br * 2) {
        warnings.push({
          type: 'warn',
          text: `Your estimated success probability (${Math.round(bestSuccessProb)}%) for "${bestOption.name}" is significantly higher than the base rate (${br}%). Most people overestimate their chances. Consider whether you have genuinely unique information, or if you're falling prey to overconfidence.`,
        });
      } else if (bestSuccessProb > br) {
        warnings.push({
          type: 'warn',
          text: `Your estimated success probability (${Math.round(bestSuccessProb)}%) is above the base rate (${br}%). This could be justified if you have a real edge — but double-check your assumptions.`,
        });
      } else {
        warnings.push({
          type: 'ok',
          text: `Your probability estimate aligns with or is below the base rate (${br}%). This suggests a realistic assessment.`,
        });
      }
    }

    // Loss aversion check
    const bestEV = evs.reduce((best, e) => e.ev > best.ev ? e : best);
    const hasRiskierBestOption = bestEV.outcomes.some(o => o.payoff < 0);
    const safeOption = evs.find(e => e.outcomes.every(o => o.payoff >= 0));

    if (hasRiskierBestOption && safeOption && safeOption.index !== bestEV.index) {
      const evGap = bestEV.ev - safeOption.ev;
      warnings.push({
        type: 'warn',
        text: `The mathematically best option ("${bestEV.name}") has downside risk, while "${safeOption.name}" feels safer. The EV gap is ${formatNumber(evGap)}. Humans feel losses ~2x more than gains (loss aversion). Make sure you're not avoiding the better option just because the downside feels scary.`,
      });
    }

    return warnings;
  }

  // ---- Rendering ----
  function renderResults(evs, bayesResults, kellyResults, biasWarnings) {
    // Summary
    $('#results-decision-summary').textContent = `"${state.decision}"`;

    // Find best option
    const bestEV = evs.reduce((best, e) => e.ev > best.ev ? e : best);
    const secondBest = evs.filter(e => e.index !== bestEV.index).reduce((best, e) => e.ev > best.ev ? e : best, { ev: -Infinity });
    const evGap = bestEV.ev - (secondBest.ev === -Infinity ? 0 : secondBest.ev);

    // Recommendation banner
    const banner = $('#recommendation-banner');
    const hasWarnings = biasWarnings.filter(w => w.type === 'warn').length;
    let bannerClass = 'positive';
    let recText = '';
    let recSub = '';

    if (evs.length === 1 || evGap === 0) {
      bannerClass = 'neutral';
      recText = 'Options are too close to call on EV alone';
      recSub = 'Consider qualitative factors and your risk tolerance.';
    } else if (hasWarnings >= 2) {
      bannerClass = 'neutral';
      recText = `"${bestEV.name}" has the highest EV — but proceed with caution`;
      recSub = `Multiple cognitive biases detected. Review the warnings below before deciding.`;
    } else {
      bannerClass = 'positive';
      recText = `"${bestEV.name}" is the mathematically strongest option`;
      recSub = `EV of ${formatNumber(bestEV.ev)} — that's ${formatNumber(evGap)} more than the next best.`;
    }

    banner.className = `recommendation-banner ${bannerClass}`;
    banner.innerHTML = `
      <p class="rec-label">Recommendation</p>
      <p class="rec-title">${escapeHtml(recText)}</p>
      <p class="rec-subtitle">${escapeHtml(recSub)}</p>
    `;

    // EV results
    const maxEV = Math.max(...evs.map(e => Math.abs(e.ev)), 1);
    const evContainer = $('#ev-results');
    evContainer.innerHTML = evs.map(e => {
      const isBest = e.index === bestEV.index && evs.length > 1;
      const barWidth = Math.max(3, (Math.abs(e.ev) / maxEV) * 100);
      return `
        <div class="ev-item">
          <div class="ev-item-header">
            <span class="ev-option-name">${letterForIndex(e.index)}. ${escapeHtml(e.name)}</span>
            <span class="ev-value ${isBest ? 'best' : ''}">${formatNumber(e.ev)}</span>
          </div>
          <div class="ev-bar-track" role="progressbar" aria-valuenow="${Math.round(e.ev)}"
               aria-label="Expected value for ${escapeHtml(e.name)}">
            <div class="ev-bar-fill ${isBest ? 'best' : ''}" style="width: ${barWidth}%"></div>
          </div>
        </div>
      `;
    }).join('');

    // EV math
    $('#ev-math').textContent = evs.map(e => {
      const calcs = e.outcomes.map(o =>
        `  ${o.probability * 100}% × ${formatNumber(o.payoff)} = ${formatNumber(o.probability * o.payoff)}`
      ).join('\n');
      return `${letterForIndex(e.index)}. ${e.name}\n${calcs}\n  EV = ${formatNumber(e.ev)}`;
    }).join('\n\n');

    // Bayes results
    const bayesContainer = $('#bayes-results');
    const bayesMath = $('#bayes-math');
    if (bayesResults) {
      bayesContainer.innerHTML = bayesResults.map(b => `
        <div class="bayes-item">
          <div>
            <span class="bayes-label">Your estimate</span>
            <span class="bayes-prior">${(b.prior * 100).toFixed(1)}%</span>
          </div>
          <span class="bayes-arrow" aria-hidden="true">→</span>
          <div>
            <span class="bayes-label">Base rate adjusted</span>
            <span class="bayes-posterior">${(b.posterior * 100).toFixed(1)}%</span>
          </div>
          <span style="margin-left:auto; font-size: var(--text-sm); font-weight:500;">${escapeHtml(b.name)}</span>
        </div>
      `).join('');

      bayesMath.textContent = bayesResults.map(b =>
        `${b.name}:\n  Your prior P(success) = ${(b.prior * 100).toFixed(1)}%\n  Base rate = ${(b.baseRate * 100).toFixed(1)}%\n  Bayesian adjusted = ${(b.posterior * 100).toFixed(1)}%`
      ).join('\n\n');
    } else {
      bayesContainer.innerHTML = '<p style="color:var(--color-text-muted); font-size:var(--text-sm);">No base rate provided — Bayesian adjustment skipped. Add a base rate in Step 4 to see this analysis.</p>';
      bayesMath.textContent = 'No base rate provided.';
    }

    // Kelly results
    const kellyContainer = $('#kelly-results');
    const kellyMath = $('#kelly-math');
    if (kellyResults) {
      kellyContainer.innerHTML = kellyResults.map(k => {
        if (k.fullKelly === 0) {
          return `
            <div class="kelly-item">
              <span class="kelly-label">${escapeHtml(k.name)}</span>
              <span class="kelly-value" style="color:var(--color-text-muted);">No positive edge — Kelly says don't bet</span>
            </div>
          `;
        }
        return `
          <div class="kelly-item">
            <div>
              <span class="kelly-label">${escapeHtml(k.name)}</span>
              <span style="display:block;font-size:var(--text-xs);color:var(--color-text-muted);">
                Full Kelly: ${(k.fullKelly * 100).toFixed(1)}% · Quarter Kelly: ${(k.quarterKelly * 100).toFixed(1)}%
              </span>
            </div>
            <span class="kelly-value">Allocate ${formatNumber(k.amount)}</span>
          </div>
        `;
      }).join('');

      kellyMath.textContent = kellyResults.map(k => {
        if (k.fullKelly === 0) return `${k.name}: No positive edge detected. Kelly fraction = 0.`;
        return `${k.name}:\n  p (win probability) = ${(k.p * 100).toFixed(1)}%\n  b (win/loss ratio) = ${k.b.toFixed(2)}\n  q = 1 - p = ${(k.q * 100).toFixed(1)}%\n  f* = (p × b - q) / b = (${k.p.toFixed(3)} × ${k.b.toFixed(2)} - ${k.q.toFixed(3)}) / ${k.b.toFixed(2)} = ${(k.fullKelly * 100).toFixed(1)}%\n  Quarter Kelly = ${(k.quarterKelly * 100).toFixed(1)}%\n  Recommended allocation = ${(k.quarterKelly * 100).toFixed(1)}% × ${formatNumber(k.bankroll)} = ${formatNumber(k.amount)}`;
      }).join('\n\n');
    } else {
      kellyContainer.innerHTML = '<p style="color:var(--color-text-muted); font-size:var(--text-sm);">No bankroll provided — Kelly sizing skipped. Add your total bankroll in Step 4 to see optimal allocation.</p>';
      kellyMath.textContent = 'No bankroll provided.';
    }

    // Bias warnings
    const biasList = $('#bias-warnings');
    biasList.innerHTML = biasWarnings.map(w => `
      <li class="bias-item ${w.type}" role="listitem">
        <span class="bias-icon" aria-hidden="true">
          ${w.type === 'warn'
            ? '<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 2L1 18h18L10 2z" stroke="#FBBF24" stroke-width="1.4" stroke-linejoin="round"/><path d="M10 8v4M10 14.5v.5" stroke="#FBBF24" stroke-width="1.6" stroke-linecap="round"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="8" stroke="#34D399" stroke-width="1.4"/><path d="M7 10l2 2 4-4" stroke="#34D399" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'}
        </span>
        <span>${escapeHtml(w.text)}</span>
      </li>
    `).join('');
  }

  function formatNumber(n) {
    if (Math.abs(n) >= 1000) {
      return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    }
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ---- Start Over ----
  $('#start-over-btn').addEventListener('click', () => {
    showScreen('landing');
  });

  // ---- Export ----
  $('#export-btn').addEventListener('click', () => {
    const evMath = $('#ev-math').textContent;
    const bayesMath = $('#bayes-math').textContent;
    const kellyMath = $('#kelly-math').textContent;
    const biases = $$('.bias-item').map(li => `- ${li.textContent.trim()}`).join('\n');
    const recTitle = $('.rec-title')?.textContent || '';
    const recSub = $('.rec-subtitle')?.textContent || '';

    const text = `RATIONAL — Decision Analysis
${'='.repeat(40)}

Decision: "${state.decision}"
Category: ${state.category || 'N/A'}

RECOMMENDATION
${recTitle}
${recSub}

EXPECTED VALUE
${evMath}

BAYESIAN ANALYSIS
${bayesMath}

KELLY CRITERION
${kellyMath}

COGNITIVE BIAS CHECK
${biases}

Generated by Rational — rational-decisions.app
`;

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rational-analysis-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ---- Modal ----
  const modal = $('#how-it-works-modal');
  $('#how-it-works-btn').addEventListener('click', () => modal.showModal());
  $('#modal-close-btn').addEventListener('click', () => modal.close());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });

})();
