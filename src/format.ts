// src/format.ts
// Shared pure number formatter. Comma separators below 10K keep small values
// exact; from 10K up the value rides the config suffix ladder with two
// decimals trimmed. A displayed value that would round up to "1000<suffix>"
// climbs one tier instead, so "1000K" never renders. Past the top suffix it
// degrades to scientific notation.

import Config from "./config";

export const Format = {
  commas(intStr: string): string {
    return intStr.replace(/\B(?=(\d{3})+$)/g, ",");
  },

  number(num: unknown): string {
    if (typeof num !== "number" || Number.isNaN(num) || num <= 0) return "0";
    const n = Math.floor(num);
    if (n < 1000) return String(n);
    if (n < 10000) return Format.commas(String(n));

    const suffixes = Config.NUMBER_SUFFIXES;
    for (let i = 0; i < suffixes.length; i++) {
      const scale = Math.pow(10, 3 * (i + 1));
      if (n < scale * 1000) {
        const v = n / scale;
        if (v >= 999.995 && i < suffixes.length - 1) {
          return trimTail((n / (scale * 1000)).toFixed(2)) + suffixes[i + 1];
        }
        return trimTail(v.toFixed(2)) + suffixes[i];
      }
    }
    return luaExponential(n);
  },

  // H:MM:SS play-time clock: unpadded growing hour, zero-padded
  // minutes/seconds. nil/NaN/negative render "0:00:00".
  clock(sec: unknown): string {
    if (typeof sec !== "number" || Number.isNaN(sec) || sec < 0)
      return "0:00:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${h}:${pad2(m)}:${pad2(s)}`;
  },
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function trimTail(str: string): string {
  if (str.includes(".")) {
    str = str.replace(/0+$/, "").replace(/\.$/, "");
  }
  return str;
}

// Match C/LÖVE %.2e exponent padding (minimum two exponent digits).
function luaExponential(n: number): string {
  return n.toExponential(2).replace(
    /e([+-])(\d)$/,
    (_m, sign, d) => `e${sign}0${d}`,
  );
}

export default Format;
