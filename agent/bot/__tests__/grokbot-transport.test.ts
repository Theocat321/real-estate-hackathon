import { describe, expect, it } from "vitest";
import { replyFrom, toPrompt } from "../../grokbot-transport";
import { extractJsonText } from "../../grok";

describe("grokbot transport", () => {
  it("flattens messages into one self-contained prompt", () => {
    const p = toPrompt([{ role: "system", content: "Be JSON." }, { role: "user", content: "{\"q\":1}" }]);
    expect(p).toMatch(/^REQUEST [0-9a-f]{8}\./);
    expect(p).toContain("### INSTRUCTIONS\nBe JSON.");
    expect(p).toContain("### INPUT\n{\"q\":1}");
  });

  it("takes the last reply, skipping the echoed prompt", () => {
    const stdout = JSON.stringify({
      timedOut: false,
      newEntries: [
        { kind: "user", text: "PROMPT" },
        { kind: "assistant", text: "thinking..." },
        { kind: "assistant", text: "```json\n{\"text\":\"hi\"}\n```" },
      ],
    });
    const reply = replyFrom(stdout, "PROMPT");
    expect(JSON.parse(extractJsonText(reply))).toEqual({ text: "hi" });
  });

  it("errors on no reply", () => {
    expect(() => replyFrom(JSON.stringify({ timedOut: true, newEntries: [] }), "P")).toThrow(/timed out/);
  });
});
