import { describe, expect, it } from "vitest";
import { languageOf } from "../../src/intent/language.js";
import { parseIntent, sameIntent, termsOf } from "../../src/intent/parser.js";

const kindOf = (text: string) => parseIntent(text)?.kind ?? null;

describe("English intents", () => {
  it.each([
    ["Create FizzBuzz", "generate"],
    ["Write a FizzBuzz function", "generate"],
    ["Implement FizzBuzz in Python", "generate"],
    ["Explain lines 10 to 20", "explain"],
    ["What does this code do?", "explain"],
    ["Walk me through this function", "explain"],
    ["Debug this", "debug"],
    ["The tests are failing", "debug"],
    ["This doesn't work", "debug"],
    ["Fix the bug", "debug"],
    ["Refactor this into a function", "refactor"],
    ["Make this into a function", "refactor"],
    ["Merge these classes into an abstract base class", "refactor"],
    ["Rename this variable", "refactor"],
    ["Create a new file for the User class", "create"],
    ["Add a file for the settings", "create"],
    ["Run it", "run"],
    ["Run the tests", "run"],
    ["Execute this file", "run"],
  ])("%s → %s", (text, kind) => {
    expect(kindOf(text)).toBe(kind);
  });

  it("handles a change of mind and English negation", () => {
    expect(kindOf("Create it, actually explain it")).toBe("explain");
    expect(kindOf("Don't create anything, just explain")).toBe("explain");
    expect(kindOf("Run it, no, debug it")).toBe("debug");
  });

  it("reads line ranges, digits or words", () => {
    expect(parseIntent("Explain lines 10 to 20")?.range).toEqual({ from: 10, to: 20 });
    expect(parseIntent("Explain line 10 through line 20")?.range).toEqual({ from: 10, to: 20 });
    expect(parseIntent("Explain lines ten to twenty")?.range).toEqual({ from: 10, to: 20 });
    expect(parseIntent("Explain lines 10-20")?.range).toEqual({ from: 10, to: 20 });
    expect(parseIntent("Explain line 15")?.range).toEqual({ from: 15, to: 15 });
  });

  it("keeps only code-like words as identifiers, so a growing sentence stays the same request", () => {
    expect(termsOf("Create FizzBuzz in Python")).toEqual(["fizzbuzz"]);
    expect(termsOf("Explain fetch_user in main.py")).toEqual(["fetch_user", "main.py"]);
    expect(sameIntent(parseIntent("Create FizzBuzz"), parseIntent("Create FizzBuzz in Python, please."))).toBe(true);
    expect(sameIntent(parseIntent("Explain lines 10"), parseIntent("Explain lines 10 to 20"))).toBe(false);
  });

  it("leaves Japanese as it was", () => {
    expect(termsOf("FizzBuzzを作って")).toEqual(["fizzbuzz"]);
    expect(kindOf("10行目から20行目を解説して")).toBe("explain");
  });
});

describe("languageOf", () => {
  it("tells Japanese from English", () => {
    expect(languageOf("FizzBuzzを作って")).toBe("ja");
    expect(languageOf("Create FizzBuzz")).toBe("en");
    expect(languageOf("。")).toBe("ja");
  });
});
