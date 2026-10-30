import { describe, expect, it } from "vitest";
import { extractInviteSecret } from "./invite";

const SECRET = "Ab3dEf6hIj9lMn2pQr5tUv8xYz1BcDe4FgH7iJk0LmN";

describe("extractInviteSecret", () => {
  it("accepts the raw secret", () => {
    expect(extractInviteSecret(SECRET)).toBe(SECRET);
    expect(extractInviteSecret(`  ${SECRET}\n`)).toBe(SECRET);
  });

  it("pulls the secret out of an https invite link", () => {
    expect(extractInviteSecret(`https://milton.example/k/${SECRET}`)).toBe(
      SECRET
    );
    expect(extractInviteSecret(`https://milton.example/k/${SECRET}/`)).toBe(
      SECRET
    );
    expect(
      extractInviteSecret(`https://milton.example/k/${SECRET}?utm=x#top`)
    ).toBe(SECRET);
  });

  it("pulls the secret out of the app link", () => {
    expect(extractInviteSecret(`milton://k/${SECRET}`)).toBe(SECRET);
  });

  it("rejects anything else", () => {
    expect(extractInviteSecret("")).toBeNull();
    expect(extractInviteSecret(null)).toBeNull();
    expect(extractInviteSecret("hola")).toBeNull();
    expect(extractInviteSecret("https://milton.example/other/path")).toBeNull();
    expect(
      extractInviteSecret("has spaces in the middle of a longer code")
    ).toBeNull();
  });
});
