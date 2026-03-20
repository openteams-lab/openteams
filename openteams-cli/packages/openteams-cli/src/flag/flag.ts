import { Config } from "effect"

function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const OPENTEAMS_AUTO_SHARE = truthy("OPENTEAMS_AUTO_SHARE")
  export const OPENTEAMS_GIT_BASH_PATH = process.env["OPENTEAMS_GIT_BASH_PATH"]
  export const OPENTEAMS_CONFIG = process.env["OPENTEAMS_CONFIG"]
  export declare const OPENTEAMS_TUI_CONFIG: string | undefined
  export declare const OPENTEAMS_CONFIG_DIR: string | undefined
  export const OPENTEAMS_CONFIG_CONTENT = process.env["OPENTEAMS_CONFIG_CONTENT"]
  export const OPENTEAMS_DISABLE_AUTOUPDATE = truthy("OPENTEAMS_DISABLE_AUTOUPDATE")
  export const OPENTEAMS_DISABLE_PRUNE = truthy("OPENTEAMS_DISABLE_PRUNE")
  export const OPENTEAMS_DISABLE_TERMINAL_TITLE = truthy("OPENTEAMS_DISABLE_TERMINAL_TITLE")
  export const OPENTEAMS_PERMISSION = process.env["OPENTEAMS_PERMISSION"]
  export const OPENTEAMS_DISABLE_DEFAULT_PLUGINS = truthy("OPENTEAMS_DISABLE_DEFAULT_PLUGINS")
  export const OPENTEAMS_DISABLE_LSP_DOWNLOAD = truthy("OPENTEAMS_DISABLE_LSP_DOWNLOAD")
  export const OPENTEAMS_ENABLE_EXPERIMENTAL_MODELS = truthy("OPENTEAMS_ENABLE_EXPERIMENTAL_MODELS")
  export const OPENTEAMS_DISABLE_AUTOCOMPACT = truthy("OPENTEAMS_DISABLE_AUTOCOMPACT")
  export const OPENTEAMS_DISABLE_MODELS_FETCH = truthy("OPENTEAMS_DISABLE_MODELS_FETCH")
  export const OPENTEAMS_DISABLE_CLAUDE_CODE = truthy("OPENTEAMS_DISABLE_CLAUDE_CODE")
  export const OPENTEAMS_DISABLE_CLAUDE_CODE_PROMPT =
    OPENTEAMS_DISABLE_CLAUDE_CODE || truthy("OPENTEAMS_DISABLE_CLAUDE_CODE_PROMPT")
  export const OPENTEAMS_DISABLE_CLAUDE_CODE_SKILLS =
    OPENTEAMS_DISABLE_CLAUDE_CODE || truthy("OPENTEAMS_DISABLE_CLAUDE_CODE_SKILLS")
  export const OPENTEAMS_DISABLE_EXTERNAL_SKILLS =
    OPENTEAMS_DISABLE_CLAUDE_CODE_SKILLS || truthy("OPENTEAMS_DISABLE_EXTERNAL_SKILLS")
  export declare const OPENTEAMS_DISABLE_PROJECT_CONFIG: boolean
  export const OPENTEAMS_FAKE_VCS = process.env["OPENTEAMS_FAKE_VCS"]
  export declare const OPENTEAMS_CLIENT: string
  export const OPENTEAMS_SERVER_PASSWORD = process.env["OPENTEAMS_SERVER_PASSWORD"]
  export const OPENTEAMS_SERVER_USERNAME = process.env["OPENTEAMS_SERVER_USERNAME"]
  export const OPENTEAMS_ENABLE_QUESTION_TOOL = truthy("OPENTEAMS_ENABLE_QUESTION_TOOL")

  // Experimental
  export const OPENTEAMS_EXPERIMENTAL = truthy("OPENTEAMS_EXPERIMENTAL")
  export const OPENTEAMS_EXPERIMENTAL_FILEWATCHER = Config.boolean("OPENTEAMS_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  )
  export const OPENTEAMS_EXPERIMENTAL_DISABLE_FILEWATCHER = Config.boolean(
    "OPENTEAMS_EXPERIMENTAL_DISABLE_FILEWATCHER",
  ).pipe(Config.withDefault(false))
  export const OPENTEAMS_EXPERIMENTAL_ICON_DISCOVERY =
    OPENTEAMS_EXPERIMENTAL || truthy("OPENTEAMS_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["OPENTEAMS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const OPENTEAMS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("OPENTEAMS_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const OPENTEAMS_ENABLE_EXA =
    truthy("OPENTEAMS_ENABLE_EXA") || OPENTEAMS_EXPERIMENTAL || truthy("OPENTEAMS_EXPERIMENTAL_EXA")
  export const OPENTEAMS_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("OPENTEAMS_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const OPENTEAMS_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("OPENTEAMS_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const OPENTEAMS_EXPERIMENTAL_OXFMT = OPENTEAMS_EXPERIMENTAL || truthy("OPENTEAMS_EXPERIMENTAL_OXFMT")
  export const OPENTEAMS_EXPERIMENTAL_LSP_TY = truthy("OPENTEAMS_EXPERIMENTAL_LSP_TY")
  export const OPENTEAMS_EXPERIMENTAL_LSP_TOOL = OPENTEAMS_EXPERIMENTAL || truthy("OPENTEAMS_EXPERIMENTAL_LSP_TOOL")
  export const OPENTEAMS_DISABLE_FILETIME_CHECK = Config.boolean("OPENTEAMS_DISABLE_FILETIME_CHECK").pipe(
    Config.withDefault(false),
  )
  export const OPENTEAMS_EXPERIMENTAL_PLAN_MODE = OPENTEAMS_EXPERIMENTAL || truthy("OPENTEAMS_EXPERIMENTAL_PLAN_MODE")
  export const OPENTEAMS_EXPERIMENTAL_WORKSPACES = OPENTEAMS_EXPERIMENTAL || truthy("OPENTEAMS_EXPERIMENTAL_WORKSPACES")
  export const OPENTEAMS_EXPERIMENTAL_MARKDOWN = !falsy("OPENTEAMS_EXPERIMENTAL_MARKDOWN")
  export const OPENTEAMS_MODELS_URL = process.env["OPENTEAMS_MODELS_URL"]
  export const OPENTEAMS_MODELS_PATH = process.env["OPENTEAMS_MODELS_PATH"]
  export const OPENTEAMS_DISABLE_CHANNEL_DB = truthy("OPENTEAMS_DISABLE_CHANNEL_DB")
  export const OPENTEAMS_SKIP_MIGRATIONS = truthy("OPENTEAMS_SKIP_MIGRATIONS")
  export const OPENTEAMS_STRICT_CONFIG_DEPS = truthy("OPENTEAMS_STRICT_CONFIG_DEPS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for OPENTEAMS_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENTEAMS_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("OPENTEAMS_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENTEAMS_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENTEAMS_TUI_CONFIG", {
  get() {
    return process.env["OPENTEAMS_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENTEAMS_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "OPENTEAMS_CONFIG_DIR", {
  get() {
    return process.env["OPENTEAMS_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for OPENTEAMS_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "OPENTEAMS_CLIENT", {
  get() {
    return process.env["OPENTEAMS_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
