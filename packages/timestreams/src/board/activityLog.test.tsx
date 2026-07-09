import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { TimestreamsBoard } from "./TimestreamsBoard";
import { makeBoardProps, makePlayState } from "./boardTestHelpers";

describe("activity log panel", () => {
  it("renders non-blocking activity log entries", () => {
    const G = makePlayState({
      activityLog: [
        {
          id: "1",
          at: Date.now(),
          message: "P0 requested decrypt for P1's draw",
          kind: "decrypt",
        },
        {
          id: "2",
          at: Date.now(),
          message: "Decrypt complete — P1 received a card",
          kind: "decrypt",
        },
      ],
    });
    const html = renderToStaticMarkup(<TimestreamsBoard {...makeBoardProps({ G })} />);
    expect(html).toContain('data-testid="activity-log"');
    expect(html).toContain("requested decrypt");
    expect(html).toContain("Decrypt complete");
    expect(html).toContain("ACTIVITY");
  });

  it("hides activity log when empty", () => {
    const G = makePlayState({ activityLog: [] });
    const html = renderToStaticMarkup(<TimestreamsBoard {...makeBoardProps({ G })} />);
    expect(html).not.toContain('data-testid="activity-log"');
  });
});
