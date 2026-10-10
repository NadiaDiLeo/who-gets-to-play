/* Who gets to play? Lecture data.
   One entry per case on the shelf, in lecture order. The pages themselves live in index.html. */
window.WG = window.WG || {};

WG.site = 'https://nadiadileo.neocities.org';

/* kind: 'title' (the lecture's own case), 'case' (a topic), 'label' (shelf label opening a part divider),
   'end' / 'refs' (closing items). Spines are in WG.spines below; shelf positions in app.js (LAYOUT). */
WG.items = [
  { id: 'title', kind: 'title', num: '00', title: 'Who gets to play?',
    blurb: 'Physical and conceptual accessibility in Videogames.',
    pages: [{ id: 'title', label: 'Title screen' }] },

  { id: 'study', kind: 'case', num: '01', title: 'What I study',
    blurb: 'Physical accessibility, conceptual accessibility, and where I look for them.',
    pages: [{ id: 'p-study', label: 'What I study' }] },

  { id: 'part1', kind: 'label', num: '', part: 1, title: 'Physical accessibility',
    blurb: 'Can you perceive and operate the game?',
    pages: [{ id: 'p-part1', label: 'Part 1' }] },

  { id: 'gap', kind: 'case', num: '02', part: 1, title: 'A gap in the guidelines',
    blurb: 'What the Game Accessibility Guidelines cover, and what does not fit a classroom.',
    pages: [{ id: 'p-gap', label: 'A gap in the guidelines' }] },

  { id: 'checklists', kind: 'case', num: '03', part: 1, title: 'From checklists to playability',
    blurb: '479 accessibility reviews by disabled players, mapped onto the GAG.',
    pages: [{ id: 'p-check-1', label: 'The mapping' }, { id: 'p-check-2', label: 'Uneven coverage' }] },

  { id: 'awards', kind: 'case', num: '04', part: 1, title: 'The award nominees',
    blurb: 'The five nominees for Innovation in Accessibility at The Game Awards 2025.',
    pages: [{ id: 'p-awards-1', label: 'The audit' }, { id: 'p-awards-2', label: 'Game by game' }] },

  { id: 'gamechanger', kind: 'case', num: '05', part: 1, title: 'Game Changer',
    blurb: 'My PhD project, built around Minecraft Education.',
    pages: [{ id: 'p-gc', label: 'Game Changer' }] },

  { id: 'whymc', kind: 'case', num: '06', part: 1, title: 'Why Minecraft Education?',
    blurb: 'A systematic review of 18 peer-reviewed studies.',
    pages: [{ id: 'p-whymc', label: 'Why Minecraft Education?' }] },

  { id: 'mcgag', kind: 'case', num: '07', part: 1, title: 'Minecraft Education and the GAG',
    blurb: 'How accessible is the game we bring into class?',
    pages: [{ id: 'p-mcgag', label: 'Evaluating Minecraft Education' }] },

  { id: 'reviews', kind: 'case', num: '08', part: 1, title: 'What 27,036 reviews say',
    blurb: 'How Minecraft Education is received once anyone can download it.',
    pages: [{ id: 'p-reviews', label: 'What 27,036 reviews say' }] },

  { id: 'skin', kind: 'case', num: '09', part: 1, title: 'Choosing a skin',
    blurb: 'What students did first.',
    pages: [{ id: 'p-skin', label: 'Choosing a skin' }] },

  { id: 'part2', kind: 'label', num: '', part: 2, title: 'Conceptual accessibility',
    blurb: 'Does the game, and its culture, make room for you?',
    pages: [{ id: 'p-part2', label: 'Part 2' }] },

  { id: 'damsel', kind: 'case', num: '10', part: 2, title: 'Stressing out the damsel in distress',
    blurb: '19 interviews on representation, infrastructures and practices.',
    pages: [{ id: 'p-damsel', label: 'Stressing out the damsel in distress' }] },

  { id: 'backlash', kind: 'case', num: '11', part: 2, title: 'The backlash',
    blurb: 'A thread on r/KotakuInAction, read as data.',
    pages: [{ id: 'p-backlash-1', label: 'The post' }, { id: 'p-backlash-2', label: 'The thread' }] },

  { id: 'player', kind: 'case', num: '12', part: 2, title: 'Who is the player?',
    blurb: 'What connects the studies, and two questions for you.',
    pages: [{ id: 'p-player', label: 'Who is the player?' }] },

  { id: 'end', kind: 'end', num: '13', title: 'Thank you',
    blurb: 'Contacts.',
    pages: [{ id: 'p-end', label: 'Thank you' }] },

  { id: 'refs', kind: 'refs', num: '14', title: 'References',
    blurb: 'Works cited in this lecture.',
    pages: [{ id: 'p-refs', label: 'References' }] }
];

/* Spines on the shelf: each case borrows its side from a real cover (scans in ../copertine).
   file: the palette-dithered spine; with color: true, "<file>-c.png" holds the original colours, shown on hover. */
WG.spines = {
  study:       { file: 'spyro.png',                 color: true, game: 'Spyro: Year of the Dragon', platform: 'PlayStation' },
  gap:         { file: 'celeste.png',               color: true, game: 'Celeste', platform: 'Nintendo Switch' },
  checklists:  { file: 'sekiro.png',                color: true, game: 'Sekiro: Shadows Die Twice', platform: 'PlayStation 4' },
  awards:      { file: 'hollow-knight.png',         color: true, game: 'Hollow Knight', platform: 'Nintendo Switch' },
  gamechanger: { file: 'minecraft.png',             color: true, game: 'Minecraft', platform: 'Xbox One' },
  whymc:       { file: 'thrillville.png',           color: true, game: 'Thrillville', platform: 'Xbox' },
  mcgag:       { file: 'yakuza-0.png',              color: true, game: 'Yakuza 0', platform: 'PlayStation 4' },
  reviews:     { file: 'fallout-76.png',            color: true, game: 'Fallout 76', platform: 'Xbox One' },
  skin:        { file: 'pokemon-moon.png',          color: true, game: 'Pokémon Moon', platform: 'Nintendo 3DS' },
  damsel:      { file: 'metroid-samus-returns.png', color: true, game: 'Metroid: Samus Returns', platform: 'Nintendo 3DS' },
  backlash:    { file: 'life-is-strange.png',       color: true, game: 'Life is Strange: Before the Storm', platform: 'PlayStation 4' },
  player:      { file: 'undertale.png',             color: true, game: 'Undertale', platform: 'Nintendo Switch' },
  end:         { file: 'animal-crossing.png',       color: true, game: 'Animal Crossing: New Leaf', platform: 'Nintendo 3DS' },
  refs:        { file: 'manual.png' }
};

/* Award nominees, Di Leo (2026a). Values from the chart on the original slide 8. */
WG.awards = [
  { id: 'ac',   name: 'Assassin’s Creed Shadows', impl: 77.0, doc: 26.5, img: 'heat-ac-shadows.png' },
  { id: 'atom', name: 'Atomfall',                 impl: 83.0, doc: 31.0, img: 'heat-atomfall.png' },
  { id: 'doom', name: 'DOOM: The Dark Ages',      impl: 79.7, doc: 40.6, img: 'heat-doom.png', tag: 'Award winner' },
  { id: 'fc',   name: 'EA Sports FC 26',          impl: 74.5, doc: 48.6, img: 'heat-fc26.png' },
  { id: 'som',  name: 'South of Midnight',        impl: 83.2, doc: 25.5, img: 'heat-south-of-midnight.png', tag: 'First in my audit' }
];
