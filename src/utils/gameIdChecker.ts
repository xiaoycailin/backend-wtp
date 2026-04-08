/**
 * Game ID Checker — validates player IDs by querying the Codashop
 * initPayment API. No API key required, no external dependencies.
 *
 * Sources for pricePointId / voucherTypeName:
 *  - https://github.com/triyatna/php-valid-game  (GameRegistry.php)
 *  - https://github.com/karyanayandi/check-ign    (check-ign npm)
 *  - Codashop Indonesia __NUXT_DATA__              (scraped April 2026)
 *
 * Total supported: 36 games
 */

export type GameCode =
  // ── Popular / Mainstream ──
  | "mobile-legends"
  | "free-fire"
  | "free-fire-max"
  | "codm"
  | "genshin-impact"
  | "honkai-star-rail"
  | "honkai-impact-3"
  | "zenless-zone-zero"
  | "valorant"
  | "arena-of-valor"
  // ── Shooter / Battle Royale ──
  | "blood-strike"
  | "undawn"
  // ── MOBA / Competitive ──
  | "league-of-legends"
  | "league-of-legends-wild-rift"
  | "onmyoji-arena"
  | "magic-chess"
  // ── RPG / Anime ──
  | "love-and-deepspace"
  | "aether-gazer"
  | "punishing-gray-raven"
  | "identity-v"
  | "revelation-infinite-journey"
  // ── Casual / Party ──
  | "stumble-guys"
  | "eggy-party"
  | "sausage-man"
  | "super-sus"
  | "tom-and-jerry-chase"
  // ── Racing / Sports ──
  | "speed-drifters"
  | "racing-master"
  | "ea-sports-fc-mobile"
  // ── Social / Misc ──
  | "8-ball-pool"
  | "point-blank"
  | "hago"
  | "dragon-city"
  | "auto-chess"
  | "mahjong-soul"
  | "zepeto"
  // ── Legacy (server-based) ──
  | "azur-lane"
  | "basketrio"
  | "badlanders"
  | "barbarq";

export interface GameCheckInput {
  game: GameCode;
  userId: string;
  zoneId?: string;
}

export interface GameCheckResult {
  success: boolean;
  game: string;
  username: string;
  userId: string;
  zoneId?: string;
}

interface GameConfig {
  label: string;
  voucherTypeName: string;
  pricePointId: string;
  price: string;
  requiresZone: boolean;
  autoZone?: boolean;
  extraParams?: string;
  nicknameFrom?: "username" | "roles" | "apiResult";
  serverMap?: Record<string, string>;
}

const CODASHOP_ENDPOINT = "https://order-sg.codashop.com/initPayment.action";

const GAME_CONFIGS: Record<GameCode, GameConfig> = {
  // ═══════════════════ POPULAR / MAINSTREAM ═══════════════════

  "mobile-legends": {
    label: "Mobile Legends",
    voucherTypeName: "MOBILE_LEGENDS",
    pricePointId: "5199",
    price: "68543.0",
    requiresZone: true,
  },
  "free-fire": {
    label: "Free Fire",
    voucherTypeName: "FREEFIRE",
    pricePointId: "270288",
    price: "200000.0",
    requiresZone: false,
    nicknameFrom: "roles",
  },
  "free-fire-max": {
    label: "Free Fire MAX",
    voucherTypeName: "FREEFIRE",
    pricePointId: "270288",
    price: "200000.0",
    requiresZone: false,
    nicknameFrom: "roles",
  },
  codm: {
    label: "Call of Duty Mobile",
    voucherTypeName: "CALL_OF_DUTY",
    pricePointId: "270251",
    price: "20000.0",
    requiresZone: false,
    nicknameFrom: "roles",
  },
  "genshin-impact": {
    label: "Genshin Impact",
    voucherTypeName: "GENSHIN_IMPACT",
    pricePointId: "338498",
    price: "16500.0",
    requiresZone: false,
    autoZone: true,
  },
  "honkai-star-rail": {
    label: "Honkai Star Rail",
    voucherTypeName: "HONKAI_STAR_RAIL",
    pricePointId: "762498",
    price: "16500.0",
    requiresZone: false,
    autoZone: true,
  },
  "honkai-impact-3": {
    label: "Honkai Impact 3",
    voucherTypeName: "HONKAI_IMPACT",
    pricePointId: "7628",
    price: "7297.0",
    requiresZone: false,
  },
  "zenless-zone-zero": {
    label: "Zenless Zone Zero",
    voucherTypeName: "ZENLESS_ZONE_ZERO",
    pricePointId: "1044968",
    price: "16500.0",
    requiresZone: false,
    autoZone: true,
  },
  valorant: {
    label: "Valorant",
    voucherTypeName: "VALORANT",
    pricePointId: "950525",
    price: "75000.0",
    requiresZone: false,
  },
  "arena-of-valor": {
    label: "Arena of Valor",
    voucherTypeName: "AOV",
    pricePointId: "270294",
    price: "10000.0",
    requiresZone: false,
    nicknameFrom: "roles",
  },

  // ═══════════════════ SHOOTER / BATTLE ROYALE ═══════════════════

  "blood-strike": {
    label: "Blood Strike",
    voucherTypeName: "BLOOD_STRIKE",
    pricePointId: "115881",
    price: "12613.0",
    requiresZone: true,
  },
  undawn: {
    label: "Undawn",
    voucherTypeName: "UNDAWN",
    pricePointId: "866324",
    price: "15000.0",
    requiresZone: false,
  },

  // ═══════════════════ MOBA / COMPETITIVE ═══════════════════

  "league-of-legends": {
    label: "League of Legends",
    voucherTypeName: "LEAGUE_OF_LEGENDS",
    pricePointId: "215",
    price: "60000.0",
    requiresZone: false,
  },
  "league-of-legends-wild-rift": {
    label: "League of Legends: Wild Rift",
    voucherTypeName: "WILD_RIFT",
    pricePointId: "221",
    price: "56000.0",
    requiresZone: false,
  },
  "onmyoji-arena": {
    label: "Onmyoji Arena",
    voucherTypeName: "ONMYOJI_ARENA",
    pricePointId: "46417",
    price: "13514.0",
    requiresZone: false,
  },
  "magic-chess": {
    label: "Magic Chess: Go Go",
    voucherTypeName: "106-MAGIC_CHESS",
    pricePointId: "238",
    price: "1582.0",
    requiresZone: true,
  },

  // ═══════════════════ RPG / ANIME ═══════════════════

  "love-and-deepspace": {
    label: "Love and Deepspace",
    voucherTypeName: "INFOLD_GAMES-LOVE_AND_DEEPSPACE",
    pricePointId: "217",
    price: "19000.0",
    requiresZone: false,
  },
  "aether-gazer": {
    label: "Aether Gazer",
    voucherTypeName: "547-AETHER_GAZER",
    pricePointId: "2",
    price: "16650.0",
    requiresZone: false,
    extraParams: "voucherTypeId=524&gvtId=691&lvtId=11840&pcId=906",
  },
  "punishing-gray-raven": {
    label: "Punishing Gray Raven",
    voucherTypeName: "PUNISHING_GRAY_RAVEN",
    pricePointId: "259947",
    price: "15136.0",
    requiresZone: true,
    serverMap: { ap: "5000", eu: "5001", na: "5002" },
  },
  "identity-v": {
    label: "Identity V",
    voucherTypeName: "IDENTITY_V",
    pricePointId: "8047",
    price: "15000.0",
    requiresZone: true,
  },
  "revelation-infinite-journey": {
    label: "Revelation: Infinite Journey",
    voucherTypeName: "VNG_REVEALATION",
    pricePointId: "48727",
    price: "9009.0",
    requiresZone: false,
  },

  // ═══════════════════ CASUAL / PARTY ═══════════════════

  "stumble-guys": {
    label: "Stumble Guys",
    voucherTypeName: "STUMBLE_GUYS",
    pricePointId: "425",
    price: "12000.0",
    requiresZone: false,
  },
  "eggy-party": {
    label: "Eggy Party",
    voucherTypeName: "EGGY_PARTY",
    pricePointId: "880500",
    price: "1982.0",
    requiresZone: true,
  },
  "sausage-man": {
    label: "Sausage Man",
    voucherTypeName: "SAUSAGE_MAN",
    pricePointId: "256513",
    price: "16000.0",
    requiresZone: false,
  },
  "super-sus": {
    label: "Super SUS",
    voucherTypeName: "SUPER_SUS",
    pricePointId: "266077",
    price: "13000.0",
    requiresZone: false,
  },
  "tom-and-jerry-chase": {
    label: "Tom and Jerry: Chase",
    voucherTypeName: "TOM_JERRY_CHASE",
    pricePointId: "89713",
    price: "15000.0",
    requiresZone: true,
  },

  // ═══════════════════ RACING / SPORTS ═══════════════════

  "speed-drifters": {
    label: "Speed Drifters",
    voucherTypeName: "SPEEDDRIFTERS",
    pricePointId: "12776",
    price: "10000.0",
    requiresZone: false,
  },
  "racing-master": {
    label: "Racing Master",
    voucherTypeName: "473-RACING_MASTER",
    pricePointId: "167",
    price: "16000.0",
    requiresZone: true,
  },
  "ea-sports-fc-mobile": {
    label: "EA SPORTS FC Mobile",
    voucherTypeName: "FC_MOBILE",
    pricePointId: "344",
    price: "6500.0",
    requiresZone: false,
  },

  // ═══════════════════ SOCIAL / MISC ═══════════════════

  "8-ball-pool": {
    label: "8 Ball Pool",
    voucherTypeName: "EIGHT_BALL_POOL",
    pricePointId: "272564",
    price: "14000.0",
    requiresZone: false,
    nicknameFrom: "roles",
  },
  "point-blank": {
    label: "Point Blank",
    voucherTypeName: "POINT_BLANK",
    pricePointId: "344845",
    price: "11000.0",
    requiresZone: false,
  },
  hago: {
    label: "Hago",
    voucherTypeName: "HAGO",
    pricePointId: "272113",
    price: "29700.0",
    requiresZone: false,
  },
  "dragon-city": {
    label: "Dragon City",
    voucherTypeName: "DRAGON_CITY",
    pricePointId: "254206",
    price: "65000.0",
    requiresZone: false,
  },
  "auto-chess": {
    label: "Auto Chess",
    voucherTypeName: "AUTO_CHESS",
    pricePointId: "203879",
    price: "150000.0",
    requiresZone: false,
  },
  "mahjong-soul": {
    label: "Mahjong Soul",
    voucherTypeName: "MAHJONG_SOUL",
    pricePointId: "274",
    price: "14000.0",
    requiresZone: false,
  },
  zepeto: {
    label: "ZEPETO",
    voucherTypeName: "NAVER_Z_CORPORATION",
    pricePointId: "424",
    price: "8500.0",
    requiresZone: false,
  },

  // ═══════════════════ LEGACY (SERVER-BASED) ═══════════════════

  "azur-lane": {
    label: "Azur Lane",
    voucherTypeName: "AZUR_LANE",
    pricePointId: "99665",
    price: "70000.0",
    requiresZone: true,
    serverMap: {
      avrora: "1",
      lexington: "2",
      sandy: "3",
      washington: "4",
      amagi: "5",
      littleenterprise: "6",
    },
  },
  basketrio: {
    label: "Basketrio",
    voucherTypeName: "BASKETRIO",
    pricePointId: "147203",
    price: "832500.0",
    requiresZone: true,
    serverMap: { buzzerbeater: "2", "001": "3", "002": "4" },
  },
  badlanders: {
    label: "Badlanders",
    voucherTypeName: "BAD_LANDERS",
    pricePointId: "333121",
    price: "2300.0",
    requiresZone: true,
    serverMap: { global: "11001", jf: "21004" },
  },
  barbarq: {
    label: "BarbarQ",
    voucherTypeName: "ELECSOUL",
    pricePointId: "5145",
    price: "120000.0",
    requiresZone: false,
    nicknameFrom: "apiResult",
  },
};

// ═══════════════════ AUTO-ZONE DETECTION ═══════════════════

const PREFIX_ZONE_MAP: Record<string, Record<string, string>> = {
  "genshin-impact": {
    "6": "os_usa",
    "7": "os_euro",
    "8": "os_asia",
    "9": "os_cht",
  },
  "honkai-star-rail": {
    "6": "prod_official_usa",
    "7": "prod_official_eur",
    "8": "prod_official_asia",
    "9": "prod_official_cht",
  },
  "zenless-zone-zero": {
    "6": "prod_gf_us",
    "7": "prod_gf_eu",
    "8": "prod_gf_jp",
    "9": "prod_gf_sg",
  },
};

function detectAutoZone(game: GameCode, userId: string): string {
  const map = PREFIX_ZONE_MAP[game];
  if (!map) {
    throw new Error(`Auto-zone not configured for ${game}`);
  }

  const prefix = userId.charAt(0);
  const zone = map[prefix];

  if (!zone) {
    const config = GAME_CONFIGS[game];
    throw new Error(
      `Invalid ${config.label} ID prefix "${prefix}". Must start with ${Object.keys(map).join(", ")}.`,
    );
  }

  return zone;
}

// ═══════════════════ HELPERS ═══════════════════

function sanitize(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\u002B/g, "%20"));
  } catch {
    return value;
  }
}

function resolveServer(config: GameConfig, zoneId: string): string {
  if (!config.serverMap) return zoneId;
  const normalized = zoneId.toLowerCase().replace(/\s+/g, "");
  return config.serverMap[normalized] ?? zoneId;
}

function extractUsername(data: any, config: GameConfig): string {
  const mode = config.nicknameFrom ?? "username";

  switch (mode) {
    case "roles":
      if (data.confirmationFields?.roles?.[0]?.role) {
        return sanitize(data.confirmationFields.roles[0].role);
      }
      if (data.confirmationFields?.username) {
        return sanitize(data.confirmationFields.username);
      }
      return "";

    case "apiResult":
      if (data.confirmationFields?.apiResult) {
        return sanitize(data.confirmationFields.apiResult);
      }
      return "";

    case "username":
    default:
      if (data.confirmationFields?.username) {
        return sanitize(data.confirmationFields.username);
      }
      if (data.confirmationFields?.roles?.[0]?.role) {
        return sanitize(data.confirmationFields.roles[0].role);
      }
      return "";
  }
}

// ═══════════════════ MAIN FUNCTIONS ═══════════════════

/**
 * Validate a game player ID and return the associated username.
 */
export async function checkGameId(
  input: GameCheckInput,
): Promise<GameCheckResult> {
  const config = GAME_CONFIGS[input.game];
  if (!config) {
    throw new Error(`Unsupported game: ${input.game}`);
  }

  let zoneId = input.zoneId ?? "";

  if (config.requiresZone && !config.autoZone && !zoneId) {
    const serverHint = config.serverMap
      ? ` Available servers: ${Object.keys(config.serverMap).join(", ")}`
      : "";
    throw new Error(`zoneId is required for ${config.label}.${serverHint}`);
  }

  if (config.autoZone) {
    zoneId = detectAutoZone(input.game, input.userId);
  }

  if (zoneId && config.serverMap) {
    zoneId = resolveServer(config, zoneId);
  }

  let body =
    `voucherPricePoint.id=${config.pricePointId}` +
    `&voucherPricePoint.price=${config.price}` +
    `&voucherPricePoint.variablePrice=0` +
    `&user.userId=${encodeURIComponent(input.userId)}` +
    `&voucherTypeName=${config.voucherTypeName}` +
    `&shopLang=id_ID`;

  if (zoneId) {
    body += `&user.zoneId=${encodeURIComponent(zoneId)}`;
  }

  if (config.extraParams) {
    body += `&${config.extraParams}`;
  }

  const response = await fetch(CODASHOP_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Codashop API returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error("Game ID not found or invalid.");
  }

  const username = extractUsername(data, config);

  return {
    success: true,
    game: data.confirmationFields?.productName ?? config.label,
    username,
    userId: data.user?.userId ?? input.userId,
    ...(zoneId ? { zoneId } : {}),
  };
}

/**
 * Return the list of supported games with codes, zone requirements,
 * and available server names.
 */
export function getSupportedGames() {
  return Object.entries(GAME_CONFIGS).map(([code, config]) => ({
    code,
    label: config.label,
    requiresZone: config.requiresZone,
    autoZone: config.autoZone ?? false,
    servers: config.serverMap ? Object.keys(config.serverMap) : undefined,
  }));
}
