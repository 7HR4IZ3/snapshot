import React from "react";
import { render } from "ink";
import { MultiConflictApp, type MultiConflictItem, type MultiConflictResult } from "./app.js";

export type { MultiConflictItem, MultiConflictResult };

export async function runMultiConflictTui(
  items: MultiConflictItem[]
): Promise<MultiConflictResult> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <MultiConflictApp
        items={items}
        onDone={(result) => {
          unmount();
          resolve(result);
        }}
      />
    );
  });
}
