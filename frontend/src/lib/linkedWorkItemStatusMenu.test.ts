import assert from "node:assert/strict";
import {
  isLinkedWorkItemStatusMenuTarget,
  toggleLinkedWorkItemStatusMenuTarget,
} from "./linkedWorkItemStatusMenu";

const opened = toggleLinkedWorkItemStatusMenuTarget(null, "session-a", "item-a");
assert.deepEqual(opened, { sessionId: "session-a", itemId: "item-a" });
assert.equal(
  toggleLinkedWorkItemStatusMenuTarget(opened, "session-a", "item-a"),
  null,
);

const otherSession = toggleLinkedWorkItemStatusMenuTarget(
  opened,
  "session-b",
  "item-a",
);
assert.deepEqual(otherSession, {
  sessionId: "session-b",
  itemId: "item-a",
});
assert.equal(
  isLinkedWorkItemStatusMenuTarget(otherSession, "session-a", "item-a"),
  false,
);
assert.equal(
  isLinkedWorkItemStatusMenuTarget(otherSession, "session-b", "item-a"),
  true,
);

console.log("Linked work item status menu state: PASS");
