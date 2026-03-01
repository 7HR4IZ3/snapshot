import React from "react";
import { render } from "ink";
import { ReviewApp, type ReviewTuiWorkspace, type ReviewTuiResult } from "./app.js";

export async function runReviewTui(workspaces: ReviewTuiWorkspace[]): Promise<ReviewTuiResult> {
  return await new Promise<ReviewTuiResult>((resolve) => {
    const instance = render(
      <ReviewApp
        workspaces={workspaces}
        onDone={(result) => {
          resolve(result);
          instance.unmount();
        }}
      />,
      {
        exitOnCtrlC: true,
      },
    );
  });
}
