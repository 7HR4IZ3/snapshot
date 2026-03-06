import React from "react";
import { render } from "ink";
import { ConflictApp, type ConflictItem, type ConflictUiResult } from "./app.js";

export async function runConflictTui(items: ConflictItem[]): Promise<ConflictUiResult> {
  return await new Promise<ConflictUiResult>((resolve) => {
    const instance = render(
      <ConflictApp
        items={items}
        onDone={(result) => {
          const typedResult: ConflictUiResult = result;
          resolve(typedResult);
          instance.unmount();
        }}
      />,
      { exitOnCtrlC: true },
    );
  });
}
