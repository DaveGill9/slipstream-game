import { test } from "node:test";
import assert from "node:assert/strict";
import { readRecords, improveRecord, formatTime } from "./records.ts";
test("records tolerate malformed, missing and unavailable browser storage", () => {
  for (const value of ["broken", "null", '{"lap":-1,"race":"oops"}'])
    assert.deepEqual(readRecords({ getItem: () => value }), {
      lap: null,
      race: null,
    });
  assert.deepEqual(
    readRecords({
      getItem: () => {
        throw Error("disabled");
      },
    }),
    { lap: null, race: null },
  );
  assert.deepEqual(readRecords({ getItem: () => '{"lap":65.25,"race":200}' }), {
    lap: 65.25,
    race: 200,
  });
  assert.equal(improveRecord(65, 70), 65);
  assert.equal(improveRecord(65, 60), 60);
  assert.equal(formatTime(65.25), "1:05.25");
  assert.equal(formatTime(null), "--:--.--");
});
