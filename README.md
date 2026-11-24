# Round of Applause

A game-show wheel for thanking people. Spin it, it ticks its way round to someone, the APPLAUSE sign lights up, and the card you wrote for them appears.

## Using it

- **Spin** with the big red button, the Space bar, or by grabbing the wheel and flicking it (either direction).
- When it lands, the card shows that person's message. **Spin again** goes straight into the next spin; **Close** (or Esc) puts the wheel back.
- Nobody is ever picked twice in a row. Their wedge is veiled and the caption under the button says they're sitting out.
- The **Line-up** button (top right) shows who has been applauded and has a switch for *Everyone gets a turn first*: with it on, nobody comes up again until everyone has had their applause.
- Sound and full screen toggles sit beside it. History, the sound setting and the wheel's position are remembered in the browser.

## Your names and messages

Everything lives in [`people.js`](people.js). The names in there now are samples.

```js
window.ROUND_OF_APPLAUSE = {
  signOff: 'From all of us',
  everyoneOncePerRound: false,
  people: [
    { name: 'Priya', message: 'For turning the quarter-end numbers round…' },
    { name: 'Tom', message: '…', from: 'From the data team', colour: '#1fb5f2' }
  ]
};
```

`from` and `colour` are optional per person. The wheel redraws itself for anything from 2 to about 40 people, and long names shrink to fit.

## Publishing

It's a static site with no build step or dependencies. In the repo's **Settings → Pages**, choose *Deploy from a branch*, `main`, `/ (root)`. It will be at `https://nihilisticiconoclast.github.io/round-of-applause/`.

Bear in mind that a Pages site is public, and so is everything in `people.js`.

## How it works

- **The spin is simulated, not animated.** [`js/physics.js`](js/physics.js) models the wheel's inertia, bearing friction and air drag, a peg on every wedge boundary, and a leather flapper that has to bend for each peg to slip past. That ratchet is why the wheel ticks, slows unevenly and sometimes rocks back off a peg at the end. Each spin is a genuine simulated throw. A throw that would land on someone who has to sit out is discarded before you see it, so what plays is always a real physical outcome.
- **The wheel** is drawn on a canvas from pre-rendered layers ([`js/wheel.js`](js/wheel.js)), with rotational motion blur at speed and lighting that stays still while the face turns.
- **Sound** is synthesised in the browser ([`js/audio.js`](js/audio.js)): peg clicks, the bearing's whirr, a bell flourish and a clapping audience. Nothing is downloaded.
- **Type** is Big Shoulders Display and Fraunces, both SIL Open Font License, self-hosted in `fonts/`.

## Development

```sh
node tools/test-physics.js   # no back-to-back repeats, fair rounds, determinism, drag
node tools/tune.js 12        # how spins feel for 12 names: lengths, click spacing, rock-backs
```
