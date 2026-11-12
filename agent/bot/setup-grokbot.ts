/**
 * One-time setup: check Grok Bot sign-in and create the JSON-only teammate used by GROK_TRANSPORT=grokbot.
 *   npx tsx agent/bot/setup-grokbot.ts
 */
import { GROKBOT_DEFAULT_NAME, runGrokBot } from "../grokbot-transport";

const NAME = process.env.GROKBOT_NAME || GROKBOT_DEFAULT_NAME;

async function main() {
  console.log(await runGrokBot(["status"], 60_000));
  const list = await runGrokBot(["list"], 60_000);
  if (list.includes(`"${NAME}"`)) {
    console.log(`Teammate "${NAME}" already exists.`);
    return;
  }
  console.log(
    await runGrokBot(
      [
        "create",
        "--name", NAME,
        "--title", "JSON responder for Structure Studio",
        "--description",
        "Back-end helper for the Structure Studio app. Every message is one self-contained request. " +
          "Reply with exactly one JSON object matching the instructions in the message, with no prose and no markdown. " +
          "Never use tools, files, the web or your computer. Never calculate tax or invent numbers. Never send messages to anyone.",
        "--no-kickstart",
      ],
      120_000,
    ),
  );
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
