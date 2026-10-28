/*
 * quiz.js — the monster quiz: questions, scoring and fairness checks.
 *
 * This file is pure logic. No DOM, no audio, no three.js. That is on purpose:
 * the same file runs in the browser (as window.Quiz) and in Node
 * (require("./quiz.js")), so quiz.test.js can check it without a browser.
 *
 * HOW SCORING WORKS
 *   - Every question has exactly five answers, one per monster.
 *   - Picking an answer gives its monster 2 points (PRIMARY) and a second
 *     monster 1 point (SECONDARY). The second monster is chosen by rotating
 *     through ORDER, with a different rotation for each question.
 *   - Because every monster is the primary of exactly one answer per question,
 *     and the secondary of exactly one answer per question, no monster can have
 *     a built-in advantage. quiz.test.js proves it with numbers.
 *   - The answer order on screen is shuffled on every run, so "always pick the
 *     first one" doesn't lead anywhere.
 *
 * ADDING A QUESTION
 *   Add one entry to QUESTIONS with an answer for each of the five monsters.
 *   Run `node quiz.test.js`. If you forgot a monster, it tells you.
 */
(function (root) {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Monsters                                                            */
  /* ------------------------------------------------------------------ */

  // The five monsters the quiz can hand out. The order is used by scoring.
  const ORDER = ["vampire", "ghost", "witch", "zombie", "demon"];

  // Display info for every monster, including the secret one. The quiz never
  // awards "pumpkin": it is only unlocked from the terminal (see main.js).
  const MONSTERS = {
    vampire: { name: "The Vampire", emoji: "🧛", tagline: "Nocturnal, dramatic, and always fashionably late." },
    ghost:   { name: "The Ghost",   emoji: "👻", tagline: "Unbothered, a little transparent, great at vanishing." },
    witch:   { name: "The Witch",   emoji: "🧙", tagline: "Prepared, chaotic, and brewing something." },
    zombie:  { name: "The Zombie",  emoji: "🧟", tagline: "Relentless. Slow. Somehow still on time." },
    demon:   { name: "The Demon",   emoji: "😈", tagline: "Bold, spicy, and not sorry about it." },
    pumpkin: { name: "The Pumpkin King", emoji: "🎃", tagline: "Secret ending unlocked. You found the thing nobody was supposed to find." }
  };

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  const PER_RUN = 5;    // questions asked each time
  const PRIMARY = 2;    // points for the monster an answer belongs to
  const SECONDARY = 1;  // points for the "runner-up" monster

  /* ------------------------------------------------------------------ */
  /* Questions                                                           */
  /* ------------------------------------------------------------------ */

  // `q` is the prompt. `a` has one answer per monster. Keep the answers about
  // the same length so no single one looks like the "obvious" pick.
  const QUESTIONS = [
    { q: "It’s 3 AM. Something moves downstairs. You…",
      a: { vampire: "Go and look. You’re up anyway.",
           ghost:   "Float through the wall to check. Easier.",
           witch:   "Hex the staircase and keep stirring.",
           zombie:  "Walk toward the noise. Slowly. Forever.",
           demon:   "Grab a flashlight and demand answers." } },

    { q: "Pick a snack.",
      a: { vampire: "Blood-orange juice in a wine glass",
           ghost:   "Cold tea nobody remembers pouring",
           witch:   "Mystery herbal tea",
           zombie:  "Week-old pizza",
           demon:   "Ghost pepper wings" } },

    { q: "Your ideal home is…",
      a: { vampire: "A castle with a dramatic staircase",
           ghost:   "An abandoned shopping mall",
           witch:   "A swamp cottage with good herbs",
           zombie:  "A bunker with a very full pantry",
           demon:   "Inside an active volcano" } },

    { q: "Your biggest flex is…",
      a: { vampire: "Looking incredible in every century",
           ghost:   "Walking through walls",
           witch:   "Casting spells",
           zombie:  "Surviving things that should have finished you",
           demon:   "Setting things on fire" } },

    { q: "Your phone buzzes. It says “I see you.” You…",
      a: { vampire: "Reply “come closer”",
           ghost:   "Leave it on read. Forever.",
           witch:   "Smudge the phone with sage and block the number",
           zombie:  "Screenshot it for the group chat",
           demon:   "Reply “I see you too”" } },

    { q: "Pick a weapon for the apocalypse.",
      a: { vampire: "A very sharp opinion",
           ghost:   "Being impossible to find",
           witch:   "A dusty spellbook",
           zombie:  "A shopping cart",
           demon:   "A pitchfork" } },

    { q: "Your friends describe you as…",
      a: { vampire: "Mysterious",
           ghost:   "Unreliable at replying",
           witch:   "Weirdly good in a crisis",
           zombie:  "Always hungry",
           demon:   "A lot" } },

    { q: "Which sound do you love?",
      a: { vampire: "A violin in an empty hall",
           ghost:   "Creaky floorboards",
           witch:   "Bubbling liquid",
           zombie:  "Low, happy groaning",
           demon:   "A crowd gasping" } },

    { q: "Pick a pet.",
      a: { vampire: "A bat",
           ghost:   "A dog only you can see",
           witch:   "A black cat",
           zombie:  "Whatever follows you home",
           demon:   "A crow with a grudge" } },

    { q: "It’s a full moon. You…",
      a: { vampire: "Wake up",
           ghost:   "Flicker the lights",
           witch:   "Dance in a circle",
           zombie:  "Stand in a field and groan at it",
           demon:   "Take it as a dare" } },

    { q: "Costume party. You arrive…",
      a: { vampire: "Fashionably late, obviously",
           ghost:   "Early, then vanish without a word",
           witch:   "With a bag of supplies nobody asked for",
           zombie:  "On time. Somehow.",
           demon:   "In the loudest outfit in the room" } },

    { q: "Group project. Your role?",
      a: { vampire: "Does everything at 3 AM, with flair",
           ghost:   "Shows up for the last meeting only",
           witch:   "Makes the plan and brings the snacks",
           zombie:  "Slow, steady, finishes the job",
           demon:   "Takes charge. Nobody voted." } },

    { q: "Pick a holiday destination.",
      a: { vampire: "Transylvania, for the aesthetic",
           ghost:   "A hotel where you’re already a regular",
           witch:   "A forest with excellent mushrooms",
           zombie:  "An all-you-can-eat buffet",
           demon:   "Anywhere with a fire pit and no rules" } },

    { q: "What scares you most?",
      a: { vampire: "Mirrors. Awkward.",
           ghost:   "Eye contact",
           witch:   "A tidy kitchen. Where would you brew?",
           zombie:  "Cardio",
           demon:   "Being ignored" } }
  ];

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  // Fisher–Yates shuffle. Returns a new array. `rng` is injectable so tests
  // can use a seeded generator and get repeatable results.
  function shuffle(list, rng) {
    rng = rng || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // The points an answer is worth: PRIMARY for its own monster, SECONDARY for
  // a rotated neighbour. The rotation (1..4) depends on the question's index,
  // so it is never 0 (a monster is never its own runner-up) and varies
  // between questions.
  function scoresFor(questionIndex, monster) {
    const i = ORDER.indexOf(monster);
    const offset = 1 + (questionIndex % (ORDER.length - 1));
    const runnerUp = ORDER[(i + offset) % ORDER.length];
    const scores = {};
    scores[monster] = PRIMARY;
    scores[runnerUp] = SECONDARY;
    return scores;
  }

  /* ------------------------------------------------------------------ */
  /* Public: playing a run                                               */
  /* ------------------------------------------------------------------ */

  // Builds one playthrough: `count` random questions, answers in random order.
  // Returns [{ prompt, options: [{ text, scores }] }].
  function buildRun(rng, count) {
    rng = rng || Math.random;
    count = count || PER_RUN;
    const indexes = shuffle(QUESTIONS.map((_, i) => i), rng).slice(0, count);
    return indexes.map(function (qi) {
      return {
        prompt: QUESTIONS[qi].q,
        options: shuffle(ORDER, rng).map(function (m) {
          return { text: QUESTIONS[qi].a[m], scores: scoresFor(qi, m) };
        })
      };
    });
  }

  function emptyScores() {
    const s = {};
    ORDER.forEach(function (m) { s[m] = 0; });
    return s;
  }

  // Adds an answer's points onto a running total (mutates and returns it).
  function addScores(total, scores) {
    for (const m in scores) total[m] += scores[m];
    return total;
  }

  // Highest score wins. Ties are broken uniformly at random.
  // (The old `sort(() => Math.random() - .5)` trick is biased; this isn't.)
  function pickWinner(total, rng) {
    rng = rng || Math.random;
    const best = Math.max.apply(null, ORDER.map(function (m) { return total[m]; }));
    const tied = ORDER.filter(function (m) { return total[m] === best; });
    return tied[Math.floor(rng() * tied.length)];
  }

  /* ------------------------------------------------------------------ */
  /* Public: checks (used by quiz.test.js)                               */
  /* ------------------------------------------------------------------ */

  // Looks for mistakes in the question pool and the scoring balance.
  // Returns a list of problems. An empty list means everything is fine.
  function audit() {
    const problems = [];
    const prompts = new Set();

    QUESTIONS.forEach(function (item, qi) {
      const label = "Q" + (qi + 1);
      if (!item.q || !item.q.trim()) problems.push(label + ": empty prompt");
      else if (prompts.has(item.q)) problems.push(label + ": duplicate prompt");
      prompts.add(item.q);

      const texts = new Set();
      ORDER.forEach(function (m) {
        const t = item.a[m];
        if (!t || !t.trim()) problems.push(label + ": missing answer for " + m);
        else if (texts.has(t)) problems.push(label + ": two answers say “" + t + "”");
        texts.add(t);
      });
      Object.keys(item.a).forEach(function (k) {
        if (ORDER.indexOf(k) === -1) problems.push(label + ": unknown monster “" + k + "”");
      });
    });

    if (QUESTIONS.length < PER_RUN * 2) {
      problems.push("Pool too small: need at least " + PER_RUN * 2 + " questions so runs feel different.");
    }

    // Balance: add up every point each monster could ever receive.
    const primary = emptyScores();
    const secondary = emptyScores();
    QUESTIONS.forEach(function (_, qi) {
      ORDER.forEach(function (m) {
        const s = scoresFor(qi, m);
        for (const k in s) (k === m ? primary : secondary)[k] += s[k];
      });
    });
    const same = function (t) { return new Set(ORDER.map(function (m) { return t[m]; })).size === 1; };
    if (!same(primary)) problems.push("Primary points are uneven: " + JSON.stringify(primary));
    if (!same(secondary)) problems.push("Secondary points are uneven: " + JSON.stringify(secondary));

    return problems;
  }

  // Plays `runs` quizzes with a random answerer and counts who wins.
  // This is the "run it 20 times" idea, just 20,000 times and instant.
  function simulate(runs, rng) {
    rng = rng || Math.random;
    const wins = emptyScores();
    for (let n = 0; n < runs; n++) {
      const total = emptyScores();
      buildRun(rng).forEach(function (step) {
        const pick = step.options[Math.floor(rng() * step.options.length)];
        addScores(total, pick.scores);
      });
      wins[pickWinner(total, rng)]++;
    }
    return wins;
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  const api = {
    ORDER, MONSTERS, QUESTIONS, PER_RUN, PRIMARY, SECONDARY,
    shuffle, scoresFor, buildRun, emptyScores, addScores, pickWinner,
    audit, simulate
  };

  root.Quiz = api;                                              // browser: window.Quiz
  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node
})(typeof window !== "undefined" ? window : globalThis);