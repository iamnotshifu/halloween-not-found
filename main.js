/*
 * main.js — everything you see and hear on "404: HALLOWEEN NOT FOUND".
 *
 * Load order (see index.html):  three.js  →  quiz.js  →  profile.js  →  main.js
 *
 * The page has four stages:
 *   1. A normal-looking 404 page.
 *   2. The page glitches and a terminal opens. It "scans" the visitor and says
 *      things it shouldn't know (city, time, device…), asks their name, then runs
 *      the quiz.
 *   3. The quiz picks a monster and a 3D graveyard appears (reveal()), with a
 *      tombstone carrying the visitor's name.
 *   4. The visitor can open "How did it know?", then save or share a card.
 *
 * Quiz logic (questions, scoring) is in quiz.js. What the page "knows" about the
 * visitor, and how it words it, is in profile.js. This file only handles
 * presentation.
 */
(function () {
  "use strict";

  /* ================================================================== */
  /* Settings you might want to tweak                                    */
  /* ================================================================== */

  const CONFIG = {
    whisperAfterMs: 2500,   // "you’re not alone on this page."
    glitchAfterMs: 4500,    // page starts glitching
    terminalAfterMs: 9000,  // terminal opens by itself
    typeSpeedMs: 14,        // delay between typed characters
    lineGapMs: 750,         // pause after each thing it "knows", so each one lands
    cardShowsCity: true,    // put "LAGOS · 11:47 PM" on the share card (set false to keep the city private)
    siteUrl: "halloween.iamnotshifu.com"  // printed on the share card
  };

  /* ================================================================== */
  /* Small helpers and page state                                        */
  /* ================================================================== */

  const $ = function (sel) { return document.querySelector(sel); };
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  const startedAt = Date.now();  // used for the "I SURVIVED n SECONDS" card

  const body = document.body;
  const p404 = $("#p404"), sub = $("#sub");
  const term = $("#term"), log = $("#log"), options = $("#opts"), cmd = $("#cmd");
  const canvas = $("#c"), hud = $("#hud");

  // People who ask for less motion get no flashing. (Glitch skew is handled in CSS.)
  const reducedMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  let terminalOpen = false;   // has the terminal been opened?
  let revealed = false;       // has the monster been shown? (guards against double reveal)
  let waiting = null;         // when a question is on screen: { count, answer(index) }

  const run = Quiz.buildRun();                 // this visitor’s questions
  const totals = Quiz.emptyScores();           // running score per monster

  // What the page learns about the visitor. Collected right away so it is ready
  // when the terminal opens (profile.js never throws: a missing signal is null).
  const factsReady = Profile.collect();
  let visitorName = "";                        // typed in the terminal ("" = stranger)
  let nameResolver = null;                     // set while the terminal waits for the name
  let awayCount = 0;                           // times the visitor switched tabs
  const answerMs = [];                         // how long each question took to answer
  let shownAt = 0;                             // when the current question appeared
  const spoken = [];                           // everything it “knew”, for the How panel: [{ text, how }]
  let visitorCity = null;                      // used on the tombstone and the share card
  let snapshotScene = null;                    // set by startScene(): draws the 3D view for the share card

  /* ================================================================== */
  /* Sound                                                               */
  /* ================================================================== */

  // Browsers block audio until the visitor interacts. So we only create the
  // AudioContext on the first tap/key, and beep() stays silent before that.
  let audio = null;

  function unlockAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume().catch(function () {});
    } catch (e) { /* no audio support: the page works fine without it */ }
  }
  ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
    addEventListener(ev, unlockAudio, { passive: true });
  });

  function beep(freq, seconds, type, volume) {
    if (!audio || audio.state !== "running") return;
    try {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      gain.gain.value = volume || 0.05;
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + seconds);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + seconds);
    } catch (e) { /* ignore */ }
  }

  /* ================================================================== */
  /* Stage 1–2: the 404 page and the terminal                            */
  /* ================================================================== */

  // Typed lines go through a queue so two lines can never type at the same
  // time and end up interleaved.
  let lineQueue = Promise.resolve();

  function say(text) {
    lineQueue = lineQueue.then(async function () {
      const row = document.createElement("div");
      log.appendChild(row);
      for (const ch of text) {
        row.textContent += ch;
        await sleep(CONFIG.typeSpeedMs);
      }
      log.scrollTop = log.scrollHeight;
    });
    return lineQueue;
  }

  // Adds a line instantly (used to echo the answer the visitor picked).
  function printNow(text) {
    const row = document.createElement("div");
    row.textContent = text;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  // Shows one question with numbered buttons, and resolves when it is answered.
  async function ask(step) {
    await say(step.prompt);
    if (revealed) return;  // the secret ending fired while we were typing

    options.innerHTML = "";
    step.options.forEach(function (opt, i) {
      const b = document.createElement("button");
      b.className = "opt";
      b.textContent = (i + 1) + ") " + opt.text;
      b.onclick = function () { if (waiting) waiting.answer(i); };
      options.appendChild(b);
    });
    log.scrollTop = log.scrollHeight;
    shownAt = Date.now();

    return new Promise(function (resolve) {
      waiting = {
        count: step.options.length,
        answer: function (i) {
          answerMs.push(Date.now() - shownAt);
          waiting = null;
          options.innerHTML = "";
          printNow("> " + step.options[i].text);
          Quiz.addScores(totals, step.options[i].scores);
          beep(180 + i * 60, 0.15, "square", 0.04);
          resolve();
        }
      };
    });
  }

  // Says one thing it "knows", then pauses so the visitor can feel it.
  // `line` is { text, how } from profile.js. It is remembered for the How panel.
  async function know(line) {
    spoken.push({ text: line.text, how: line.how });
    await say(line.text);
    beep(140, 0.25, "square", 0.05);
    await sleep(CONFIG.lineGapMs);
  }

  // Asks for the visitor's name and waits for them to type it.
  function askName() {
    return new Promise(function (resolve) {
      nameResolver = resolve;
      cmd.placeholder = "type your name…";
      cmd.focus();
    });
  }

  async function openTerminal() {
    if (terminalOpen || revealed) return;
    terminalOpen = true;
    body.classList.add("glitch");
    term.style.display = "flex";
    beep(110, 2, "sawtooth", 0.06);

    await say("SYSTEM: visitor detected.");
    await say("scanning…");
    await sleep(1400);
    if (revealed) return;

    // 1. It knows things it shouldn't. (Stays quiet about anything the browser didn't share.)
    const facts = await factsReady;
    visitorCity = facts.city;
    for (const line of Profile.dossier(facts)) {
      await know(line);
      if (revealed) return;
    }

    // 2. …but not the one thing it wants.
    await say("that’s almost everything. one thing is missing.");
    await sleep(500);
    await say("what’s your name?");
    const typed = await askName();
    cmd.placeholder = "type a number…";
    if (revealed) return;

    visitorName = Profile.sanitizeName(typed);
    if (visitorName) {
      await say(visitorName.toLowerCase() + ". noted.");
      spoken.push({ text: "you told it your name: " + visitorName, how: "You typed it. It’s the one thing in here that wasn’t already in your browser." });
    } else {
      await say("no name? fine. i’ll call you stranger.");
    }
    await sleep(700);
    await say("now. let’s find out what you are.");

    // 3. The quiz.
    for (const step of run) {
      await ask(step);
      if (revealed) return;
    }

    // 4. It was watching while they answered.
    await say("analyzing… ");
    await sleep(900);
    if (revealed) return;
    for (const line of Profile.behaviour({ awayCount: awayCount, answerMs: answerMs })) {
      await know(line);
      if (revealed) return;
    }

    const monster = Quiz.pickWinner(totals);
    await say("result: " + Quiz.MONSTERS[monster].name.toUpperCase());
    await sleep(900);
    await say("see you in the graveyard, " + Profile.displayName(visitorName).toLowerCase() + ".");
    await sleep(1400);
    reveal(monster);
  }

  // Things you can type into the terminal besides answering.
  const COMMANDS = {
    "help": "commands: help, whoami, ls, sudo. or just answer the question.",
    "whoami": "someone who stayed too long.",
    "ls": "nothing.txt  do_not_open/  you.jpg",
    "sudo": "nice try. you have no power here.",
    "cat nothing.txt": "exactly.",
    "cat you.jpg": "i wouldn’t look.",
    "exit": "there is no exit.",
    "rm -rf /": "you can’t delete what’s already gone."
  };
  const SECRET_COMMAND = /^(cd|open) do_not_open\/?$/;

  cmd.addEventListener("keydown", async function (e) {
    if (e.key !== "Enter" || revealed) return;
    const raw = cmd.value.trim();
    const input = raw.toLowerCase().replace(/\s+/g, " ");
    cmd.value = "";

    // While the terminal is waiting for a name, whatever is typed (even nothing)
    // is the name. The secret command still works, so it is checked first.
    if (nameResolver && !SECRET_COMMAND.test(input)) {
      const resolve = nameResolver;
      nameResolver = null;
      printNow("> " + (Profile.sanitizeName(raw) || "…"));
      resolve(raw);
      return;
    }

    if (!input) return;

    // A number answers the current question.
    if (waiting && /^[1-9]$/.test(input) && +input <= waiting.count) {
      waiting.answer(+input - 1);
      return;
    }

    // The secret ending.
    if (SECRET_COMMAND.test(input)) {
      await say("…you shouldn’t have.");
      await sleep(900);
      reveal("pumpkin");
      return;
    }

    say(COMMANDS[input] || "command not found. but it found you.");
  });

  // The 404 page's own behaviour: timed creepiness.
  setTimeout(function () {
    const whisper = document.createElement("p");
    whisper.textContent = "you’re not alone on this page.";
    whisper.style.cssText = "color:#777;font-style:italic;margin-top:18px;font-size:14px";
    p404.appendChild(whisper);
    document.title = "don’t leave";
  }, CONFIG.whisperAfterMs);

  setTimeout(function () {
    body.classList.add("glitch");
    sub.textContent = "The page you’re looking for doesn’t exist. Neither do you.";
    beep(80, 0.8, "sawtooth", 0.08);
  }, CONFIG.glitchAfterMs);

  setTimeout(openTerminal, CONFIG.terminalAfterMs);

  // The tab title reacts when you switch away (only until the reveal).
  document.addEventListener("visibilitychange", function () {
    if (revealed) return;
    if (document.hidden) awayCount++;   // counted, and quoted back to them after the quiz
    document.title = document.hidden ? "come back." : "…you came back.";
  });

  // "Go home" is not a safe option.
  $("#home").onclick = function () {
    if (terminalOpen) return;
    body.classList.add("glitch");
    sub.textContent = "There is no home.";
    beep(55, 1.2, "sawtooth", 0.1);
    setTimeout(openTerminal, 1800);
  };

  // Occasional one-frame flash while glitching. Skipped for reduced motion.
  if (!reducedMotion) {
    setInterval(function () {
      if (body.classList.contains("glitch") && Math.random() < 0.35) {
        body.classList.add("flick");
        setTimeout(function () { body.classList.remove("flick"); }, 70);
      }
    }, 900);
  }

  /* ================================================================== */
  /* "How did it know?" panel                                            */
  /* ================================================================== */

  // Lists everything it said, with where each thing really came from.
  // Built with textContent, so nothing the visitor typed can inject markup.
  function openHow() {
    const list = $("#howlist");
    list.innerHTML = "";
    spoken.forEach(function (item) {
      const row = document.createElement("div");
      row.className = "fact";
      const said = document.createElement("q");
      said.textContent = item.text;
      const how = document.createElement("span");
      how.textContent = item.how;
      row.appendChild(said);
      row.appendChild(how);
      list.appendChild(row);
    });
    $("#howpanel").classList.add("open");
    $("#howclose").focus({ preventScroll: true });   // keep the panel scrolled to the top
    $("#howpanel .sheet").scrollTop = 0;
  }

  function closeHow() { $("#howpanel").classList.remove("open"); }

  /* ================================================================== */
  /* Stage 3: the reveal                                                 */
  /* ================================================================== */

  function reveal(key) {
    if (revealed) return;     // never run twice
    revealed = true;
    waiting = null;
    if (nameResolver) { const release = nameResolver; nameResolver = null; release(""); }  // unblock the terminal

    const monster = Quiz.MONSTERS[key];
    const seconds = Math.round((Date.now() - startedAt) / 1000);

    // Swap the screen. The buttons are wired up *before* the 3D scene, so
    // they still work if three.js or WebGL is unavailable.
    p404.style.display = "none";
    term.style.display = "none";
    hud.style.display = "flex";
    body.classList.remove("glitch", "flick");
    $("#mn").textContent = monster.emoji + " " + monster.name;
    $("#mt").textContent = monster.tagline;
    document.title = monster.emoji + " " + monster.name + " — 404: HALLOWEEN NOT FOUND";
    beep(70, 2.5, "sawtooth", 0.08);

    $("#save").onclick = function () { makeCard(key, seconds, false); };
    $("#share").onclick = function () { makeCard(key, seconds, true); };
    $("#again").onclick = function () { location.reload(); };

    // "How did it know?" panel. Hidden if it never said anything (secret found early).
    $("#how").style.display = spoken.length ? "" : "none";
    $("#how").onclick = openHow;
    $("#howclose").onclick = closeHow;
    $("#howpanel").addEventListener("click", function (e) { if (e.target === e.currentTarget) closeHow(); });
    addEventListener("keydown", function (e) { if (e.key === "Escape") closeHow(); });

    const tomb = {
      name: Profile.displayName(visitorName),
      epitaph: key === "pumpkin" ? "FOUND THE SECRET" : "STAYED TOO LONG",
      place: CONFIG.cardShowsCity && visitorCity ? visitorCity.toUpperCase() : "",   // the tombstone appears on the card too
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    };

    try {
      canvas.style.display = "block";
      startScene(key, tomb);
    } catch (err) {
      // No three.js (blocked CDN) or no WebGL: show the emoji instead of a black page.
      console.warn("3D scene unavailable:", err);
      canvas.style.display = "none";
      const fallback = document.createElement("div");
      fallback.textContent = monster.emoji;
      fallback.style.cssText = "position:fixed;inset:0 0 40% 0;display:flex;align-items:center;justify-content:center;font-size:min(40vw,220px)";
      body.appendChild(fallback);
    }
  }

  /* ================================================================== */
  /* The 3D scene (three.js r128)                                        */
  /* ================================================================== */

  // Colours for each monster: skin/face and body/robe.
  const SKIN = { vampire: 0xe8e0e8, ghost: 0xf4f8ff, witch: 0x6fbf5a, zombie: 0x7fa06a, demon: 0xc62a1a, pumpkin: 0xff7a1a };
  const BODY = { vampire: 0x14101a, ghost: 0xf4f8ff, witch: 0x2a1840, zombie: 0x3a4a6a, demon: 0x4a0d0d, pumpkin: 0xe86400 };

  // Shorthand: make a simple lit material.
  function material(color, extra) {
    return new THREE.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.8 }, extra || {}));
  }

  // Shorthand: make a mesh, position it, add it to a group, and return it.
  function part(group, geometry, color, x, y, z, extra) {
    const mesh = new THREE.Mesh(geometry, material(color, extra));
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  // Builds one monster out of basic shapes.
  // Returns the group plus the pieces that get animated every frame.
  function buildMonster(key) {
    const T = THREE;
    const group = new T.Group();
    const isGhost = key === "ghost";
    const ghostly = isGhost ? { transparent: true, opacity: 0.8 } : {};  // applied to ghost parts only
    const skin = SKIN[key], robe = BODY[key];
    const arms = [], wings = [];
    let cape = null;

    // Torso (a cone) and head (a sphere). Every monster has these.
    part(group, new T.ConeGeometry(0.9, 1.8, 20), robe, 0, 0.9, 0, ghostly);
    part(group, new T.SphereGeometry(0.5, 20, 20), skin, 0, 2.15, 0, ghostly);

    // Eyes. Kept in an array so the animation loop can make them blink.
    const eyeColor = (key === "demon" || key === "pumpkin") ? 0xffee33 : key === "vampire" ? 0xff2020 : 0x050505;
    const eyes = [-0.18, 0.18].map(function (x) {
      return part(group, new T.SphereGeometry(0.08, 10, 10), eyeColor, x, 2.22, 0.43,
        { emissive: eyeColor, emissiveIntensity: 1 });
    });

    // Arms (everyone except the zombie, who has them stretched out below, and the pumpkin).
    if (key !== "zombie" && key !== "pumpkin") {
      [-1, 1].forEach(function (side) {
        const arm = new T.Group();
        arm.position.set(side * 0.55, 1.75, 0.05);
        part(arm, new T.CylinderGeometry(0.09, 0.07, 0.8, 10), isGhost ? 0xf4f8ff : robe, 0, -0.4, 0, ghostly);
        part(arm, new T.SphereGeometry(0.1, 10, 10), skin, 0, -0.85, 0, ghostly);
        if (isGhost) arm.rotation.x = -1.1;  // ghost arms reach forward
        group.add(arm);
        arms.push(arm);
      });
    }

    // Monster-specific parts ------------------------------------------------

    if (key === "vampire") {
      // fangs
      [-0.1, 0.1].forEach(function (x) {
        const fang = part(group, new T.ConeGeometry(0.04, 0.14, 8), 0xffffff, x, 2.0, 0.46);
        fang.rotation.x = Math.PI;
      });
      // slicked-back hair
      part(group, new T.SphereGeometry(0.52, 20, 10, 0, 6.28, 0, 1), 0x0a0a10, 0, 2.2, 0);
      // red cape (open cone, drawn on both sides)
      cape = part(group, new T.ConeGeometry(1.1, 1.8, 20, 1, true), 0x7a0012, 0, 0.95, -0.3, { side: T.DoubleSide });
      cape.scale.z = 0.5;
    }

    if (key === "ghost") {
      // wavy hem: a ring of blobs around the bottom
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * 6.283;
        part(group, new T.SphereGeometry(0.26, 10, 10), 0xf4f8ff, Math.cos(a) * 0.72, 0.12, Math.sin(a) * 0.72, ghostly);
      }
    }

    if (key === "witch") {
      part(group, new T.ConeGeometry(0.42, 1, 16), 0x111111, 0, 3, 0);                 // hat
      part(group, new T.CylinderGeometry(0.8, 0.8, 0.06, 20), 0x111111, 0, 2.6, 0);    // brim
      part(group, new T.TorusGeometry(0.4, 0.05, 8, 20), 0x6a2a9a, 0, 2.55, 0).rotation.x = Math.PI / 2; // hat band
      part(group, new T.ConeGeometry(0.07, 0.3, 8), skin, 0, 2.12, 0.55).rotation.x = Math.PI / 2;        // nose
      const broom = new T.Group();
      part(broom, new T.CylinderGeometry(0.04, 0.04, 2.4, 8), 0x6b4a2a, 0, 0, 0);
      part(broom, new T.ConeGeometry(0.22, 0.6, 10), 0xc9a227, 0, -1.4, 0);
      broom.position.set(1.15, 1, 0.3);
      broom.rotation.z = 0.25;
      group.add(broom);
    }

    if (key === "zombie") {
      // arms stretched out in front
      [-0.7, 0.7].forEach(function (x) {
        part(group, new T.BoxGeometry(0.25, 0.25, 0.95), skin, x, 1.5, 0.5);
      });
      // patchy hair
      for (let i = 0; i < 5; i++) {
        part(group, new T.BoxGeometry(0.18, 0.1, 0.18), 0x1a120a, -0.3 + i * 0.15, 2.62 - Math.abs(i - 2) * 0.04, 0);
      }
      // mouth
      part(group, new T.BoxGeometry(0.3, 0.05, 0.05), 0x200000, 0, 2.02, 0.47);
    }

    if (key === "demon") {
      // horns
      [-0.3, 0.3].forEach(function (x) {
        const horn = part(group, new T.ConeGeometry(0.09, 0.55, 8), 0x220808, x, 2.7, 0);
        horn.rotation.z = x > 0 ? -0.35 : 0.35;
      });
      // wings (flat triangles that flap)
      [-1, 1].forEach(function (side) {
        const wing = part(group, new T.ConeGeometry(0.7, 1.7, 3), 0x330909, side * 0.9, 1.6, -0.3);
        wing.scale.z = 0.12;
        wing.rotation.z = side * 0.6;
        wings.push(wing);
      });
      // tail: shrinking beads ending in a spike
      for (let i = 0; i < 4; i++) {
        part(group, new T.SphereGeometry(0.12 - i * 0.02, 8, 8), 0x4a0d0d, 0, 0.35 + i * 0.2, -0.75 - i * 0.2);
      }
      part(group, new T.ConeGeometry(0.14, 0.3, 3), 0xc62a1a, 0, 1.2, -1.5).rotation.x = -Math.PI / 2.2;
    }

    if (key === "pumpkin") {
      part(group, new T.CylinderGeometry(0.08, 0.12, 0.35, 8), 0x2e7d32, 0, 2.75, 0);  // stem
      part(group, new T.BoxGeometry(0.4, 0.1, 0.05), 0xffee33, 0, 2.0, 0.46,            // glowing grin
        { emissive: 0xffee33, emissiveIntensity: 1.5 });
      const glow = new T.PointLight(0xff7a1a, 1.5, 8);
      glow.position.set(0, 2.2, 1);
      group.add(glow);
    }

    return { group: group, eyes: eyes, arms: arms, wings: wings, cape: cape };
  }

  // Sky, ground, tombstones, moon and the flickering lantern.
  // Returns the lantern light so it can flicker.
  function buildGraveyard(scene) {
    const T = THREE;
    scene.background = new T.Color(0x07070c);
    scene.fog = new T.FogExp2(0x07070c, 0.06);

    scene.add(new T.HemisphereLight(0x6677aa, 0x110a05, 0.6));
    const moonlight = new T.DirectionalLight(0x8899cc, 0.7);
    moonlight.position.set(-8, 9, -10);
    scene.add(moonlight);

    const moon = new T.Mesh(new T.SphereGeometry(2, 24, 24), new T.MeshBasicMaterial({ color: 0xfff2c8 }));
    moon.position.set(-9, 10, -22);
    scene.add(moon);

    const ground = new T.Mesh(new T.CircleGeometry(40, 48), material(0x16120f));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // 24 tilted tombstones scattered in a ring around the monster
    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * 6.283;
      const dist = 4 + Math.random() * 13;
      const height = 1 + Math.random() * 0.8;
      const stone = new T.Mesh(new T.BoxGeometry(0.7, height, 0.2), material(0x555560));
      stone.position.set(Math.cos(angle) * dist, height / 2 - 0.1, Math.sin(angle) * dist);
      stone.rotation.y = Math.random() * 3;
      stone.rotation.z = (Math.random() - 0.5) * 0.25;
      scene.add(stone);
    }

    // lantern: a point light plus a small glowing bulb
    const lamp = new T.PointLight(0xff8a2a, 2.4, 14);
    lamp.position.set(2, 2, 1.5);
    scene.add(lamp);
    const bulb = new T.Mesh(new T.SphereGeometry(0.15, 12, 12), new T.MeshBasicMaterial({ color: 0xffb050 }));
    bulb.position.copy(lamp.position);
    scene.add(bulb);

    return lamp;
  }

  // Paints the engraving for the visitor's own tombstone onto a canvas.
  function tombTexture(tomb) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 640;
    const x = c.getContext("2d");
    x.fillStyle = "#9a9aa8";
    x.fillRect(0, 0, 512, 640);
    for (let i = 0; i < 700; i++) {          // speckle, so it reads as stone
      x.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.08)";
      x.fillRect(Math.random() * 512, Math.random() * 640, 3, 3);
    }
    x.textAlign = "center";

    // Each line is drawn twice (a light edge, then dark) so it looks carved in.
    function carve(text, y, font, fitWidth) {
      if (fitWidth) fitFont(x, text, fitWidth, 72, "700", "Georgia, serif", 20);
      else x.font = font;
      x.fillStyle = "rgba(255,255,255,.35)";
      x.fillText(text, 256 + 2, y + 2);
      x.fillStyle = "#14141b";
      x.fillText(text, 256, y);
    }
    carve("HERE LIES", 150, "700 44px Georgia, serif");
    carve(tomb.name, 270, null, 450);
    carve(tomb.epitaph, 355, "700 32px Georgia, serif");
    carve(tomb.date, 435, "30px Georgia, serif");
    if (tomb.place) carve(tomb.place, 495, "28px Georgia, serif");
    return new THREE.CanvasTexture(c);
  }

  // The visitor's own tombstone. It stays beside the monster, facing the camera
  // (startScene moves it every frame), so the name is always readable and never
  // blocks the monster. Lit by its own glow, because the graveyard is dark.
  function buildTombstone(scene, tomb) {
    const T = THREE;
    const stone = new T.Group();
    const w = 1.5, h = 1.7, d = 0.25;
    const rock = { emissive: 0x5c5c6a };   // matches the glow of the engraved face

    const body = new T.Mesh(new T.BoxGeometry(w, h, d), material(0x8a8a98, rock));
    body.position.y = h / 2;
    stone.add(body);

    // rounded top: half a cylinder lying on its side
    const arch = new T.Mesh(new T.CylinderGeometry(w / 2, w / 2, d, 24, 1, false, 0, Math.PI), material(0x8a8a98, rock));
    arch.rotation.x = Math.PI / 2;
    arch.rotation.y = Math.PI / 2;
    arch.position.y = h;
    stone.add(arch);

    const map = tombTexture(tomb);
    const face = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshStandardMaterial({
      map: map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.9
    }));
    face.position.set(0, h / 2, d / 2 + 0.002);
    stone.add(face);

    stone.scale.setScalar(0.8);
    stone.rotation.z = 0.04;           // slightly crooked, like the others
    scene.add(stone);
    return stone;
  }

  // Seven see-through ghosts drifting in a ring around the graveyard.
  function buildWisps(scene) {
    const T = THREE;
    const glow = { transparent: true, emissive: 0x8899bb };
    const wisps = [];
    for (let i = 0; i < 7; i++) {
      const g = new T.Group();
      part(g, new T.SphereGeometry(0.3, 12, 12), 0xffffff, 0, 0, 0, Object.assign({ opacity: 0.55, emissiveIntensity: 0.5 }, glow));
      part(g, new T.ConeGeometry(0.3, 0.6, 12), 0xffffff, 0, -0.4, 0, Object.assign({ opacity: 0.45, emissiveIntensity: 0.4 }, glow));
      const angle = i / 7 * 6.283;
      const dist = 6 + Math.random() * 5;
      g.position.set(Math.cos(angle) * dist, 1.5 + Math.random() * 1.5, Math.sin(angle) * dist);
      g.userData = { angle: angle, dist: dist, phase: Math.random() * 6 };
      scene.add(g);
      wisps.push(g);
    }
    return wisps;
  }

  // Six bats circling overhead.
  function buildBats(scene) {
    const T = THREE;
    const bats = [];
    for (let i = 0; i < 6; i++) {
      const bat = new T.Group();
      const wings = [-1, 1].map(function (side) {
        const w = part(bat, new T.ConeGeometry(0.25, 0.5, 3), 0x120a20, side * 0.25, 0, 0, { emissive: 0x331a55 });
        w.rotation.z = side * 1.5;
        w.scale.z = 0.15;
        return w;
      });
      bat.userData = { phase: Math.random() * 6, radius: 3 + Math.random() * 3, height: 4 + Math.random() * 2, wings: wings };
      scene.add(bat);
      bats.push(bat);
    }
    return bats;
  }

  // 140 orange embers floating upwards.
  function buildEmbers(scene) {
    const T = THREE;
    const count = 140;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 24;
      positions[i * 3 + 1] = Math.random() * 6;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 24;
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
    scene.add(new T.Points(geometry, new T.PointsMaterial({ color: 0xff9a3a, size: 0.08 })));
    return geometry.attributes.position;
  }

  // Puts it all together and starts the animation loop.
  // Throws if three.js or WebGL is unavailable (reveal() catches that).
  function startScene(key, tomb) {
    if (typeof THREE === "undefined") throw new Error("three.js did not load");
    const T = THREE;

    const renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);

    const lamp = buildGraveyard(scene);
    const stone = buildTombstone(scene, tomb);
    const monster = buildMonster(key);
    scene.add(monster.group);
    const wisps = buildWisps(scene);
    const bats = buildBats(scene);
    const embers = buildEmbers(scene);

    // Drag to orbit the camera. It also drifts slowly on its own.
    let angle = 0.6, dragging = false, lastX = 0;
    canvas.onpointerdown = function (e) { dragging = true; lastX = e.clientX; };
    addEventListener("pointerup", function () { dragging = false; });
    addEventListener("pointermove", function (e) {
      if (!dragging) return;
      angle -= (e.clientX - lastX) * 0.01;
      lastX = e.clientX;
    });
    // Fits the view to the screen. On a tall phone screen the camera backs away so
    // the monster and tombstone fit side by side, and the picture slides up so it
    // sits above the buttons instead of behind them.
    let radius = 7;      // camera distance from the monster
    let stoneSide = -2;  // how far left of the monster the tombstone stands
    let stoneAhead = 2.4;      // and how far toward the camera
    function layout() {
      const w = innerWidth, h = innerHeight, aspect = w / h;
      radius = 7 + (1 - Math.min(aspect, 1)) * 4.5;
      stoneAhead = 2.4;
      const visibleHalfWidth = (radius - stoneAhead) * Math.tan(camera.fov * Math.PI / 360) * aspect;
      stoneSide = -Math.max(0.5, Math.min(2.4, visibleHalfWidth - 0.75));
      camera.aspect = aspect;
      camera.setViewOffset(w, h, 0, Math.round((hud.offsetHeight || 0) / 2), w, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    layout();
    addEventListener("resize", layout);

    const isGhost = key === "ghost";

    // Called every frame. `ms` is the time in milliseconds.
    function frame(ms) {
      requestAnimationFrame(frame);
      const t = ms / 1000;  // seconds

      // lantern flicker
      lamp.intensity = 2.4 + Math.sin(t * 23) * 0.4 + Math.random() * 0.6;

      // monster: spin, breathe, sway (zombie), float (ghost)
      const m = monster.group;
      m.rotation.y = t * 0.5;
      m.rotation.z = key === "zombie" ? Math.sin(t * 2) * 0.1 : 0;
      m.scale.y = 1 + Math.sin(t * 3) * 0.03;
      m.position.y = isGhost ? 0.3 + Math.sin(t * 2) * 0.25 : 0;

      monster.arms.forEach(function (arm, i) { arm.rotation.z = (i ? 1 : -1) * (0.35 + Math.sin(t * 2 + i) * 0.15); });
      monster.wings.forEach(function (wing, i) { wing.rotation.y = (i ? 1 : -1) * Math.sin(t * 6) * 0.4; });
      if (monster.cape) monster.cape.rotation.x = Math.sin(t * 2) * 0.05;

      // blink: now and then squash the eyes shut for a moment
      const blink = Math.sin(t * 1.3) > 0.97 ? 0.1 : 1;
      monster.eyes.forEach(function (eye) { eye.scale.y = blink; });

      // drifting ghosts
      wisps.forEach(function (g) {
        const u = g.userData;
        g.position.y += Math.sin(t * 1.5 + u.phase) * 0.004;
        g.position.x = Math.cos(u.angle + t * 0.1) * u.dist;
        g.position.z = Math.sin(u.angle + t * 0.1) * u.dist;
        g.lookAt(0, g.position.y, 0);
      });

      // circling, flapping bats
      bats.forEach(function (b) {
        const u = b.userData, a = t * 0.6 + u.phase;
        b.position.set(Math.cos(a) * u.radius, u.height + Math.sin(t * 3 + u.phase) * 0.3, Math.sin(a) * u.radius);
        b.rotation.y = -a;
        u.wings.forEach(function (w, j) { w.rotation.z = (j ? -1 : 1) * (1.2 + Math.sin(t * 14 + u.phase) * 0.5); });
      });

      // rising embers (wrap back to the ground at the top)
      for (let i = 0; i < embers.count; i++) {
        embers.array[i * 3 + 1] += 0.01;
        if (embers.array[i * 3 + 1] > 6) embers.array[i * 3 + 1] = 0;
      }
      embers.needsUpdate = true;

      // camera orbit
      if (!dragging) angle += 0.0025;
      placeCamera();

      renderer.render(scene, camera);
    }

    // Puts the camera on its orbit, and the tombstone beside the monster, facing it.
    // The tombstone keeps its place as the camera circles, so the name stays readable.
    function placeCamera() {
      camera.position.set(Math.sin(angle) * radius, 3, Math.cos(angle) * radius);
      camera.lookAt(0, 1.6, 0);
      stone.position.set(
        stoneAhead * Math.sin(angle) + stoneSide * Math.cos(angle), 0,
        stoneAhead * Math.cos(angle) - stoneSide * Math.sin(angle));
      stone.rotation.y = angle;
    }

    // For the share card: draws the scene exactly as the visitor sees it right now
    // (same monster, same tombstone, same camera angle), but in a landscape frame
    // of width x height pixels. Returns a 2D canvas, or null if anything goes wrong.
    snapshotScene = function (width, height) {
      const ratio = renderer.getPixelRatio();
      const keepAngle = angle;                   // where the visitor's camera was
      const keepSpin = monster.group.rotation.y; // and how far the monster had turned
      try {
        angle = 0;                               // card shot is always from the front...
        monster.group.rotation.y = 0;            // ...with the monster facing the lens
        monster.eyes.forEach(function (eye) { eye.scale.y = 1; });   // and eyes open (no mid-blink)
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);   // false: don't touch the on-screen canvas size
        camera.aspect = width / height;
        camera.clearViewOffset();
        radius = 5.4;                             // closer than on screen, so the monster fills the card
        stoneAhead = 1;                           // tombstone further from the lens, so its whole face fits
        stoneSide = -1.9;
        camera.updateProjectionMatrix();
        placeCamera();
        renderer.render(scene, camera);          // render and copy in the same moment, so the buffer is still full

        const copy = document.createElement("canvas");
        copy.width = width;
        copy.height = height;
        copy.getContext("2d").drawImage(canvas, 0, 0);
        return copy;
      } catch (err) {
        console.warn("Could not capture the 3D scene for the card:", err);
        return null;
      } finally {
        angle = keepAngle;
        monster.group.rotation.y = keepSpin;
        renderer.setPixelRatio(ratio);
        layout();                                 // put the on-screen view back exactly as it was
      }
    };

    frame(0);
  }

  /* ================================================================== */
  /* Stage 4: the share card                                             */
  /* ================================================================== */

  // Draws `text` centred, wrapping onto new lines when it gets too wide.
  function wrapText(ctx, text, centerX, y, maxWidth, lineHeight) {
    let line = "";
    text.split(" ").forEach(function (word) {
      if (line && ctx.measureText(line + word).width > maxWidth) {
        ctx.fillText(line.trim(), centerX, y);
        y += lineHeight;
        line = "";
      }
      line += word + " ";
    });
    ctx.fillText(line.trim(), centerX, y);
  }

  // Shrinks the font until `text` fits inside `maxWidth`.
  // (Needed for "THE PUMPKIN KING", which is wider than the other names.)
  function fitFont(ctx, text, maxWidth, startPx, weight, family, minPx) {
    minPx = minPx || 40;
    let size = startPx;
    ctx.font = weight + " " + size + "px " + family;
    while (size > minPx && ctx.measureText(text).width > maxWidth) {
      size -= 4;
      ctx.font = weight + " " + size + "px " + family;
    }
  }

  // Draws the 1080×1350 card, then either shares it or downloads it.
  function makeCard(key, seconds, share) {
    const monster = Quiz.MONSTERS[key];
    const c = document.createElement("canvas");
    c.width = 1080;
    c.height = 1350;
    const ctx = c.getContext("2d");

    // background and frame
    const bg = ctx.createLinearGradient(0, 0, 0, 1350);
    bg.addColorStop(0, "#1f0a2a");
    bg.addColorStop(1, "#050508");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1080, 1350);
    ctx.strokeStyle = "#ff7a1a";
    ctx.lineWidth = 6;
    ctx.strokeRect(40, 40, 1000, 1270);
    ctx.textAlign = "center";

    // title
    ctx.fillStyle = "#ff7a1a";
    ctx.font = "700 44px monospace";
    ctx.fillText("404: HALLOWEEN NOT FOUND", 540, 130);

    // picture: the real 3D scene (their monster beside their own tombstone).
    // If WebGL isn't available there is no scene, so fall back to the emoji.
    const PIC = { x: 100, y: 170, w: 880, h: 587 };      // 3:2 frame
    const scene = snapshotScene ? snapshotScene(1320, 880) : null;
    ctx.fillStyle = "#07070c";
    ctx.fillRect(PIC.x, PIC.y, PIC.w, PIC.h);
    if (scene) {
      ctx.drawImage(scene, PIC.x, PIC.y, PIC.w, PIC.h);
    } else {
      ctx.fillStyle = "#ff7a1a";
      ctx.font = "280px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',serif";
      ctx.fillText(monster.emoji, 540, PIC.y + 400);
    }
    ctx.strokeStyle = "#ff7a1a";
    ctx.lineWidth = 3;
    ctx.strokeRect(PIC.x, PIC.y, PIC.w, PIC.h);

    // name (shrinks to fit) and tagline
    ctx.fillStyle = "#fff";
    fitFont(ctx, monster.name.toUpperCase(), 880, 88, "800", "sans-serif");
    ctx.fillText(monster.name.toUpperCase(), 540, 855);
    ctx.fillStyle = "#b9b9c8";
    ctx.font = "38px sans-serif";
    wrapText(ctx, monster.tagline, 540, 918, 820, 50);

    // the personal part: their name, and (optionally) where and when they died
    ctx.fillStyle = "#ff7a1a";
    fitFont(ctx, "HERE LIES " + Profile.displayName(visitorName), 880, 44, "700", "monospace");
    ctx.fillText("HERE LIES " + Profile.displayName(visitorName), 540, 1062);
    const where = [CONFIG.cardShowsCity && visitorCity ? visitorCity.toUpperCase() : "", Profile.clock(new Date())]
      .filter(Boolean).join(" · ");
    ctx.fillStyle = "#888";
    ctx.font = "30px monospace";
    ctx.fillText(where, 540, 1110);

    // score and address
    ctx.fillStyle = "#39ff88";
    ctx.font = "700 46px monospace";
    ctx.fillText("I SURVIVED " + seconds + (seconds === 1 ? " SECOND" : " SECONDS"), 540, 1198);
    ctx.fillStyle = "#888";
    ctx.font = "34px monospace";
    ctx.fillText(CONFIG.siteUrl, 540, 1268);

    c.toBlob(async function (blob) {
      if (!blob) return;
      const file = new File([blob], "halloween-404-" + key + ".png", { type: "image/png" });

      // On phones: open the share sheet. If the visitor closes it, do nothing.
      if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: "404: HALLOWEEN NOT FOUND",
            text: "I’m " + monster.name + ". What are you?"
          });
          return;
        } catch (err) {
          if (err && err.name === "AbortError") return;
          // any other error: fall through to a plain download
        }
      }

      // Everywhere else: download the PNG.
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = file.name;
      link.click();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 10000);
    });
  }
})();