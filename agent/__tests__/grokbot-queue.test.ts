import { describe, expect, it } from "vitest";
import { serialised } from "../grokbot-transport";
import { BrochureSchema } from "../extract";

describe("Grok Bot transport", () => {
  it("runs calls one at a time, in order, even if one fails", async () => {
    const log: string[] = [];
    let active = 0;
    const job = (id: string, ms: number, fail = false) =>
      serialised(async () => {
        active++;
        expect(active).toBe(1);
        log.push(`start ${id}`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`end ${id}`);
        active--;
        if (fail) throw new Error(id);
        return id;
      });
    const results = await Promise.allSettled([job("a", 30), job("b", 5, true), job("c", 1)]);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });

  it("rejects a reply that isn't a brochure (e.g. a crossed A-D rationale)", () => {
    expect(BrochureSchema.safeParse({ A: "x", B: "y", C: "z", D: "w" }).success).toBe(false);
    expect(BrochureSchema.safeParse({ address: { value: "638 High Road", page: 1, excerpt: "638 High Road" } }).success).toBe(true);
  });
});

import { extractJsonText } from "../grok";
describe("chat reply JSON", () => {
  it("escapes raw line breaks inside strings but keeps formatting whitespace", () => {
    const raw = '{\n  "excerpt": "N17 0GA\nPage 1 of\t9",\n  "n": 1\n}';
    expect(JSON.parse(extractJsonText(raw))).toEqual({ excerpt: "N17 0GA\nPage 1 of\t9", n: 1 });
    expect(JSON.parse(extractJsonText('{"a": "say \\"hi\\"\n"}'))).toEqual({ a: 'say "hi"\n' });
  });
});
