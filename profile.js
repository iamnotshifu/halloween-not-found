/*
 * profile.js — "how does it know that?": the creepy-but-harmless layer.
 *
 * Like quiz.js, this file is pure logic: no DOM writes, no audio, no three.js.
 * It runs in the browser (as window.Profile) and in Node (require("./profile.js")),
 * so profile.test.js can check it without a browser.
 *
 * WHAT IT DOES
 *   1. collect()    reads things your browser already tells EVERY website:
 *                   timezone, clock, device, battery (Chrome only), connection,
 *                   theme, language, the page you came from, and a visit counter
 *                   saved in your own browser.
 *   2. dossier()    turns those facts into the lines the terminal "knows".
 *                   Every line carries a `how` that explains where it came from,
 *                   which is shown on the "How did it know?" panel at the end.
 *   3. behaviour()  turns what the visitor did during the quiz (tab switches,
 *                   time per question) into two more lines.
 *   4. sanitizeName()  cleans the name they type (keeps accents: Ọlá, Chukwuébuka).
 *
 * WHAT IT NEVER DOES
 *   No network requests, no IP lookup, no camera, microphone, clipboard or GPS.
 *   Nothing here leaves the browser. The only thing stored is the visit counter,
 *   in localStorage, on the visitor's own device.
 *
 * ADDING A LINE
 *   Add a fact in buildFacts(), a line in dossier() (with `how`), put its id in
 *   ORDER (and in FILLERS or MUST), then run `node profile.test.js`.
 */
(function (root) {
  "use strict";

  const STORE_KEY = "halloween404.visits";
  const MAX_NAME = 18;      // characters kept from the typed name
  const MAX_LINES = 6;      // dossier lines shown, so it stays creepy, not tedious

  /* ------------------------------------------------------------------ */
  /* Small readers: each turns raw browser data into a plain fact        */
  /* ------------------------------------------------------------------ */

  // "Africa/Lagos" -> "Lagos". "America/Argentina/Buenos_Aires" -> "Buenos Aires".
  // Returns null for zones that name no city (UTC, Etc/GMT+1, …).
  function cityFromTimezone(tz) {
    if (!tz || typeof tz !== "string") return null;
    if (/^(utc|gmt|etc\/)/i.test(tz)) return null;
    const parts = tz.split("/");
    if (parts.length < 2) return null;
    return parts[parts.length - 1].replace(/_/g, " ");
  }

  // 23:47 -> "11:47 PM"
  function clock(date) {
    let h = date.getHours();
    const m = date.getMinutes();
    const suffix = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + String(m).padStart(2, "0") + " " + suffix;
  }

  // "night" (9 PM – 5 AM, split into "late" below), "morning", "afternoon", "evening".
  function dayPart(hour) {
    if (hour < 5) return "late";       // after midnight: the creepiest hours
    if (hour < 12) return "morning";
    if (hour < 17) return "afternoon";
    if (hour < 21) return "evening";
    return "night";
  }

  // Days from today until Oct 31 of this year (negative once it has passed).
  function daysToHalloween(now) {
    const year = now.getFullYear();
    const today = new Date(year, now.getMonth(), now.getDate());
    const target = new Date(year, 9, 31);
    return Math.round((target - today) / 864e5);
  }

  // Coarse on purpose: system + kind + browser. Chrome hides phone models now anyway.
  function detectDevice(nav) {
    const ua = (nav && nav.userAgent) || "";
    const touchPoints = (nav && nav.maxTouchPoints) || 0;
    let os = null;
    let kind = "computer";

    if (/iPhone/.test(ua)) { os = "iPhone"; kind = "phone"; }
    else if (/iPad/.test(ua)) { os = "iPad"; kind = "tablet"; }
    else if (/Android/.test(ua)) { os = "Android"; kind = /Mobile/.test(ua) ? "phone" : "tablet"; }
    else if (/CrOS/.test(ua)) { os = "Chromebook"; }
    else if (/Windows/.test(ua)) { os = "Windows"; }
    else if (/Macintosh|Mac OS X/.test(ua)) {
      // iPads ask for the desktop site and say "Macintosh", but they have a touchscreen.
      if (touchPoints > 1) { os = "iPad"; kind = "tablet"; } else { os = "Mac"; }
    }
    else if (/Linux/.test(ua)) { os = "Linux"; }

    let browser = null;
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
    else if (/SamsungBrowser/.test(ua)) browser = "Samsung Internet";
    else if (/Firefox\/|FxiOS/.test(ua)) browser = "Firefox";
    else if (/Chrome\/|CriOS/.test(ua)) browser = "Chrome";
    else if (/Safari\//.test(ua)) browser = "Safari";

    return { os: os, kind: kind, browser: browser };
  }

  // Where the visitor clicked from. Own-site visits (a refresh) don't count.
  const REFERRERS = [
    [/(^|\.)(x|twitter)\.com$|^t\.co$/, "X"],
    [/(^|\.)instagram\.com$/, "Instagram"],
    [/(^|\.)(facebook|fb)\.com$|^fb\.me$/, "Facebook"],
    [/(^|\.)whatsapp\.(com|net)$/, "WhatsApp"],
    [/(^|\.)linkedin\.com$|^lnkd\.in$/, "LinkedIn"],
    [/(^|\.)tiktok\.com$/, "TikTok"],
    [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
    [/(^|\.)reddit\.com$/, "Reddit"],
    [/(^|\.)threads\.net$/, "Threads"],
    [/(^|\.)snapchat\.com$/, "Snapchat"],
    [/(^|\.)(telegram\.org|t\.me)$/, "Telegram"],
    [/(^|\.)github\.com$/, "GitHub"],
    [/(^|\.)google\./, "Google"]
  ];

  function referrerLabel(referrer, ownHost) {
    if (!referrer) return null;
    let host;
    try { host = new URL(referrer).hostname.toLowerCase(); } catch (e) { return null; }
    if (!host || host === ownHost) return null;
    for (let i = 0; i < REFERRERS.length; i++) {
      if (REFERRERS[i][0].test(host)) return REFERRERS[i][1];
    }
    return host.replace(/^www\./, "");
  }

  // "en-NG" -> "Nigerian English" (falls back to the raw code).
  function languageLabel(lang) {
    if (!lang) return null;
    try {
      const label = new Intl.DisplayNames(["en"], { type: "language" }).of(lang);
      if (label && label !== lang) return label;
    } catch (e) { /* older browsers: use the code */ }
    return lang;
  }

  // Remembers visits in the visitor's own browser. Returns what it knew BEFORE
  // this visit ({ count, gapMs }) or null if it has never seen them / storage is blocked.
  function visitFacts(storage, nowMs) {
    if (!storage) return null;
    try {
      const saved = JSON.parse(storage.getItem(STORE_KEY) || "null");
      storage.setItem(STORE_KEY, JSON.stringify({
        count: (saved && saved.count ? saved.count : 0) + 1,
        last: nowMs
      }));
      if (!saved || !saved.count || !saved.last) return null;
      return { count: saved.count, gapMs: Math.max(0, nowMs - saved.last) };
    } catch (e) {
      return null;   // private mode / blocked storage: the page works without it
    }
  }

  // "a few minutes ago", "3 hours ago", "yesterday", "5 days ago"
  function gapText(ms) {
    const min = Math.round(ms / 6e4);
    if (min < 10) return "a few minutes ago";
    if (min < 60) return min + " minutes ago";
    const hours = Math.round(min / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    const days = Math.round(hours / 24);
    return days === 1 ? "yesterday" : days + " days ago";
  }

  // Battery Status API: Chrome only, and it can hang, so we race a timeout.
  function readBattery(nav, timeoutMs) {
    if (!nav || typeof nav.getBattery !== "function") return Promise.resolve(null);
    const timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, timeoutMs); });
    const read = Promise.resolve(nav.getBattery()).then(function (b) {
      return { percent: Math.round(b.level * 100), charging: !!b.charging };
    });
    return Promise.race([read, timeout]).catch(function () { return null; });
  }

  /* ------------------------------------------------------------------ */
  /* Collecting                                                          */
  /* ------------------------------------------------------------------ */

  // Reads the real browser. Tests pass their own `env` instead.
  function browserEnv() {
    let timezone = null, storage = null, dark = null;
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
    try { storage = window.localStorage; } catch (e) {}
    try { if (window.matchMedia) dark = window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
    return {
      now: new Date(),
      navigator: navigator,
      timezone: timezone,
      screen: { w: window.screen && screen.width, h: window.screen && screen.height },
      dark: dark,
      referrer: document.referrer,
      ownHost: location.hostname,
      storage: storage
    };
  }

  // Builds the facts object from an env plus an already-read battery.
  function buildFacts(env, battery) {
    const nav = env.navigator || {};
    const now = env.now;
    const conn = nav.connection || nav.mozConnection || null;
    const device = detectDevice(nav);

    return {
      timezone: env.timezone || null,
      city: cityFromTimezone(env.timezone),
      hour: now.getHours(),
      clock: clock(now),
      dayPart: dayPart(now.getHours()),
      daysToHalloween: daysToHalloween(now),
      device: device,
      screen: env.screen && env.screen.w && env.screen.h ? { w: env.screen.w, h: env.screen.h } : null,
      language: nav.language || null,
      languageLabel: languageLabel(nav.language),
      dark: typeof env.dark === "boolean" ? env.dark : null,
      battery: battery,
      network: conn ? { type: conn.effectiveType || null, saveData: !!conn.saveData } : null,
      referrer: referrerLabel(env.referrer, env.ownHost),
      visit: visitFacts(env.storage, now.getTime())
    };
  }

  // Resolves to the facts. Never rejects: a missing signal is just null.
  function collect(env, opts) {
    env = env || browserEnv();
    const timeoutMs = (opts && opts.batteryTimeoutMs) || 800;
    return readBattery(env.navigator, timeoutMs).then(function (battery) {
      return buildFacts(env, battery);
    });
  }

  /* ------------------------------------------------------------------ */
  /* The dossier: what the terminal "knows"                              */
  /* ------------------------------------------------------------------ */

  // Display order = escalation: harmless first, "it remembers me" last.
  const ORDER = ["city", "time", "halloween", "device", "battery", "network", "theme", "language", "referrer", "return"];
  // Always shown when available: these are the ones that get the "how?" reaction.
  const MUST = ["city", "time", "return"];
  // Then filled in this order until MAX_LINES.
  const FILLERS = ["referrer", "device", "battery", "halloween", "network", "theme", "language"];

  // Every candidate line, keyed by id. A fact we don't have means no line.
  function candidates(f) {
    const c = {};

    if (f.city) {
      c.city = {
        text: "you’re in " + f.city + ".",
        how: "Your browser reports its timezone (“" + f.timezone + "”) to every site. The city is just the last part of that name. No GPS involved."
      };
    }

    const timeText = {
      late: "it’s " + f.clock + " there. you should be asleep.",
      morning: "it’s " + f.clock + ". you’re starting your day with this?",
      afternoon: "it’s " + f.clock + ". shouldn’t you be doing something else?",
      evening: "it’s " + f.clock + ". the light is going.",
      night: "it’s " + f.clock + ". almost the witching hour."
    };
    c.time = { text: timeText[f.dayPart], how: "Your device’s clock. Any page can read your local date and time." };

    if (f.daysToHalloween === 0) {
      c.halloween = { text: "it’s halloween. of course you’re here.", how: "Your device’s date, compared with October 31." };
    } else if (f.daysToHalloween > 0 && f.daysToHalloween <= 10) {
      c.halloween = {
        text: f.daysToHalloween + (f.daysToHalloween === 1 ? " day" : " days") + " until halloween. i’ve been counting.",
        how: "Your device’s date, compared with October 31."
      };
    }

    if (f.device && f.device.os) {
      const d = f.device;
      const label = (d.os === "iPhone" || d.os === "iPad" || d.os === "Chromebook" ? d.os : d.os + " " + d.kind).toLowerCase();
      const size = f.screen ? " " + f.screen.w + "×" + f.screen.h + "." : "";
      let text;
      if (d.kind === "phone") text = label + "." + size + " you’re holding it with your thumb.";
      else if (d.kind === "tablet") text = label + "." + size + " propped up somewhere comfortable.";
      else text = label + (d.browser ? ", " + d.browser.toLowerCase() : "") + "." + size + " sitting down. probably slouching.";
      c.device = { text: text, how: "Your browser’s user-agent and screen size, which it sends to every site automatically." };
    }

    if (f.battery) {
      const p = f.battery.percent;
      const tail = f.battery.charging ? " charging. you plan to stay."
        : p <= 20 ? " it won’t last the night."
        : p >= 80 ? " plenty. for now."
        : " enough. for now.";
      c.battery = {
        text: "battery: " + p + "%." + tail,
        how: "The Battery Status API. Only Chrome (Android and desktop) shares it; Safari and Firefox block it."
      };
    }

    if (f.network && (f.network.saveData || f.network.type)) {
      const slow = /^(slow-2g|2g|3g)$/.test(f.network.type || "");
      c.network = {
        text: f.network.saveData ? "data saver is on. i’ll be gentle."
          : "connection: " + f.network.type + (slow ? ". slow. i’m patient." : ". fast enough to run. you won’t."),
        how: "The Network Information API (Chrome) shares your connection type and data-saver setting."
      };
    }

    if (f.dark !== null) {
      c.theme = {
        text: f.dark ? "your screen is set to dark mode. you like the dark. good."
          : "your screen is bright. you won’t like what’s coming.",
        how: "The prefers-color-scheme setting, which every website can read."
      };
    }

    if (f.languageLabel) {
      c.language = {
        text: "your language is set to " + f.languageLabel + ". i’ll keep up.",
        how: "navigator.language, which your browser sends so sites can show the right language."
      };
    }

    if (f.referrer) {
      c.referrer = {
        text: "you came from " + f.referrer + ". someone wanted you here.",
        how: "document.referrer: the page you clicked from. It’s empty if you typed the address or the app hides it."
      };
    }

    if (f.visit) {
      const text = f.visit.gapMs < 10 * 6e4 ? "you refreshed the page. you can’t stay away, can you."
        : f.visit.count >= 2 ? "visit number " + (f.visit.count + 1) + ". you keep coming back."
        : "you were here " + gapText(f.visit.gapMs) + ". i kept your seat.";
      c.return = {
        text: text,
        how: "A tiny counter this page saved in your own browser (localStorage) last time. It never leaves your device."
      };
    }

    return c;
  }

  // The lines to show, in order: [{ id, text, how }]. At most MAX_LINES.
  function dossier(facts) {
    const all = candidates(facts);
    const chosen = MUST.filter(function (id) { return all[id]; });
    FILLERS.forEach(function (id) {
      if (chosen.length < MAX_LINES && all[id]) chosen.push(id);
    });
    return ORDER.filter(function (id) { return chosen.indexOf(id) !== -1; })
      .map(function (id) { return { id: id, text: all[id].text, how: all[id].how }; });
  }

  // Lines about what the visitor did while answering.
  // stats = { awayCount: tab switches, answerMs: [ms per question] }
  function behaviour(stats) {
    const lines = [];
    const times = (stats && stats.answerMs) || [];

    if (stats && stats.awayCount > 0) {
      lines.push({
        id: "away",
        text: "you looked away " + stats.awayCount + (stats.awayCount === 1 ? " time" : " times") + ". i waited.",
        how: "Browsers tell a page when its tab is hidden (visibilitychange). I counted."
      });
    }

    if (times.length) {
      const slowest = Math.max.apply(null, times);
      const at = times.indexOf(slowest);
      const average = times.reduce(function (a, b) { return a + b; }, 0) / times.length;
      if (slowest >= 7000) {
        lines.push({
          id: "slow",
          text: "you took " + Math.round(slowest / 1000) + " seconds on question " + (at + 1) + ". what were you thinking about?",
          how: "I timed the gap between each question appearing and your click."
        });
      } else if (average < 3000) {
        lines.push({
          id: "fast",
          text: "you answered fast. you didn’t think. that’s the honest version of you.",
          how: "I timed the gap between each question appearing and your click."
        });
      }
    }
    return lines.slice(0, 2);
  }

  /* ------------------------------------------------------------------ */
  /* Names                                                               */
  /* ------------------------------------------------------------------ */

  // Keeps letters (any language, with accents), numbers, spaces, ' . -
  // so "Ọlá-Chukwuébuka <b>" becomes "Ọlá-Chukwuébuka b". Max MAX_NAME characters.
  function sanitizeName(raw) {
    if (typeof raw !== "string") return "";
    const clean = raw.normalize("NFC")
      .replace(/[^\p{L}\p{M}\p{N} '’.\-]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    return Array.from(clean).slice(0, MAX_NAME).join("").trim();
  }

  // What goes on the tombstone and the card.
  function displayName(name) {
    return name ? name.toLocaleUpperCase() : "STRANGER";
  }

  /* ------------------------------------------------------------------ */
  /* Export                                                              */
  /* ------------------------------------------------------------------ */

  const api = {
    MAX_NAME, MAX_LINES,
    cityFromTimezone, clock, dayPart, daysToHalloween, detectDevice,
    referrerLabel, languageLabel, visitFacts, gapText, readBattery,
    browserEnv, buildFacts, collect, dossier, behaviour, sanitizeName, displayName
  };

  root.Profile = api;                                              // browser: window.Profile
  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node
})(typeof window !== "undefined" ? window : globalThis);
