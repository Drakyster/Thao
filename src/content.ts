/**
 * ─────────────────────────────────────────────────────────────
 *  EVERYTHING SHE READS LIVES IN THIS FILE.
 *  Change any line so it sounds like you. Keep lines short:
 *  she reads them as subtitles, in her second language.
 * ─────────────────────────────────────────────────────────────
 */

/** Facts only you know. Leave a value empty and the film stays true without it. */
export const config = {
  /** Her name as she writes it (for example 'Thảo' if she uses the accent). */
  herName: 'Thao',

  /** Your full name, for the title card and the poster. */
  director: 'Hugo Lothsavan',

  /** Your first name, for the credits. */
  me: 'Hugo',

  /** City where you met, e.g. 'Saigon'. Empty → just "Vietnam". */
  city: '',

  /** France ↔ Vietnam. Change it if you know the exact distance. */
  distance: 'about 10,000 km',

  /** You are in France, she is in Vietnam: adds "I miss you." */
  currentlyApart: true,

  /**
   * Link to your chat, opened by "Wink back" (WhatsApp https://wa.me/33612345678,
   * Instagram https://ig.me/m/yourname, Messenger https://m.me/yourname, Zalo...).
   * Empty → the button copies ;) and asks her to send it to you.
   */
  replyUrl: '',

  /** "Dính như sam." (stuck together like horseshoe crabs, said of couples who are always together) */
  showIdiom: true,

  /** Small line after "Anh yêu em.": delete it if you speak Vietnamese well. */
  accentsLine: true,

  /**
   * A light, original score played by the browser itself (no music file,
   * nothing licensed). It starts softly once she lets go of the first bulb,
   * and a small button in the corner mutes it. false → a silent film.
   */
  sound: true,
}

/** one day of the week: its bulb label and the lines her tap reveals */
function day(name: string, short: string, notes: string[]) {
  return { name, short, note: notes[0], notes }
}

const place = config.city || 'Vietnam'
const placeVi = config.city ? `${config.city}, Việt Nam` : 'Việt Nam'

export const copy = {
  meta: {
    title: `For ${config.herName}`,
  },

  common: {
    next: 'Next',
    back: 'Back',
    upright: 'This one works best upright.',
    /** only if a scene ever fails to draw on her phone */
    failed: "This part didn't load.",
    retry: 'Try again',
    skip: 'Skip this part',
    /** the sound button (read aloud by screen readers; the button itself is an icon) */
    soundOn: 'Sound on',
    soundOff: 'Sound off',
  },

  lights: {
    hello: `Hi ${config.herName}.`,
    /** she has already watched it once on this phone */
    helloAgain: `Hi again, ${config.herName}.`,
    /** she left halfway last time */
    welcomeBack: `Welcome back, ${config.herName}.`,
    intro: "I made you a short film, because a message wasn't enough.",
    prompt: 'Hold the light to start.',
    keepHolding: 'Keep holding.',
    runtime: config.sound ? 'About 4 minutes, with sound.' : 'About 4 minutes.',
    play: 'Play',
    resume: 'Continue where you left off',
    title: config.herName.toUpperCase(),
    byline: `A film by ${config.director}`,
  },

  sofas: {
    hisCaption: 'Me, 2009.\nDressed for a\u00a0wedding.',
    herCaption: 'You. Already winking?',
    lines: ['Two kids, each living their own little life.', 'Neither of us knew the\u00a0other existed. Not yet.'],
    prompt: 'Slide us together.',
    action: 'Bring us together',
    after: [`Then, years later, in\u00a0${place}, I\u00a0met you.`, 'And from the very first day, everything felt so natural with you.'],
  },

  /**
   * Monday to Saturday: one bulb for every day you saw each other.
   * `notes` play one after the other when her tap lights that day's bulb
   * (`note` is the first one, kept for a one-line summary).
   */
  week: {
    lead: 'From then on, we\u00a0saw each\u00a0other every\u00a0single\u00a0day.',
    prompt: 'Tap to light up each day.',
    action: 'Next day',
    /** the same button while a day still has a line to tell */
    actionMore: 'And then?',
    days: [
      day('Monday', 'Mon', [
        'Our first date, at\u00a0a\u00a0Vietnamese restaurant.',
        'I was so nervous that I\u00a0dropped my meat on the floor.',
        'Then we went for cocktails, and I really got to know you.',
      ]),
      day('Tuesday', 'Tue', ["I couldn't stop smiling, all because of you."]),
      day('Wednesday', 'Wed', ["It already felt like I'd\u00a0known\u00a0you\u00a0forever."]),
      day('Thursday', 'Thu', [
        'We had a Vietnamese coffee together.',
        'But then I had to leave to meet my friends.',
        'Honestly, I wish I had stayed with you instead.',
      ]),
      day('Friday', 'Fri', [
        'We had xiao\u00a0long\u00a0bao, then\u00a0went back to the\u00a0apartment.',
        'That evening, we went out again to grab a\u00a0coffee.',
        'It was our last night.',
      ]),
      day('Saturday', 'Sat', [
        'We went to a\u00a0crab\u00a0restaurant for lunch.',
        'Then we spent the rest of the day together.',
        'Until the very last minute.',
      ]),
    ],
    end: "Six days. I'd\u00a0live every\u00a0one\u00a0of\u00a0them\u00a0again.",
  },

  /** Friday night at the café: the two photos */
  focus: {
    lead: 'Back to Friday night, at the café.',
    prompt: 'Tap to focus.',
    action: 'Focus',
    missed: 'Almost. But I meant you.',
    found: 'There you are.',
    after: [
      'I was so happy to be there with you.',
      'And at the same time, so sad.',
      'Because I knew that the\u00a0next\u00a0day, I\u00a0had\u00a0to\u00a0leave.',
    ],
  },

  /** Saturday night: the airport, then the plane back to France */
  plane: {
    lead: 'Saturday night, you came with me to the airport.',
    /** before she wipes the window (the drop runs down the glass on the line with "cried") */
    lines: ['Leaving you there was so hard.', 'On the plane, I cried. A lot.'],
    prompt: 'Wipe the window.',
    action: 'Wipe it',
    /** the moment the fog lifts under her finger */
    after: 'Thanks. I needed that.',
    /** over the clear night, once she has wiped it */
    afterLines: ["I couldn't stop thinking about you.", 'And your messages touched me so much.'],
    /**
     * Optional: one short line copied from one of her real messages to you
     * (exactly as she wrote it). It appears, small, on the clear glass.
     * Never invent one: leave it empty and nothing shows.
     */
    herMessage: '',
  },

  glued: {
    lead: `Now there are ${config.distance} between us.`,
    prompt: 'Go on, try to pull us apart.',
    hint: 'Drag sideways.',
    action: 'Pull us apart',
    nope: 'Nope.',
    told: 'Still glued.',
    after: ["The distance doesn't\u00a0change what\u00a0I\u00a0feel."],
    idiom: config.showIdiom ? 'Dính như sam.' : null,
  },

  light: {
    prompt: 'Hold the light again.',
    action: 'Turn it on',
    lines: [
      `${config.herName}.`,
      'I never expected to meet someone like you.',
      'Or to fall for you so fast.',
      ...(config.currentlyApart
        ? [
            'I miss you.',
            'I miss everything about you.',
            'Your laugh, that wink, the\u00a0way\u00a0you\u00a0love\u00a0life.',
            "I can't wait to see you again.",
          ]
        : []),
      'Thank you for those six days.',
      "I'm so happy I met you.",
      'I love you.',
    ],
    card: 'Anh yêu em.',
    accents: config.accentsLine ? 'Hope I got the accents right.' : null,
    rollCredits: 'Roll the credits',
  },

  credits: {
    roll: [
      { role: 'Starring', name: config.herName },
      { role: 'Also starring', name: config.me },
      { role: 'Written and directed by', name: config.director },
      { role: 'Camera', name: `${config.herName}, arm fully extended` },
      { role: 'Lighting', name: 'Some bulbs under a striped umbrella' },
      { role: 'Archive footage', name: 'Two leather sofas' },
      { role: 'Costumes', name: 'Green bows, one very serious blazer' },
      { role: 'Stunts', name: `${config.me}, dropping his meat on the floor` },
      { role: 'Color matching', name: 'Her green bows, his green fish tank' },
      { role: 'Shooting schedule', name: 'Monday to Saturday' },
      { role: 'Tears', name: `${config.me}, on the plane` },
      { role: 'Special thanks', name: `${config.herName}, for\u00a0coming to\u00a0the\u00a0airport\u00a0with\u00a0me` },
      { role: 'Filmed on location in', name: placeVi, vi: true },
      { role: 'Best wink', name: config.herName },
    ],
    last: 'No days were skipped in\u00a0the\u00a0making of\u00a0this\u00a0film.',
    skip: 'Skip to the end',
    poster: {
      presents: `${config.director} presents`,
      tagline: 'Every single day.',
      title: config.herName.toUpperCase(),
      award: 'Best wink',
      billing: [
        `Starring ${config.herName}`,
        `Camera ${config.herName}`,
        `Written and directed by ${config.director}`,
        'Lighting some bulbs under a striped umbrella',
        'Archive footage two leather sofas',
        `Filmed on location in ${placeVi}`,
      ],
      release: 'Now playing on one phone only',
    },
    yourTurn: 'Your turn to wink.',
    wink: 'Wink back ;)',
    copied: 'Copied. Now send it to me.',
    /** when the phone refuses the clipboard: she copies the ;) under his line by hand */
    copyThis: 'Copy this and send it to me.',
    again: 'Watch again',
    keep: 'Tap the poster for a clean screenshot.',
    /** shown for a moment after she taps the poster, before everything else steps aside */
    screenshotNow: 'Screenshot now.',
  },
}

/**
 * How long a subtitle stays up before moving on by itself. Tight enough to
 * keep the film moving; a tap on the right moves on sooner, a tap on the
 * left reads the previous line again.
 */
export function readingMs(text: string) {
  return Math.min(4600, Math.max(2100, 1450 + text.length * 50))
}
