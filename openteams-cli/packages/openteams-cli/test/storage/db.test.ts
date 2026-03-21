import { describe, expect, test } from "bun:test"
import path from "path"
import { Installation } from "../../src/installation"
import { Database } from "../../src/storage/db"

describe("Database.Path", () => {
  test("returns database path for the current channel", () => {
    const file = path.basename(Database.Path)
    const expected = ["latest", "beta"].includes(Installation.CHANNEL)
      ? "openteams-cli.db"
      : `openteams-cli-${Installation.CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`
    expect(file).toBe(expected)
  })

  test("uses the actual database path as the migration marker", () => {
    expect(Database.MigrationMarkerPath).toBe(Database.Path)
  })
})
