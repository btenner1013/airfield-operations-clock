// Modular AHAS Bird Watch Condition (BWC) timestamp parsing and age calculation

export function parseAhasTimestampIso(raw: string | undefined | null, now: Date): string | null {
  if (!raw || raw === "—" || raw.trim() === "") return null;
  const clean = raw.trim();

  // A. Detect and parse compact AHAS format FIRST (DD/HHMMZ or HHMMZ)
  const m = clean.match(/^(?:(\d{2})\/)?(\d{2})(\d{2})Z?$/i);
  if (m) {
    const rawDay = m[1] ? Number(m[1]) : null;
    const hour = Number(m[2]);
    const min = Number(m[3]);

    // B. Validate boundaries
    if (hour < 0 || hour > 23 || min < 0 || min > 59) return null;
    if (rawDay !== null && (rawDay < 1 || rawDay > 31)) return null;

    let year = now.getUTCFullYear();
    let month = now.getUTCMonth();
    let day = rawDay !== null ? rawDay : now.getUTCDate();

    // C. Construct UTC Date
    let d = new Date(Date.UTC(year, month, day, hour, min));
    if (!Number.isFinite(d.getTime())) return null;

    // D. Month and year rollover logic
    if (rawDay !== null) {
      if (rawDay > now.getUTCDate() + 15) {
        month -= 1;
        if (month < 0) { month = 11; year -= 1; }
        d = new Date(Date.UTC(year, month, day, hour, min));
      } else if (rawDay < now.getUTCDate() - 15) {
        month += 1;
        if (month > 11) { month = 0; year += 1; }
        d = new Date(Date.UTC(year, month, day, hour, min));
      }
    } else {
      if (d.getTime() - now.getTime() > 60000) {
        d.setUTCDate(d.getUTCDate() - 1);
      }
    }

    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  // E. Fallback for explicit ISO-8601 strings (must contain T or ISO date structure)
  if (clean.includes("T") || /^\d{4}-\d{2}-\d{2}/.test(clean)) {
    const t = Date.parse(clean);
    if (!isNaN(t)) {
      const d = new Date(t);
      return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    }
  }

  return null;
}

export function calculateBirdObservationAge(bwcIso: string | null, now: Date): string {
  if (!bwcIso) return "";
  const bwcMs = Date.parse(bwcIso);
  if (!Number.isFinite(bwcMs)) return "";
  const diffMs = now.getTime() - bwcMs;
  if (diffMs < 0) {
    const futMin = Math.ceil(Math.abs(diffMs) / 60000);
    return `FUTURE OBS (+${futMin}M)`;
  }
  const elapsedMin = Math.floor(diffMs / 60000);
  if (elapsedMin === 0) return "0 MIN AGO";
  if (elapsedMin < 60) return `${elapsedMin} MIN AGO`;
  const h = Math.floor(elapsedMin / 60);
  const m = elapsedMin % 60;
  return `${h}H ${m}M AGO`;
}
