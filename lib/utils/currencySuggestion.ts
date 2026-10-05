import { isOfferedCurrency } from './currencies';
import { normalizeCurrency } from './currency';

/**
 * The currency of each country whose currency we offer (`CURRENCY_OPTIONS`),
 * by ISO 3166-1 alpha-2 code. USD's countries aren't listed: a country that
 * isn't here already comes out as USD.
 */
const CURRENCY_COUNTRIES: Record<string, string> = {
  EUR: `AT BE BG CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK
        AD AX BL GF GP MC ME MF MQ PM RE SM VA XK YT`,
  PLN: 'PL',
  BYN: 'BY',
  RUB: 'RU',
  GBP: 'GB GG IM JE',
  JPY: 'JP',
  CAD: 'CA',
  AUD: 'AU CC CX KI NF NR TV',
  CHF: 'CH LI',
  CNY: 'CN',
  INR: 'IN',
  BRL: 'BR',
  MXN: 'MX',
  KRW: 'KR',
  SEK: 'SE',
  NOK: 'NO SJ',
  DKK: 'DK FO GL',
  TRY: 'TR',
  ZAR: 'ZA',
  NZD: 'NZ CK NU PN TK',
  SGD: 'SG',
  HKD: 'HK',
};

/**
 * The IANA time zones of those countries. Browsers report some zones by an
 * older name (Chrome says `Asia/Calcutta` where Firefox says `Asia/Kolkata`),
 * so both are listed. Left out on purpose, so they suggest nothing: zones
 * where another currency is what's used (Büsingen, a German town that pays in
 * Swiss francs; Famagusta, for the north of Cyprus, which pays in lira), and
 * Simferopol, since whose it is is disputed.
 */
const COUNTRY_ZONES: Record<string, string> = {
  AT: 'Europe/Vienna',
  BE: 'Europe/Brussels',
  BG: 'Europe/Sofia',
  CY: 'Asia/Nicosia Europe/Nicosia',
  DE: 'Europe/Berlin',
  EE: 'Europe/Tallinn',
  ES: 'Europe/Madrid Africa/Ceuta Atlantic/Canary',
  FI: 'Europe/Helsinki',
  FR: 'Europe/Paris',
  GR: 'Europe/Athens',
  HR: 'Europe/Zagreb',
  IE: 'Europe/Dublin',
  IT: 'Europe/Rome',
  LT: 'Europe/Vilnius',
  LU: 'Europe/Luxembourg',
  LV: 'Europe/Riga',
  MT: 'Europe/Malta',
  NL: 'Europe/Amsterdam',
  PT: 'Europe/Lisbon Atlantic/Madeira Atlantic/Azores',
  SI: 'Europe/Ljubljana',
  SK: 'Europe/Bratislava',
  AD: 'Europe/Andorra',
  AX: 'Europe/Mariehamn',
  BL: 'America/St_Barthelemy',
  GF: 'America/Cayenne',
  GP: 'America/Guadeloupe',
  MC: 'Europe/Monaco',
  ME: 'Europe/Podgorica',
  MF: 'America/Marigot',
  MQ: 'America/Martinique',
  PM: 'America/Miquelon',
  RE: 'Indian/Reunion',
  SM: 'Europe/San_Marino',
  VA: 'Europe/Vatican',
  YT: 'Indian/Mayotte',
  PL: 'Europe/Warsaw',
  BY: 'Europe/Minsk',
  RU: `Europe/Moscow Europe/Kaliningrad Europe/Samara Europe/Volgograd Europe/Saratov
       Europe/Ulyanovsk Europe/Astrakhan Europe/Kirov Asia/Yekaterinburg Asia/Omsk
       Asia/Novosibirsk Asia/Barnaul Asia/Tomsk Asia/Novokuznetsk Asia/Krasnoyarsk
       Asia/Irkutsk Asia/Chita Asia/Yakutsk Asia/Khandyga Asia/Vladivostok Asia/Ust-Nera
       Asia/Magadan Asia/Sakhalin Asia/Srednekolymsk Asia/Kamchatka Asia/Anadyr`,
  GB: 'Europe/London Europe/Belfast',
  GG: 'Europe/Guernsey',
  IM: 'Europe/Isle_of_Man',
  JE: 'Europe/Jersey',
  JP: 'Asia/Tokyo',
  CA: `America/Toronto America/Montreal America/Vancouver America/Edmonton America/Winnipeg
       America/Regina America/Swift_Current America/Halifax America/Glace_Bay America/Moncton
       America/Goose_Bay America/St_Johns America/Iqaluit America/Pangnirtung
       America/Rankin_Inlet America/Resolute America/Cambridge_Bay America/Inuvik
       America/Yellowknife America/Whitehorse America/Dawson America/Dawson_Creek
       America/Fort_Nelson America/Creston America/Atikokan America/Coral_Harbour
       America/Blanc-Sablon America/Thunder_Bay America/Nipigon America/Rainy_River`,
  AU: `Australia/Sydney Australia/Melbourne Australia/Brisbane Australia/Perth
       Australia/Adelaide Australia/Hobart Australia/Darwin Australia/Lindeman
       Australia/Broken_Hill Australia/Lord_Howe Australia/Eucla Australia/Currie
       Antarctica/Macquarie`,
  CC: 'Indian/Cocos',
  CX: 'Indian/Christmas',
  KI: 'Pacific/Tarawa Pacific/Kanton Pacific/Enderbury Pacific/Kiritimati',
  NF: 'Pacific/Norfolk',
  NR: 'Pacific/Nauru',
  TV: 'Pacific/Funafuti',
  CH: 'Europe/Zurich',
  LI: 'Europe/Vaduz',
  CN: 'Asia/Shanghai Asia/Urumqi Asia/Chongqing Asia/Chungking Asia/Harbin Asia/Kashgar',
  IN: 'Asia/Kolkata Asia/Calcutta',
  BR: `America/Sao_Paulo America/Rio_Branco America/Porto_Acre America/Manaus
       America/Fortaleza America/Recife America/Bahia America/Belem America/Maceio
       America/Araguaina America/Cuiaba America/Campo_Grande America/Porto_Velho
       America/Boa_Vista America/Santarem America/Eirunepe America/Noronha`,
  MX: `America/Mexico_City America/Cancun America/Merida America/Monterrey
       America/Matamoros America/Chihuahua America/Ciudad_Juarez America/Ojinaga
       America/Mazatlan America/Bahia_Banderas America/Hermosillo America/Tijuana
       America/Ensenada America/Santa_Isabel`,
  KR: 'Asia/Seoul',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  SJ: 'Arctic/Longyearbyen Atlantic/Jan_Mayen',
  DK: 'Europe/Copenhagen',
  FO: 'Atlantic/Faroe Atlantic/Faeroe',
  GL: 'America/Nuuk America/Godthab America/Danmarkshavn America/Scoresbysund America/Thule',
  TR: 'Europe/Istanbul Asia/Istanbul',
  ZA: 'Africa/Johannesburg',
  NZ: 'Pacific/Auckland Pacific/Chatham',
  CK: 'Pacific/Rarotonga',
  NU: 'Pacific/Niue',
  PN: 'Pacific/Pitcairn',
  TK: 'Pacific/Fakaofo',
  SG: 'Asia/Singapore',
  HK: 'Asia/Hong_Kong',
};

const words = (list: string) => list.trim().split(/\s+/);

/** Country code → currency code. */
export const COUNTRY_CURRENCY: ReadonlyMap<string, string> = new Map(
  Object.entries(CURRENCY_COUNTRIES).flatMap(([currency, countries]) =>
    words(countries).map((country) => [country, currency] as const)
  )
);

/** Time zone → country code. */
export const ZONE_COUNTRY: ReadonlyMap<string, string> = new Map(
  Object.entries(COUNTRY_ZONES).flatMap(([country, zones]) =>
    words(zones).map((zone) => [zone, country] as const)
  )
);

/**
 * The IANA areas whose zones each name a place (`Europe/Kyiv`), unlike `UTC`
 * or `Etc/GMT+2`, which say nothing about where someone is.
 */
const PLACE_AREAS = new Set([
  'Africa',
  'America',
  'Antarctica',
  'Arctic',
  'Asia',
  'Atlantic',
  'Australia',
  'Europe',
  'Indian',
  'Pacific',
]);

/** The region subtag of a BCP 47 language tag (`en-GB` → `GB`), if it has one. */
function regionOf(language: string | null | undefined): string | undefined {
  if (!language) return undefined;
  try {
    return new Intl.Locale(language.trim()).region?.toUpperCase();
  } catch {
    return undefined; // not a well-formed tag
  }
}

/**
 * The currency to suggest to someone, from what their browser says about them:
 * its time zone, then the region of its language, then USD. Only a currency
 * the pickers offer (`CURRENCY_OPTIONS`) is ever suggested.
 *
 * The time zone goes first because it says where someone is, while a language
 * often doesn't (Russian is common in Belarus and Poland, English everywhere).
 * So a zone that names a place decides on its own: one in a country whose
 * currency we don't offer (`Europe/Kyiv`, `Asia/Dubai`) suggests USD rather
 * than whatever the language would. The language only decides when the zone
 * names no place: missing, `UTC` (a privacy-minded browser reports that), or
 * `Etc/…`. Only an explicit region counts: `pl` alone says nothing about
 * where someone is.
 */
export function suggestCurrency({
  timeZone,
  language,
}: {
  timeZone?: string | null;
  language?: string | null;
}): string {
  const zone = timeZone?.trim();
  if (zone) {
    const country = ZONE_COUNTRY.get(zone);
    if (country) return offered(COUNTRY_CURRENCY.get(country));
    const [area, place] = zone.split('/');
    if (place && PLACE_AREAS.has(area)) return 'USD';
  }
  const region = regionOf(language);
  return offered(region && COUNTRY_CURRENCY.get(region));
}

function offered(code: string | undefined): string {
  return code && isOfferedCurrency(code) ? code : 'USD';
}

/** What the browser says about where its user is, for `suggestCurrency`. */
export function browserCurrencySuggestion(): string {
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  const language = typeof navigator === 'undefined' ? undefined : navigator.language;
  return suggestCurrency({ timeZone, language });
}

/**
 * The currency the dashboard's one-time prompt should offer this user, or null
 * for no prompt. It's offered only to someone who hasn't answered it yet
 * (`currencyChosen`, from `User.currencyChosenAt`) and is still on the USD
 * every account starts on, and only when the suggestion is something else: a
 * prompt offering the USD they already have would ask nothing.
 */
export function currencyToOffer(
  user: { defaultCurrency?: string | null; currencyChosen?: boolean } | null | undefined,
  suggestion: string | null
): string | null {
  if (!user || user.currencyChosen) return null;
  const current = normalizeCurrency(user.defaultCurrency);
  if (current !== 'USD') return null;
  if (!suggestion || suggestion === 'USD' || !isOfferedCurrency(suggestion)) return null;
  return suggestion;
}
