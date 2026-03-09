/* ============================================================
   Rational — Dot-Matrix Particle System
   "Every pixel is a dot. Every interaction is dots finding their place."

   Uses PixiJS for GPU-accelerated particle rendering.
   Uses GSAP for orchestrated timeline animations.
   ============================================================ */

(function () {
  'use strict';

  // ================================================================
  // CONFIG
  // ================================================================
  const CONFIG = {
    // Dot appearance
    dotSize: 2.5,
    dotSizeVariance: 1.2,
    // Colors (match CSS vars)
    colors: {
      mustard: 0xE8A817,
      red: 0xD71921,
      blue: 0x3B6B9E,
      white: 0xFFFFFF,
      gray: 0x888888,
    },
    // Performance
    maxDots: 1500,           // Budget for mobile
    maxDotsDesktop: 3000,    // Budget for desktop
    targetFPS: 60,
    // Physics
    friction: 0.92,
    returnForce: 0.06,
    rippleForce: 8,
    rippleRadius: 120,
    // Timing
    loadDuration: 2.5,
    transitionDuration: 0.8,
    // Feature flags
    enableCursorTrail: true,
    enableSound: false,  // opt-in later
  };

  // Responsive dot budget
  const isMobile = window.innerWidth < 768;
  const MAX_DOTS = isMobile ? CONFIG.maxDots : CONFIG.maxDotsDesktop;

  // ================================================================
  // PIXI APP SETUP
  // ================================================================
  let app, particleContainer, cursorGraphics;
  let dots = [];
  let mouseX = -1000, mouseY = -1000;
  let isMouseDown = false;
  let animationId;
  let isReady = false;

  function initPixi() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;

    app = new PIXI.Application({
      view: canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundAlpha: 0,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
    });

    // Particle container for batch rendering (much faster)
    particleContainer = new PIXI.ParticleContainer(MAX_DOTS, {
      scale: true,
      position: true,
      alpha: true,
      tint: true,
    });
    app.stage.addChild(particleContainer);

    // Cursor trail layer (regular container for graphics)
    cursorGraphics = new PIXI.Graphics();
    app.stage.addChild(cursorGraphics);

    // Create dot texture (shared by all particles)
    const gfx = new PIXI.Graphics();
    gfx.beginFill(0xFFFFFF);
    gfx.drawCircle(0, 0, 4);
    gfx.endFill();
    CONFIG._dotTexture = app.renderer.generateTexture(gfx);
    gfx.destroy();

    // Handle resize
    window.addEventListener('resize', onResize);
    onResize();

    isReady = true;
  }

  function onResize() {
    if (!app) return;
    app.renderer.resize(window.innerWidth, window.innerHeight);
  }

  // ================================================================
  // DOT CLASS
  // ================================================================
  class Dot {
    constructor(x, y, color, size) {
      this.sprite = new PIXI.Sprite(CONFIG._dotTexture);
      this.sprite.anchor.set(0.5);
      this.sprite.tint = color || CONFIG.colors.white;
      this.sprite.alpha = 0;

      const s = (size || CONFIG.dotSize + (Math.random() - 0.5) * CONFIG.dotSizeVariance) / 4;
      this.sprite.scale.set(s);

      // Current position
      this.x = x;
      this.y = y;
      this.sprite.x = x;
      this.sprite.y = y;

      // Target position (where it "belongs")
      this.homeX = x;
      this.homeY = y;

      // Velocity
      this.vx = 0;
      this.vy = 0;

      // State
      this.alpha = 0;
      this.targetAlpha = 1;
      this.alive = true;
      this.free = false; // If true, doesn't return home

      // For load animation
      this.delay = 0;
      this.phase = 'idle'; // 'scatter', 'converge', 'idle', 'transition'
    }

    setHome(x, y) {
      this.homeX = x;
      this.homeY = y;
    }

    setPosition(x, y) {
      this.x = x;
      this.y = y;
      this.sprite.x = x;
      this.sprite.y = y;
    }

    update(dt) {
      if (!this.alive) return;

      if (!this.free) {
        // Spring back to home
        const dx = this.homeX - this.x;
        const dy = this.homeY - this.y;
        this.vx += dx * CONFIG.returnForce;
        this.vy += dy * CONFIG.returnForce;
      }

      // Apply friction
      this.vx *= CONFIG.friction;
      this.vy *= CONFIG.friction;

      // Update position
      this.x += this.vx;
      this.y += this.vy;

      // Alpha lerp
      this.alpha += (this.targetAlpha - this.alpha) * 0.08;

      // Update sprite
      this.sprite.x = this.x;
      this.sprite.y = this.y;
      this.sprite.alpha = this.alpha;
    }

    applyForce(fx, fy) {
      this.vx += fx;
      this.vy += fy;
    }

    distanceTo(x, y) {
      const dx = this.x - x;
      const dy = this.y - y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    destroy() {
      this.alive = false;
      if (this.sprite.parent) this.sprite.parent.removeChild(this.sprite);
      this.sprite.destroy();
    }
  }

  // ================================================================
  // DOT POOL — reuse dots for performance
  // ================================================================
  function createDot(x, y, color, size) {
    if (dots.length >= MAX_DOTS) return null;
    const dot = new Dot(x, y, color, size);
    dots.push(dot);
    particleContainer.addChild(dot.sprite);
    return dot;
  }

  function clearDots() {
    dots.forEach(d => d.destroy());
    dots = [];
  }

  // ================================================================
  // MOUSE / TOUCH TRACKING
  // ================================================================
  function initInput() {
    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });
    document.addEventListener('mousedown', () => { isMouseDown = true; });
    document.addEventListener('mouseup', () => { isMouseDown = false; });

    document.addEventListener('touchmove', (e) => {
      if (e.touches[0]) {
        mouseX = e.touches[0].clientX;
        mouseY = e.touches[0].clientY;
      }
    }, { passive: true });
    document.addEventListener('touchstart', (e) => {
      if (e.touches[0]) {
        mouseX = e.touches[0].clientX;
        mouseY = e.touches[0].clientY;
      }
    }, { passive: true });
    document.addEventListener('touchend', () => {
      mouseX = -1000;
      mouseY = -1000;
    });
  }

  // ================================================================
  // CURSOR DOT TRAIL
  // ================================================================
  const cursorTrail = [];
  const TRAIL_LENGTH = 12;

  function updateCursorTrail() {
    if (!CONFIG.enableCursorTrail || isMobile) return;
    if (!cursorGraphics) return;

    // Add new point
    if (mouseX > 0 && mouseY > 0) {
      cursorTrail.push({ x: mouseX, y: mouseY, life: 1 });
      if (cursorTrail.length > TRAIL_LENGTH) cursorTrail.shift();
    }

    // Draw trail
    cursorGraphics.clear();
    for (let i = 0; i < cursorTrail.length; i++) {
      const p = cursorTrail[i];
      p.life -= 0.06;
      if (p.life <= 0) {
        cursorTrail.splice(i, 1);
        i--;
        continue;
      }
      const size = p.life * 2.5;
      const alpha = p.life * 0.4;
      cursorGraphics.beginFill(CONFIG.colors.mustard, alpha);
      cursorGraphics.drawCircle(p.x, p.y, size);
      cursorGraphics.endFill();
    }
  }

  // ================================================================
  // TOUCH RIPPLE
  // ================================================================
  // Touch ripple removed — was distracting and fought with content visibility

  // ================================================================
  // INTERACTIVE REPULSION — dots flee from cursor
  // ================================================================
  function applyMouseRepulsion() {
    if (mouseX < 0) return;
    const radius = isMouseDown ? CONFIG.rippleRadius * 1.5 : CONFIG.rippleRadius;
    const force = isMouseDown ? CONFIG.rippleForce * 1.5 : CONFIG.rippleForce;

    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      if (!dot.alive) continue;
      const dist = dot.distanceTo(mouseX, mouseY);
      if (dist < radius && dist > 1) {
        const angle = Math.atan2(dot.y - mouseY, dot.x - mouseX);
        const strength = (1 - dist / radius) * force * 0.15;
        dot.applyForce(Math.cos(angle) * strength, Math.sin(angle) * strength);
      }
    }
  }

  // ================================================================
  // LOAD SEQUENCE — dots scatter then converge into logo + UI
  // ================================================================
  function playLoadSequence() {
    if (!isReady) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const centerX = w / 2;
    const centerY = h * 0.22;

    // Phase 1: Create scattered dots
    const totalDots = isMobile ? 200 : 400;
    const colors = [CONFIG.colors.mustard, CONFIG.colors.red, CONFIG.colors.blue, CONFIG.colors.white, CONFIG.colors.gray];

    for (let i = 0; i < totalDots; i++) {
      const color = colors[Math.floor(Math.random() * colors.length)];
      const dot = createDot(
        Math.random() * w,
        Math.random() * h,
        color,
        CONFIG.dotSize + Math.random() * 2
      );
      if (!dot) break;

      // Start invisible and scattered
      dot.alpha = 0;
      dot.targetAlpha = 0;
      dot.free = true;
      dot.phase = 'scatter';

      // Store converge target — logo area initially
      dot._convergeX = centerX + (Math.random() - 0.5) * 80;
      dot._convergeY = centerY + (Math.random() - 0.5) * 30;
      dot.delay = Math.random() * 0.5;
    }

    // GSAP timeline for the sequence
    const tl = gsap.timeline();

    // Phase 1: Fade in scattered (0 -> 0.6s)
    tl.to({}, {
      duration: 0.6,
      onUpdate: function () {
        const p = this.progress();
        dots.forEach(dot => {
          if (dot.phase === 'scatter' && p > dot.delay) {
            dot.targetAlpha = 0.6;
          }
        });
      }
    });

    // Phase 2: Converge to center (0.6 -> 1.6s)
    tl.to({}, {
      duration: 1,
      onStart: () => {
        dots.forEach(dot => {
          if (dot.phase === 'scatter') {
            dot.phase = 'converge';
            dot.setHome(dot._convergeX, dot._convergeY);
            dot.free = false;
            dot.targetAlpha = 0.9;
          }
        });
      },
      onUpdate: function () {
        // Tighten the spring as we converge
        const p = this.progress();
        CONFIG.returnForce = 0.03 + p * 0.06;
      }
    });

    // Phase 3: Burst outward to form dot fields (1.6 -> 2.2s)
    tl.to({}, {
      duration: 0.6,
      onStart: () => {
        CONFIG.returnForce = 0.06; // Reset

        // Explode outward
        dots.forEach(dot => {
          if (dot.phase === 'converge') {
            dot.phase = 'burst';
            const angle = Math.random() * Math.PI * 2;
            const force = 8 + Math.random() * 12;
            dot.applyForce(Math.cos(angle) * force, Math.sin(angle) * force);
            dot.free = true;
            dot.targetAlpha = 0;
          }
        });
      },
      onComplete: () => {
        // Clean up load dots, spawn persistent UI dots
        clearDots();
        spawnHomeDots();
        // Reveal the DOM content
        document.body.classList.add('particles-ready');
      }
    });

    // Phase 4: Settle (2.2 -> 2.5s) — handled by spawnHomeDots()
  }

  // ================================================================
  // HOME SCREEN DOT FIELDS — persistent dots behind each card
  // ================================================================
  function spawnHomeDots() {
    if (!isReady) return;

    const cards = document.querySelectorAll('.home-door');
    if (!cards.length) return;

    cards.forEach((card, idx) => {
      const rect = card.getBoundingClientRect();
      const color = idx === 0 ? CONFIG.colors.mustard :
                    idx === 1 ? CONFIG.colors.red :
                                CONFIG.colors.blue;

      // Create a field of dots within the card bounds
      const density = isMobile ? 0.003 : 0.004;
      const count = Math.floor(rect.width * rect.height * density);

      for (let i = 0; i < count; i++) {
        const x = rect.left + Math.random() * rect.width;
        const y = rect.top + Math.random() * rect.height;
        const dot = createDot(x, y, color, CONFIG.dotSize + Math.random());
        if (!dot) break;
        dot.targetAlpha = 0.08 + Math.random() * 0.08;
        dot.alpha = 0;
        dot._cardIndex = idx;
        dot._cardRect = rect;
        dot.phase = 'card';

        // Gentle floating
        dot._floatOffset = Math.random() * Math.PI * 2;
        dot._floatSpeed = 0.3 + Math.random() * 0.5;
        dot._floatRadius = 2 + Math.random() * 4;
      }
    });

    // Fade in card dots
    gsap.to({}, {
      duration: 0.8,
      onUpdate: function () {
        const p = this.progress();
        dots.forEach(dot => {
          if (dot.phase === 'card') {
            dot.alpha = dot.targetAlpha * p;
          }
        });
      }
    });

    // Add ambient floating to card dots
    startCardFloat();
  }

  // Ambient floating motion for card dots
  let cardFloatTime = 0;
  function startCardFloat() {
    function floatLoop() {
      cardFloatTime += 0.016;
      dots.forEach(dot => {
        if (dot.phase === 'card' && dot.alive) {
          const ox = Math.sin(cardFloatTime * dot._floatSpeed + dot._floatOffset) * dot._floatRadius;
          const oy = Math.cos(cardFloatTime * dot._floatSpeed * 0.7 + dot._floatOffset) * dot._floatRadius;
          dot.setHome(dot.homeX + ox * 0.1, dot.homeY + oy * 0.1);
        }
      });
      requestAnimationFrame(floatLoop);
    }
    floatLoop();
  }

  // ================================================================
  // CARD HOVER EFFECT — dots ripple outward on hover
  // ================================================================
  function initCardHoverEffects() {
    const cards = document.querySelectorAll('.home-door');
    cards.forEach((card, idx) => {
      card.addEventListener('mouseenter', () => {
        // Brighten dots on this card
        dots.forEach(dot => {
          if (dot._cardIndex === idx && dot.phase === 'card') {
            dot.targetAlpha = 0.2 + Math.random() * 0.15;
          }
        });
      });
      card.addEventListener('mouseleave', () => {
        dots.forEach(dot => {
          if (dot._cardIndex === idx && dot.phase === 'card') {
            dot.targetAlpha = 0.08 + Math.random() * 0.08;
          }
        });
      });
    });
  }

  // ================================================================
  // SCREEN TRANSITION — dots scatter and reform
  // ================================================================
  function playTransition(fromScreenId, toScreenId, callback) {
    if (!isReady) {
      if (callback) callback();
      return;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;

    // Suppress CSS fadeUp during particle transition
    document.body.classList.add('particle-transition');

    // Sound effect
    if (window.RationalSound) window.RationalSound.playSound('whoosh');

    // Phase 1: Current dots scatter outward
    const tl = gsap.timeline({
      onComplete: () => {
        document.body.classList.remove('particle-transition');
      }
    });

    tl.to({}, {
      duration: 0.3,
      onStart: () => {
        dots.forEach(dot => {
          dot.free = true;
          const angle = Math.atan2(dot.y - h / 2, dot.x - w / 2);
          const force = 6 + Math.random() * 8;
          dot.applyForce(Math.cos(angle) * force, Math.sin(angle) * force);
          dot.targetAlpha = 0;
        });
      },
    });

    // Phase 2: Clear and spawn new screen dots
    tl.to({}, {
      duration: 0.2,
      onStart: () => {
        clearDots();
        if (callback) callback(); // Actually switch screens
      },
    });

    // Phase 3: New dots converge in
    tl.to({}, {
      duration: 0.5,
      onStart: () => {
        spawnScreenDots(toScreenId);
      },
    });
  }

  // Spawn ambient dots for any screen
  function spawnScreenDots(screenId) {
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (screenId === 'home') {
      spawnHomeDots();
      return;
    }

    // Generic ambient dots for other screens
    const count = isMobile ? 60 : 120;
    const color = screenId === 'decide-input' ? CONFIG.colors.blue :
                  screenId === 'debate' ? CONFIG.colors.red :
                  screenId === 'spin' ? CONFIG.colors.mustard :
                  CONFIG.colors.gray;

    for (let i = 0; i < count; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const dot = createDot(x, y, color, CONFIG.dotSize);
      if (!dot) break;
      dot.targetAlpha = 0.04 + Math.random() * 0.06;
      dot.phase = 'ambient';

      // Start from center and expand
      dot.setPosition(w / 2 + (Math.random() - 0.5) * 100, h / 2 + (Math.random() - 0.5) * 100);
    }
  }

  // ================================================================
  // DOT-MATRIX TEXT REVEAL
  // ================================================================
  function dotMatrixReveal(element) {
    if (!element) return;
    if (window.RationalSound) window.RationalSound.playSound('reveal');

    element.classList.add('dot-reveal-active');
    const text = element.textContent;
    const chars = text.split('');

    // Create wrapper spans for each character
    element.innerHTML = chars.map((ch, i) => {
      if (ch === ' ') return '<span class="dot-char dot-space">&nbsp;</span>';
      return `<span class="dot-char" style="--char-index:${i}">${ch}</span>`;
    }).join('');

    // GSAP stagger reveal
    gsap.fromTo(
      element.querySelectorAll('.dot-char:not(.dot-space)'),
      {
        opacity: 0,
        filter: 'blur(8px)',
        y: 4,
      },
      {
        opacity: 1,
        filter: 'blur(0px)',
        y: 0,
        duration: 0.05,
        stagger: 0.03,
        ease: 'power2.out',
        onComplete: () => {
          // Clean up — restore plain text for accessibility
          element.classList.remove('dot-reveal-active');
        }
      }
    );
  }

  // ================================================================
  // THINKING STATE — Generative neural network visualization
  // ================================================================
  let thinkingDots = [];
  let thinkingActive = false;

  function startThinkingVisualization() {
    if (!isReady) return;
    thinkingActive = true;
    document.body.classList.add('particles-thinking');

    const w = window.innerWidth;
    const h = window.innerHeight;
    const centerX = w / 2;
    const centerY = h * 0.4;

    // Create neural network nodes
    const nodeCount = isMobile ? 80 : 180;
    const colors = [CONFIG.colors.mustard, CONFIG.colors.red, CONFIG.colors.blue, CONFIG.colors.white];

    for (let i = 0; i < nodeCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 30 + Math.random() * 150;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      const color = colors[Math.floor(Math.random() * colors.length)];

      const dot = createDot(x, y, color, 1.5 + Math.random() * 3);
      if (!dot) break;
      dot.targetAlpha = 0.15 + Math.random() * 0.4;
      dot.phase = 'thinking';
      dot._angle = angle;
      dot._radius = radius;
      dot._orbitSpeed = (0.2 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1);
      dot._pulseOffset = Math.random() * Math.PI * 2;
      thinkingDots.push(dot);
    }

    // Animate the thinking state
    animateThinking();
  }

  let thinkingTime = 0;
  function animateThinking() {
    if (!thinkingActive) return;

    thinkingTime += 0.016;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight * 0.4;

    thinkingDots.forEach(dot => {
      if (!dot.alive) return;

      // Orbit
      dot._angle += dot._orbitSpeed * 0.01;
      const pulseFactor = 1 + Math.sin(thinkingTime * 2 + dot._pulseOffset) * 0.2;
      const r = dot._radius * pulseFactor;

      dot.setHome(
        centerX + Math.cos(dot._angle) * r,
        centerY + Math.sin(dot._angle) * r
      );

      // Pulse alpha
      dot.targetAlpha = 0.1 + Math.abs(Math.sin(thinkingTime * 1.5 + dot._pulseOffset)) * 0.5;
    });

    // Draw connections between nearby dots
    if (cursorGraphics) {
      // Limit connection drawing for performance
      const maxConnections = isMobile ? 30 : 80;
      let connectionCount = 0;

      for (let i = 0; i < thinkingDots.length && connectionCount < maxConnections; i++) {
        const a = thinkingDots[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < thinkingDots.length && connectionCount < maxConnections; j++) {
          const b = thinkingDots[j];
          if (!b.alive) continue;
          const dist = a.distanceTo(b.x, b.y);
          if (dist < 80) {
            const alpha = (1 - dist / 80) * 0.12;
            cursorGraphics.lineStyle(0.5, CONFIG.colors.mustard, alpha);
            cursorGraphics.moveTo(a.x, a.y);
            cursorGraphics.lineTo(b.x, b.y);
            connectionCount++;
          }
        }
      }
    }

    requestAnimationFrame(animateThinking);
  }

  function stopThinkingVisualization() {
    thinkingActive = false;
    document.body.classList.remove('particles-thinking');
    thinkingDots.forEach(dot => {
      dot.targetAlpha = 0;
      dot.free = true;
      const angle = Math.random() * Math.PI * 2;
      dot.applyForce(Math.cos(angle) * 5, Math.sin(angle) * 5);
    });
    setTimeout(() => {
      thinkingDots.forEach(dot => dot.destroy());
      thinkingDots = [];
    }, 800);
  }

  // ================================================================
  // ANSWER SCREEN — Victory particle burst
  // ================================================================
  function playAnswerBurst() {
    if (!isReady) return;
    if (window.RationalSound) window.RationalSound.playSound('burst');

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight * 0.2;
    const count = isMobile ? 40 : 80;
    const colors = [CONFIG.colors.mustard, CONFIG.colors.red, CONFIG.colors.blue];

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const speed = 4 + Math.random() * 10;
      const color = colors[i % colors.length];

      const dot = createDot(centerX, centerY, color, 2 + Math.random() * 2);
      if (!dot) break;
      dot.targetAlpha = 0.8;
      dot.free = true;
      dot.phase = 'burst';
      dot.applyForce(Math.cos(angle) * speed, Math.sin(angle) * speed);

      // Fade out over time
      gsap.to(dot, {
        targetAlpha: 0,
        duration: 1.5,
        delay: 0.3 + Math.random() * 0.5,
        ease: 'power2.in',
      });
    }
  }

  // ================================================================
  // INIT & PUBLIC API
  // ================================================================
  function init() {
    // Respect reduced motion preference
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      document.body.classList.add('particles-ready');
      isReady = false; // Skip all particle effects
      return;
    }

    initPixi();
    if (!isReady) {
      // PixiJS failed to init — graceful degradation
      document.body.classList.add('particles-ready');
      return;
    }

    initInput();
    initThemeWatcher();
    initAdaptiveQuality();
    gameLoop();

    // Play load sequence after a brief delay
    requestAnimationFrame(() => {
      playLoadSequence();
    });

    // Wire up card hover effects after DOM is ready
    setTimeout(initCardHoverEffects, CONFIG.loadDuration * 1000 + 200);
  }

  // ================================================================
  // THEME AWARENESS — re-tint particles on dark/light switch
  // ================================================================
  function initThemeWatcher() {
    const observer = new MutationObserver(() => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      // In light mode, dim particles more and shift gray
      dots.forEach(dot => {
        if (dot.phase === 'card' || dot.phase === 'ambient') {
          dot.targetAlpha = isLight
            ? dot.targetAlpha * 0.6  // subtler in light mode
            : dot.targetAlpha;
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  // ================================================================
  // ADAPTIVE QUALITY — drop particles if FPS drops
  // ================================================================
  let lastFrameTime = 0;
  let slowFrameCount = 0;
  let qualityReduced = false;

  function initAdaptiveQuality() {
    // Check in the game loop — but sample every 60 frames
    let frameCount = 0;
    const origGameLoop = gameLoop;

    // Override game loop with quality monitoring
    const monitoredLoop = () => {
      const now = performance.now();
      if (lastFrameTime > 0) {
        const dt = now - lastFrameTime;
        if (dt > 20) { // Below ~50fps
          slowFrameCount++;
        } else {
          slowFrameCount = Math.max(0, slowFrameCount - 1);
        }

        // If consistently slow, hide every other dot
        if (slowFrameCount > 10 && !qualityReduced) {
          qualityReduced = true;
          dots.forEach((dot, i) => {
            if (i % 2 === 0) {
              dot.sprite.visible = false;
            }
          });
        }
        // Recovery
        if (slowFrameCount === 0 && qualityReduced) {
          qualityReduced = false;
          dots.forEach(dot => { dot.sprite.visible = true; });
        }
      }
      lastFrameTime = now;
    };

    // Inject into game loop
    const origRequest = gameLoop;
    // We'll call monitoredLoop at the start of each frame
    window._particleQualityMonitor = monitoredLoop;
  }

  // ================================================================
  // MAIN RENDER LOOP (updated to include quality monitor)
  // ================================================================
  // Redefine gameLoop to include quality monitoring
  function gameLoop() {
    animationId = requestAnimationFrame(gameLoop);

    // Quality monitoring
    if (window._particleQualityMonitor) window._particleQualityMonitor();

    // Update all dots
    for (let i = 0; i < dots.length; i++) {
      dots[i].update(1);
    }

    // Interactive effects
    applyMouseRepulsion();
    updateCursorTrail();
  }

  // ================================================================
  // SCROLL DRIFT — gentle parallax on scroll
  // ================================================================
  function applyScrollDrift(delta) {
    const drift = delta * 0.08;
    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      if (!dot.alive || dot.free) continue;
      // Drift proportional to distance from center
      const offset = (dot.x / window.innerWidth - 0.5) * drift;
      dot.applyForce(offset * 0.3, drift * 0.1);
    }
  }

  // ================================================================
  // ASCII ART RASTERIZATION — convert text art to dot particles on hover
  // ================================================================
  function rasterizeAsciiArt(preElement, cardRect, color) {
    if (!preElement || !isReady) return;

    // Create offscreen canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const scale = 2;
    canvas.width = cardRect.width * scale;
    canvas.height = cardRect.height * scale;

    // Render the text
    const text = preElement.textContent;
    const lines = text.split('\n').filter(l => l.trim());
    ctx.font = `${10 * scale}px "Space Mono", monospace`;
    ctx.fillStyle = '#ffffff';

    lines.forEach((line, i) => {
      ctx.fillText(line, 10 * scale, (12 + i * 12) * scale);
    });

    // Sample pixels to get dot positions
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;
    const dotPositions = [];
    const step = 4 * scale; // Sample every Nth pixel

    for (let y = 0; y < canvas.height; y += step) {
      for (let x = 0; x < canvas.width; x += step) {
        const idx = (y * canvas.width + x) * 4;
        if (pixels[idx + 3] > 100) { // Non-transparent
          dotPositions.push({
            x: cardRect.left + (x / scale),
            y: cardRect.top + (y / scale),
          });
        }
      }
    }

    // Create particles at these positions
    const newDots = [];
    const maxAsciiDots = Math.min(dotPositions.length, isMobile ? 40 : 80);
    for (let i = 0; i < maxAsciiDots; i++) {
      const pos = dotPositions[Math.floor(Math.random() * dotPositions.length)];
      const dot = createDot(pos.x, pos.y, color, 2);
      if (!dot) break;
      dot.targetAlpha = 0.6;
      dot.phase = 'ascii';
      newDots.push(dot);

      // Start from center of card and fly to position
      dot.setPosition(
        cardRect.left + cardRect.width / 2,
        cardRect.top + cardRect.height / 2
      );
    }

    return newDots;
  }

  // Expose API for app.js to call
  window.RationalParticles = {
    init,
    playTransition,
    dotMatrixReveal,
    startThinkingVisualization,
    stopThinkingVisualization,
    playAnswerBurst,
    spawnHomeDots,
    clearDots,
    applyScrollDrift,
    rasterizeAsciiArt,
    get isReady() { return isReady; },
  };

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
