// Site-wide configuration. Change SITE_NAME here to rebrand everything.
export const SITE_NAME = 'Matchday';

export const GAMES = {
  lineup: {
    slug: 'lineup',
    name: 'The XI',
    tagline: 'Build a full eleven, one player from each of the 11 clubs.',
  },
  grid: {
    slug: 'grid',
    name: 'Football Grid',
    tagline: 'Fill a 3x3 grid with players who fit both the row and column.',
  },
} as const;
