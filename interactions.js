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

        case 'door': {
          // Door card tap — satisfying thunk + ascending tone
          const osc1 = audioCtx.createOscillator();
          const osc2 = audioCtx.createOscillator();
          const gain1 = audioCtx.createGain();
          const gain2 = audioCtx.createGain();
          // Low thunk
          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(120, now);
          osc1.frequency.exponentialRampToValueAtTime(60, now + 0.1);
          gain1.gain.setValueAtTime(0.1, now);
          gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
          osc1.connect(gain1).connect(audioCtx.destination);
          osc1.start(now);
          osc1.stop(now + 0.12);
          // High confirmation ping
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(880, now + 0.05);
          osc2.frequency.exponentialRampToValueAtTime(1100, now + 0.15);
          gain2.gain.setValueAtTime(0.06, now + 0.05);
          gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
          osc2.connect(gain2).connect(audioCtx.destination);
          osc2.start(now + 0.05);
          osc2.stop(now + 0.2);
          break;
        }

        case 'send': {
          // Send button — quick upward sweep
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(400, now);
          osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08);
          gain.gain.setValueAtTime(0.07, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(now);
          osc.stop(now + 0.12);
          break;
        }

        case 'mic': {
          // Mic button — warm pulse
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, now);
          gain.gain.setValueAtTime(0.08, now);
          gain.gain.setValueAtTime(0.08, now + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
          osc.connect(gain).connect(audioCtx.destination);
          osc.start(now);
          osc.stop(now + 0.2);
          break;
        }
      }
    } catch (e) {
      // Silently fail — sound is optional
    }
  }

  // Wire sounds to UI events
  function wireUpSounds() {
    // Door card hovers (desktop) + taps
    document.querySelectorAll('.home-door').forEach(card => {
      card.addEventListener('mouseenter', () => playSound('hover'));
      card.addEventListener('click', () => playSound('door'));
    });

    // Mic button
    const micBtn = document.getElementById('mic-btn');
    if (micBtn) {
      micBtn.addEventListener('click', () => playSound('mic'));
    }

    // Send button
    const sendBtn = document.querySelector('.send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => playSound('send'));
    }

    // Generic buttons — soft tick
    document.querySelectorAll('button').forEach(btn => {
      if (btn.classList.contains('home-door') || btn === micBtn || btn === sendBtn || btn.id === 'sound-toggle') return;
      btn.addEventListener('click', () => playSound('tick'));
    });

    // Also wire up dynamically: use event delegation for buttons added later
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      // Check for specific button types added dynamically
      if (btn.classList.contains('btn-primary-full') || btn.classList.contains('send-btn')) {
        playSound('send');
      }
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
  // HERO CAROUSEL — Scroll-snap with dot indicator tracking
  // ================================================================
  function initHeroCarousel() {
    const track = document.getElementById('hero-track');
    const dots = document.querySelectorAll('.hero-dot[data-dot]');
    const fill = document.getElementById('hero-dot-fill');
    if (!track || dots.length === 0) return;

    let currentSlide = 0;
    const slideCount = dots.length;

    // Position the fill indicator
    function updateDotFill(progress) {
      if (!fill) return;
      const firstDot = dots[0];
      const lastDot = dots[dots.length - 1];
      if (!firstDot || !lastDot) return;

      const container = firstDot.parentElement;
      const containerRect = container.getBoundingClientRect();
      const firstRect = firstDot.getBoundingClientRect();
      const lastRect = lastDot.getBoundingClientRect();

      const startX = firstRect.left - containerRect.left;
      const endX = lastRect.left - containerRect.left;
      const x = startX + (endX - startX) * progress;

      fill.style.left = x + 'px';

      // Change color based on which slide we're closer to
      if (progress < 0.5) {
        fill.style.background = 'var(--mustard)';
      } else {
        fill.style.background = 'var(--matte-blue)';
      }
    }

    // Update active dot state
    function setActiveDot(index) {
      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
      });
      currentSlide = index;
    }

    // Track scroll position
    track.addEventListener('scroll', () => {
      const scrollLeft = track.scrollLeft;
      const maxScroll = track.scrollWidth - track.clientWidth;
      if (maxScroll <= 0) return;

      const progress = Math.min(scrollLeft / maxScroll, 1);
      const slideIndex = Math.round(progress * (slideCount - 1));

      updateDotFill(progress);
      if (slideIndex !== currentSlide) {
        setActiveDot(slideIndex);
        playSound('tick');
      }
    }, { passive: true });

    // Dot click → scroll to slide
    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        const index = parseInt(dot.dataset.dot);
        const slides = track.querySelectorAll('.hero-slide');
        if (slides[index]) {
          slides[index].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
          playSound('tick');
        }
      });
    });

    // Initial position
    requestAnimationFrame(() => updateDotFill(0));
  }

  // ================================================================
  // INIT
  // ================================================================
  function init() {
    initCursor();
    initSound();
    initScrollEffects();
    initHeroCarousel();

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
