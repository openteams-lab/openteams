import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  ListFilter,
  PanelLeftClose,
  PanelLeftOpen,
  PencilLine,
  Plus,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";
import {
  DropdownSelect,
  type DropdownSelectOption,
} from "@/components/DropdownSelect";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  useCommandHandler,
  useShortcutScope,
} from "@/shortcuts/ShortcutProvider";
import { agentRuntimeApi } from "@/lib/api";
import type {
  AgentRuntimeDiagnostics,
  AgentRuntimeStatus,
  BaseCodingAgent,
  JsonValue,
} from "@/types";
import {
  envSummaryToText,
  filterRuntimeRunners,
  getRunnerLabel,
  getRuntimeDisplayState,
  parseEnvText,
  type AgentRuntimeFilter,
  type RuntimeDisplayState,
} from "./agent-runtime/agentRuntimeViewModel";
import ampSchema from "../../../shared/schemas/amp.json";
import claudeCodeSchema from "../../../shared/schemas/claude_code.json";
import codexSchema from "../../../shared/schemas/codex.json";
import copilotSchema from "../../../shared/schemas/copilot.json";
import cursorAgentSchema from "../../../shared/schemas/cursor_agent.json";
import droidSchema from "../../../shared/schemas/droid.json";
import geminiSchema from "../../../shared/schemas/gemini.json";
import kimiCodeSchema from "../../../shared/schemas/kimi_code.json";
import openTeamsCliSchema from "../../../shared/schemas/open_teams_cli.json";
import opencodeSchema from "../../../shared/schemas/opencode.json";
import qwenCodeSchema from "../../../shared/schemas/qwen_code.json";

type TranslateFn = (
  key: string,
  replacements?: Record<string, string | number>,
) => string;

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const brandIconPaths = {
  alibabaCloud:
    "M3.996 4.517h5.291L8.01 6.324 4.153 7.506a1.668 1.668 0 0 0-1.165 1.601v5.786a1.668 1.668 0 0 0 1.165 1.6l3.857 1.183 1.277 1.807H3.996A3.996 3.996 0 0 1 0 15.487V8.513a3.996 3.996 0 0 1 3.996-3.996m16.008 0h-5.291l1.277 1.807 3.857 1.182c.715.227 1.17.889 1.165 1.601v5.786a1.668 1.668 0 0 1-1.165 1.6l-3.857 1.183-1.277 1.807h5.291A3.996 3.996 0 0 0 24 15.487V8.513a3.996 3.996 0 0 0-3.996-3.996m-4.007 8.345H8.002v-1.804h7.995Z",
  amp: "M12 0c6.628 0 12 5.373 12 12s-5.372 12-12 12C5.373 24 0 18.627 0 12S5.373 0 12 0zm-.92 19.278l5.034-8.377a.444.444 0 00.097-.268.455.455 0 00-.455-.455l-2.851.004.924-5.468-.927-.003-5.018 8.367s-.1.183-.1.291c0 .251.204.455.455.455l2.831-.004-.901 5.458z",
  android:
    "M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z",
  anthropic:
    "M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z",
  claude:
    "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z",
  copilot:
    "M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z",
  gemini:
    "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81",
  openai:
    "M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z",
} as const;

type AgentBrandMark = {
  title: string;
  path?: string;
  text?: string;
  logoSrc?: string;
  logoMode?: "image" | "mask";
  logoClassName?: string;
};

const agentBrandMarks: Record<BaseCodingAgent, AgentBrandMark> = {
  AMP: {
    title: "Amp",
    path: brandIconPaths.amp,
    logoClassName: "h-6 w-6",
  },
  CLAUDE_CODE: { title: "Claude", path: brandIconPaths.claude },
  CODEX: { title: "OpenAI Codex", path: brandIconPaths.openai },
  COPILOT: {
    title: "GitHub Copilot",
    logoSrc: "/logos/github-copilot-logo.svg",
    logoMode: "mask",
    logoClassName: "h-[21px] w-[21px]",
  },
  CURSOR_AGENT: {
    title: "Cursor",
    logoSrc: "/logos/cursor-logo.svg",
    logoMode: "mask",
    logoClassName: "h-[22px] w-[22px]",
  },
  DROID: {
    title: "Droid",
    logoSrc: "/logos/droid-light.svg",
    logoClassName: "h-8 w-8",
  },
  GEMINI: { title: "Google Gemini", path: brandIconPaths.gemini },
  KIMI_CODE: { title: "Kimi", logoSrc: "/logos/kimi-logo.svg" },
  OPENCODE: {
    title: "OpenCode",
    logoSrc: "/logos/opencode.svg",
    logoMode: "mask",
    logoClassName: "h-8 w-8",
  },
  OPEN_TEAMS_CLI: {
    title: "OpenTeams CLI",
    logoSrc: "/logos/openteams-logo.svg",
  },
  QWEN_CODE: {
    title: "Qwen",
    logoSrc: "/logos/qwen-dark.svg",
    logoMode: "mask",
    logoClassName: "h-8 w-8",
  },
};

type JsonSchemaProperty = {
  title?: string;
  description?: string;
  type?: string | string[];
  enum?: Array<string | number | boolean | null>;
  format?: string;
  items?: { type?: string | string[] };
  additionalProperties?: unknown;
};

type AgentJsonSchema = {
  properties?: Record<string, JsonSchemaProperty>;
};

const agentConfigSchemas: Record<BaseCodingAgent, AgentJsonSchema> = {
  AMP: ampSchema,
  CLAUDE_CODE: claudeCodeSchema,
  CODEX: codexSchema,
  COPILOT: copilotSchema,
  CURSOR_AGENT: cursorAgentSchema,
  DROID: droidSchema,
  GEMINI: geminiSchema,
  KIMI_CODE: kimiCodeSchema,
  OPENCODE: opencodeSchema,
  OPEN_TEAMS_CLI: openTeamsCliSchema,
  QWEN_CODE: qwenCodeSchema,
};

const hiddenConfigFields = new Set([
  "env",
  "run_mode",
  "mode",
  "model",
  "model_provider",
  "model_reasoning_effort",
  "model_reasoning_summary",
  "model_reasoning_summary_format",
  "reasoning_effort",
  "thinking_effort",
  "variant",
  "effort",
  "profile",
]);
const nullOptionId = "__openteams_null__";

const isHiddenConfigField = (
  runner: BaseCodingAgent,
  fieldKey: string,
): boolean =>
  hiddenConfigFields.has(fieldKey) ||
  (runner === "OPEN_TEAMS_CLI" &&
    (fieldKey === "variant" || fieldKey === "agent"));

const formatRunnerKey = (runner: BaseCodingAgent): string =>
  runner.toLowerCase().replaceAll("_", " ");

const getSchemaValueType = (property: JsonSchemaProperty): string => {
  const rawType = Array.isArray(property.type)
    ? property.type.find((item) => item !== "null")
    : property.type;
  return rawType ?? "string";
};

const toFieldLabel = (key: string, property?: JsonSchemaProperty): string =>
  property?.title ??
  key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const translateWithFallback = (
  t: TranslateFn,
  key: string,
  fallback: string,
): string => {
  const translated = t(key);
  return translated === key ? fallback : translated;
};

type RuntimeRunnerUpdateOptions = {
  notifyErrors?: boolean;
};

const runtimeSnapshotTime = (value: string | null | undefined) => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const shouldApplyRuntimeSnapshot = (
  current: Pick<AgentRuntimeStatus, "last_checked_at">,
  next: Pick<AgentRuntimeStatus, "last_checked_at">,
): boolean => {
  const currentTime = runtimeSnapshotTime(current.last_checked_at);
  const nextTime = runtimeSnapshotTime(next.last_checked_at);
  if (currentTime !== null && nextTime === null) return false;
  if (currentTime === null || nextTime === null) return true;
  return nextTime >= currentTime;
};

const getRuntimeErrorMessage = (
  runner: AgentRuntimeStatus,
  t: TranslateFn,
): string => {
  const lastError = runner.last_error?.trim();
  if (lastError) return lastError;
  if (runner.installed && !runner.executable) return t("agents.status.error");
  return "";
};

const translateConfigFieldText = (
  t: TranslateFn,
  runner: BaseCodingAgent,
  fieldKey: string,
  kind: "label" | "description",
  fallback: string,
): string => {
  const runnerKey = `agents.config.schema.${runner.toLowerCase()}.${fieldKey}.${kind}`;
  const runnerText = t(runnerKey);
  if (runnerText !== runnerKey) return runnerText;

  return translateWithFallback(
    t,
    `agents.config.schema.common.${fieldKey}.${kind}`,
    fallback,
  );
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const getRuntimeExecutorOptions = (
  runner: AgentRuntimeStatus,
): Record<string, JsonValue | undefined> => {
  const options = runner.executor_options;
  return isObjectRecord(options)
    ? { ...(options as Record<string, JsonValue>) }
    : {};
};

const getModelSourceLabel = (
  source: AgentRuntimeStatus["model_source"],
  t: TranslateFn,
): string => {
  switch (source) {
    case "runner":
      return t("agents.model.source.runner");
    case "profile_fallback":
      return t("agents.model.source.profileFallback");
    case "none":
    default:
      return t("agents.model.source.none");
  }
};

const createStatusFilterOptions = (t: TranslateFn): DropdownSelectOption[] =>
  [
    { key: "all", label: t("agents.filter.all") },
    { key: "available", label: t("agents.filter.available") },
    { key: "error", label: t("agents.filter.error") },
    { key: "not_installed", label: t("agents.filter.notInstalled") },
  ].map((item) => ({
    id: item.key,
    label: item.label,
  }));

/* ---------- Status helpers ---------- */

function StatusDot({ state }: { state: RuntimeDisplayState }) {
  return (
    <span
      className={cx(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        state === "available" && "bg-[var(--success)]",
        state === "error" && "bg-red-500",
        state === "not_installed" && "bg-[var(--ink-tertiary)]",
      )}
    />
  );
}

function StatusBadge({
  runner,
  t,
  size = "compact",
}: {
  runner: AgentRuntimeStatus;
  t: TranslateFn;
  size?: "compact" | "normal";
}) {
  const state = getRuntimeDisplayState(runner);
  const label =
    state === "available"
      ? t("agents.status.available")
      : state === "error"
        ? t("agents.status.error")
        : t("agents.status.notInstalled");
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-medium",
        size === "normal" ? "text-[13px]" : "text-[11px]",
        state === "available" && "text-[var(--success)]",
        state === "error" && "text-red-400",
        state === "not_installed" && "text-[var(--ink-subtle)]",
      )}
    >
      <StatusDot state={state} />
      {label}
    </span>
  );
}

function AgentNavStatusDot({
  state,
  overlay = false,
}: {
  state: RuntimeDisplayState;
  overlay?: boolean;
}) {
  return (
    <span
      className={cx(
        "h-1 w-1 shrink-0 rounded-full",
        overlay &&
          "absolute -right-0.5 -top-0.5 ring-2 ring-[var(--surface-2)]",
        state === "available" && "bg-[var(--success)]",
        state === "error" && "bg-red-500",
        state === "not_installed" &&
          "border border-[var(--ink-tertiary)] bg-[var(--surface-2)]",
      )}
    />
  );
}

function AgentBrandAvatar({
  runner,
  framed = true,
}: {
  runner: BaseCodingAgent;
  framed?: boolean;
}) {
  const brand = agentBrandMarks[runner];
  const maskStyle =
    brand.logoSrc && brand.logoMode === "mask"
      ? ({
          WebkitMaskImage: `url(${brand.logoSrc})`,
          WebkitMaskPosition: "center",
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskImage: `url(${brand.logoSrc})`,
          maskPosition: "center",
          maskRepeat: "no-repeat",
          maskSize: "contain",
        } satisfies CSSProperties)
      : undefined;

  return (
    <span
      className={cx(
        "flex h-8 w-8 shrink-0 items-center justify-center text-[var(--ink-muted)]",
        framed &&
          "rounded-full border border-[var(--mono-border)] bg-[var(--mono-bg)]",
      )}
      title={brand.title}
      aria-label={brand.title}
    >
      {brand.logoSrc && brand.logoMode === "mask" ? (
        <span
          aria-hidden="true"
          className={cx(
            "block shrink-0 bg-current",
            brand.logoClassName ?? "h-5 w-5",
          )}
          style={maskStyle}
        />
      ) : brand.logoSrc ? (
        <img
          src={brand.logoSrc}
          alt=""
          aria-hidden="true"
          className={cx("h-5 w-5 object-contain", brand.logoClassName)}
        />
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={cx("h-[18px] w-[18px]", brand.logoClassName)}
          focusable="false"
        >
          {brand.path ? (
            <path fill="currentColor" d={brand.path} />
          ) : (
            <text
              x="12"
              y="15"
              textAnchor="middle"
              className="fill-current font-mono text-[9px] font-semibold"
            >
              {brand.text}
            </text>
          )}
        </svg>
      )}
    </span>
  );
}

/* ---------- Sort priority: available first, then error, then not_installed ---------- */

const statePriority: Record<RuntimeDisplayState, number> = {
  available: 0,
  error: 1,
  not_installed: 2,
};

function sortRunnersByAvailability(
  runners: AgentRuntimeStatus[],
): AgentRuntimeStatus[] {
  return [...runners].sort(
    (a, b) =>
      statePriority[getRuntimeDisplayState(a)] -
      statePriority[getRuntimeDisplayState(b)],
  );
}

/* ---------- Agent row item ---------- */

function AgentRow({
  runner,
  selected,
  collapsed,
  onOpenConfig,
}: {
  runner: AgentRuntimeStatus;
  selected: boolean;
  collapsed: boolean;
  onOpenConfig: () => void;
}) {
  const state = getRuntimeDisplayState(runner);
  const runnerLabel = getRunnerLabel(runner.runner_type);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenConfig}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenConfig();
        }
      }}
      className={cx(
        "group cursor-pointer px-2 py-1 transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20",
        collapsed ? "flex justify-center" : "block",
        selected && "opacity-100",
        !selected && state === "available" && "opacity-75 hover:opacity-95",
        !selected && state === "error" && "opacity-65 hover:opacity-90",
        !selected && state === "not_installed" && "opacity-40 hover:opacity-65",
      )}
      title={runnerLabel}
    >
      <div
        className={cx(
          "flex min-w-0 items-center gap-3 rounded-[7px] transition-colors",
          collapsed ? "h-10 w-10 justify-center" : "px-2.5 py-2",
          selected
            ? "bg-[#f3eee3]/[0.045] text-[var(--ink)] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] backdrop-blur-[1px]"
            : cx(
                "group-hover:bg-white/[0.025]",
                state === "available" && "text-[var(--ink)]",
                state === "error" && "text-red-300",
                state === "not_installed" && "text-[var(--ink-tertiary)]",
              ),
        )}
      >
        <span className="relative shrink-0">
          <AgentBrandAvatar runner={runner.runner_type} framed={false} />
          {collapsed && <AgentNavStatusDot state={state} overlay />}
        </span>
        {!collapsed && (
          <>
            <p className="min-w-0 flex-1 truncate text-[14px] font-medium leading-[1.35]">
              {runnerLabel}
            </p>
            <AgentNavStatusDot state={state} />
          </>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[128px_minmax(0,1fr)] items-baseline gap-3 py-1.5">
      <p className="truncate text-[12px] font-medium leading-[1.4] text-[var(--ink-subtle)]">
        {label}
      </p>
      <p className="break-all font-mono text-[12px] leading-[1.55] text-[var(--ink-muted)]">
        {value}
      </p>
    </div>
  );
}

function ConfigSchemaField({
  runner,
  fieldKey,
  property,
  value,
  onChange,
  onCommit,
  t,
}: {
  runner: BaseCodingAgent;
  fieldKey: string;
  property: JsonSchemaProperty;
  value: JsonValue | undefined;
  onChange: (key: string, value: JsonValue | undefined) => void;
  onCommit?: () => void | Promise<void>;
  t: TranslateFn;
}) {
  const [jsonDraft, setJsonDraft] = useState(() =>
    value === undefined || value === null ? "" : JSON.stringify(value, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const valueType = getSchemaValueType(property);
  const label = translateConfigFieldText(
    t,
    runner,
    fieldKey,
    "label",
    toFieldLabel(fieldKey, property),
  );
  const description = translateConfigFieldText(
    t,
    runner,
    fieldKey,
    "description",
    property.description ?? "",
  );

  useEffect(() => {
    if (valueType !== "object") return;
    setJsonDraft(
      value === undefined || value === null
        ? ""
        : JSON.stringify(value, null, 2),
    );
    setJsonError(null);
  }, [value, valueType]);

  const labelNode = (
    <div className="w-32 shrink-0 pt-1" title={description || undefined}>
      <label className="block truncate text-[12px] font-medium leading-[1.35] text-[var(--ink-subtle)]">
        {label}
      </label>
    </div>
  );

  const inputBaseClass =
    "w-full rounded-none border-x-0 border-b border-t-0 border-transparent bg-transparent px-0 py-1.5 font-mono text-[12px] leading-[1.55] text-[var(--ink)] outline-none transition-all placeholder:text-[var(--ink-tertiary)] hover:border-white/10 hover:bg-white/[0.04] focus:border-white/20 focus:bg-white/[0.04]";

  if (property.enum) {
    const hasNullOption = property.enum.some((item) => item === null);
    const options: DropdownSelectOption[] = [
      ...(hasNullOption
        ? [{ id: nullOptionId, label: t("agents.config.default") }]
        : []),
      ...property.enum
        .filter((item) => item !== null)
        .map((item) => ({
          id: String(item),
          label: String(item),
        })),
    ];
    const selectedValue =
      value === null || value === undefined ? nullOptionId : String(value);

    return (
      <div className="flex items-start gap-3 py-1.5">
        {labelNode}
        <DropdownSelect
          value={selectedValue}
          options={options}
          showSearch={options.length > 8}
          className="min-w-0 flex-1 hover:[&>button]:!border-white/10 hover:[&>button]:!bg-white/[0.04] focus-within:[&>button]:!border-white/20 focus-within:[&>button]:!bg-white/[0.04] [&>button]:h-8 [&>button]:!rounded-none [&>button]:!border-x-0 [&>button]:!border-b [&>button]:!border-t-0 [&>button]:!border-transparent [&>button]:!bg-transparent [&>button]:px-0 [&>button]:py-0 [&>button]:font-mono [&>button]:text-[12px]"
          panelClassName="max-w-none"
          onChange={(nextValue) =>
            onChange(fieldKey, nextValue === nullOptionId ? null : nextValue)
          }
        />
      </div>
    );
  }

  if (valueType === "boolean") {
    const checked = value === true;
    return (
      <div className="flex items-center gap-3 py-1.5">
        {labelNode}
        <div className="flex h-8 min-w-0 flex-1 items-center">
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            onClick={() => {
              onChange(fieldKey, !checked);
              window.setTimeout(() => {
                void onCommit?.();
              }, 0);
            }}
            onBlur={() => {
              void onCommit?.();
            }}
            className={cx(
              "relative h-5 w-9 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20",
              checked
                ? "bg-[var(--primary)]/80"
                : "bg-white/[0.035] ring-1 ring-inset ring-white/10 hover:bg-white/[0.06]",
            )}
          >
            <span
              className={cx(
                "absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all",
                checked
                  ? "left-[18px] bg-white shadow-[0_0_10px_rgba(255,255,255,0.18)]"
                  : "left-1 bg-white/35",
              )}
            />
          </button>
        </div>
      </div>
    );
  }

  if (valueType === "array") {
    const arrayValue = Array.isArray(value) ? value : [];
    return (
      <div className="flex items-start gap-3 py-1.5">
        {labelNode}
        <textarea
          value={arrayValue.map(String).join("\n")}
          onChange={(event) => {
            const items = event.target.value
              .split(/\r?\n/u)
              .map((item) => item.trim())
              .filter(Boolean);
            onChange(fieldKey, items.length > 0 ? items : null);
          }}
          onBlur={() => {
            void onCommit?.();
          }}
          rows={3}
          spellCheck={false}
          placeholder={t("agents.config.placeholder.array")}
          className={cx(inputBaseClass, "min-w-0 flex-1 resize-none")}
        />
      </div>
    );
  }

  if (valueType === "object") {
    return (
      <div className="flex items-start gap-3 py-1.5">
        {labelNode}
        <div className="min-w-0 flex-1">
          <textarea
            value={jsonDraft}
            onChange={(event) => {
              const nextDraft = event.target.value;
              setJsonDraft(nextDraft);
              if (!nextDraft.trim()) {
                setJsonError(null);
                onChange(fieldKey, null);
                return;
              }
              try {
                const parsed = JSON.parse(nextDraft) as JsonValue;
                setJsonError(null);
                onChange(fieldKey, parsed);
              } catch (error) {
                setJsonError(
                  error instanceof Error
                    ? error.message
                    : t("agents.config.invalidJson"),
                );
              }
            }}
            onBlur={() => {
              void onCommit?.();
            }}
            rows={5}
            spellCheck={false}
            placeholder={t("agents.config.placeholder.object")}
            className={cx(inputBaseClass, "resize-none")}
          />
          {jsonError && (
            <p className="mt-1.5 font-mono text-[14px] text-amber-400">
              {jsonError}
            </p>
          )}
        </div>
      </div>
    );
  }

  const stringValue =
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const InputElement = property.format === "textarea" ? "textarea" : "input";

  return (
    <div className="flex items-start gap-3 py-1.5">
      {labelNode}
      <InputElement
        value={stringValue}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(fieldKey, nextValue.trim() ? nextValue : null);
        }}
        onBlur={() => {
          void onCommit?.();
        }}
        rows={
          property.format === "textarea"
            ? fieldKey === "append_prompt"
              ? 1
              : 2
            : undefined
        }
        spellCheck={property.format === "textarea"}
        placeholder={t("agents.config.placeholder.value")}
        className={cx(
          inputBaseClass,
          "min-w-0 flex-1",
          property.format === "textarea" && "resize-y",
        )}
      />
    </div>
  );
}

function ModelConfigField({
  runner,
  models,
  modelSource,
  value,
  onChange,
  onModelSaved,
  t,
}: {
  runner: BaseCodingAgent;
  models: string[];
  modelSource: AgentRuntimeStatus["model_source"];
  value: JsonValue | undefined;
  onChange: (key: string, value: JsonValue | undefined) => void;
  onModelSaved: (model: string) => Promise<void>;
  t: TranslateFn;
}) {
  const selectedModel = typeof value === "string" ? value : "";
  const modelFieldId = `agent-model-options-${runner}`;
  const sourceLabel = getModelSourceLabel(modelSource, t);
  const [modelFormMode, setModelFormMode] = useState<"add" | "edit" | null>(
    null,
  );
  const [editingModelName, setEditingModelName] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const [addModelError, setAddModelError] = useState<string | null>(null);
  const [customModels, setCustomModels] = useState<string[]>([]);
  const modelOptions = useMemo<DropdownSelectOption[]>(() => {
    const uniqueModels = new Set<string>();
    for (const model of [...models, ...customModels, selectedModel]) {
      const trimmed = model.trim();
      if (trimmed) uniqueModels.add(trimmed);
    }

    return [...uniqueModels].sort().map((model) => ({
      id: model,
      label: model,
    }));
  }, [customModels, models, selectedModel]);

  useEffect(() => {
    setModelFormMode(null);
    setEditingModelName("");
    setNewModelName("");
    setAddModelError(null);
    setCustomModels([]);
  }, [runner]);

  const handleSaveModel = async () => {
    const trimmed = newModelName.trim();
    if (!trimmed) {
      setAddModelError(t("agents.model.add.empty"));
      return;
    }

    setSavingModel(true);
    setAddModelError(null);
    try {
      if (modelFormMode === "edit") {
        await agentRuntimeApi.renameModel(runner, editingModelName, trimmed);
        setCustomModels((current) => {
          const next = current.filter((model) => model !== editingModelName);
          return next.includes(trimmed) ? next : [...next, trimmed];
        });
      } else {
        await agentRuntimeApi.addModel(runner, trimmed);
        setCustomModels((current) =>
          current.includes(trimmed) ? current : [...current, trimmed],
        );
      }
      await onModelSaved(trimmed);
      setEditingModelName("");
      setNewModelName("");
      setModelFormMode(null);
    } catch (error) {
      setAddModelError(
        error instanceof Error ? error.message : t("agents.model.add.failed"),
      );
    } finally {
      setSavingModel(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3 py-1.5">
        <div
          className="w-32 shrink-0 pt-1"
          title={
            models.length > 0
              ? t("agents.model.field.description", { source: sourceLabel })
              : t("agents.model.field.emptyDescription")
          }
        >
          <label className="block truncate text-[12px] font-medium leading-[1.35] text-[var(--ink-subtle)]">
            {t("agents.model.field.label")}
          </label>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <DropdownSelect
            value={selectedModel}
            options={modelOptions}
            placeholder={t("agents.model.field.placeholder")}
            searchPlaceholder={t("agents.model.field.searchPlaceholder")}
            emptyLabel={t("agents.model.field.noMatch")}
            className="min-w-0 flex-1 hover:[&>button]:!border-white/10 hover:[&>button]:!bg-white/[0.04] focus-within:[&>button]:!border-white/20 focus-within:[&>button]:!bg-white/[0.04] [&>button]:h-8 [&>button]:!rounded-none [&>button]:!border-x-0 [&>button]:!border-b [&>button]:!border-t-0 [&>button]:!border-transparent [&>button]:!bg-transparent [&>button]:px-0 [&>button]:py-0 [&>button]:font-mono [&>button]:text-[12px]"
            maxPanelHeightClassName="max-h-[280px]"
            onChange={(nextValue) => {
              const trimmed = nextValue.trim();
              onChange("model", trimmed ? trimmed : null);
              if (trimmed) {
                setModelFormMode("edit");
                setEditingModelName(trimmed);
                setNewModelName(trimmed);
                setAddModelError(null);
              } else {
                setModelFormMode(null);
                setEditingModelName("");
                setNewModelName("");
                setAddModelError(null);
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              setModelFormMode("add");
              setEditingModelName("");
              setNewModelName("");
              setAddModelError(null);
            }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-transparent bg-transparent text-[var(--ink-tertiary)] transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-[var(--ink)]"
            title={t("agents.model.add.button")}
            aria-label={t("agents.model.add.button")}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {modelFormMode && (
        <form
          className="flex items-center gap-1.5 py-1.5 pl-[140px]"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveModel();
          }}
        >
          <input
            id={`${modelFieldId}-new`}
            value={newModelName}
            onChange={(event) => {
              setNewModelName(event.target.value);
              setAddModelError(null);
            }}
            spellCheck={false}
            placeholder={t("agents.model.add.placeholder")}
            className="h-8 min-w-0 flex-1 rounded-none border-x-0 border-b border-t-0 border-transparent bg-transparent px-0 font-mono text-[12px] text-[var(--ink)] outline-none transition-all placeholder:text-[var(--ink-tertiary)] hover:border-white/10 hover:bg-white/[0.04] focus:border-white/20 focus:bg-white/[0.04]"
          />
          <button
            type="submit"
            disabled={savingModel}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-2 text-[13px] font-medium text-[var(--primary)] transition-colors hover:text-[var(--primary-hover)] focus-visible:outline-none focus-visible:text-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingModel ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PencilLine className="h-3.5 w-3.5" />
            )}
            {savingModel
              ? t("agents.model.add.saving")
              : t("agents.model.add.save")}
          </button>
          <button
            type="button"
            onClick={() => {
              setModelFormMode(null);
              setEditingModelName("");
              setNewModelName("");
              setAddModelError(null);
            }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] border border-transparent bg-transparent text-[var(--ink-tertiary)] transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/10"
            aria-label={t("agents.save.cancel")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      )}
      {addModelError && (
        <p className="font-mono text-[14px] text-red-400">{addModelError}</p>
      )}
    </div>
  );
}

/* ---------- Embedded agent configuration sidebar ---------- */

function AgentConfigSidebar({
  runner,
  saveError,
  onClose,
  onSave,
  onDiagnosticsLoaded,
  t,
}: {
  runner: AgentRuntimeStatus;
  saveError: string | null;
  onClose: () => void;
  onSave: (
    runner: BaseCodingAgent,
    formData: Record<string, JsonValue | undefined>,
    envJson: Record<string, string> | null,
  ) => Promise<void>;
  onDiagnosticsLoaded: (diagnostics: AgentRuntimeDiagnostics) => void;
  t: TranslateFn;
}) {
  const [formData, setFormData] = useState<
    Record<string, JsonValue | undefined>
  >(() => getRuntimeExecutorOptions(runner));
  const [initialFormData, setInitialFormData] = useState<
    Record<string, JsonValue | undefined>
  >(() => getRuntimeExecutorOptions(runner));
  const [envText, setEnvText] = useState(() =>
    envSummaryToText(runner.env_summary),
  );
  const [envDirty, setEnvDirty] = useState(false);
  const [diagnostics, setDiagnostics] =
    useState<AgentRuntimeDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const autoSaveTimerRef = useRef<number | null>(null);
  const savedStatusTimerRef = useRef<number | null>(null);
  const latestRunnerRef = useRef(runner);
  latestRunnerRef.current = runner;
  const schema = agentConfigSchemas[runner.runner_type];
  const diagnosticsFailedLabel = t("agents.diagnostics.failed");
  const diagnosticsFailedLabelRef = useRef(diagnosticsFailedLabel);
  diagnosticsFailedLabelRef.current = diagnosticsFailedLabel;
  const onDiagnosticsLoadedRef = useRef(onDiagnosticsLoaded);
  onDiagnosticsLoadedRef.current = onDiagnosticsLoaded;
  const schemaFields = Object.entries(schema.properties ?? {}).filter(
    ([fieldKey]) => !isHiddenConfigField(runner.runner_type, fieldKey),
  );
  const currentDiagnostics =
    diagnostics?.runner_type === runner.runner_type ? diagnostics : null;
  const envSummary = currentDiagnostics?.env_summary ?? runner.env_summary;
  const configPath =
    currentDiagnostics?.config_path ??
    (diagnosticsLoading
      ? t("agents.details.loading")
      : t("agents.details.notReported"));
  const cliVersion = diagnosticsLoading
    ? t("agents.details.checking")
    : (currentDiagnostics?.version ??
      runner.version ??
      t("agents.details.notReported"));
  const modelOptions =
    currentDiagnostics?.discovered_models ?? runner.discovered_models;
  const modelSource = currentDiagnostics?.model_source ?? runner.model_source;
  const isDirty =
    envDirty || JSON.stringify(formData) !== JSON.stringify(initialFormData);
  const envSummaryText = useMemo(
    () => envSummaryToText(envSummary),
    [envSummary],
  );
  const latestDraftRef = useRef({
    formData,
    envText,
    envDirty,
    isDirty,
  });
  latestDraftRef.current = {
    formData,
    envText,
    envDirty,
    isDirty,
  };

  const clearSavedStatusTimer = useCallback(() => {
    if (savedStatusTimerRef.current !== null) {
      window.clearTimeout(savedStatusTimerRef.current);
      savedStatusTimerRef.current = null;
    }
  }, []);

  const runAutoSave = useCallback(async () => {
    const draft = latestDraftRef.current;
    if (!draft.isDirty) return;
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    clearSavedStatusTimer();
    setAutoSaveStatus("saving");
    try {
      await onSave(
        runner.runner_type,
        draft.formData,
        draft.envDirty ? parseEnvText(draft.envText) : null,
      );
      setInitialFormData(draft.formData);
      setEnvDirty(false);
      setAutoSaveStatus("saved");
      savedStatusTimerRef.current = window.setTimeout(() => {
        setAutoSaveStatus("idle");
        savedStatusTimerRef.current = null;
      }, 1500);
    } catch {
      setAutoSaveStatus("idle");
    }
  }, [clearSavedStatusTimer, onSave, runner.runner_type]);

  useEffect(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    clearSavedStatusTimer();
    setAutoSaveStatus("idle");
    const nextFormData = getRuntimeExecutorOptions(runner);
    setFormData(nextFormData);
    setInitialFormData(nextFormData);
    setEnvText(envSummaryToText(runner.env_summary));
    setEnvDirty(false);
    setDiagnostics((current) =>
      current?.runner_type === runner.runner_type
        ? {
            ...current,
            installed: runner.installed,
            executable: runner.executable,
            availability: runner.availability,
            discovered_models: runner.discovered_models,
            model_source: runner.model_source,
            version: runner.version,
            last_checked_at: runner.last_checked_at,
            last_error: runner.last_error,
            run_mode: runner.run_mode,
            env_summary: runner.env_summary,
            executor_options: runner.executor_options,
          }
        : current,
    );
  }, [clearSavedStatusTimer, runner]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
      clearSavedStatusTimer();
    };
  }, [clearSavedStatusTimer]);

  useEffect(() => {
    if (envDirty) return;
    setEnvText(envSummaryText);
  }, [envDirty, envSummaryText]);

  useEffect(() => {
    if (!isDirty) return;
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      void runAutoSave();
    }, 500);

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [formData, envText, envDirty, isDirty, runAutoSave]);

  useEffect(() => {
    let active = true;
    setDiagnostics(null);
    setDiagnosticsError(null);
    setDiagnosticsLoading(true);

    agentRuntimeApi
      .getDiagnostics(runner.runner_type)
      .then((result) => {
        if (active) {
          const latestRunner = latestRunnerRef.current;
          if (!shouldApplyRuntimeSnapshot(latestRunner, result)) return;
          setDiagnostics(result);
          onDiagnosticsLoadedRef.current(result);
        }
      })
      .catch((error) => {
        if (active) {
          setDiagnosticsError(
            error instanceof Error
              ? error.message
              : diagnosticsFailedLabelRef.current,
          );
        }
      })
      .finally(() => {
        if (active) setDiagnosticsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [runner.runner_type]);

  const handleConfigFieldChange = (
    key: string,
    value: JsonValue | undefined,
  ) => {
    setFormData((current) => {
      const next = { ...current };
      if (value === undefined || value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const handleModelSaved = async (model: string) => {
    const nextFormData = { ...formData, model };
    setFormData(nextFormData);
    clearSavedStatusTimer();
    setAutoSaveStatus("saving");
    await onSave(
      runner.runner_type,
      nextFormData,
      envDirty ? parseEnvText(envText) : null,
    );
    setInitialFormData(nextFormData);
    setEnvDirty(false);
    setAutoSaveStatus("saved");
    savedStatusTimerRef.current = window.setTimeout(() => {
      setAutoSaveStatus("idle");
      savedStatusTimerRef.current = null;
    }, 1500);
  };

  return (
    <aside
      className={cx(
        "relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--surface-2)]",
      )}
    >
      <header className="shrink-0 border-b border-[var(--hairline)] px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-4">
            <AgentBrandAvatar runner={runner.runner_type} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[18px] font-semibold leading-[1.2] tracking-[-0.2px] text-[var(--ink)]">
                  {getRunnerLabel(runner.runner_type)}
                </h2>
                <StatusBadge runner={runner} t={t} size="normal" />
              </div>
              <p className="mt-1 truncate font-mono text-[14px] leading-[1.35] text-[var(--ink-tertiary)] tracking-wider">
                {cliVersion}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="min-w-[74px]">
              {autoSaveStatus !== "idle" && (
                <div className="flex items-center justify-end gap-1.5 font-mono text-[11px] text-white/35 transition-opacity">
                  {autoSaveStatus === "saving" && (
                    <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                  )}
                  <span>
                    {autoSaveStatus === "saving" ? "Saving..." : "Saved"}
                  </span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="-mr-1 rounded-[6px] p-1.5 text-[var(--ink-tertiary)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
              aria-label={t("agents.sidebar.close")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div
        className={cx(
          "min-h-0 flex-1 overflow-y-auto px-5 py-4 ot-scroll-area-styled",
        )}
      >
        <section className="pb-5">
          <h3 className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-[var(--ink-subtle)] uppercase">
            {t("agents.details.runtime")}
          </h3>
          <div className="grid gap-1">
            <DetailRow
              label={t("agents.details.configFile")}
              value={configPath}
            />
            <DetailRow
              label={t("agents.details.cliVersion")}
              value={cliVersion}
            />
          </div>
          {diagnosticsError && (
            <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-amber-500/20 bg-amber-500/5 p-3 text-[14px] leading-relaxed text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {diagnosticsError}
            </div>
          )}
        </section>

        <section className="border-t border-white/10 py-5">
          <h3 className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-[var(--ink-subtle)] uppercase">
            {t("agents.env.title")}
          </h3>
          <div>
            <textarea
              value={envText}
              onChange={(event) => {
                setEnvText(event.target.value);
                setEnvDirty(true);
              }}
              onBlur={() => {
                void runAutoSave();
              }}
              rows={Math.max(4, Math.min(10, envText.split(/\r?\n/u).length))}
              spellCheck={false}
              placeholder={t("agents.env.placeholder")}
              className="block w-full resize-y rounded-[6px] border border-transparent bg-transparent px-2.5 py-2 font-mono text-[12px] leading-[1.55] text-[var(--ink)] outline-none transition-all placeholder:text-[var(--ink-tertiary)] hover:border-white/10 hover:bg-white/[0.025] focus:border-white/20 focus:bg-transparent focus:ring-1 focus:ring-white/10"
            />
          </div>
        </section>

        <section className="border-t border-white/10 py-5">
          <h3 className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-[var(--ink-subtle)] uppercase">
            {t("agents.config.title")}
          </h3>

          <div>
            {schemaFields.length === 0 ? (
              <ModelConfigField
                runner={runner.runner_type}
                models={modelOptions}
                modelSource={modelSource}
                value={formData.model}
                onChange={handleConfigFieldChange}
                onModelSaved={handleModelSaved}
                t={t}
              />
            ) : (
              <div className="space-y-1">
                <ModelConfigField
                  runner={runner.runner_type}
                  models={modelOptions}
                  modelSource={modelSource}
                  value={formData.model}
                  onChange={handleConfigFieldChange}
                  onModelSaved={handleModelSaved}
                  t={t}
                />
                {schemaFields.map(([fieldKey, property]) => (
                  <ConfigSchemaField
                    key={fieldKey}
                    runner={runner.runner_type}
                    fieldKey={fieldKey}
                    property={property}
                    value={formData[fieldKey]}
                    onChange={handleConfigFieldChange}
                    onCommit={runAutoSave}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>

          {saveError && (
            <div className="mt-4 flex items-start gap-2 rounded-[8px] border border-red-500/20 bg-red-500/5 p-3 text-[14px] leading-relaxed text-red-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {saveError}
            </div>
          )}
        </section>
      </div>

    </aside>
  );
}

function AgentConfigEmptyState({ t }: { t: TranslateFn }) {
  return (
    <aside
      className={cx(
        "flex h-full min-h-0 flex-col bg-[var(--surface-2)]",
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-[8px] border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-tertiary)]">
          <Settings className="h-5 w-5" />
        </span>
        <h3 className="mt-3 text-[14px] font-medium text-[var(--ink)]">
          {t("agents.sidebar.selectTitle")}
        </h3>
        <p className="mt-1 max-w-[260px] text-[14px] leading-[1.5] text-[var(--ink-tertiary)]">
          {t("agents.sidebar.selectDesc")}
        </p>
      </div>
    </aside>
  );
}

/* ========== Main page ========== */

export function AgentsPage() {
  const { t, showToast } = useWorkspace();
  const [runners, setRunners] = useState<AgentRuntimeStatus[]>([]);
  const runnersRef = useRef<AgentRuntimeStatus[]>([]);
  const agentsPageRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<AgentRuntimeFilter>("all");
  const [loading, setLoading] = useState(true);
  const [runtimeLoaded, setRuntimeLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedRunner, setSelectedRunner] =
    useState<AgentRuntimeStatus | null>(null);
  const [agentNavCollapsed, setAgentNavCollapsed] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const discoveryRefreshedNotice = t("agents.notice.discoveryRefreshed");
  const configSavedNotice = t("agents.notice.configSaved");

  const statusFilterOptions = useMemo(() => createStatusFilterOptions(t), [t]);
  const toggleAgentNavCollapsed = useCallback(() => {
    setAgentNavCollapsed((current) => !current);
  }, []);
  const autoDismissNotices = useMemo(
    () => new Set([discoveryRefreshedNotice, configSavedNotice]),
    [configSavedNotice, discoveryRefreshedNotice],
  );

  useShortcutScope('agent-runtime', {
    active: true,
    rootRef: agentsPageRef,
  });
  useCommandHandler('agent-runtime.sidebar.toggle', {
    scope: 'page',
    enabled: true,
    execute: toggleAgentNavCollapsed,
  });

  const notifyRuntimeErrors = useCallback(
    (next: AgentRuntimeStatus[], previous: AgentRuntimeStatus[]) => {
      for (const runner of next) {
        if (getRuntimeDisplayState(runner) !== "error") continue;
        const previousRunner = previous.find(
          (item) => item.runner_type === runner.runner_type,
        );
        if (!previousRunner) continue;

        const message = getRuntimeErrorMessage(runner, t);
        if (!message) continue;

        const previousMessage = getRuntimeErrorMessage(previousRunner, t);
        if (
          getRuntimeDisplayState(previousRunner) !== "error" ||
          previousMessage !== message
        ) {
          showToast(`${getRunnerLabel(runner.runner_type)}: ${message}`);
          return;
        }
      }
    },
    [showToast, t],
  );

  const updateRuntimeRunners = useCallback(
    (next: AgentRuntimeStatus[], options?: RuntimeRunnerUpdateOptions) => {
      const previous = runnersRef.current;
      if (options?.notifyErrors) {
        notifyRuntimeErrors(next, previous);
      }
      runnersRef.current = next;
      setRunners(next);
    },
    [notifyRuntimeErrors],
  );

  const updateRuntimeRunnersWith = useCallback(
    (
      updater: (current: AgentRuntimeStatus[]) => AgentRuntimeStatus[],
      options?: RuntimeRunnerUpdateOptions,
    ) => {
      const previous = runnersRef.current;
      const next = updater(previous);
      if (options?.notifyErrors) {
        notifyRuntimeErrors(next, previous);
      }
      runnersRef.current = next;
      setRunners(next);
    },
    [notifyRuntimeErrors],
  );

  const replaceRuntimeRunner = useCallback(
    (updated: AgentRuntimeStatus, options?: RuntimeRunnerUpdateOptions) => {
      updateRuntimeRunnersWith(
        (current) =>
          current.map((item) =>
            item.runner_type === updated.runner_type ? updated : item,
          ),
        options,
      );
    },
    [updateRuntimeRunnersWith],
  );

  const filteredRunners = useMemo(
    () =>
      sortRunnersByAvailability(filterRuntimeRunners(runners, "", filter)),
    [filter, runners],
  );
  const suppressRuntimePlaceholder =
    !runtimeLoaded || (loading && runners.length === 0);

  const loadRuntime = useCallback(
    async (options?: { showLoading?: boolean }) => {
      const showLoading = options?.showLoading ?? true;
      if (showLoading) setLoading(true);
      if (showLoading) setLoadError(null);
      try {
        const response = await agentRuntimeApi.list();
        updateRuntimeRunners(response.runners);
        setRuntimeLoaded(true);
        setLoadError(null);
      } catch (error) {
        if (showLoading) {
          setRuntimeLoaded(true);
          setLoadError(
            error instanceof Error ? error.message : t("agents.load.failed"),
          );
        }
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [t, updateRuntimeRunners],
  );

  useEffect(() => {
    void loadRuntime();
  }, [loadRuntime]);

  useEffect(() => {
    setSelectedRunner((current) => {
      if (!current) return current;
      return (
        runners.find((runner) => runner.runner_type === current.runner_type) ??
        current
      );
    });
  }, [runners]);

  useEffect(() => {
    if (!notice) return;
    if (!autoDismissNotices.has(notice)) return;

    const timeoutId = window.setTimeout(() => {
      setNotice(null);
    }, 3500);

    return () => window.clearTimeout(timeoutId);
  }, [autoDismissNotices, notice]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const response = await agentRuntimeApi.refresh();
      updateRuntimeRunners(response.runners, { notifyErrors: true });
      setNotice(
        response.errors.length > 0
          ? t("agents.notice.refreshFailedCount", {
              count: response.errors.length,
            })
          : discoveryRefreshedNotice,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("agents.refresh.failed");
      setNotice(message);
      showToast(message);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDiagnosticsLoaded = useCallback(
    (diagnostics: AgentRuntimeDiagnostics) => {
      updateRuntimeRunnersWith(
        (current) =>
          current.map((item) => {
            if (item.runner_type !== diagnostics.runner_type) return item;
            const next = {
              ...item,
              installed: diagnostics.installed,
              executable: diagnostics.executable,
              availability: diagnostics.availability,
              discovered_models: diagnostics.discovered_models,
              model_source: diagnostics.model_source,
              version: diagnostics.version,
              last_checked_at: diagnostics.last_checked_at,
              last_error: diagnostics.last_error,
              run_mode: diagnostics.run_mode,
              env_summary: diagnostics.env_summary,
              executor_options: diagnostics.executor_options,
            };
            return shouldApplyRuntimeSnapshot(item, next) ? next : item;
          }),
        { notifyErrors: true },
      );
    },
    [updateRuntimeRunnersWith],
  );

  const handleSave = async (
    runner: BaseCodingAgent,
    formData: Record<string, JsonValue | undefined>,
    envJson: Record<string, string> | null,
  ) => {
    setSaveError(null);
    try {
      const updated = await agentRuntimeApi.updateConfig(runner, {
        run_mode: null,
        env_json: envJson,
        executor_options: formData as JsonValue,
      });
      replaceRuntimeRunner(updated);
      setSelectedRunner(updated);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : t("agents.save.failed"),
      );
      throw error;
    }
  };

  const handleOpenConfig = useCallback(
    (runner: AgentRuntimeStatus) => {
      setSelectedRunner(runner);
      setSaveError(null);
    },
    [],
  );
  const systemBreadcrumbLabel = t("agents.breadcrumb.system");
  const agentNavToggleLabel = agentNavCollapsed
    ? "Expand agent list (Ctrl/Cmd+B)"
    : "Collapse agent list (Ctrl/Cmd+B)";

  return (
    <div ref={agentsPageRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--surface-2)] text-[var(--ink)]">
      <header className="flex h-[49px] shrink-0 items-center justify-between border-b border-[var(--hairline)] bg-[var(--surface-2)] px-[29px]">
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 items-center gap-[7px]"
        >
          <span
            role="img"
            aria-label={systemBreadcrumbLabel}
            title={systemBreadcrumbLabel}
            className="flex h-[19px] w-[19px] shrink-0 items-center justify-center text-[var(--primary)]"
          >
            <Settings aria-hidden="true" className="h-[17px] w-[17px]" />
          </span>
          <ChevronRight
            aria-hidden="true"
            className="h-[15px] w-[15px] shrink-0 text-[#8f9298]"
            strokeWidth={2.4}
          />
          <h1 className="truncate text-[16px] font-semibold leading-[1.25] text-[var(--ink)]">
            {t("agents.page.title")}
          </h1>
        </nav>

        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            data-command-id="agent-runtime.sidebar.toggle"
            onClick={toggleAgentNavCollapsed}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)]"
            aria-label={agentNavToggleLabel}
            title={agentNavToggleLabel}
          >
            {agentNavCollapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" />
            )}
          </button>
          <DropdownSelect
            value={filter}
            options={statusFilterOptions}
            showSearch={false}
            triggerIcon={
              <ListFilter className="h-3.5 w-3.5 shrink-0 text-[var(--ink-tertiary)]" />
            }
            className="w-7 [&>button]:h-7 [&>button]:w-7 [&>button]:justify-center [&>button]:gap-0 [&>button]:rounded-full [&>button]:border-[var(--hairline)] [&>button]:bg-[var(--surface-2)] [&>button]:p-0 [&>button>span]:hidden [&>button>svg:last-child]:hidden"
            panelClassName="max-w-none"
            panelMinWidth={180}
            maxPanelHeightClassName="max-h-[220px]"
            onChange={(value) => setFilter(value as AgentRuntimeFilter)}
          />
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--ink-tertiary)] transition hover:bg-[var(--surface-3)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={refreshing ? t("agents.refreshing") : t("agents.refresh")}
            title={refreshing ? t("agents.refreshing") : t("agents.refresh")}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--surface-2)]">
        {(loadError || notice) && (
          <div className="shrink-0 space-y-2 border-b border-[var(--hairline)] p-3">
            {loadError && (
              <div className="rounded-[8px] border border-red-500/30 bg-red-500/10 p-3 text-[14px] text-red-300">
                <span className="inline-flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  {t("agents.load.failedTitle")}
                </span>
                <p className="mt-1 text-red-300/80">{loadError}</p>
              </div>
            )}
            {notice && (
              <div className="rounded-[8px] border border-[var(--primary)]/30 bg-[var(--primary-tint)] p-3 text-[14px] text-[var(--primary)]">
                {notice}
              </div>
            )}
          </div>
        )}

        <div
          className={cx(
            "flex min-h-0 flex-1 flex-col overflow-hidden lg:grid",
            agentNavCollapsed
              ? "lg:grid-cols-[64px_minmax(0,1fr)]"
              : "lg:grid-cols-[256px_minmax(0,1fr)]",
          )}
        >
          <div
            className={cx(
              "min-h-0 flex-1 overflow-y-auto border-r border-white/10 py-3 ot-scroll-area-styled",
              agentNavCollapsed ? "px-1.5" : "px-2",
            )}
          >
            {suppressRuntimePlaceholder ? (
              null
            ) : filteredRunners.length === 0 ? (
              <div className="flex min-h-[240px] flex-col items-center justify-center text-center">
                <Bot className="h-8 w-8 text-[var(--ink-tertiary)]" />
                <h3 className="mt-3 text-[14px] font-medium text-[var(--ink)]">
                  {t("agents.empty.title")}
                </h3>
                <p className="mt-1 max-w-sm text-[14px] leading-[1.5] text-[var(--ink-subtle)]">
                  {t("agents.empty.desc")}
                </p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredRunners.map((runner) => (
                  <AgentRow
                    key={runner.runner_type}
                    runner={runner}
                    selected={selectedRunner?.runner_type === runner.runner_type}
                    collapsed={agentNavCollapsed}
                    onOpenConfig={() => handleOpenConfig(runner)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="min-h-[360px] overflow-hidden border-t border-[var(--hairline)] lg:min-h-0 lg:border-t-0">
            {!runtimeLoaded ? (
              null
            ) : selectedRunner ? (
              <AgentConfigSidebar
                runner={selectedRunner}
                saveError={saveError}
                onClose={() => setSelectedRunner(null)}
                onSave={handleSave}
                onDiagnosticsLoaded={handleDiagnosticsLoaded}
                t={t}
              />
            ) : (
              <AgentConfigEmptyState t={t} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
