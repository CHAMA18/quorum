/**
 * The country register behind the organization door.
 *
 * Every UN member state plus the one non-member observer (Palestine) —
 * 194 entries — with ISO 3166-1 alpha-2 codes and international dial
 * codes. The dropdown search matches name, code, dial digits and the
 * keyword line (common alternative spellings), so "USA", "UK",
 * "Ivory Coast" or "+254" all resolve.
 *
 * `registrar` names the authority that issues company registration
 * numbers in that jurisdiction; the wizard surfaces it as a live hint
 * under the registration-number field. Optional — jurisdictions without
 * an entry fall back to the generic line.
 */

export type Country = {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  dial: string;
  keywords?: string;
  registrar?: string;
};

export const SUGGESTED_COUNTRIES = [
  "Zambia",
  "Kenya",
  "Rwanda",
  "Tanzania",
  "Uganda",
  "South Africa",
  "Malawi",
  "Zimbabwe",
  "Botswana",
  "Nigeria",
  "Ghana",
  "Egypt",
] as const;

export const COUNTRIES: Country[] = [
  { code: "AF", name: "Afghanistan", dial: "+93" },
  { code: "AL", name: "Albania", dial: "+355" },
  { code: "DZ", name: "Algeria", dial: "+213" },
  { code: "AD", name: "Andorra", dial: "+376" },
  { code: "AO", name: "Angola", dial: "+244", registrar: "the Guichet Único da Empresa" },
  { code: "AG", name: "Antigua and Barbuda", dial: "+1268" },
  { code: "AR", name: "Argentina", dial: "+54" },
  { code: "AM", name: "Armenia", dial: "+374" },
  { code: "AU", name: "Australia", dial: "+61", registrar: "ASIC — Australian Securities and Investments Commission" },
  { code: "AT", name: "Austria", dial: "+43" },
  { code: "AZ", name: "Azerbaijan", dial: "+994" },
  { code: "BS", name: "Bahamas", dial: "+1242" },
  { code: "BH", name: "Bahrain", dial: "+973" },
  { code: "BD", name: "Bangladesh", dial: "+880", registrar: "RJSC — Registrar of Joint Stock Companies" },
  { code: "BB", name: "Barbados", dial: "+1246" },
  { code: "BY", name: "Belarus", dial: "+375" },
  { code: "BE", name: "Belgium", dial: "+32" },
  { code: "BZ", name: "Belize", dial: "+501" },
  { code: "BJ", name: "Benin", dial: "+229" },
  { code: "BT", name: "Bhutan", dial: "+975" },
  { code: "BO", name: "Bolivia", dial: "+591", keywords: "Plurinational State of Bolivia" },
  { code: "BA", name: "Bosnia and Herzegovina", dial: "+387" },
  { code: "BW", name: "Botswana", dial: "+267", registrar: "the Registrar of Companies (ROCIP)" },
  { code: "BR", name: "Brazil", dial: "+55" },
  { code: "BN", name: "Brunei", dial: "+673", keywords: "Brunei Darussalam" },
  { code: "BG", name: "Bulgaria", dial: "+359" },
  { code: "BF", name: "Burkina Faso", dial: "+226" },
  { code: "BI", name: "Burundi", dial: "+257" },
  { code: "CV", name: "Cabo Verde", dial: "+238", keywords: "Cape Verde" },
  { code: "KH", name: "Cambodia", dial: "+855" },
  { code: "CM", name: "Cameroon", dial: "+237", registrar: "the RCCM (Commercial Register)" },
  { code: "CA", name: "Canada", dial: "+1", registrar: "the provincial or territorial corporate registry" },
  { code: "CF", name: "Central African Republic", dial: "+236" },
  { code: "TD", name: "Chad", dial: "+235" },
  { code: "CL", name: "Chile", dial: "+56" },
  { code: "CN", name: "China", dial: "+86", registrar: "SAMR — State Administration for Market Regulation" },
  { code: "CO", name: "Colombia", dial: "+57" },
  { code: "KM", name: "Comoros", dial: "+269" },
  { code: "CG", name: "Congo (Republic)", dial: "+242", keywords: "Congo-Brazzaville Republic of the Congo" },
  { code: "CD", name: "Congo (Democratic Republic)", dial: "+243", keywords: "DRC Congo-Kinshasa Zaire Democratic Republic of the Congo", registrar: "the RCCM (Commercial Court)" },
  { code: "CR", name: "Costa Rica", dial: "+506" },
  { code: "CI", name: "Côte d'Ivoire", dial: "+225", keywords: "Ivory Coast" },
  { code: "HR", name: "Croatia", dial: "+385" },
  { code: "CU", name: "Cuba", dial: "+53" },
  { code: "CY", name: "Cyprus", dial: "+357" },
  { code: "CZ", name: "Czechia", dial: "+420", keywords: "Czech Republic" },
  { code: "DK", name: "Denmark", dial: "+45" },
  { code: "DJ", name: "Djibouti", dial: "+253" },
  { code: "DM", name: "Dominica", dial: "+1767" },
  { code: "DO", name: "Dominican Republic", dial: "+1809" },
  { code: "EC", name: "Ecuador", dial: "+593" },
  { code: "EG", name: "Egypt", dial: "+20", registrar: "GAFI — General Authority for Investment and Free Zones" },
  { code: "SV", name: "El Salvador", dial: "+503" },
  { code: "GQ", name: "Equatorial Guinea", dial: "+240" },
  { code: "ER", name: "Eritrea", dial: "+291" },
  { code: "EE", name: "Estonia", dial: "+372" },
  { code: "SZ", name: "Eswatini", dial: "+268", keywords: "Swaziland" },
  { code: "ET", name: "Ethiopia", dial: "+251", registrar: "the Ministry of Trade and Regional Integration" },
  { code: "FJ", name: "Fiji", dial: "+679" },
  { code: "FI", name: "Finland", dial: "+358" },
  { code: "FR", name: "France", dial: "+33", registrar: "the INPI (Registre national des entreprises)" },
  { code: "GA", name: "Gabon", dial: "+241" },
  { code: "GM", name: "Gambia", dial: "+220" },
  { code: "GE", name: "Georgia", dial: "+995" },
  { code: "DE", name: "Germany", dial: "+49", registrar: "the Handelsregister" },
  { code: "GH", name: "Ghana", dial: "+233", registrar: "the Registrar-General's Department" },
  { code: "GR", name: "Greece", dial: "+30" },
  { code: "GD", name: "Grenada", dial: "+1473" },
  { code: "GT", name: "Guatemala", dial: "+502" },
  { code: "GN", name: "Guinea", dial: "+224" },
  { code: "GW", name: "Guinea-Bissau", dial: "+245" },
  { code: "GY", name: "Guyana", dial: "+592" },
  { code: "HT", name: "Haiti", dial: "+509" },
  { code: "HN", name: "Honduras", dial: "+504" },
  { code: "HU", name: "Hungary", dial: "+36" },
  { code: "IS", name: "Iceland", dial: "+354" },
  { code: "IN", name: "India", dial: "+91", registrar: "the Ministry of Corporate Affairs (MCA)" },
  { code: "ID", name: "Indonesia", dial: "+62" },
  { code: "IR", name: "Iran", dial: "+98", keywords: "Islamic Republic of Iran" },
  { code: "IQ", name: "Iraq", dial: "+964" },
  { code: "IE", name: "Ireland", dial: "+353", registrar: "CRO — Companies Registration Office" },
  { code: "IL", name: "Israel", dial: "+972" },
  { code: "IT", name: "Italy", dial: "+39" },
  { code: "JM", name: "Jamaica", dial: "+1876" },
  { code: "JP", name: "Japan", dial: "+81" },
  { code: "JO", name: "Jordan", dial: "+962" },
  { code: "KZ", name: "Kazakhstan", dial: "+7" },
  { code: "KE", name: "Kenya", dial: "+254", registrar: "the Business Registration Service (BRS)" },
  { code: "KI", name: "Kiribati", dial: "+686" },
  { code: "KW", name: "Kuwait", dial: "+965" },
  { code: "KG", name: "Kyrgyzstan", dial: "+996" },
  { code: "LA", name: "Laos", dial: "+856", keywords: "Lao PDR Lao People's Democratic Republic" },
  { code: "LV", name: "Latvia", dial: "+371" },
  { code: "LB", name: "Lebanon", dial: "+961" },
  { code: "LS", name: "Lesotho", dial: "+266" },
  { code: "LR", name: "Liberia", dial: "+231" },
  { code: "LY", name: "Libya", dial: "+218" },
  { code: "LI", name: "Liechtenstein", dial: "+423" },
  { code: "LT", name: "Lithuania", dial: "+370" },
  { code: "LU", name: "Luxembourg", dial: "+352" },
  { code: "MG", name: "Madagascar", dial: "+261" },
  { code: "MW", name: "Malawi", dial: "+265", registrar: "the Registrar General" },
  { code: "MY", name: "Malaysia", dial: "+60" },
  { code: "MV", name: "Maldives", dial: "+960" },
  { code: "ML", name: "Mali", dial: "+223" },
  { code: "MT", name: "Malta", dial: "+356" },
  { code: "MH", name: "Marshall Islands", dial: "+692" },
  { code: "MR", name: "Mauritania", dial: "+222" },
  { code: "MU", name: "Mauritius", dial: "+230" },
  { code: "MX", name: "Mexico", dial: "+52" },
  { code: "FM", name: "Micronesia", dial: "+691", keywords: "Federated States of Micronesia FSM" },
  { code: "MD", name: "Moldova", dial: "+373", keywords: "Republic of Moldova" },
  { code: "MC", name: "Monaco", dial: "+377" },
  { code: "MN", name: "Mongolia", dial: "+976" },
  { code: "ME", name: "Montenegro", dial: "+382" },
  { code: "MA", name: "Morocco", dial: "+212" },
  { code: "MZ", name: "Mozambique", dial: "+258", registrar: "the Conservatória das Entidades Legais" },
  { code: "MM", name: "Myanmar", dial: "+95", keywords: "Burma" },
  { code: "NA", name: "Namibia", dial: "+264", registrar: "BIPA — Business and Intellectual Property Authority" },
  { code: "NR", name: "Nauru", dial: "+674" },
  { code: "NP", name: "Nepal", dial: "+977" },
  { code: "NL", name: "Netherlands", dial: "+31", registrar: "KVK — Chamber of Commerce" },
  { code: "NZ", name: "New Zealand", dial: "+64" },
  { code: "NI", name: "Nicaragua", dial: "+505" },
  { code: "NE", name: "Niger", dial: "+227" },
  { code: "NG", name: "Nigeria", dial: "+234", registrar: "CAC — Corporate Affairs Commission" },
  { code: "KP", name: "North Korea", dial: "+850", keywords: "DPRK Democratic People's Republic of Korea" },
  { code: "MK", name: "North Macedonia", dial: "+389", keywords: "Macedonia" },
  { code: "NO", name: "Norway", dial: "+47" },
  { code: "OM", name: "Oman", dial: "+968" },
  { code: "PK", name: "Pakistan", dial: "+92", registrar: "SECP — Securities and Exchange Commission" },
  { code: "PW", name: "Palau", dial: "+680" },
  { code: "PS", name: "Palestine", dial: "+970", keywords: "State of Palestine" },
  { code: "PA", name: "Panama", dial: "+507" },
  { code: "PG", name: "Papua New Guinea", dial: "+675" },
  { code: "PY", name: "Paraguay", dial: "+595" },
  { code: "PE", name: "Peru", dial: "+51" },
  { code: "PH", name: "Philippines", dial: "+63" },
  { code: "PL", name: "Poland", dial: "+48" },
  { code: "PT", name: "Portugal", dial: "+351" },
  { code: "QA", name: "Qatar", dial: "+974" },
  { code: "RO", name: "Romania", dial: "+40" },
  { code: "RU", name: "Russia", dial: "+7", keywords: "Russian Federation" },
  { code: "RW", name: "Rwanda", dial: "+250", registrar: "the Rwanda Development Board (RDB)" },
  { code: "KN", name: "Saint Kitts and Nevis", dial: "+1869" },
  { code: "LC", name: "Saint Lucia", dial: "+1758" },
  { code: "VC", name: "Saint Vincent and the Grenadines", dial: "+1784" },
  { code: "WS", name: "Samoa", dial: "+685" },
  { code: "SM", name: "San Marino", dial: "+378" },
  { code: "ST", name: "Sao Tome and Principe", dial: "+239" },
  { code: "SA", name: "Saudi Arabia", dial: "+966", registrar: "the Ministry of Commerce" },
  { code: "SN", name: "Senegal", dial: "+221" },
  { code: "RS", name: "Serbia", dial: "+381" },
  { code: "SC", name: "Seychelles", dial: "+248" },
  { code: "SL", name: "Sierra Leone", dial: "+232" },
  { code: "SG", name: "Singapore", dial: "+65", registrar: "ACRA" },
  { code: "SK", name: "Slovakia", dial: "+421" },
  { code: "SI", name: "Slovenia", dial: "+386" },
  { code: "SB", name: "Solomon Islands", dial: "+677" },
  { code: "SO", name: "Somalia", dial: "+252" },
  { code: "ZA", name: "South Africa", dial: "+27", registrar: "CIPC — Companies and Intellectual Property Commission" },
  { code: "KR", name: "South Korea", dial: "+82", keywords: "Korea Republic of Korea" },
  { code: "SS", name: "South Sudan", dial: "+211" },
  { code: "ES", name: "Spain", dial: "+34" },
  { code: "LK", name: "Sri Lanka", dial: "+94" },
  { code: "SD", name: "Sudan", dial: "+249" },
  { code: "SR", name: "Suriname", dial: "+597" },
  { code: "SE", name: "Sweden", dial: "+46" },
  { code: "CH", name: "Switzerland", dial: "+41" },
  { code: "SY", name: "Syria", dial: "+963", keywords: "Syrian Arab Republic" },
  { code: "TJ", name: "Tajikistan", dial: "+992" },
  { code: "TZ", name: "Tanzania", dial: "+255", keywords: "United Republic of Tanzania", registrar: "BRELA — Business Registrations and Licensing Agency" },
  { code: "TH", name: "Thailand", dial: "+66" },
  { code: "TL", name: "Timor-Leste", dial: "+670", keywords: "East Timor" },
  { code: "TG", name: "Togo", dial: "+228" },
  { code: "TO", name: "Tonga", dial: "+676" },
  { code: "TT", name: "Trinidad and Tobago", dial: "+1868" },
  { code: "TN", name: "Tunisia", dial: "+216" },
  { code: "TR", name: "Türkiye", dial: "+90", keywords: "Turkey" },
  { code: "TM", name: "Turkmenistan", dial: "+993" },
  { code: "TV", name: "Tuvalu", dial: "+688" },
  { code: "UG", name: "Uganda", dial: "+256", registrar: "URSB — Uganda Registration Services Bureau" },
  { code: "UA", name: "Ukraine", dial: "+380" },
  { code: "AE", name: "United Arab Emirates", dial: "+971", keywords: "UAE Emirates", registrar: "the DED or the relevant free-zone authority" },
  { code: "GB", name: "United Kingdom", dial: "+44", keywords: "UK Great Britain England Britain", registrar: "Companies House" },
  { code: "US", name: "United States", dial: "+1", keywords: "USA America United States of America", registrar: "the Secretary of State of the state of incorporation" },
  { code: "UY", name: "Uruguay", dial: "+598" },
  { code: "UZ", name: "Uzbekistan", dial: "+998" },
  { code: "VU", name: "Vanuatu", dial: "+678" },
  { code: "VE", name: "Venezuela", dial: "+58", keywords: "Bolivarian Republic of Venezuela" },
  { code: "VN", name: "Vietnam", dial: "+84", keywords: "Viet Nam" },
  { code: "YE", name: "Yemen", dial: "+967" },
  { code: "ZM", name: "Zambia", dial: "+260", registrar: "PACRA — Patents and Companies Registration Agency" },
  { code: "ZW", name: "Zimbabwe", dial: "+263", registrar: "the Registrar of Companies" },
];

/* ── Lookups ─────────────────────────────────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[.(),'’-]/g, " ").replace(/\s+/g, " ").trim();

const BY_NAME = new Map<string, Country>();
for (const c of COUNTRIES) {
  BY_NAME.set(norm(c.name), c);
  if (c.keywords) {
    for (const k of c.keywords.split(/\s{2,}|,\s*/)) BY_NAME.set(norm(k), c);
  }
}

/** Resolve a country from free text — tolerant of case, punctuation and the common aliases ("USA", "UK", "Ivory Coast"). */
export function findCountry(name: string): Country | undefined {
  const n = norm(name);
  if (!n) return undefined;
  return BY_NAME.get(n);
}

/** Dial code for a country name, if it resolves. */
export function dialFor(name: string): string | undefined {
  return findCountry(name)?.dial;
}

/** Registrar line for a country name, if one is known. */
export function registrarFor(name: string): string | undefined {
  return findCountry(name)?.registrar;
}
