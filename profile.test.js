/*
 * profile.test.js — checks the "how does it know?" layer.
 *
 * Run:  node profile.test.js
 * No dependencies. Exits with a non-zero code if anything fails.
 *
 * It feeds profile.js fake browsers (a Lagos Android phone at night, a bare
 * desktop with no signals, a returning visitor, blocked storage) and checks that
 * every line is sensible, never says "undefined", and always explains its source.
 */
"use strict";

const assert = require("assert");
const Profile = require("./profile.js");

let failed = 0;
const pending = [];   // async tests, awaited before the final report

function pass(name) { console.log("  ok    " + name); }
function fail(name, err) { failed++; console.log("  FAIL  " + name + "\n        " + err.message); }

// Runs a sync or async test function.
function test(name, fn) {
  let result;
  try { result = fn(); } catch (err) { fail(name, err); return; }
  if (result && typeof result.then === "function") {
    pending.push(result.then(function () { pass(name); }, function (err) { fail(name, err); }));
  } else {
    pass(name);
  }
}

// A tiny in-memory localStorage.
function fakeStorage(initial) {
  const data = Object.assign({}, initial || {});
  return {
    getItem: function (k) { return k in data ? data[k] : null; },
    setItem: function (k, v) { data[k] = String(v); },
    data: data
  };
}

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

// Tue 27 Oct 2026, 23:47 local.
const NIGHT = new Date(2026, 9, 27, 23, 47);

function lagosPhone(extra) {
  return Object.assign({
    now: NIGHT,
    timezone: "Africa/Lagos",
    screen: { w: 412, h: 915 },
    dark: true,
    referrer: "https://t.co/abc123",
    ownHost: "halloween.iamnotshifu.com",
    storage: fakeStorage(),
    navigator: {
      userAgent: ANDROID_UA, language: "en-NG", maxTouchPoints: 5,
      connection: { effectiveType: "4g", saveData: false },
      getBattery: function () { return Promise.resolve({ level: 0.17, charging: false }); }
    }
  }, extra || {});
}

const BARE = {
  now: new Date(2026, 9, 27, 14, 5),
  timezone: "UTC",
  screen: null, dark: null, referrer: "", ownHost: "x.test", storage: null,
  navigator: { userAgent: "", language: "" }
};

function allText(lines) { return lines.map(function (l) { return l.text; }).join(" | "); }

console.log("\nprofile.js\n");

/* ---------- readers ---------- */

test("timezone becomes a city", function () {
  assert.strictEqual(Profile.cityFromTimezone("Africa/Lagos"), "Lagos");
  assert.strictEqual(Profile.cityFromTimezone("America/New_York"), "New York");
  assert.strictEqual(Profile.cityFromTimezone("America/Argentina/Buenos_Aires"), "Buenos Aires");
  assert.strictEqual(Profile.cityFromTimezone("UTC"), null);
  assert.strictEqual(Profile.cityFromTimezone("Etc/GMT+1"), null);
  assert.strictEqual(Profile.cityFromTimezone(undefined), null);
});

test("12-hour clock is right at the edges", function () {
  assert.strictEqual(Profile.clock(new Date(2026, 0, 1, 0, 5)), "12:05 AM");
  assert.strictEqual(Profile.clock(new Date(2026, 0, 1, 12, 0)), "12:00 PM");
  assert.strictEqual(Profile.clock(new Date(2026, 0, 1, 23, 47)), "11:47 PM");
});

test("devices are recognised, including iPads pretending to be Macs", function () {
  assert.deepStrictEqual(Profile.detectDevice({ userAgent: ANDROID_UA }), { os: "Android", kind: "phone", browser: "Chrome" });
  assert.deepStrictEqual(Profile.detectDevice({ userAgent: WINDOWS_UA }), { os: "Windows", kind: "computer", browser: "Edge" });
  assert.deepStrictEqual(Profile.detectDevice({ userAgent: IPHONE_UA }), { os: "iPhone", kind: "phone", browser: "Safari" });
  assert.strictEqual(Profile.detectDevice({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 5 }).os, "iPad");
  assert.strictEqual(Profile.detectDevice({ userAgent: IPAD_DESKTOP_UA, maxTouchPoints: 0 }).os, "Mac");
  assert.strictEqual(Profile.detectDevice({ userAgent: "" }).os, null);
});

test("referrers: known apps get names, own site and junk get nothing", function () {
  assert.strictEqual(Profile.referrerLabel("https://t.co/x", "me.com"), "X");
  assert.strictEqual(Profile.referrerLabel("https://l.instagram.com/?u=1", "me.com"), "Instagram");
  assert.strictEqual(Profile.referrerLabel("https://www.google.com.ng/", "me.com"), "Google");
  assert.strictEqual(Profile.referrerLabel("https://www.some-blog.dev/post", "me.com"), "some-blog.dev");
  assert.strictEqual(Profile.referrerLabel("https://me.com/", "me.com"), null);
  assert.strictEqual(Profile.referrerLabel("", "me.com"), null);
  assert.strictEqual(Profile.referrerLabel("not a url", "me.com"), null);
});

test("visit memory: first visit knows nothing, second remembers, bad storage is safe", function () {
  const store = fakeStorage();
  assert.strictEqual(Profile.visitFacts(store, 1000), null);
  const second = Profile.visitFacts(store, 1000 + 3 * 864e5);
  assert.deepStrictEqual(second, { count: 1, gapMs: 3 * 864e5 });
  assert.strictEqual(Profile.visitFacts(null, 5), null);
  const broken = { getItem: function () { throw new Error("blocked"); }, setItem: function () {} };
  assert.strictEqual(Profile.visitFacts(broken, 5), null);
  assert.strictEqual(Profile.visitFacts(fakeStorage({ "halloween404.visits": "{not json" }), 5), null);
});

test("gap text reads naturally", function () {
  assert.strictEqual(Profile.gapText(2 * 6e4), "a few minutes ago");
  assert.strictEqual(Profile.gapText(45 * 6e4), "45 minutes ago");
  assert.strictEqual(Profile.gapText(60 * 6e4), "1 hour ago");
  assert.strictEqual(Profile.gapText(5 * 36e5), "5 hours ago");
  assert.strictEqual(Profile.gapText(30 * 36e5), "yesterday");
  assert.strictEqual(Profile.gapText(4 * 864e5), "4 days ago");
});

test("days to halloween counts down and is 0 on the day", function () {
  assert.strictEqual(Profile.daysToHalloween(new Date(2026, 9, 27, 23, 59)), 4);
  assert.strictEqual(Profile.daysToHalloween(new Date(2026, 9, 31, 0, 1)), 0);
  assert.ok(Profile.daysToHalloween(new Date(2026, 10, 2)) < 0);
});

/* ---------- collecting ---------- */

test("battery: reads, times out, and survives errors", async function () {
  const ok = await Profile.readBattery({ getBattery: function () { return Promise.resolve({ level: 0.5, charging: true }); } }, 50);
  assert.deepStrictEqual(ok, { percent: 50, charging: true });
  const hang = await Profile.readBattery({ getBattery: function () { return new Promise(function () {}); } }, 20);
  assert.strictEqual(hang, null);
  const boom = await Profile.readBattery({ getBattery: function () { return Promise.reject(new Error("no")); } }, 50);
  assert.strictEqual(boom, null);
  assert.strictEqual(await Profile.readBattery({}, 50), null);
});

/* ---------- the dossier ---------- */

test("a Lagos Android phone at night gets the full, specific dossier", async function () {
  const env = lagosPhone();
  // pretend they visited 3 days ago
  env.storage.setItem("halloween404.visits", JSON.stringify({ count: 1, last: NIGHT.getTime() - 3 * 864e5 }));
  const facts = await Profile.collect(env, { batteryTimeoutMs: 50 });
  const lines = Profile.dossier(facts);
  const text = allText(lines);

  assert.ok(/you’re in Lagos\./.test(text), text);
  assert.ok(/11:47 PM/.test(text), text);
  assert.ok(/android phone\. 412×915\. you’re holding it with your thumb/.test(text), text);
  assert.ok(/you came from X\./.test(text), text);
  assert.ok(/you were here 3 days ago/.test(text), text);
  assert.ok(lines.length <= Profile.MAX_LINES, "too many lines: " + lines.length);
  // escalation: city first, the "it remembers you" line last
  assert.strictEqual(lines[0].id, "city");
  assert.strictEqual(lines[lines.length - 1].id, "return");
});

test("every line explains itself and nothing says undefined/null/NaN", async function () {
  const envs = [lagosPhone(), lagosPhone({ navigator: { userAgent: WINDOWS_UA, language: "en-US" } }), BARE];
  for (const env of envs) {
    const lines = Profile.dossier(await Profile.collect(env, { batteryTimeoutMs: 20 }));
    assert.ok(lines.length >= 1, "no lines at all");
    lines.forEach(function (l) {
      assert.ok(l.how && l.how.length > 20, "missing how for " + l.id);
      assert.ok(!/undefined|null|NaN|\[object/.test(l.text + l.how), "bad text in " + l.id + ": " + l.text);
    });
  }
});

test("a browser that shares nothing still gets a few safe lines (time, at least)", async function () {
  const lines = Profile.dossier(await Profile.collect(BARE, { batteryTimeoutMs: 20 }));
  const ids = lines.map(function (l) { return l.id; });
  assert.ok(ids.indexOf("time") !== -1, ids.join());
  assert.ok(ids.indexOf("city") === -1, "UTC has no city");
  assert.ok(ids.indexOf("battery") === -1);
});

test("after-midnight, morning and evening each say something different", async function () {
  const base = lagosPhone({ navigator: { userAgent: "", language: "" } });
  const said = {};
  for (const hour of [2, 9, 14, 18, 22]) {
    const env = Object.assign({}, base, { now: new Date(2026, 5, 1, hour, 0), storage: null });
    const time = Profile.dossier(await Profile.collect(env, {})).filter(function (l) { return l.id === "time"; })[0];
    said[time.text.replace(/\d+:\d+ [AP]M/, "T")] = true;
  }
  assert.strictEqual(Object.keys(said).length, 5);
});

test("battery line changes with level and charging", async function () {
  async function batteryLine(level, charging) {
    const env = lagosPhone({ navigator: { userAgent: ANDROID_UA, language: "en", getBattery: function () { return Promise.resolve({ level: level, charging: charging }); } } });
    const lines = Profile.dossier(await Profile.collect(env, { batteryTimeoutMs: 50 }));
    const b = lines.filter(function (l) { return l.id === "battery"; })[0];
    return b ? b.text : "";
  }
  assert.ok(/won’t last the night/.test(await batteryLine(0.12, false)));
  assert.ok(/plan to stay/.test(await batteryLine(0.5, true)));
  assert.ok(/plenty/.test(await batteryLine(0.9, false)));
});

test("a quick refresh is called out; a third visit is counted", function () {
  const base = { city: null, timezone: null, hour: 12, clock: "12:00 PM", dayPart: "afternoon", daysToHalloween: 30,
    device: { os: null }, screen: null, languageLabel: null, dark: null, battery: null, network: null, referrer: null };
  const quick = Profile.dossier(Object.assign({}, base, { visit: { count: 1, gapMs: 2 * 6e4 } }));
  assert.ok(/refreshed the page/.test(allText(quick)));
  const third = Profile.dossier(Object.assign({}, base, { visit: { count: 3, gapMs: 5 * 864e5 } }));
  assert.ok(/visit number 4/.test(allText(third)));
});

test("the dossier never exceeds the line cap, even with every signal", async function () {
  const env = lagosPhone({ now: new Date(2026, 9, 29, 23, 0) });
  env.storage.setItem("halloween404.visits", JSON.stringify({ count: 4, last: env.now.getTime() - 864e5 * 2 }));
  const lines = Profile.dossier(await Profile.collect(env, { batteryTimeoutMs: 50 }));
  assert.strictEqual(lines.length, Profile.MAX_LINES);
  const ids = lines.map(function (l) { return l.id; });
  ["city", "time", "return"].forEach(function (id) { assert.ok(ids.indexOf(id) !== -1, "missing " + id); });
});

/* ---------- behaviour ---------- */

test("behaviour lines: tab switches, slow answers, fast answers", function () {
  const away = Profile.behaviour({ awayCount: 2, answerMs: [4000, 4000, 4000, 4000, 4000] });
  assert.ok(/looked away 2 times/.test(allText(away)));
  const slow = Profile.behaviour({ awayCount: 0, answerMs: [3000, 3000, 11000, 3000, 3000] });
  assert.ok(/11 seconds on question 3/.test(allText(slow)), allText(slow));
  const fast = Profile.behaviour({ awayCount: 0, answerMs: [1200, 1500, 900, 1800, 1000] });
  assert.ok(/answered fast/.test(allText(fast)));
  assert.deepStrictEqual(Profile.behaviour({ awayCount: 0, answerMs: [4000, 5000, 4500, 4000, 5000] }), []);
  assert.strictEqual(Profile.behaviour({ awayCount: 5, answerMs: [20000, 1000] }).length, 2);
  assert.deepStrictEqual(Profile.behaviour(null), []);
  assert.ok(/looked away 1 time\./.test(allText(Profile.behaviour({ awayCount: 1, answerMs: [] }))));
});

/* ---------- names ---------- */

test("names keep accents and other languages, and lose anything dangerous", function () {
  assert.strictEqual(Profile.sanitizeName("Ọlá Chukwuébuka"), "Ọlá Chukwuébuka");
  assert.strictEqual(Profile.sanitizeName("Adaeze"), "Adaeze");
  assert.strictEqual(Profile.sanitizeName("  amina   bello  "), "amina bello");
  const attack = Profile.sanitizeName("<img src=x onerror=alert(1)>");
  assert.ok(!/[<>="()\/\\]/.test(attack), "dangerous characters survived: " + attack);
  assert.ok(attack.length <= Profile.MAX_NAME);
  assert.strictEqual(Profile.sanitizeName("Zoë 李雷"), "Zoë 李雷");
  assert.strictEqual(Profile.sanitizeName("a".repeat(100)).length, Profile.MAX_NAME);
  assert.strictEqual(Profile.sanitizeName("💀💀💀"), "");
  assert.strictEqual(Profile.sanitizeName(""), "");
  assert.strictEqual(Profile.sanitizeName(null), "");
});

test("display name is uppercase, or STRANGER when empty", function () {
  assert.strictEqual(Profile.displayName("adaeze"), "ADAEZE");
  assert.strictEqual(Profile.displayName(""), "STRANGER");
  assert.strictEqual(Profile.displayName("ọlá"), "ỌLÁ");
});

Promise.all(pending).then(function () {
  if (failed) { console.log("\n" + failed + " test(s) failed.\n"); process.exit(1); }
  console.log("\nAll tests passed.\n");
});
