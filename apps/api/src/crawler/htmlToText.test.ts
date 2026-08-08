import { describe, expect, it } from "vitest";
import { htmlToText } from "./htmlToText.js";

describe("htmlToText", () => {
  it("returns plain text unchanged (aside from trimming)", () => {
    expect(htmlToText("  Just plain text  ")).toBe("Just plain text");
  });

  it("converts <br> tags to newlines", () => {
    expect(htmlToText("Line one<br>Line two<br/>Line three<br />Line four")).toBe(
      "Line one\nLine two\nLine three\nLine four",
    );
  });

  it("converts closing block tags to newlines", () => {
    expect(htmlToText("<p>First</p><p>Second</p>")).toBe("First\nSecond");
    expect(htmlToText("<li>One</li><li>Two</li>")).toBe("One\nTwo");
    expect(htmlToText("<div>Alpha</div><div>Beta</div>")).toBe("Alpha\nBeta");
    expect(htmlToText("<h1>Title</h1><h3>Subtitle</h3>")).toBe("Title\nSubtitle");
  });

  it("collapses 3+ consecutive newlines down to 2", () => {
    expect(htmlToText("<p>First</p><p></p><p></p><p>Second</p>")).toBe("First\n\nSecond");
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(htmlToText("")).toBeNull();
    expect(htmlToText("   ")).toBeNull();
    expect(htmlToText("<p></p><div></div>")).toBeNull();
  });
});
