import React from "react";
import { render } from "ink";
import { ReviewApp, type ReviewTuiFile, type ReviewTuiResult } from "./app";

export async function runReviewTui(files: ReviewTuiFile[]): Promise<ReviewTuiResult> {
  return await new Promise<ReviewTuiResult>((resolve) => {
    const instance = render(
      <ReviewApp
        files={files}
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
