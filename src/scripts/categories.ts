// Grid categories, modelled on futbol11's board: clubs and countries, split
// into a "popular" tier and a wider tier so the four difficulty levels can
// include progressively more of them.
import type { Index } from './shared';

export type CategoryType = 'club' | 'club2' | 'country' | 'country2';

export interface GridCategory {
  id: string;
  name: string;
  type: CategoryType;
  flag?: string;
  players: Set<string>;
}

// Club-type tokens we strip to get a cleaner label ("FC Barcelona" -> "Barcelona").
const CLUB_TOKENS = new Set([
  'fc', 'cf', 'afc', 'ac', 'as', 'ss', 'ssc', 'sc', 'sv', 'vfb', 'vfl', 'bsc',
  'dsc', 'cd', 'ca', 'cs', 'ec', 'se', 'fk', 'sk', 'nk', 'hnk', 'us', 'sl',
  'acf', 'asl', 'tsv', 'rcd', 'rc', 'ud', 'sd', 'fsv', 'tsg', 'vfr', 'bc',
  'cfc', 'uc', 'calcio', 'olympique', 'de', 'the',
]);

const CLUB_PHRASES =
  /\b(club de f[uú]tbol|football club|f[uú]tbol club|calcio club|association football club)\b/gi;

// Hand-written clean-ups where the generic rules aren't enough.
const CLUB_ALIASES: Record<string, string> = {
  'Club Atlético River Plate': 'River Plate',
  'PSV Eindhoven': 'PSV',
  Lyonnais: 'Lyon',
  'Leicester City': 'Leicester',
};

export function shortClubName(raw: string): string {
  const parts = raw
    .replace(CLUB_PHRASES, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !CLUB_TOKENS.has(token.replace(/\./g, '').toLowerCase()))
    .filter((token) => !/^\d+$/.test(token)); // drop years ("Parma Calcio 1913")
  const cleaned = parts.join(' ').trim();
  if (!cleaned) return raw;
  return CLUB_ALIASES[cleaned] ?? cleaned;
}

const FLAGS: Record<string, string> = {
  Argentina: '🇦🇷', Brazil: '🇧🇷', Spain: '🇪🇸', France: '🇫🇷', England: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  Italy: '🇮🇹', Germany: '🇩🇪', Portugal: '🇵🇹', Uruguay: '🇺🇾', Netherlands: '🇳🇱',
  Belgium: '🇧🇪', Colombia: '🇨🇴', Mexico: '🇲🇽', 'United States': '🇺🇸', USA: '🇺🇸',
  Chile: '🇨🇱', Sweden: '🇸🇪', Denmark: '🇩🇰', Switzerland: '🇨🇭', Poland: '🇵🇱',
  Paraguay: '🇵🇾', Croatia: '🇭🇷', Nigeria: '🇳🇬', Algeria: '🇩🇿', Austria: '🇦🇹',
  'Czech Republic': '🇨🇿', Czechia: '🇨🇿', Norway: '🇳🇴', Ukraine: '🇺🇦',
  Turkiye: '🇹🇷', Turkey: '🇹🇷', Wales: '🏴󠁧󠁢󠁷󠁬󠁳󠁿', Scotland: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'Ivory Coast': '🇨🇮', Morocco: '🇲🇦', Japan: '🇯🇵', Ghana: '🇬🇭', Senegal: '🇸🇳',
  Cameroon: '🇨🇲', Ecuador: '🇪🇨', 'South Korea': '🇰🇷', Ireland: '🇮🇪',
  'Republic of Ireland': '🇮🇪', 'Northern Ireland': '🇬🇧', Serbia: '🇷🇸',
  Romania: '🇷🇴', Greece: '🇬🇷', Russia: '🇷🇺', Hungary: '🇭🇺', Slovakia: '🇸🇰',
  Slovenia: '🇸🇮', Finland: '🇫🇮', Iceland: '🇮🇸', 'North Macedonia': '🇲🇰',
  Albania: '🇦🇱', Georgia: '🇬🇪', Bosnia: '🇧🇦', 'Bosnia and Herzegovina': '🇧🇦',
  Peru: '🇵🇪', Venezuela: '🇻🇪', Bolivia: '🇧🇴', 'Costa Rica': '🇨🇷', Jamaica: '🇯🇲',
  Honduras: '🇭🇳', Panama: '🇵🇦', Canada: '🇨🇦', Australia: '🇦🇺', 'New Zealand': '🇳🇿',
  Egypt: '🇪🇬', Tunisia: '🇹🇳', 'South Africa': '🇿🇦', 'Cape Verde': '🇨🇻',
  'DR Congo': '🇨🇩', 'Democratic Republic of the Congo': '🇨🇩', Mali: '🇲🇱',
  Guinea: '🇬🇳', 'Burkina Faso': '🇧🇫', Zambia: '🇿🇲', Israel: '🇮🇱',
  'Saudi Arabia': '🇸🇦', 'United Arab Emirates': '🇦🇪', Qatar: '🇶🇦', Iran: '🇮🇷',
  China: '🇨🇳', 'United Kingdom': '🇬🇧', Bulgaria: '🇧🇬', Belarus: '🇧🇾',
  Kosovo: '🇽🇰', Montenegro: '🇲🇪', Moldova: '🇲🇩', Cyprus: '🇨🇾', Latvia: '🇱🇻',
  Lithuania: '🇱🇹', Estonia: '🇪🇪', Luxembourg: '🇱🇺', Armenia: '🇦🇲',
  Azerbaijan: '🇦🇿', Kazakhstan: '🇰🇿', Uzbekistan: '🇺🇿', 'Cape Verde Islands': '🇨🇻',
  Angola: '🇦🇴', Mozambique: '🇲🇿', Kenya: '🇰🇪', Uganda: '🇺🇬', Zimbabwe: '🇿🇼',
  Gabon: '🇬🇦', Congo: '🇨🇬', Benin: '🇧🇯', Togo: '🇹🇬', Niger: '🇳🇪',
  'Guinea-Bissau': '🇬🇼', Gambia: '🇬🇲', 'Sierra Leone': '🇸🇱',
  Liberia: '🇱🇷', Ethiopia: '🇪🇹', Sudan: '🇸🇩', Libya: '🇱🇾', Tanzania: '🇹🇿',
  Singapore: '🇸🇬', Thailand: '🇹🇭', Vietnam: '🇻🇳', Indonesia: '🇮🇩',
  Malaysia: '🇲🇾', India: '🇮🇳', Iraq: '🇮🇶', Jordan: '🇯🇴', Lebanon: '🇱🇧',
  Syria: '🇸🇾', Kuwait: '🇰🇼', Oman: '🇴🇲', Bahrain: '🇧🇭', 'Costa de Marfil': '🇨🇮',
  Guyana: '🇬🇾', Suriname: '🇸🇷', Haiti: '🇭🇹', Cuba: '🇨🇺',
  'Trinidad and Tobago': '🇹🇹', Guatemala: '🇬🇹', 'El Salvador': '🇸🇻',
  Nicaragua: '🇳🇮', 'Dominican Republic': '🇩🇴', 'Puerto Rico': '🇵🇷',
};

export function countryFlag(name: string): string {
  return FLAGS[name] ?? '';
}

const CLUB_POPULAR = 14;
const CLUB_WIDER = 33;
const COUNTRY_POPULAR = 10;
const COUNTRY_WIDER = 21;

export function buildCategories(index: Index): GridCategory[] {
  const out: GridCategory[] = [];
  const seenNames = new Set<string>();

  const addUnique = (cat: GridCategory) => {
    const key = `${cat.type}:${cat.name}`;
    if (seenNames.has(key) || cat.players.size === 0) return;
    seenNames.add(key);
    out.push(cat);
  };

  index.clubsRanked.slice(0, CLUB_POPULAR + CLUB_WIDER).forEach((club, i) => {
    addUnique({
      id: `club:${club}`,
      name: shortClubName(club),
      type: i < CLUB_POPULAR ? 'club' : 'club2',
      players: index.clubPlayers.get(club) ?? new Set(),
    });
  });

  index.countriesRanked
    .slice(0, COUNTRY_POPULAR + COUNTRY_WIDER)
    .forEach((country, i) => {
      addUnique({
        id: `country:${country}`,
        name: country,
        type: i < COUNTRY_POPULAR ? 'country' : 'country2',
        flag: countryFlag(country),
        players: index.countryPlayers.get(country) ?? new Set(),
      });
    });

  return out;
}
