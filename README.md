# 404: HALLOWEEN NOT FOUND

> A website that gets scarier the longer you stay on it.

**Live:** https://halloween.iamnotshifu.com

It starts as a perfectly normal 404 page. Stick around and it starts to glitch, a hidden terminal opens, and it works out what kind of monster you are. Then you land in a 3D graveyard with your monster in the middle of it, and you get a shareable "I survived" card.

It's a silly, small, completely unnecessary Halloween project. That's the point.

## How it plays

1. **A normal 404 page.** Nothing to see here.
2. **It starts to glitch.** The page turns on you.
3. **A terminal opens** and asks four questions, picked at random from a pool.
4. **You get a monster:** Vampire, Ghost, Witch, Zombie or Demon.
5. **3D graveyard reveal.** Fog, moon, flickering lantern, drifting ghosts, circling bats. Drag to look around.
6. **Save or share your card.**

There's also a secret ending. I'm not telling you where it is.

## Built with

- Plain HTML, CSS and JavaScript, with no build step
- [three.js](https://threejs.org) for the 3D scene (loaded from a CDN)
- Web Audio API for sound effects
- Canvas API for the share card

Every monster is built from basic shapes in code. There are no 3D model files.

## Run it locally

You need an internet connection, because three.js loads from a CDN.

```bash
git clone https://github.com/iamnotshifu/halloween-not-found.git
cd halloween-not-found
python -m http.server 8000
```

Then open http://localhost:8000.

## Make it your own

**Add quiz questions** in `main.js` by adding to the `Q.push(...)` block. Each answer gives points to one or more monsters:

```js
["Your question…", [
  ["Answer A", {vampire: 2}],
  ["Answer B", {ghost: 1, witch: 1}],
  ["Answer C", {zombie: 2}],
  ["Answer D", {demon: 2}]
]]
```

The game picks 5 random questions from the pool each time.

**Change the monster text** in the `M` object at the top of `main.js`.

## Project structure

```
index.html   page and meta tags
style.css    styles
main.js      quiz, terminal, 3D scene, share card
og.png       social preview image
```

## Deploy

Drag the folder into Netlify Drop, or connect the repo to Netlify or GitHub Pages. No build command is needed.

## More from me

- [IAMNOTSHIFU.com](https://iamnotshifu.com): my portfolio
- [Halloween portfolio (2023)](https://nforshifu234dev-halloween-portfolio.netlify.app/): last Halloween's project ([code](https://github.com/iamnotshifu/portfolio-halloween))
- [WishIT](https://wish-it.app)
- [GitHub](https://github.com/iamnotshifu)

## Credits

Made by [IAMNOTSHIFU](https://iamnotshifu.com). Thanks to [three.js](https://threejs.org) and [Remotion](https://www.remotion.dev).
