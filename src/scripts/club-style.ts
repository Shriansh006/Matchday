// Jersey-style club icons (like futbol11's shirt images) drawn as inline SVG,
// so no trademarked crests or third-party assets are used.
import { hashString } from './shared';

export type JerseyPattern = 'solid' | 'stripes' | 'hoops' | 'sash' | 'halves';

export interface ClubStyle {
  base: string;
  accent: string;
  text: string;
  pattern: JerseyPattern;
}

const STYLES: Record<string, ClubStyle> = {
  // popular clubs
  Milan: { base: '#FB090B', accent: '#000000', text: '#ffffff', pattern: 'stripes' },
  Juventus: { base: '#ffffff', accent: '#000000', text: '#000000', pattern: 'stripes' },
  Barcelona: { base: '#A50044', accent: '#004D98', text: '#EDBB00', pattern: 'stripes' },
  'Inter Milan': { base: '#0068A8', accent: '#000000', text: '#ffffff', pattern: 'stripes' },
  'Real Madrid': { base: '#ffffff', accent: '#FEBE10', text: '#00529F', pattern: 'solid' },
  Roma: { base: '#8E1F2F', accent: '#F0BC42', text: '#F0BC42', pattern: 'solid' },
  Liverpool: { base: '#C8102E', accent: '#F6EB61', text: '#ffffff', pattern: 'solid' },
  Chelsea: { base: '#034694', accent: '#ffffff', text: '#ffffff', pattern: 'solid' },
  Arsenal: { base: '#EF0107', accent: '#ffffff', text: '#ffffff', pattern: 'solid' },
  'Manchester United': { base: '#DA291C', accent: '#000000', text: '#FBE122', pattern: 'solid' },
  'Manchester City': { base: '#6CABDD', accent: '#ffffff', text: '#1C2C5B', pattern: 'solid' },
  Monaco: { base: '#E63312', accent: '#ffffff', text: '#ffffff', pattern: 'halves' },
  'West Ham United': { base: '#7A263A', accent: '#1BB1E7', text: '#ffffff', pattern: 'sash' },
  Valencia: { base: '#ffffff', accent: '#F18E00', text: '#000000', pattern: 'solid' },
  // wider clubs
  'Tottenham Hotspur': { base: '#ffffff', accent: '#132257', text: '#132257', pattern: 'solid' },
  Fiorentina: { base: '#582C83', accent: '#ffffff', text: '#ffffff', pattern: 'solid' },
  'Newcastle United': { base: '#241F20', accent: '#ffffff', text: '#ffffff', pattern: 'stripes' },
  'Atlético Madrid': { base: '#CB3524', accent: '#ffffff', text: '#272E61', pattern: 'stripes' },
  'Aston Villa': { base: '#670E36', accent: '#95BFE5', text: '#ffffff', pattern: 'halves' },
  Marseille: { base: '#ffffff', accent: '#2FAEE0', text: '#000000', pattern: 'solid' },
  Ajax: { base: '#ffffff', accent: '#D2122E', text: '#000000', pattern: 'sash' },
  Lazio: { base: '#87D8F7', accent: '#ffffff', text: '#ffffff', pattern: 'solid' },
  Benfica: { base: '#E32636', accent: '#ffffff', text: '#ffffff', pattern: 'solid' },
  'Bayern Munich': { base: '#DC052D', accent: '#ffffff', text: '#ffffff', pattern: 'solid' },
  Everton: { base: '#003399', accent: '#ffffff', text: '#ffffff', pattern: 'solid' },
  'River Plate': { base: '#ffffff', accent: '#DA291C', text: '#000000', pattern: 'sash' },
  Villarreal: { base: '#FFE667', accent: '#005187', text: '#005187', pattern: 'solid' },
  'Paris Saint-Germain': { base: '#004170', accent: '#DA291C', text: '#ffffff', pattern: 'sash' },
  PSV: { base: '#ED1C24', accent: '#ffffff', text: '#ffffff', pattern: 'stripes' },
  Lyon: { base: '#ffffff', accent: '#DA001A', text: '#1A2C5B', pattern: 'solid' },
  Napoli: { base: '#12A0D7', accent: '#ffffff', text: '#ffffff', pattern: 'solid' },
  Sevilla: { base: '#ffffff', accent: '#D9072C', text: '#000000', pattern: 'solid' },
  Galatasaray: { base: '#A90432', accent: '#FDB912', text: '#FDB912', pattern: 'halves' },
  Porto: { base: '#00428C', accent: '#ffffff', text: '#ffffff', pattern: 'stripes' },
  Parma: { base: '#FFE600', accent: '#003399', text: '#003399', pattern: 'solid' },
  'Leeds United': { base: '#ffffff', accent: '#1D428A', text: '#1D428A', pattern: 'solid' },
  Genoa: { base: '#A21C25', accent: '#003D7D', text: '#ffffff', pattern: 'halves' },
  'Boca Juniors': { base: '#00245D', accent: '#F6B40E', text: '#F6B40E', pattern: 'solid' },
  Leicester: { base: '#003090', accent: '#FDBE11', text: '#ffffff', pattern: 'solid' },
  Sunderland: { base: '#EB172B', accent: '#ffffff', text: '#ffffff', pattern: 'stripes' },
  Fulham: { base: '#ffffff', accent: '#000000', text: '#000000', pattern: 'solid' },
  'Sporting CP': { base: '#008057', accent: '#ffffff', text: '#ffffff', pattern: 'hoops' },
  Udinese: { base: '#000000', accent: '#ffffff', text: '#ffffff', pattern: 'stripes' },
  'Borussia Dortmund': { base: '#FDE100', accent: '#000000', text: '#000000', pattern: 'solid' },
  Sampdoria: { base: '#1C5594', accent: '#ffffff', text: '#ffffff', pattern: 'solid' },
  Celtic: { base: '#018749', accent: '#ffffff', text: '#ffffff', pattern: 'hoops' },
  Atalanta: { base: '#1E71B8', accent: '#000000', text: '#ffffff', pattern: 'stripes' },
};

// Contrasting outline so the initials stay legible on any shirt.
function outlineFor(text: string): string {
  return text.toLowerCase() === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.7)';
}

export function clubStyle(name: string): ClubStyle {
  const known = STYLES[name];
  if (known) return known;
  // Deterministic fallback hue for anything unmapped.
  const h = hashString(name) % 360;
  return {
    base: `hsl(${h} 58% 42%)`,
    accent: `hsl(${(h + 40) % 360} 60% 28%)`,
    text: '#ffffff',
    pattern: 'solid',
  };
}

export function clubInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

const SHIRT =
  'M24 9 C21 9 18 10 15 12 L4 19 L10 31 L17 27 L17 57 L47 57 L47 27 L54 31 L60 19 L49 12 C46 10 43 9 40 9 C40 14 24 14 24 9 Z';

function patternMarkup(style: ClubStyle, clip: string): string {
  switch (style.pattern) {
    case 'stripes':
      return `<g clip-path="url(#${clip})">
        <rect x="24" y="0" width="7" height="64" fill="${style.accent}"/>
        <rect x="38" y="0" width="7" height="64" fill="${style.accent}"/></g>`;
    case 'hoops':
      return `<g clip-path="url(#${clip})">
        <rect x="0" y="22" width="64" height="7" fill="${style.accent}"/>
        <rect x="0" y="40" width="64" height="7" fill="${style.accent}"/></g>`;
    case 'sash':
      return `<g clip-path="url(#${clip})">
        <polygon points="4,58 0,46 52,-2 62,10" fill="${style.accent}"/></g>`;
    case 'halves':
      return `<g clip-path="url(#${clip})">
        <rect x="32" y="0" width="32" height="64" fill="${style.accent}"/></g>`;
    default:
      return '';
  }
}

/** Inline SVG jersey for a club. `uid` must be unique on the page. */
export function jerseySvg(name: string, uid: string): string {
  const style = clubStyle(name);
  const clip = `jersey-clip-${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return `<svg class="jersey" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs><clipPath id="${clip}"><path d="${SHIRT}"/></clipPath></defs>
    <path d="${SHIRT}" fill="${style.base}" stroke="rgba(255,255,255,0.28)" stroke-width="1.2"/>
    ${patternMarkup(style, clip)}
    <text x="32" y="43" text-anchor="middle" font-family="Poppins, system-ui, sans-serif" font-size="13" font-weight="700" fill="${style.text}" stroke="${outlineFor(style.text)}" stroke-width="2.4" paint-order="stroke" stroke-linejoin="round">${clubInitials(name)}</text>
  </svg>`;
}
