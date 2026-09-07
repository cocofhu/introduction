(() => {
    "use strict";

    const root = document.documentElement;
    const curtain = document.getElementById("curtain");
    const sigFly = document.getElementById("sigFly");
    const wordmark = document.getElementById("wordmark");
    const wordmarkHit = document.getElementById("wordmarkHit");
    if (wordmarkHit) {
      wordmarkHit.addEventListener("pointerenter", () => wordmarkHit.classList.add("is-hot"));
      wordmarkHit.addEventListener("pointerleave", () => wordmarkHit.classList.remove("is-hot"));
    }
    const cue = document.getElementById("cue");
    const screenCue = document.getElementById("screenCue");
    const frame = document.getElementById("frame");
    const chassis = document.getElementById("chassis");
    const glass = document.getElementById("glass");
    const env = document.getElementById("env");
    const starBg = document.getElementById("starBg");
    const starIntro = document.getElementById("starIntro");
    const starLoop = document.getElementById("starLoop");

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarsePointer = window.matchMedia("(hover: none), (pointer: coarse)").matches;
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const touchIntro = coarsePointer || isIOS || window.innerWidth <= 900;
    if (touchIntro) root.classList.add("touch-intro");

    let smoothScrollRaf = 0;

    function smoothScrollTo(targetY, ms) {
      const start = window.scrollY;
      const dist = targetY - start;
      if (Math.abs(dist) < 1) return;
      if (smoothScrollRaf) {
        cancelAnimationFrame(smoothScrollRaf);
        smoothScrollRaf = 0;
      }
      if (reduceMotion) {
        window.scrollTo({ top: targetY, behavior: "auto" });
        return;
      }
      const dur = ms || Math.min(900, Math.max(420, Math.abs(dist) * 0.38));
      const t0 = performance.now();
      const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const step = (now) => {
        const u = Math.min(1, (now - t0) / dur);
        window.scrollTo({ top: start + dist * ease(u), behavior: "auto" });
        if (u < 1) smoothScrollRaf = requestAnimationFrame(step);
        else smoothScrollRaf = 0;
      };
      smoothScrollRaf = requestAnimationFrame(step);
    }

    function cancelSmoothScroll() {
      if (diveLock) return;
      if (!smoothScrollRaf) return;
      cancelAnimationFrame(smoothScrollRaf);
      smoothScrollRaf = 0;
    }

    ["wheel", "touchstart", "keydown"].forEach((ev) => {
      window.addEventListener(ev, cancelSmoothScroll, { passive: true });
    });

    if (cue) {
      cue.addEventListener("click", () => {
        diveIntoScreen();
      });
    }

    if (screenCue) {
      screenCue.addEventListener("click", () => {
        const work = document.getElementById("work");
        if (!work) return;
        screenCue.classList.remove("is-shown");
        const y = work.getBoundingClientRect().top + window.scrollY - Math.round(window.innerHeight * 0.06);
        smoothScrollTo(y, 680);
      });
    }

    (function hudClock() {
      const el = document.getElementById("hudClock");
      if (!el) return;
      const tick = () => {
        const d = new Date();
        el.textContent = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      };
      tick();
      setInterval(tick, 30000);
    })();

    let dpr = 1;

    // Filled after layer setup; layout() pauses them once the hero room is gone
    let envNebula = null;
    let cicdVideo = null;
    let envFxOff = false;
    let fxSuspended = false;
    let introDone = false;
    let diveArmed = false;
    let diveLock = false;
    let starPlayed = false;
    let starArmed = false;
    let starLooping = false;
    let starLoaded = false;
    let starHandoffPending = false;
    let starLoopAttempt = 0;
    let stallWatchId = 0;
    let lastStarLoopTime = -1;
    let starStallHits = 0;
    const STAR_INTRO_SRC = (window.COCOFHU && window.COCOFHU.starIntro) || "assets/star-handoff.mp4?v=bake2";
    // g1.1: never wait forever on canplay — WeChat / desktop both stall here
    const PLAY_WAIT_MS = 900;
    const ADVANCE_WAIT_MS = 1400;
    const STALL_POLL_MS = 1400;

    function loadStarSrc() {
      if (starLoaded) return;
      if (starIntro && !starIntro.getAttribute("src")) starIntro.src = STAR_INTRO_SRC;
      [starIntro, starLoop].forEach((el) => {
        if (!el) return;
        try { el.load(); } catch (_) {}
      });
      starLoaded = true;
    }

    function dropStarIntro() {
      if (!starIntro) return;
      try { starIntro.pause(); } catch (_) {}
      starIntro.removeAttribute("src");
      try { starIntro.load(); } catch (_) {}
    }

    // g1.1: timeout + onFail so poster/intro stay if play never starts.
    // These clips are preload="none", so play() is also what starts the fetch —
    // waiting on canplay first would leave readyState at 0 forever.
    function playVid(el, onFail) {
      if (!el) {
        if (typeof onFail === "function") onFail();
        return;
      }
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        if (typeof onFail === "function") onFail();
      };
      const go = () => {
        if (settled) return;
        const p = el.play();
        if (p && typeof p.then === "function") {
          p.then(() => { settled = true; }).catch(fail);
        } else {
          settled = true;
        }
      };
      go();
      setTimeout(() => {
        if (settled) return;
        // Still buffering counts as alive — only a stopped element is a failure
        if (!el.paused && el.readyState >= 2) {
          settled = true;
          return;
        }
        fail();
      }, PLAY_WAIT_MS);
    }

    function showStar(el) {
      if (starIntro) starIntro.classList.toggle("is-shown", el === starIntro);
      if (starLoop) starLoop.classList.toggle("is-shown", el === starLoop);
    }

    function isVidAdvancing(el, prevTime) {
      if (!el || el.paused) return false;
      const t = el.currentTime || 0;
      return t - prevTime > 0.04;
    }

    // Wait until currentTime actually moves (g1.2 handoff gate)
    function waitForAdvance(el, cb, timeoutMs) {
      if (!el) {
        if (typeof cb === "function") cb(false);
        return;
      }
      const t0 = el.currentTime || 0;
      const start = performance.now();
      const limit = timeoutMs || ADVANCE_WAIT_MS;
      const tick = () => {
        if (isVidAdvancing(el, t0)) {
          if (typeof cb === "function") cb(true);
          return;
        }
        if (performance.now() - start >= limit) {
          if (typeof cb === "function") cb(false);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    // Poster / static-frame fallback — keep visible until a real frame paints (g1.1 / g3.2)
    function clearStarFallback() {
      if (!starBg) return;
      starBg.classList.remove("is-fallback");
      starBg.style.removeProperty("background-image");
      starBg.style.removeProperty("background-size");
      starBg.style.removeProperty("background-position");
    }

    function showStarPosterFallback() {
      if (!starBg) return;
      const poster = (starIntro && starIntro.getAttribute("poster")) || "";
      if (poster) {
        starBg.style.backgroundImage = `url("${poster}")`;
        starBg.style.backgroundSize = "cover";
        starBg.style.backgroundPosition = "center";
      }
      starBg.classList.add("is-fallback");
      // Prefer intro element (keeps poster attr / last frame) over blank loop
      if (starIntro) showStar(starIntro);
    }

    function keepStarStill() {
      // Prefer live intro last frame; else static poster — never pure black
      if (starIntro && starIntro.getAttribute("src")) {
        showStar(starIntro);
        if (starIntro.readyState < 2) showStarPosterFallback();
      } else {
        showStarPosterFallback();
      }
    }

    function reloadAndPlay(el, onFail) {
      if (!el) {
        if (typeof onFail === "function") onFail();
        return;
      }
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        if (typeof onFail === "function") onFail();
      };
      const ok = () => {
        if (settled) return;
        settled = true;
        clearStarFallback();
      };
      const attempt = () => {
        const p = el.play();
        if (p && p.then) {
          p.then(ok).catch(fail);
        } else {
          ok();
        }
      };
      try { el.load(); } catch (_) {}
      attempt();
      setTimeout(() => {
        if (settled) return;
        if (!el.paused && el.readyState >= 2) {
          ok();
          return;
        }
        fail();
      }, PLAY_WAIT_MS);
    }

    function finishStarHandoff() {
      starHandoffPending = false;
      clearStarFallback();
      showStar(starLoop);
      dropStarIntro();
      lastStarLoopTime = starLoop ? (starLoop.currentTime || 0) : -1;
      starStallHits = 0;
    }

    // g1.2: start cycle while intro stays; drop only after cycle time moves
    function beginStarLoopPlayback() {
      if (!starLoop || reduceMotion) return;
      loadStarSrc();
      starHandoffPending = true;
      const attempt = ++starLoopAttempt;
      // Keep intro (or poster) on screen during the gap
      if (starIntro && starIntro.getAttribute("src")) showStar(starIntro);
      else showStarPosterFallback();

      const afterPlay = () => {
        waitForAdvance(starLoop, (ok) => {
          if (attempt !== starLoopAttempt) return;
          if (ok) {
            finishStarHandoff();
            return;
          }
          // Loop not advancing yet — keep still, let watchdog / gesture retry
          keepStarStill();
        });
      };

      const startLoop = () => {
        if (attempt !== starLoopAttempt) return;
        try { starLoop.currentTime = 0; } catch (_) {}
        playVid(starLoop, () => {
          if (attempt !== starLoopAttempt) return;
          keepStarStill();
        });
        afterPlay();
      };

      if (starLoop.readyState >= 2) startLoop();
      else {
        let started = false;
        const once = () => {
          if (started || attempt !== starLoopAttempt) return;
          started = true;
          startLoop();
        };
        starLoop.addEventListener("canplay", once, { once: true });
        setTimeout(() => {
          if (started || attempt !== starLoopAttempt) return;
          if (starLoop.readyState >= 2) once();
          else keepStarStill();
        }, PLAY_WAIT_MS);
      }
    }

    function enterStarLoop() {
      if (!starIntro || !starLoop || reduceMotion || starLooping) return;
      starPlayed = true;
      starArmed = false;
      starLooping = true;
      // Handoff clip already ends on the loop's last frame; jump to loop[0]
      // which matches that last frame (seamless loop source).
      beginStarLoopPlayback();
      ensureStallWatch();
    }

    // g1.3: after settle, wake frozen cycle / cicd without a full refresh
    function ensureStallWatch() {
      if (stallWatchId || reduceMotion) return;
      stallWatchId = window.setInterval(() => {
        if (document.hidden) return;
        nudgeStarPlayback(false);
        if (cicdVideo && typeof cicdVideo.nudge === "function") cicdVideo.nudge();
      }, STALL_POLL_MS);
    }

    function nudgeStarPlayback(force) {
      if (document.hidden || reduceMotion || !starBg) return;
      const wantOn = introDone && (progress > 0.88 || (starPlayed && progress > 0.55));
      if (!wantOn) return;
      starBg.classList.add("is-on");

      if (starLooping && starLoop) {
        const t = starLoop.currentTime || 0;
        // First sample only — avoid restarting a fresh handoff attempt
        if (!force && lastStarLoopTime < 0) {
          lastStarLoopTime = t;
          return;
        }
        const frozen = starLoop.paused || Math.abs(t - lastStarLoopTime) < 0.02;
        if (!force) {
          if (frozen) starStallHits += 1;
          else {
            starStallHits = 0;
            lastStarLoopTime = t;
            // Late advance after a timed-out waitForAdvance — complete handoff
            if (starHandoffPending) finishStarHandoff();
            else {
              clearStarFallback();
              showStar(starLoop);
            }
            return;
          }
          lastStarLoopTime = t;
          // Require two consecutive frozen polls unless forced by gesture
          if (starStallHits < 2) return;
        } else {
          lastStarLoopTime = t;
        }
        starStallHits = 0;

        if (starHandoffPending || !starLoop.classList.contains("is-shown")) {
          // Still in handoff — retry cycle without dropping intro
          beginStarLoopPlayback();
          return;
        }

        if (starLoop.readyState < 2 || starLoop.networkState === 3) {
          keepStarStill();
          reloadAndPlay(starLoop, keepStarStill);
        } else {
          playVid(starLoop, () => {
            keepStarStill();
            reloadAndPlay(starLoop, keepStarStill);
          });
          waitForAdvance(starLoop, (ok) => {
            if (ok) {
              clearStarFallback();
              showStar(starLoop);
            } else {
              keepStarStill();
            }
          });
        }
        return;
      }

      if (!starPlayed && starIntro) {
        if (starIntro.readyState < 2) loadStarSrc();
        showStar(starIntro);
        if (starIntro.paused || force) {
          playVid(starIntro, showStarPosterFallback);
          waitForAdvance(starIntro, (ok) => {
            if (ok) clearStarFallback();
            else showStarPosterFallback();
          });
        }
      }
    }

    // g2.1: shared unlock for WeChat autoplay + desktop freeze
    let lastKickAt = 0;
    function kickPlayback(force) {
      if (document.hidden || !introDone) return;
      const now = performance.now();
      if (!force && now - lastKickAt < 900) return;
      lastKickAt = now;
      nudgeStarPlayback(true);
      if (cicdVideo) {
        if (typeof cicdVideo.start === "function") cicdVideo.start();
        if (typeof cicdVideo.resume === "function") cicdVideo.resume();
        if (typeof cicdVideo.nudge === "function") cicdVideo.nudge(true);
      }
      ensureStallWatch();
    }

    // Resume loop/intro after background without replaying signature intro (g2.2 / g3)
    function resumeStarfield() {
      if (document.hidden || !starBg) return;
      const wantOn = introDone && (progress > 0.88 || (starPlayed && progress > 0.55));
      if (!wantOn) return;

      starBg.classList.add("is-on");

      if (reduceMotion) {
        showStarPosterFallback();
        return;
      }

      nudgeStarPlayback(true);
    }

    function resetStarBg() {
      starPlayed = false;
      starArmed = false;
      starLooping = false;
      starLoaded = false;
      starHandoffPending = false;
      starLoopAttempt = 0;
      lastStarLoopTime = -1;
      starStallHits = 0;
      if (!starBg) return;
      starBg.classList.remove("is-on");
      clearStarFallback();
      if (starIntro) {
        if (!starIntro.getAttribute("src")) starIntro.src = STAR_INTRO_SRC;
        try { starIntro.pause(); starIntro.currentTime = 0; } catch (_) {}
      }
      if (starLoop) {
        try { starLoop.pause(); starLoop.currentTime = 0; } catch (_) {}
      }
      showStar(null);
    }

    function setStarBg(on) {
      if (!starBg || !starIntro) return;
      if (on) loadStarSrc();
      const linger = starPlayed && introDone && progress > 0.55;
      const active = on || linger;
      starBg.classList.toggle("is-on", active);

      if (reduceMotion || !active) {
        try { starIntro.pause(); } catch (_) {}
        try { if (starLoop) starLoop.pause(); } catch (_) {}
        if (!active) clearStarFallback();
        else if (reduceMotion) showStarPosterFallback();
        return;
      }

      if (on) ensureStallWatch();

      if (on && !starPlayed && !starArmed) {
        starArmed = true;
        starLooping = false;
        // g1.1: keep poster until a real intro frame advances — never clear-then-wait
        showStarPosterFallback();
        showStar(starIntro);
        playVid(starIntro, showStarPosterFallback);
        waitForAdvance(starIntro, (ok) => {
          if (ok) clearStarFallback();
          else showStarPosterFallback();
        });
      } else if (on && !starPlayed && starArmed && starIntro && starIntro.paused) {
        playVid(starIntro, showStarPosterFallback);
      } else if (on && starLooping && starLoop && (starLoop.paused || starHandoffPending)) {
        nudgeStarPlayback(true);
      }
    }

    if (starIntro) {
      starIntro.loop = false;
      // Baked dissolve lives inside star-handoff.mp4; when it ends, continue on loop
      starIntro.addEventListener("ended", enterStarLoop);
      starIntro.addEventListener("timeupdate", () => {
        if (starLooping || !starIntro.duration) return;
        if (starIntro.currentTime >= starIntro.duration - 0.05) {
          enterStarLoop();
        }
      });
    }

    if (starLoop) {
      starLoop.loop = true;
      starLoop.addEventListener("ended", () => {
        if (!starLooping) return;
        try { starLoop.currentTime = 0; } catch (_) {}
        playVid(starLoop, keepStarStill);
      });
    }

    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const smoothstep = (a, b, v) => {
      const t = clamp01((v - a) / (b - a));
      return t * t * (3 - 2 * t);
    };

    /* ============================================================
       Scroll rig: the monitor grows until its glass is the viewport
       ============================================================ */

    const GROW = 1.4;   // viewport-heights of scroll spent growing
    const START_DESKTOP = 0.52;
    const START_MOBILE = 0.65;
    const ENTER_AT = 0.999;
    const RIG_COLLAPSE = 1.8;  // 280vh → 100vh after the grow is locked

    let progress = 0;
    let frameScale = START_DESKTOP;
    let frameSettled = false;
    let eFloor = -1;           // -1 = not fully inside yet
    let rigCollapsed = false;
    const workBand = document.getElementById("work");
    const pinEl = document.querySelector(".pin");
    const rig = document.getElementById("rig");

    const startScale = () => (window.innerWidth <= 900 ? START_MOBILE : START_DESKTOP);

    // Desktop: landscape 16:9 object in the room.
    // Mobile: a bit taller than 16:9 so wordmark + hello + tags + pills fit;
    // long bio stays hidden until is-inside.
    function panelHeight() {
      const vh = window.innerHeight;
      const vw = frame.offsetWidth;
      if (!vw) return vh;
      if (window.innerWidth <= 900) {
        return Math.min(vh * 0.72, vw * 1.15);
      }
      return Math.min((vw * 9) / 16, vh);
    }

    function updateScreenCue(inside, workTop, pinRect) {
      if (!screenCue) return;
      // Nothing to show before the intro hands over — skip the rect reads
      if (!introDone || !inside) {
        screenCue.classList.remove("is-shown");
        return;
      }
      // After the grow is collapsed, pin sits at the document top:
      // scrollY > 8 is exactly pin.top < -8.
      if (rigCollapsed) {
        screenCue.classList.toggle("is-shown", window.scrollY <= 8);
        return;
      }
      let showScreenCue = true;
      if (workBand) {
        const wt = workTop != null ? workTop : workBand.getBoundingClientRect().top;
        if (wt < window.innerHeight * 0.85) showScreenCue = false;
      }
      if (pinEl) {
        const pr = pinRect || pinEl.getBoundingClientRect();
        if (pr.top < -8 || pr.bottom < window.innerHeight * 0.92) showScreenCue = false;
      }
      screenCue.classList.toggle("is-shown", showScreenCue);
    }

    function collapseRig() {
      if (rigCollapsed || !rig) return;
      rigCollapsed = true;
      const delta = window.innerHeight * RIG_COLLAPSE;
      const y = Math.max(0, window.scrollY - delta);
      root.classList.add("is-entered");
      void document.documentElement.scrollHeight;
      window.scrollTo(0, y);
    }

    function layout() {
      const vh = window.innerHeight;
      const span = vh * GROW;
      const raw = span > 0 ? clamp01(window.scrollY / span) : 1;
      let e = raw * raw * (3 - 2 * raw);
      if (eFloor >= 0) {
        e = Math.max(e, eFloor);
        eFloor = e;
      } else if (e >= ENTER_AT) {
        eFloor = e;
      }
      progress = e;
      const inside = e > (window.innerWidth <= 900 ? 0.9 : 0.82);

      // Read geometry before any style writes so we do not force a sync layout
      let workTop, pinRect;
      if (introDone && inside && !rigCollapsed) {
        if (workBand) workTop = workBand.getBoundingClientRect().top;
        if (pinEl) pinRect = pinEl.getBoundingClientRect();
      }

      if (eFloor >= 0 && !rigCollapsed && !diveLock && !smoothScrollRaf) collapseRig();

      if (e >= ENTER_AT && frameSettled) {
        if (inside !== root.classList.contains("is-inside")) {
          root.classList.toggle("is-inside", inside);
        }
        updateScreenCue(inside, workTop, pinRect);
        setStarBg(introDone);
        return;
      }

      const start = startScale();
      frameScale = start + (1 - start) * e;

      // 16:9 while it is an object in the room, viewport-shaped once we are inside
      const h16 = panelHeight();
      frame.style.height = (h16 + (vh - h16) * e).toFixed(2) + "px";
      frame.style.transform = "translateY(-50%) scale(" + frameScale + ")";
      frame.style.setProperty("--p", e.toFixed(4));

      // Corners square off exactly as the glass becomes the viewport
      glass.style.borderRadius = (16 * (1 - e)).toFixed(2) + "px";

      // The room around the monitor is gone by the time we are inside it
      env.style.opacity = (1 - smoothstep(0.3, 0.92, e)).toFixed(3);
      chassis.style.opacity = (1 - smoothstep(0.45, 1, e)).toFixed(3);

      if (e > 0.02) cue.classList.remove("is-shown");
      if (e > 0.85) diveArmed = false;

      if (inside !== root.classList.contains("is-inside")) {
        root.classList.toggle("is-inside", inside);
      }

      updateScreenCue(inside, workTop, pinRect);

      // Stop the room nebula as the desk starts fading — don't keep painting
      // through the dive while the star video is about to start.
      const off = e > 0.45;
      if (off !== envFxOff) {
        envFxOff = off;
        if (off) {
          if (envNebula) envNebula.stop();
        } else if (!fxSuspended) {
          if (envNebula) envNebula.start();
        }
      }

      // Play the starfield only once the glass is nearly the viewport
      setStarBg(introDone && progress > 0.88);
      frameSettled = e >= ENTER_AT;
    }

    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        layout();
      });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", () => {
      dpr = 1;
      frameSettled = false;
      layout();
    });

    // The 16:9 height is derived from the frame's own width, which shifts the
    // moment a document scrollbar appears — re-measure instead of guessing
    let lastParentW = -1, lastParentH = -1;
    if (window.ResizeObserver) {
      new ResizeObserver((entries) => {
        const cr = entries[0] && entries[0].contentRect;
        if (!cr) { layout(); return; }
        if (cr.width === lastParentW && cr.height === lastParentH) return;
        lastParentW = cr.width;
        lastParentH = cr.height;
        layout();
      }).observe(frame.parentElement);
    }
    /* ============================================================
       Layer instances
       ============================================================ */
    const NEBULA_THEMES = {
      indigo: { hue: 230, accent: "#7eafff", sky: "#000d4d" },
      violet: { hue: 280, accent: "#9b7dff", sky: "#1a0044" },
      teal:   { hue: 172, accent: "#3ecfc4", sky: "#002a2c" },
      rose:   { hue: 338, accent: "#ff7aa2", sky: "#2a0016" },
    };

    function applyTheme(id) {
      const theme = NEBULA_THEMES[id] || NEBULA_THEMES.indigo;
      root.dataset.theme = id;
      root.style.setProperty("--accent", theme.accent);
      env.style.setProperty("--sky", theme.sky);
      if (envNebula) envNebula.setHue(theme.hue);
      document.querySelectorAll("#hueSwitch [data-theme]").forEach((btn) => {
        btn.setAttribute("aria-pressed", btn.dataset.theme === id ? "true" : "false");
      });
    }

    function createNebula(canvasEl) {
      if (!canvasEl) return null;
      const box = canvasEl.parentElement;
      const ctx = canvasEl.getContext("2d", { alpha: true, desynchronized: true });
      if (!ctx) return null;

      const narrow = () => window.innerWidth <= 900;
      const COUNT = narrow() ? 18 : 26;
      const FPS = narrow() ? 16 : 22;
      let w = 0, h = 0, raf = 0, visible = false, last = 0;
      let hue = NEBULA_THEMES.indigo.hue;
      let camX = 0, camY = 0, tx = 0, ty = 0;
      const stars = [];
      let blob = null;
      const BLOB = 64;

      function makeBlob() {
        const c = document.createElement("canvas");
        c.width = c.height = BLOB;
        const x = c.getContext("2d");
        const mid = BLOB / 2;
        const g = x.createRadialGradient(mid, mid, 0, mid, mid, mid);
        g.addColorStop(0, "hsla(0, 0%, 100%, 0.92)");
        g.addColorStop(0.42, "hsla(" + hue + ", 86%, 48%, 0.62)");
        g.addColorStop(1, "hsla(" + hue + ", 86%, 40%, 0)");
        x.fillStyle = g;
        x.beginPath();
        x.arc(mid, mid, mid, 0, Math.PI * 2);
        x.fill();
        blob = c;
      }

      function seed() {
        stars.length = 0;
        for (let i = 0; i < COUNT; i++) {
          stars.push({
            a: Math.random() * 360,
            b: Math.random() * 360,
            c: Math.random() * 360,
            va: 0.32 + Math.random() * 0.22,
            vb: 0.28 + Math.random() * 0.22,
            vc: 0.26 + Math.random() * 0.2,
            shift: i * 2.4,
          });
        }
      }

      function resize() {
        const rect = box.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        w = rect.width;
        h = rect.height;
        const ratio = 1;
        canvasEl.width = Math.max(1, Math.floor(w * ratio));
        canvasEl.height = Math.max(1, Math.floor(h * ratio));
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }

      function paint() {
        if (!blob) makeBlob();
        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = "lighter";
        const R = Math.min(w, h) * 0.3;
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          const x = R * Math.cos(s.a * Math.PI / 180);
          const y = R * Math.sin(s.b * Math.PI / 180);
          const z = R * Math.sin(s.c * Math.PI / 180);
          const f = 280 / (280 + z);
          const px = w / 2 + (x + camX) * f;
          const py = h / 2 + (y + camY) * f;
          const rad = Math.max(0.5, f * 11);
          const size = rad * 4;
          ctx.drawImage(blob, px - rad * 2, py - rad * 2, size, size);
        }
        ctx.globalCompositeOperation = "source-over";
        if (!canvasEl.classList.contains("is-live")) canvasEl.classList.add("is-live");
      }

      function frame(now) {
        if (!visible) { raf = 0; return; }
        raf = requestAnimationFrame(frame);
        if (now - last < 1000 / FPS) return;
        const step = Math.min((now - last) / (1000 / 24), 2);
        last = now;
        camX += (tx - camX) * 0.05;
        camY += (ty - camY) * 0.05;
        for (let i = 0; i < stars.length; i++) {
          const s = stars[i];
          s.a += s.va * step;
          s.b += s.vb * step;
          s.c += s.vc * step;
        }
        paint();
      }

      function start() {
        if (raf || !visible) return;
        resize();
        if (!stars.length) seed();
        last = performance.now();
        if (reduceMotion) {
          paint();
          return;
        }
        raf = requestAnimationFrame(frame);
      }

      function stop() {
        cancelAnimationFrame(raf);
        raf = 0;
      }

      if (!coarsePointer && !reduceMotion) {
        let queued = false, mx = 0, my = 0;
        window.addEventListener("pointermove", (e) => {
          if (!visible) return;
          mx = e.clientX;
          my = e.clientY;
          if (queued) return;
          queued = true;
          requestAnimationFrame(() => {
            queued = false;
            if (!visible) return;
            tx = (mx - w / 2) * -0.22;
            ty = (my - h / 2) * 0.22;
          });
        }, { passive: true });
      }

      new ResizeObserver(() => { if (visible) resize(); }).observe(box);

      return {
        start() { visible = true; start(); },
        stop() { visible = false; stop(); },
        setHue(next) { hue = next; blob = null; if (visible) paint(); },
      };
    }

    envNebula = createNebula(document.getElementById("nebula"));

    const hueSwitch = document.getElementById("hueSwitch");
    if (hueSwitch) {
      hueSwitch.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-theme]");
        if (!btn) return;
        applyTheme(btn.dataset.theme);
      });
    }

    // Right column: looping CI/CD video + caption beats (same stall class as stars — g1.3 / g2)
    cicdVideo = (() => {
      const el = document.getElementById("cicdVideo");
      if (!el) return null;
      const caption = document.getElementById("vizCaption");
      const stage = el.closest(".viz-stage");
      const beatBuild = caption && caption.querySelector(".viz-beat--build");
      const beatDeploy = caption && caption.querySelector(".viz-beat--deploy");
      let running = false;
      let pinned = true;
      let beat = "build";
      let lastCicdTime = -1;
      let cicdStallHits = 0;
      // cicd.mp4 ~6.46s: code+pipeline → EXE/servers around 2.85s
      const DEPLOY_AT = 2.85;
      const BUILD_BACK = 2.55;

      const showCicdPoster = () => {
        if (!stage) return;
        // Hide empty/black video so stage poster can show (WeChat fail path)
        el.classList.remove("is-live");
        const poster = el.getAttribute("poster") || "";
        if (poster) {
          stage.style.backgroundImage = `url("${poster}")`;
          stage.style.backgroundSize = "contain";
          stage.style.backgroundPosition = "center";
          stage.style.backgroundRepeat = "no-repeat";
        }
        stage.classList.add("is-fallback");
      };

      const clearCicdPoster = () => {
        if (!stage) return;
        stage.classList.remove("is-fallback");
        stage.style.removeProperty("background-image");
        stage.style.removeProperty("background-size");
        stage.style.removeProperty("background-position");
        stage.style.removeProperty("background-repeat");
      };

      const setBeat = (next) => {
        if (!caption || !beatBuild || !beatDeploy || next === beat) return;
        beat = next;
        caption.dataset.beat = next;
        const showBuild = next === "build";
        const incoming = showBuild ? beatBuild : beatDeploy;
        const outgoing = showBuild ? beatDeploy : beatBuild;

        if (reduceMotion) {
          beatBuild.classList.toggle("is-on", showBuild);
          beatDeploy.classList.toggle("is-on", !showBuild);
          beatBuild.hidden = !showBuild;
          beatDeploy.hidden = showBuild;
          beatBuild.classList.remove("is-leave");
          beatDeploy.classList.remove("is-leave");
          return;
        }

        outgoing.classList.remove("is-on");
        outgoing.classList.add("is-leave");
        incoming.classList.remove("is-leave");
        // restart em kick
        void incoming.offsetWidth;
        incoming.classList.add("is-on");
        window.setTimeout(() => {
          if (!outgoing.classList.contains("is-on")) outgoing.classList.remove("is-leave");
        }, 480);
      };

      const syncCaption = () => {
        if (reduceMotion || !caption) return;
        const t = el.currentTime || 0;
        if (beat === "build" && t >= DEPLOY_AT) setBeat("deploy");
        else if (beat === "deploy" && t < BUILD_BACK) setBeat("build");
      };

      // g2.3: ≤900px never plays / fetches decode path
      const phoneSplit = () => window.innerWidth <= 900;

      const tryPlay = () => {
        if (!running || !pinned || reduceMotion) return;
        if (phoneSplit()) {
          el.pause();
          return;
        }
        // Already painting — just keep playing without flashing the poster
        if (!el.paused && el.readyState >= 2 && (el.currentTime || 0) > 0.05) {
          clearCicdPoster();
          el.classList.add("is-live");
          const keep = el.play();
          if (keep && typeof keep.catch === "function") keep.catch(() => showCicdPoster());
          return;
        }
        // Keep poster until frames advance — avoid black MyWork (g1.1 / f3)
        showCicdPoster();
        playVid(el, showCicdPoster);
        waitForAdvance(el, (ok) => {
          if (ok) {
            clearCicdPoster();
            el.classList.add("is-live");
            lastCicdTime = el.currentTime || 0;
            cicdStallHits = 0;
          } else {
            showCicdPoster();
          }
        });
      };

      const nudge = (force) => {
        if (!running || !pinned || reduceMotion || phoneSplit() || document.hidden) return;
        const t = el.currentTime || 0;
        const frozen = el.paused || (lastCicdTime >= 0 && Math.abs(t - lastCicdTime) < 0.02);
        if (!force && lastCicdTime >= 0) {
          if (frozen) cicdStallHits += 1;
          else {
            cicdStallHits = 0;
            lastCicdTime = t;
            clearCicdPoster();
            el.classList.add("is-live");
            return;
          }
          lastCicdTime = t;
          if (cicdStallHits < 2) return;
        } else {
          lastCicdTime = t;
        }
        cicdStallHits = 0;
        if (el.readyState < 2 || el.networkState === 3) {
          showCicdPoster();
          try { el.load(); } catch (_) {}
        }
        tryPlay();
      };

      el.addEventListener("timeupdate", syncCaption);
      el.addEventListener("seeked", syncCaption);
      el.addEventListener("loadedmetadata", syncCaption);

      el.addEventListener("loadeddata", () => {
        if (reduceMotion) {
          el.classList.add("is-live");
          try { el.currentTime = Math.min(0.1, (el.duration || 1) * 0.4); } catch (_) {}
          el.pause();
          showCicdPoster();
          if (beatBuild && beatDeploy) {
            beatBuild.classList.add("is-on");
            beatDeploy.classList.remove("is-on");
            beatBuild.hidden = false;
            beatDeploy.hidden = true;
          }
        } else {
          tryPlay();
        }
      });

      // Pause only when the sticky monitor leaves the viewport
      const pin = document.querySelector(".pin");
      if (pin && "IntersectionObserver" in window) {
        new IntersectionObserver(([entry]) => {
          pinned = entry.isIntersecting;
          if (pinned) tryPlay();
          else el.pause();
        }, { threshold: 0 }).observe(pin);
      }

      return {
        start() {
          running = true;
          if (reduceMotion) {
            el.pause();
            showCicdPoster();
            // Poster path: keep video opacity 0 via missing is-live
            return;
          }
          if (phoneSplit()) return;
          // Do not set is-live until frames advance — otherwise black video covers poster
          tryPlay();
          ensureStallWatch();
        },
        stop() {
          running = false;
          el.pause();
        },
        resume() {
          if (running) tryPlay();
        },
        nudge,
        resize() {},
      };
    })();

    // Tab hidden → freeze all continuous work; foreground → revive star loop (g3)
    document.addEventListener("visibilitychange", () => {
      fxSuspended = document.hidden;
      if (fxSuspended) {
        if (envNebula) envNebula.stop();
        if (cicdVideo) cicdVideo.stop();
        try { if (starIntro) starIntro.pause(); } catch (_) {}
        try { if (starLoop) starLoop.pause(); } catch (_) {}
      } else {
        if (!envFxOff) {
          if (envNebula) envNebula.start();
        }
        // Re-arm playback after a background pause; resume() respects pin visibility
        if (cicdVideo && introDone) {
          cicdVideo.start();
          cicdVideo.resume();
        }
        setStarBg(introDone && progress > 0.88);
        resumeStarfield();
      }
    });

    // iOS / bfcache path — resume star + cicd without replaying signature (g2.2)
    window.addEventListener("pageshow", () => {
      if (document.hidden) return;
      if (cicdVideo && introDone) {
        cicdVideo.start();
        cicdVideo.resume();
      }
      setStarBg(introDone && progress > 0.88);
      resumeStarfield();
    });

    if ("onresume" in document) {
      document.addEventListener("resume", () => {
        if (cicdVideo && introDone) {
          cicdVideo.start();
          cicdVideo.resume();
        }
        setStarBg(introDone && progress > 0.88);
        resumeStarfield();
      });
    }

    // g2.1: tap / pointer after intro can unlock WeChat autoplay (no new play button)
    ["pointerdown", "touchend"].forEach((ev) => {
      window.addEventListener(ev, () => {
        if (!introDone || document.hidden) return;
        if (!(starArmed || starPlayed || starLooping || progress > 0.88)) return;
        kickPlayback(false);
      }, { passive: true });
    });

    /* ============================================================
       Intro: sign, hand the signature to the desk, then release
       ============================================================ */

    const T_WRITE = 240;    // pen touches down
    const T_LIGHT = 2380;   // the desk lights up behind the ink
    const T_FLY = 3060;     // the signature shrinks into the screen
    const T_DONE = 4180;    // scroll is released

    let introTimers = [];

    // Hold the page at the top until the signature has been handed over,
    // without toggling overflow (which would flash the scrollbar away)
    function holdIntroScroll() {
      if (!introDone && window.scrollY > 0) window.scrollTo(0, 0);
    }
    window.addEventListener("scroll", holdIntroScroll, { passive: true });

    function flyTarget() {
      const from = sigFly.getBoundingClientRect();
      const to = wordmark.getBoundingClientRect();
      if (!from.width || !to.width) return null;
      const scale = to.width / from.width;
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      return "translate(-50%, -50%) translate(" + dx + "px, " + dy + "px) scale(" + scale + ")";
    }

    function lightUp() {
      curtain.classList.add("is-lifted");
      glass.classList.add("is-lit");
      frame.classList.add("is-lit");
      if (envNebula) envNebula.start();
      if (cicdVideo) cicdVideo.start();
    }

    function land() {
      wordmark.classList.add("is-shown");
      if (wordmarkHit) wordmarkHit.classList.add("is-shown");
      sigFly.classList.add("is-landed");
    }

    function diveIntoScreen() {
      if (diveLock || !introDone) return;
      if (progress >= 0.96) {
        diveArmed = false;
        // Already inside — still use this gesture to unstick videos (g2.1)
        kickPlayback(true);
        return;
      }
      diveArmed = false;
      diveLock = true;
      cue.classList.remove("is-shown");
      envFxOff = true;
      if (envNebula) envNebula.stop();
      // Land fully inside so the ratchet can latch (ENTER_AT)
      const enterY = Math.max(1, Math.floor(window.innerHeight * GROW));
      const dist = Math.abs(enterY - window.scrollY);
      const dur = reduceMotion ? 1 : Math.min(1550, Math.max(1100, dist * 0.65));
      // g2.1: dive scroll/tap is a trusted gesture — arm star + cicd
      kickPlayback(true);
      smoothScrollTo(enterY, dur);
      setTimeout(() => {
        diveLock = false;
        layout();
        kickPlayback(true);
      }, dur + 60);
    }

    function release() {
      introDone = true;
      introSkipArmed = false;
      window.removeEventListener("scroll", holdIntroScroll);
      root.classList.remove("is-intro");
      sigFly.style.display = "none";
      loadStarSrc();
      // Body leaves position:fixed — remeasure before the next paint
      layout();
      // Arm after this event so a skip-intro wheel does not also dive
      requestAnimationFrame(() => {
        if (!introDone || progress > 0.15) return;
        diveArmed = true;
        cue.classList.add("is-shown");
      });
    }

    let introSkipArmed = false;
    let introTouchY = null;

    function runIntro() {
      introTimers.forEach(clearTimeout);
      introTimers = [];
      introDone = false;
      introSkipArmed = false;
      introTouchY = null;
      diveArmed = false;
      diveLock = false;
      resetStarBg();

      // Pin only after we are at the top, otherwise fixed body freezes mid-page
      window.scrollTo(0, 0);
      root.classList.add("is-intro");
      layout();

      sigFly.style.display = "";
      sigFly.classList.remove("is-flying", "is-landed");
      sigFly.style.transform = "translate(-50%, -50%)";
      sigFly.style.color = "";
      root.classList.remove("sig-writing", "sig-written");
      wordmark.classList.remove("is-shown");
      if (wordmarkHit) wordmarkHit.classList.remove("is-shown", "is-hot");
      curtain.classList.remove("is-lifted");
      glass.classList.remove("is-lit");
      frame.classList.remove("is-lit");
      cue.classList.remove("is-shown");

      // Ignore accidental first taps / Safari chrome gestures for a beat
      introTimers.push(setTimeout(() => { introSkipArmed = true; }, 1400));

      if (reduceMotion) {
        // Still show the static signature briefly — don't jump straight to the desk
        root.classList.add("sig-written");
        const at = (ms, fn) => introTimers.push(setTimeout(fn, ms));
        at(900, () => { lightUp(); land(); });
        at(1500, release);
        return;
      }

      // Reflow so the write animation always restarts from a clean slate
      void root.offsetWidth;

      const at = (ms, fn) => introTimers.push(setTimeout(fn, ms));

      at(T_WRITE, () => root.classList.add("sig-writing"));
      at(T_LIGHT, lightUp);
      at(T_FLY, () => {
        const target = flyTarget();
        if (!target) { land(); return; }
        sigFly.classList.add("is-flying");
        void sigFly.offsetWidth;
        sigFly.style.transform = target;
        // The real wordmark takes over just before the flyer fades out
        introTimers.push(setTimeout(land, 780));
      });
      at(T_DONE, release);
    }

    function skipIntro() {
      if (introDone || !introSkipArmed) return;
      introTimers.forEach(clearTimeout);
      introTimers = [];
      sigFly.classList.remove("is-flying");
      root.classList.remove("sig-writing");
      root.classList.add("sig-written");
      lightUp();
      land();
      release();
      // g2.1: WeChat / desktop — unlock playback inside the skip gesture
      kickPlayback(true);
    }

    // Desktop: wheel / keys can skip. Mobile: only a deliberate swipe skips —
    // bare touchstart/pointerdown was killing the intro on iPhone immediately.
    window.addEventListener("wheel", skipIntro, { passive: true });
    window.addEventListener("keydown", (e) => {
      if (["Escape", "Enter", " ", "PageDown", "ArrowDown"].includes(e.key)) skipIntro();
    });
    window.addEventListener("touchstart", (e) => {
      if (introDone) return;
      introTouchY = e.touches[0] ? e.touches[0].clientY : null;
    }, { passive: true });
    window.addEventListener("touchmove", (e) => {
      if (introDone || !introSkipArmed || introTouchY == null) return;
      const y = e.touches[0] ? e.touches[0].clientY : introTouchY;
      if (Math.abs(introTouchY - y) < 28) return;
      introTouchY = null;
      skipIntro();
    }, { passive: true });

    // One downward scroll finishes the whole room → glass transition
    window.addEventListener("wheel", (e) => {
      if (!introDone) return;
      if (e.deltaY <= 0) return;
      if (diveLock) {
        e.preventDefault();
        return;
      }
      if (progress >= 0.96) return;
      e.preventDefault();
      diveIntoScreen();
    }, { passive: false });

    let diveTouchY = null;
    window.addEventListener("touchstart", (e) => {
      if (!introDone || progress >= 0.96) return;
      diveTouchY = e.touches[0] ? e.touches[0].clientY : null;
    }, { passive: true });
    window.addEventListener("touchmove", (e) => {
      if (!introDone || diveTouchY == null) return;
      const y = e.touches[0] ? e.touches[0].clientY : diveTouchY;
      if (diveTouchY - y < 18) return;
      if (diveLock) {
        e.preventDefault();
        return;
      }
      if (progress >= 0.96) {
        diveTouchY = null;
        return;
      }
      e.preventDefault();
      diveTouchY = null;
      diveIntoScreen();
    }, { passive: false });

    window.addEventListener("keydown", (e) => {
      if (!introDone) return;
      if (!["PageDown", "ArrowDown", " ", "Enter"].includes(e.key)) return;
      if (diveLock) {
        e.preventDefault();
        return;
      }
      if (progress >= 0.96) return;
      e.preventDefault();
      diveIntoScreen();
    });

    if ("scrollRestoration" in history) history.scrollRestoration = "manual";

    layout();
    runIntro();

    /* ============================================================
       Showcase: scroll reveal + soft spotlight on work cards
       ============================================================ */

    const docAmb = document.querySelector(".doc-amb");
    if (docAmb && workBand && "IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        docAmb.classList.toggle("is-running", entry.isIntersecting);
      }, { threshold: 0 }).observe(workBand);
    } else if (docAmb) {
      docAmb.classList.add("is-running");
    }

    const revealEls = document.querySelectorAll(".reveal");
    if (reduceMotion) {
      revealEls.forEach((el) => el.classList.add("is-in"));
    } else if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          });
        },
        { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
      );
      revealEls.forEach((el) => io.observe(el));
    } else {
      revealEls.forEach((el) => el.classList.add("is-in"));
    }

    /* Case art: play hover layers only when the figure is fully on screen */
    (() => {
      const arts = document.querySelectorAll(
        ".case-shell--harness .harness-art, .case-shell--express .harness-art"
      );
      if (!arts.length) return;

      const setPlay = (el, on) => {
        if (on) {
          if (el.classList.contains("is-play")) return;
          el.classList.add("is-play");
        } else {
          el.classList.remove("is-play");
        }
      };

      if (reduceMotion) {
        arts.forEach((el) => el.classList.add("is-play"));
        return;
      }

      if (!("IntersectionObserver" in window)) {
        arts.forEach((el) => el.classList.add("is-play"));
        return;
      }

      const fullyOnScreen = (entry) => {
        if (entry.intersectionRatio >= 1) return true;
        const r = entry.boundingClientRect;
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        if (r.height > vh - 1 || r.width > vw - 1) {
          return r.top <= 1 && r.bottom >= vh - 1;
        }
        return false;
      };

      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            setPlay(entry.target, fullyOnScreen(entry));
          });
        },
        { threshold: [0, 0.5, 1] }
      );
      arts.forEach((el) => io.observe(el));
    })();

    /* AI Harness: keep one text bubble visible while hovering a mark */
    (() => {
      const shell = document.querySelector(".case-shell--harness");
      if (!shell) return;
      const marks = [...shell.querySelectorAll(".harness-mark")];
      marks.forEach((mark) => {
        mark.addEventListener("pointerenter", () => {
          marks.forEach((m) => m.classList.toggle("is-on", m === mark));
        });
        mark.addEventListener("pointerleave", () => mark.classList.remove("is-on"));
        mark.addEventListener("focus", () => {
          marks.forEach((m) => m.classList.toggle("is-on", m === mark));
        });
        mark.addEventListener("blur", () => mark.classList.remove("is-on"));
      });
    })();

    /* SkillHub media: one continuous camera dolly through ask → install */
    const shDemo = document.getElementById("shDemo");
    const shTyped = document.getElementById("shTyped");
    const shQuery = document.getElementById("shQuery");
    const shBody = shDemo ? shDemo.querySelector(".sh-body") : null;
    const shView = shDemo ? shDemo.querySelector(".sh-view") : null;
    const SH_QUERY = "PDF 解析";
    const SH_STAGES = ["is-searching", "is-found", "is-installing", "is-ready"];
    let shTimers = [];
    let shRunning = false;
    let shCamY = 0;
    let shCamTarget = 0;
    let shCamRaf = 0;
    let shCamLast = 0;

    function shClear() {
      shTimers.forEach(clearTimeout);
      shTimers = [];
    }

    function shAt(ms, fn) {
      shTimers.push(setTimeout(fn, ms));
    }

    function shCamApply() {
      if (!shBody) return;
      shBody.style.setProperty("--cam", "-" + shCamY.toFixed(2) + "px");
    }

    function shCamTick(now) {
      shCamRaf = 0;
      if (!shBody) return;
      const t = now || performance.now();
      const dt = shCamLast ? Math.min(0.05, (t - shCamLast) / 1000) : 0.016;
      shCamLast = t;
      const d = shCamTarget - shCamY;
      if (Math.abs(d) < 0.2) {
        shCamY = shCamTarget;
        shCamApply();
        return;
      }
      // ~1.1s settle — overlaps stage changes so pans never fully stop
      const k = 1 - Math.exp(-dt * 3.2);
      shCamY += d * k;
      shCamApply();
      shCamRaf = requestAnimationFrame(shCamTick);
    }

    function shCamDrive() {
      if (shCamRaf) return;
      shCamLast = 0;
      shCamRaf = requestAnimationFrame(shCamTick);
    }

    function shCamMarkY(name) {
      if (!shDemo || !shBody) return 0;
      const mark = shDemo.querySelector('[data-cam="' + name + '"]');
      if (!mark) return 0;
      const viewH = shView ? shView.clientHeight : 0;
      const top = mark.offsetTop;
      if (name === "install") {
        // legacy — install is overlay now; keep catalog framed
        return shCamMarkY("found");
      }
      if (name === "found") {
        // frame the dark catalog grid, not just the top edge
        const prefer = top - Math.max(8, viewH * 0.04);
        return Math.max(0, prefer);
      }
      if (name === "search") {
        return Math.max(0, top - 14);
      }
      return Math.max(0, top - 6);
    }

    function shCam(name) {
      shCamTarget = shCamMarkY(name);
      shCamDrive();
    }

    function shCamSnap(name) {
      shCamY = shCamTarget = shCamMarkY(name);
      shCamApply();
    }

    function shReset(opts) {
      if (!shDemo || !shTyped) return;
      const soft = opts && opts.soft;
      shDemo.classList.remove(...SH_STAGES);
      shTyped.textContent = "";
      if (shQuery) shQuery.textContent = "skillhub search …";
      const hint = document.getElementById("shSearchHint");
      if (hint) hint.textContent = "";
      if (soft) {
        shCamSnap("ask");
      } else {
        shCam("ask");
      }
    }

    function shPlayOnce(done) {
      if (!shDemo || !shTyped) { if (done) done(); return; }
      shDemo.classList.remove("is-cam-fade");
      shReset({ soft: true });
      let i = 0;

      function typeNext() {
        if (i <= SH_QUERY.length) {
          shTyped.textContent = SH_QUERY.slice(0, i);
          i += 1;
          shAt(72, typeNext);
          return;
        }
        // Beat 1: tool appears — camera already easing into search
        shCam("search");
        shAt(160, () => {
          shDemo.classList.add("is-searching");
          if (shQuery) shQuery.textContent = 'skillhub search "' + SH_QUERY + '"';
          const hint = document.getElementById("shSearchHint");
          if (hint) hint.textContent = SH_QUERY;
          shCam("found");
        });
        // Beat 2: catalog already visible — settle on hit
        shAt(780, () => shCam("found"));
        shAt(920, () => {
          shDemo.classList.remove("is-searching");
          shDemo.classList.add("is-found");
          shCam("found");
          shAt(280, () => shCam("found"));
        });
        // Beat 3: install as overlay popup — camera stays on catalog
        shAt(2800, () => {
          shDemo.classList.add("is-installing");
          shCam("found");
        });
        shAt(4200, () => {
          shDemo.classList.remove("is-installing");
          shDemo.classList.add("is-ready");
          shCam("found");
          // Hold the final frame, then soft dissolve back for the next take
          shAt(1700, () => {
            if (!shRunning) { if (done) done(); return; }
            shDemo.classList.add("is-cam-fade");
            shAt(480, () => {
              shReset({ soft: true });
              shAt(80, () => {
                shDemo.classList.remove("is-cam-fade");
                if (done) done();
              });
            });
          });
        });
      }

      shAt(280, typeNext);
    }

    function shStop() {
      shRunning = false;
      shClear();
      if (shCamRaf) {
        cancelAnimationFrame(shCamRaf);
        shCamRaf = 0;
      }
      shDemo && shDemo.classList.remove("is-cam-fade");
      shReset({ soft: true });
    }

    function shStart() {
      if (!shDemo || shRunning) return;
      if (reduceMotion) {
        shTyped.textContent = SH_QUERY;
        if (shQuery) shQuery.textContent = 'skillhub search "' + SH_QUERY + '"';
        shDemo.classList.add("is-found", "is-ready");
        shCamSnap("found");
        return;
      }
      shRunning = true;
      const loop = () => {
        if (!shRunning) return;
        shClear();
        shPlayOnce(() => {
          if (!shRunning) return;
          shAt(220, loop);
        });
      };
      loop();
    }

    const shMount = document.getElementById("skillhubDemo");
    if (shDemo && "IntersectionObserver" in window) {
      const shIo = new IntersectionObserver(([entry]) => {
        const r = entry.boundingClientRect;
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const full = entry.intersectionRatio >= 1 ||
          ((r.height > vh - 1 || r.width > vw - 1) && r.top <= 1 && r.bottom >= vh - 1);
        if (full) shStart();
        else shStop();
      }, { threshold: [0, 0.5, 1] });
      shIo.observe(shMount || shDemo);
    } else {
      shStart();
    }
})();
