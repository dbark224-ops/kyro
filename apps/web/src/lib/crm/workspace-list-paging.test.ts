import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fetchWorkspaceList,
  WORKSPACE_LIST_MAX_ROWS,
  WORKSPACE_LIST_PAGE_SIZE,
} from "./queries";

type Range = { from: number; to: number };

/**
 * Serves `total` rows across however many pages the helper asks for, and
 * records the ranges it requested so the paging arithmetic is checked rather
 * than assumed.
 */
function fakeTable(total: number) {
  const ranges: Range[] = [];

  return {
    query: (from: number, to: number) => {
      ranges.push({ from, to });

      const rows = [];

      for (let index = from; index <= to && index < total; index += 1) {
        rows.push({ id: `row-${index}` });
      }

      return Promise.resolve({ data: rows, error: null });
    },
    ranges,
  };
}

describe("fetchWorkspaceList", () => {
  it("returns every row of a workspace smaller than one page", async () => {
    const table = fakeTable(37);
    const rows = await fetchWorkspaceList("contacts", "ws-1", table.query);

    assert.equal(rows.length, 37);
    assert.equal(table.ranges.length, 1);
    assert.deepEqual(table.ranges[0], {
      from: 0,
      to: WORKSPACE_LIST_PAGE_SIZE - 1,
    });
  });

  it("keeps paging past the old 100-row cap", async () => {
    // The bug this replaces: a workspace with 300 contacts showed 100 and
    // silently dropped 200, including from search.
    const rows = await fetchWorkspaceList("contacts", "ws-1", fakeTable(300).query);

    assert.equal(rows.length, 300);
  });

  it("walks contiguous ranges with no gap or overlap", async () => {
    const table = fakeTable(WORKSPACE_LIST_PAGE_SIZE * 2 + 10);
    const rows = await fetchWorkspaceList("contacts", "ws-1", table.query);

    assert.equal(rows.length, WORKSPACE_LIST_PAGE_SIZE * 2 + 10);
    assert.equal(table.ranges.length, 3);

    for (const [index, range] of table.ranges.entries()) {
      assert.equal(range.from, index * WORKSPACE_LIST_PAGE_SIZE);
      assert.equal(range.to, range.from + WORKSPACE_LIST_PAGE_SIZE - 1);
    }

    // Every row appears exactly once.
    assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  });

  it("stops after a page that comes back exactly full then empty", async () => {
    const table = fakeTable(WORKSPACE_LIST_PAGE_SIZE);
    const rows = await fetchWorkspaceList("contacts", "ws-1", table.query);

    assert.equal(rows.length, WORKSPACE_LIST_PAGE_SIZE);
    // A full first page cannot be assumed final, so it asks once more.
    assert.equal(table.ranges.length, 2);
  });

  it("stops at the ceiling instead of looping forever", async () => {
    const table = fakeTable(WORKSPACE_LIST_MAX_ROWS * 3);
    const rows = await fetchWorkspaceList("contacts", "ws-1", table.query);

    assert.equal(rows.length, WORKSPACE_LIST_MAX_ROWS);
    assert.ok(
      table.ranges.every((range) => range.to < WORKSPACE_LIST_MAX_ROWS),
      "never requests rows beyond the ceiling",
    );
  });

  it("names what failed to load", async () => {
    await assert.rejects(
      fetchWorkspaceList("quote drafts", "ws-1", () =>
        Promise.resolve({ data: null, error: { message: "boom" } }),
      ),
      /Unable to load quote drafts: boom/,
    );
  });

  it("treats a null page as the end rather than crashing", async () => {
    const rows = await fetchWorkspaceList("leads", "ws-1", () =>
      Promise.resolve({ data: null, error: null }),
    );

    assert.deepEqual(rows, []);
  });
});
