function parseEnvCcList(): string[] | null {
  const raw = process.env.SOA_CC_RECIPIENTS;
  if (!raw) {
    return null;
  }
  const items = raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
  return items.length > 0 ? items : null;
}

const GLOBAL_CC = parseEnvCcList();

export const EMAIL_CONFIG = {
  get FALLBACK_EMAIL(): string {
    const val = process.env.SOA_FALLBACK_EMAIL;
    if (!val) {
      if (process.env.NODE_ENV === "test") {
        return "";
      }
      throw new Error("SOA_FALLBACK_EMAIL environment variable is required");
    }
    return val;
  },
  SHARED_MAILBOX: (() => {
    const val = process.env.AZURE_SHARED_MAILBOX;
    if (!val) {
      throw new Error("AZURE_SHARED_MAILBOX environment variable is required");
    }
    return val;
  })(),
  getCcRecipients(actingCode: string): string[] {
    if (GLOBAL_CC) {
      return GLOBAL_CC;
    }
    const DEFAULT_CC: Record<string, string[]> = {
      DIP: ["finance@tob-ins.com", "mkt.nonleasing@tob-ins.com"],
      DIG: [
        "finance@tob-ins.com",
        "mkt.nonleasing@tob-ins.com",
        "mkt.directgroup@tob-ins.com",
      ],
      DEFAULT: ["finance@tob-ins.com"],
    };
    return DEFAULT_CC[actingCode] || DEFAULT_CC.DEFAULT;
  },
} as const;
