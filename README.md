# 404: HALLOWEEN NOT FOUND

> A website that knows things it shouldn't, and gets stranger the longer you stay.

**Live:** https://halloween.iamnotshifu.com

It starts as a perfectly normal 404 page. Stick around and it starts to glitch, a hidden terminal opens, and it tells you things about yourself that you never typed. Then it works out what kind of monster you are, drops you into a 3D graveyard with your own tombstone, and gives you a shareable "I survived" card.

It's a silly, small, completely unnecessary Halloween project. That's the point.

## How it plays

1. **A normal 404 page.** Nothing to see here.
2. **It starts to glitch.** The page turns on you.
3. **A terminal opens and scans you.** It says where you are, what time it is there, what you're holding, how much battery you have left, where you came from, and whether you've been here before.
4. **It asks your name.** It knows everything except that.
5. **Five questions**, picked at random from a pool.
6. **You get a monster:** Vampire, Ghost, Witch, Zombie or Demon. While you answered, it was also watching how long you took and whether you looked away.
7. **3D graveyard reveal.** Fog, moon, flickering lantern, drifting ghosts, circling bats, and a tombstone with your name on it. Drag to look around.
8. **"How did it know?"** shows each thing it said and where it really came from.
9. **Save or share your card.** It is a snapshot of your own graveyard: your monster, your tombstone, your name.

There's also a secret ending. I'm not telling you where it is.

## How it "knows" (and what it doesn't)

Everything comes from your own browser, which tells every website these things anyway:

| It says | It came from |
| --- | --- |
| your city | the browser's timezone name (`Africa/Lagos` → Lagos), not GPS |
| the time | your device clock |
| your device | the user-agent string and screen size |
| your battery | the Battery Status API (Chrome only) |
| where you came from | `document.referrer` |
| that you've been here | a small counter saved in your own `localStorage` |
| that you looked away | the `visibilitychange` event |

It never makes a network request about you, and never uses an IP lookup, camera, microphone, clipboard or GPS. The only thing saved is the visit counter, on the visitor's own device. The "How did it know?" panel explains all of this to the visitor.

If you don't want the city on the shared card, set `cardShowsCity: false` in `main.js`.

## Built with

- Plain HTML, CSS and JavaScript, with no build step
- [three.js](https://threejs.org) for the 3D scene (loaded from a CDN)
- Web Audio API for sound effects
- Canvas API for the share card and the tombstone (the card includes a real snapshot of the 3D scene; it falls back to the emoji if WebGL is unavailable)

Every monster is built from basic shapes in code. There are no 3D model files.

## Run it locally

You need an internet connection, because three.js loads from a CDN.

```bash
git clone https://github.com/iamnotshifu/halloween-not-found.git
cd halloween-not-found
python -m http.server 8000
```

Then open http://localhost:8000.

## Test it

The logic lives in two files with no browser code in them, so Node can test them. No dependencies.

```bash
node quiz.test.js      # questions are well-formed; each monster wins about 20% of random runs
node profile.test.js   # every "it knows" line is sensible, explains itself, and handles missing signals
```

## Make it your own

**Add quiz questions** in `quiz.js`, in the `QUESTIONS` array. Each question needs one answer for each of the five monsters:

```js
{ q: "Your question…",
  a: { vampire: "…", ghost: "…", witch: "…", zombie: "…", demon: "…" } }
```

The game asks 5 random questions per run and shuffles the answers. Run `node quiz.test.js` after adding one. It tells you if you forgot a monster.

**Add or reword an "it knows" line** in `profile.js`, inside `candidates()`. Every line needs a `how` (the honest explanation shown on the final panel). Add its id to `ORDER`, and to `MUST` or `FILLERS`. Then run `node profile.test.js`.

**Change the monster text** in `MONSTERS` at the top of `quiz.js`. **Change timings** (when the glitch starts, how fast it types) in `CONFIG` at the top of `main.js`.

## Project structure

```
index.html         page and meta tags
style.css          styles
quiz.js            questions and scoring (pure logic)
profile.js         what the page "knows" about the visitor (pure logic)
main.js            terminal, 3D scene, tombstone, share card
quiz.test.js       checks the quiz
profile.test.js    checks the "it knows" lines
og.png             social preview image
```

## Deploy

Drag the folder into Netlify Drop, or connect the repo to Netlify or GitHub Pages. No build command is needed.

## More from me

- [IAMNOTSHIFU.com](https://iamnotshifu.com): my portfolio
- [Halloween portfolio (2023)](https://nforshifu234dev-halloween-portfolio.netlify.app/): my 2023 Halloween project ([code](https://github.com/iamnotshifu/portfolio-halloween))
- [WishIT](https://wish-it.app)
- [GitHub](https://github.com/iamnotshifu)

## Credits

Made by [IAMNOTSHIFU](https://iamnotshifu.com). Thanks to [three.js](https://threejs.org) and [Remotion](https://www.remotion.dev).
