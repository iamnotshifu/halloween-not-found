/*
 * quiz.test.js — checks that the quiz is well-formed and fair.
 *
 * Run:  node quiz.test.js
 * No dependencies. Exits with a non-zero code if anything fails, so it can
 * also run in CI.
 *
 * What "fair" means here: a player who answers completely at random should
 * end up with each monster about 20% of the time. Whether real people find
 * one monster's answers more tempting than another's is something no test
 * can measure, only real play can.
 */
"use strict";

const assert = require("assert");
const Quiz = require("./quiz.js");

// Small seeded random generator (mulberry32) so test runs are repeatable.
function seeded(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok    " + name); }
  catch (err) { failed++; console.log("  FAIL  " + name + "\n        " + err.message); }
}

console.log("\nquiz.js\n");

test("question pool has no mistakes (audit)", function () {
  assert.deepStrictEqual(Quiz.audit(), []);
});

test("a run asks the right number of different questions", function () {
  for (let n = 0; n < 500; n++) {
    const run = Quiz.buildRun(seeded(n));
    assert.strictEqual(run.length, Quiz.PER_RUN);
    assert.strictEqual(new Set(run.map(function (s) { return s.prompt; })).size, Quiz.PER_RUN);
    run.forEach(function (s) { assert.strictEqual(s.options.length, Quiz.ORDER.length); });
  }
});

test("every monster can be reached by committing to it", function () {
  Quiz.ORDER.forEach(function (monster) {
    for (let n = 0; n < 300; n++) {
      const rng = seeded(n);
      const total = Quiz.emptyScores();
      Quiz.buildRun(rng).forEach(function (step) {
        // the answer worth PRIMARY points to this monster
        const pick = step.options.find(function (o) { return o.scores[monster] === Quiz.PRIMARY; });
        Quiz.addScores(total, pick.scores);
      });
      assert.strictEqual(Quiz.pickWinner(total, rng), monster, "committing to " + monster + " should win");
    }
  });
});

test("a random answerer gets each monster 20% of the time (±1.5)", function () {
  const runs = 60000;
  const wins = Quiz.simulate(runs, seeded(2026));
  console.log("");
  Quiz.ORDER.forEach(function (m) {
    const pct = wins[m] / runs * 100;
    console.log("        " + m.padEnd(8) + pct.toFixed(1) + "%  " + "█".repeat(Math.round(pct)));
    assert.ok(Math.abs(pct - 20) <= 1.5, m + " got " + pct.toFixed(1) + "%");
  });
  console.log("");
});

test("the secret pumpkin can never be awarded by the quiz", function () {
  const wins = Quiz.simulate(2000, seeded(7));
  assert.deepStrictEqual(Object.keys(wins).sort(), Quiz.ORDER.slice().sort());
});

test("ties are broken evenly", function () {
  const rng = seeded(99);
  const tally = { vampire: 0, witch: 0 };
  const tied = { vampire: 4, ghost: 1, witch: 4, zombie: 0, demon: 2 };
  for (let n = 0; n < 20000; n++) tally[Quiz.pickWinner(tied, rng)]++;
  assert.ok(Math.abs(tally.vampire / 20000 - 0.5) < 0.02, JSON.stringify(tally));
});

test("answer order is shuffled (no monster is stuck in one slot)", function () {
  const rng = seeded(5);
  const slotZero = Quiz.emptyScores();
  for (let n = 0; n < 20000; n++) {
    const first = Quiz.buildRun(rng)[0].options[0];
    const monster = Quiz.ORDER.find(function (m) { return first.scores[m] === Quiz.PRIMARY; });
    slotZero[monster]++;
  }
  Quiz.ORDER.forEach(function (m) {
    assert.ok(Math.abs(slotZero[m] / 20000 - 0.2) < 0.015, m + " lands in slot 1 too often/rarely");
  });
});

console.log(failed ? "\n" + failed + " test(s) failed.\n" : "\nAll tests passed.\n");
process.exit(failed ? 1 : 0);