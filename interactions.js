/* ============================================================
   Rational — Premium Interactions Layer
   Custom cursor, sound design, scroll effects
   ============================================================ */

(function () {
  'use strict';

  // ================================================================
  // CUSTOM CURSOR — Branded dot + ring (desktop only)
  // ================================================================
  const cursor = document.getElementById('custom-cursor');
  const ring = document.getElementById('cursor-ring');
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const hasFineCursor = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  let cursorX = -100, cursorY = -100;
  let ringX = -100, ringY = -100;
  let cursorVisible = false;

  function initCursor() {
    if (isTouch || !hasFineCursor || !cursor || !ring) return;

    document.addEventListener('mousemove', (e) => {
      cursorX = e.clientX;
      cursorY = e.clientY;

      if (!cursorVisible) {
        cursorVisible = true;
        cursor.classList.add('visible');
        ring.classList.add('visible');
      }
    });

    document.addEventListener('mouseleave', () => {
      cursorVisible = false;
      cursor.classList.remove('visible');
      ring.classList.remove('visible');
    });

    document.addEventListener('mouseenter', () => {
      cursorVisible = true;
      cursor.classList.add('visible');
      ring.classList.add('visible');
    });

    document.addEventListener('mousedown', () => {
      cursor.classList.add('clicking');
      playSound('click');
    });

    document.addEventListener('mouseup', () => {
      cursor.classList.remove('clicking');
    });

    // Hover detection for interactive elements
    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest('a, button, input, textarea, select, [role="button"], .home-door');
      if (target) {
        cursor.classList.add('hover');
        ring.classList.add('hover');

        // Color cursor based on card
        if (target.classList.contains('door-spin')) {
          cursor.classList.add('cursor-mustard');
        } else if (target.classList.contains('door-debate')) {
          cursor.classList.add('cursor-red');
        } else if (target.classList.contains('door-decide')) {
          cursor.classList.add('cursor-blue');
        }
      }
    });

    document.addEventListener('mouseout', (e) => {
      const target = e.target.closest('a, button, input, textarea, select, [role="button"], .home-door');
      if (target) {
        cursor.classList.remove('hover', 'cursor-mustard', 'cursor-red', 'cursor-blue');
        ring.classList.remove('hover');
      }
    });

    // Smooth follow animation
    updateCursor();
  }

  function updateCursor() {
    if (!cursor || !ring) return;

    // Cursor follows immediately
    cursor.style.left = cursorX + 'px';
    cursor.style.top = cursorY + 'px';

    // Ring follows with lag (spring feel)
    ringX += (cursorX - ringX) * 0.15;
    ringY += (cursorY - ringY) * 0.15;
    ring.style.left = ringX + 'px';
    ring.style.top = ringY + 'px';

    requestAnimationFrame(updateCursor);
  }

  // ================================================================
  // SOUND DESIGN — Subtle, tactile audio feedback
  // ================================================================
  let soundEnabled = false;
  const sounds = {};

  function initSound() {
    const toggle = document.getElementById('sound-toggle');
    if (!toggle) return;

    // Check saved preference
    soundEnabled = localStorage.getItem('rational_sound') === 'true';
    if (soundEnabled) toggle.classList.add('active');

    toggle.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem('rational_sound', soundEnabled);
      toggle.classList.toggle('active', soundEnabled);

      if (soundEnabled) {
        // Play a soft tick on first enable
        playSound('tick');
      }
    });

    // Generate sounds programmatically using Web Audio API
    // (No external audio files needed!)
    initWebAudioSounds();
  }

  let audioCtx;

  function initWebAudioSounds() {
    // Lazy init audio context (needs user gesture)
    document.addEventListener('click', function initAudio() {
      if (audioCtx) return;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      document.removeEventListener('click', initAudio);
    }, { once: false });
  }

  function playSound(type) {
    if (!soundEnabled || !audioCtx) return;

    try {
      const now = audioCtx.currentTime;

      switch (type) {
        case 'click': {
          // Soft click — short sine blip
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(800, now);
          osc.frequency.exponentialRampToValueAtTime(400, now + 0.06);
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(now);
          osc.stop(now + 0.08);
          break;
        }

        case 'tick': {
          // Dot settling tick — tiny noise burst
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(1200, now);
          osc.frequency.exponentialRampToValueAtTime(600, now + 0.03);
          gain.gain.setValueAtTime(0.04, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(now);
          osc.stop(now + 0.04);
          break;
        }

        case 'whoosh': {
          // Screen transition — filtered noise sweep
          const bufferSize = audioCtx.sampleRate * 0.15;
          const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
          const data = buffer.getChannelData(0);
          for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
          }
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          const filter = audioCtx.createBiquadFilter();
          filter.type = 'bandpass';
          filter.frequency.setValueAtTime(2000, now);
          filter.frequency.exponentialRampToValueAtTime(200, now + 0.15);
          filter.Q.value = 2;
          const gain = audioCtx.createGain();
          gain.gain.setValueAtTime(0.06, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          source.connect(filter).connect(gain).connect(audioCtx.destination);
          source.start(now);
          break;
        }

        case 'reveal': {
          // Dot-matrix text reveal — ascending arpeggio
          const notes = [600, 800, 1000, 1200];
          notes.forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.04);
            gain.gain.setValueAtTime(0.03, now + i * 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.06);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(now + i * 0.04);
            osc.stop(now + i * 0.04 + 0.06);
          });
          break;
        }

        case 'burst': {
          // Victory burst — bright chord
          const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5
          freqs.forEach((freq) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.4);
          });
          break;
        }

        case 'hover': {
          // Card hover — soft resonant ping
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(660, now);
          gain.gain.setValueAtTime(0.025, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(now);
          osc.stop(now + 0.1);
          break;
        }
      }
    } catch (e) {
      // Silently fail — sound is optional
    }
  }

  // Wire sounds to UI events
  function wireUpSounds() {
    // Card hovers
    document.querySelectorAll('.home-door').forEach(card => {
      card.addEventListener('mouseenter', () => playSound('hover'));
    });

    // Button clicks
    document.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!btn.classList.contains('home-door')) {
          playSound('tick');
        }
      });
    });
  }

  // ================================================================
  // SCROLL PARALLAX — Dot-drift on scroll
  // ================================================================
  function initScrollEffects() {
    // Observe scroll on answer screen for parallax dot drift
    let lastScrollY = 0;

    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY;
      const delta = scrollY - lastScrollY;
      lastScrollY = scrollY;

      // Tell particle system about scroll delta
      const P = window.RationalParticles;
      if (P && P.isReady && Math.abs(delta) > 1) {
        // Apply gentle drift to all visible dots
        // This is handled via a public method we expose
        if (typeof P.applyScrollDrift === 'function') {
          P.applyScrollDrift(delta);
        }
      }
    }, { passive: true });
  }

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    initCursor();
    initSound();
    initScrollEffects();

    // Delay sound wiring until DOM is settled
    setTimeout(wireUpSounds, 3000);
  }

  // Expose sound API for particles.js to use
  window.RationalSound = { playSound };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
