import { describe, expect, it } from "vitest";
import { micStepAfterAsking, micStepFor } from "./mic-core";

const state = (
  status: string,
  canAskAgain: boolean,
  granted = status === "granted"
) => ({ status, canAskAgain, granted });

describe("microphone tap", () => {
  it("granted: record straight away", () => {
    expect(micStepFor(state("granted", true))).toBe("record");
    expect(micStepFor(state("granted", false))).toBe("record");
  });
  it("undetermined (never asked): ask, do not send the person to Settings", () => {
    expect(micStepFor(state("undetermined", true))).toBe("ask");
  });
  it("denied or restricted (the system will not ask again): Settings", () => {
    expect(micStepFor(state("denied", false))).toBe("settings");
    expect(micStepFor(state("undetermined", false))).toBe("settings");
  });
  it("denied but the system can still ask (Android): ask", () => {
    expect(micStepFor(state("denied", true))).toBe("ask");
  });
  it("after the prompt: approved records, refused goes to Settings", () => {
    expect(micStepAfterAsking(state("granted", true))).toBe("record");
    expect(micStepAfterAsking(state("denied", false))).toBe("settings");
    expect(micStepAfterAsking(state("denied", true))).toBe("settings");
  });
});
