/**
 * Unified frontend analytics client.
 *
 * Preferred write path:
 *   POST /api/analytics/collect/batch
 *
 * Temporary fallback before B1 lands:
 *   POST /api/analytics/events/batch
 */

export type EventCategory = 'user_action' | 'system' | 'conversion';
export type AnalyticsSource = 'frontend';
export type AnalyticsPlatform = 'desktop' | 'mobile' | 'web' | 'unknown';

type AnalyticsTransportMode = 'auto' | 'collect' | 'legacy';
type PropertyValue = string | number | boolean;

type PropertySanitizer = (value: unknown) => PropertyValue | undefined;

interface EventDefinition {
  category: EventCategory;
  version: number;
  legacyType?: string;
  properties: Record<string, PropertySanitizer>;
}

const stringProperty =
  (maxLength = 128, allowedValues?: readonly string[]): PropertySanitizer =>
  (value) => {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }

    if (allowedValues && !allowedValues.includes(normalized)) {
      return undefined;
    }

    return normalized.slice(0, maxLength);
  };

const integerProperty =
  (min = 0, max = Number.MAX_SAFE_INTEGER): PropertySanitizer =>
  (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    const normalized = Math.trunc(value);
    if (normalized < min || normalized > max) {
      return undefined;
    }

    return normalized;
  };

const numberProperty =
  (min = 0, max = Number.MAX_SAFE_INTEGER): PropertySanitizer =>
  (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return undefined;
    }

    if (value < min || value > max) {
      return undefined;
    }

    return value;
  };

const booleanProperty: PropertySanitizer = (value) =>
  typeof value === 'boolean' ? value : undefined;

const idProperty = stringProperty(128);
const enumProperty = (values: readonly string[]): PropertySanitizer =>
  stringProperty(64, values);

const EVENT_DEFINITIONS = {
  ui_new_accessed: {
    category: 'user_action',
    version: 1,
    properties: {
      surface: enumProperty(['new_design']),
    },
  },
  preview_navigated: {
    category: 'user_action',
    version: 1,
    properties: {
      trigger: enumProperty(['button', 'keyboard']),
      direction: enumProperty(['forward', 'backward']),
      project_id: idProperty,
      task_id: idProperty,
      attempt_id: idProperty,
    },
  },
  diffs_navigated: {
    category: 'user_action',
    version: 1,
    properties: {
      trigger: enumProperty(['button', 'keyboard']),
      direction: enumProperty(['forward', 'backward']),
      project_id: idProperty,
      task_id: idProperty,
      attempt_id: idProperty,
    },
  },
  view_closed: {
    category: 'user_action',
    version: 1,
    properties: {
      trigger: enumProperty(['button']),
      from_view: enumProperty(['attempt', 'preview', 'diffs']),
      project_id: idProperty,
      task_id: idProperty,
      attempt_id: idProperty,
    },
  },
  session_create: {
    category: 'user_action',
    version: 1,
    properties: {
      title_length: integerProperty(),
    },
  },
  session_archive: {
    category: 'user_action',
    version: 1,
    properties: {
      duration_seconds: integerProperty(),
      message_count: integerProperty(),
      agent_count: integerProperty(),
    },
  },
  session_restore: {
    category: 'user_action',
    version: 1,
    properties: {},
  },
  session_delete: {
    category: 'user_action',
    version: 1,
    properties: {
      had_messages: booleanProperty,
    },
  },
  message_send: {
    category: 'user_action',
    version: 1,
    properties: {
      message_length: integerProperty(),
      mention_count: integerProperty(),
      has_attachment: booleanProperty,
      attachment_count: integerProperty(),
    },
  },
  agent_add: {
    category: 'user_action',
    version: 1,
    properties: {
      agent_id: idProperty,
      runner_type: stringProperty(64),
      has_workspace: booleanProperty,
    },
  },
  agent_remove: {
    category: 'user_action',
    version: 1,
    properties: {
      agent_id: idProperty,
      session_duration_seconds: integerProperty(),
    },
  },
  agent_run_start: {
    category: 'system',
    version: 1,
    properties: {
      agent_id: idProperty,
      run_id: idProperty,
      executor_profile: stringProperty(64),
    },
  },
  agent_run_complete: {
    category: 'system',
    version: 1,
    properties: {
      agent_id: idProperty,
      run_id: idProperty,
      duration_ms: integerProperty(),
      success: booleanProperty,
      token_count: integerProperty(),
    },
  },
  agent_run_error: {
    category: 'system',
    version: 1,
    properties: {
      agent_id: idProperty,
      run_id: idProperty,
      error_type: stringProperty(64),
    },
  },
  skill_install: {
    category: 'user_action',
    version: 1,
    properties: {
      skill_id: idProperty,
      source: enumProperty(['builtin', 'registry']),
    },
  },
  skill_assign: {
    category: 'user_action',
    version: 1,
    properties: {
      skill_id: idProperty,
      agent_id: idProperty,
    },
  },
  skill_enable: {
    category: 'user_action',
    version: 1,
    properties: {
      skill_id: idProperty,
      agent_id: idProperty,
    },
  },
  skill_disable: {
    category: 'user_action',
    version: 1,
    properties: {
      skill_id: idProperty,
      agent_id: idProperty,
    },
  },
  skill_invoke: {
    category: 'system',
    version: 1,
    properties: {
      skill_id: idProperty,
      agent_id: idProperty,
    },
  },
  first_session: {
    category: 'conversion',
    version: 1,
    properties: {},
  },
  returning_user: {
    category: 'conversion',
    version: 1,
    properties: {
      days_since_last_visit: numberProperty(),
    },
  },
} as const satisfies Record<string, EventDefinition>;

export type AnalyticsEventName = keyof typeof EVENT_DEFINITIONS;

export interface CollectorEventRequest {
  event_id: string;
  event_name: AnalyticsEventName;
  event_version: number;
  occurred_at: string;
  source: AnalyticsSource;
  platform: AnalyticsPlatform;
  app_version: string;
  session_id?: string;
  trace_id: string;
  properties: Record<string, PropertyValue>;
}

export interface CollectorBatchRequest {
  events: CollectorEventRequest[];
}

export interface LegacyTrackEventRequest {
  event_type: string;
  event_category: EventCategory;
  user_id?: string;
  session_id?: string;
  properties: Record<string, PropertyValue>;
  platform?: AnalyticsPlatform;
  app_version?: string;
  os?: string;
  device_id?: string;
}

export interface LegacyTrackEventsBatchRequest {
  events: LegacyTrackEventRequest[];
}

interface QueuedAnalyticsEvent {
  event: CollectorEventRequest;
  legacy_event_type: string;
  event_category: EventCategory;
  attempts: number;
}

interface AnalyticsClientConfig {
  enabled?: boolean;
  userId?: string;
}

interface TrackOptions {
  sessionId?: string;
  traceId?: string;
}

interface ViewTrackingContext {
  trigger: 'button' | 'keyboard';
  direction?: 'forward' | 'backward';
  fromView?: 'attempt' | 'preview' | 'diffs';
  projectId?: string;
  taskId?: string;
  attemptId?: string | null;
}

const DEVICE_ID_STORAGE_KEY = 'analytics_device_id';
const OUTBOX_STORAGE_KEY = 'analytics_outbox_v2';
const COLLECT_BATCH_ENDPOINT = '/api/analytics/collect/batch';
const LEGACY_BATCH_ENDPOINT = '/api/analytics/events/batch';
const COLLECT_FALLBACK_STATUSES = new Set([404, 405, 410, 501]);

class AnalyticsService {
  private readonly deviceId: string;
  private userId?: string;
  private enabled = false;
  private hasConfigured = false;
  private queue: QueuedAnalyticsEvent[] = [];
  private flushIntervalMs = 5000;
  private maxQueueSize = 200;
  private maxBatchSize = 50;
  private isFlushing = false;
  private consecutiveFailures = 0;
  private nextRetryAt = 0;
  private transportMode: AnalyticsTransportMode = 'auto';

  constructor() {
    this.deviceId = this.getOrCreateDeviceId();
    this.queue = this.loadQueue();
    this.startFlushTimer();
    this.setupUnloadHandler();
  }

  configure(config: AnalyticsClientConfig): void {
    this.hasConfigured = true;

    if (typeof config.enabled === 'boolean') {
      this.enabled = config.enabled;
    }

    if (config.userId !== undefined) {
      this.userId = config.userId;
    }

    if (!this.enabled) {
      this.clearQueue();
      return;
    }

    if (this.queue.length > 0) {
      void this.flush();
    }
  }

  setUserId(userId: string | undefined) {
    this.userId = userId;
  }

  track(
    eventName: AnalyticsEventName,
    properties: Record<string, unknown> = {},
    options: TrackOptions = {}
  ) {
    if (this.hasConfigured && !this.enabled) {
      return;
    }

    const definition: EventDefinition = EVENT_DEFINITIONS[eventName];
    const sanitizedProperties = this.sanitizeProperties(
      definition.properties,
      properties
    );
    const occurredAt = new Date().toISOString();
    const sanitizedSessionIdValue = idProperty(options.sessionId);
    const sanitizedSessionId =
      typeof sanitizedSessionIdValue === 'string'
        ? sanitizedSessionIdValue
        : undefined;
    const legacyEventType = definition.legacyType;
    const event: CollectorEventRequest = {
      event_id: this.generateEventId(),
      event_name: eventName,
      event_version: definition.version,
      occurred_at: occurredAt,
      source: 'frontend',
      platform: this.getPlatform(),
      app_version: __APP_VERSION__,
      session_id: sanitizedSessionId,
      trace_id: options.traceId ?? this.generateEventId(),
      properties: sanitizedProperties,
    };

    this.queue.push({
      event,
      legacy_event_type: legacyEventType ?? eventName,
      event_category: definition.category,
      attempts: 0,
    });

    if (this.queue.length > this.maxQueueSize) {
      this.queue = this.queue.slice(-this.maxQueueSize);
    }

    this.persistQueue();

    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  trackUiNewAccessed() {
    this.track('ui_new_accessed', { surface: 'new_design' });
  }

  trackPreviewNavigated(context: ViewTrackingContext) {
    this.track('preview_navigated', {
      trigger: context.trigger,
      direction: context.direction,
      project_id: context.projectId,
      task_id: context.taskId,
      attempt_id: context.attemptId ?? undefined,
    });
  }

  trackDiffsNavigated(context: ViewTrackingContext) {
    this.track('diffs_navigated', {
      trigger: context.trigger,
      direction: context.direction,
      project_id: context.projectId,
      task_id: context.taskId,
      attempt_id: context.attemptId ?? undefined,
    });
  }

  trackViewClosed(context: ViewTrackingContext) {
    this.track('view_closed', {
      trigger: context.trigger,
      from_view: context.fromView,
      project_id: context.projectId,
      task_id: context.taskId,
      attempt_id: context.attemptId ?? undefined,
    });
  }

  trackSessionCreate(sessionId: string, titleLength: number) {
    this.track('session_create', { title_length: titleLength }, { sessionId });
  }

  trackSessionArchive(
    sessionId: string,
    durationSeconds: number,
    messageCount: number,
    agentCount: number
  ) {
    this.track(
      'session_archive',
      {
        duration_seconds: durationSeconds,
        message_count: messageCount,
        agent_count: agentCount,
      },
      { sessionId }
    );
  }

  trackSessionRestore(sessionId: string) {
    this.track('session_restore', {}, { sessionId });
  }

  trackSessionDelete(sessionId: string, hadMessages: boolean) {
    this.track('session_delete', { had_messages: hadMessages }, { sessionId });
  }

  trackMessageSend(
    sessionId: string,
    messageLength: number,
    mentions: string[],
    hasAttachment: boolean = false,
    attachmentCount: number = 0
  ) {
    this.track(
      'message_send',
      {
        message_length: messageLength,
        mention_count: mentions.length,
        has_attachment: hasAttachment,
        attachment_count: attachmentCount,
      },
      { sessionId }
    );
  }

  trackAgentAdd(
    sessionId: string,
    agentId: string,
    _agentName: string,
    runnerType: string,
    hasWorkspace: boolean
  ) {
    this.track(
      'agent_add',
      {
        agent_id: agentId,
        runner_type: runnerType,
        has_workspace: hasWorkspace,
      },
      { sessionId }
    );
  }

  trackAgentRemove(
    sessionId: string,
    agentId: string,
    sessionDurationSeconds: number
  ) {
    this.track(
      'agent_remove',
      {
        agent_id: agentId,
        session_duration_seconds: sessionDurationSeconds,
      },
      { sessionId }
    );
  }

  trackAgentRunStart(
    sessionId: string,
    agentId: string,
    runId: string,
    executorProfile?: string
  ) {
    this.track(
      'agent_run_start',
      {
        agent_id: agentId,
        run_id: runId,
        executor_profile: executorProfile,
      },
      { sessionId }
    );
  }

  trackAgentRunComplete(
    sessionId: string,
    agentId: string,
    runId: string,
    durationMs: number,
    success: boolean,
    tokenCount?: number
  ) {
    this.track(
      'agent_run_complete',
      {
        agent_id: agentId,
        run_id: runId,
        duration_ms: durationMs,
        success,
        token_count: tokenCount,
      },
      { sessionId }
    );
  }

  trackAgentRunError(
    sessionId: string,
    agentId: string,
    runId: string,
    errorType: string
  ) {
    this.track(
      'agent_run_error',
      {
        agent_id: agentId,
        run_id: runId,
        error_type: errorType,
      },
      { sessionId }
    );
  }

  trackSkillInstall(
    skillId: string,
    _skillName: string,
    source: 'builtin' | 'registry'
  ) {
    this.track('skill_install', {
      skill_id: skillId,
      source,
    });
  }

  trackSkillAssign(skillId: string, agentId: string) {
    this.track('skill_assign', {
      skill_id: skillId,
      agent_id: agentId,
    });
  }

  trackSkillEnable(skillId: string, agentId: string) {
    this.track('skill_enable', {
      skill_id: skillId,
      agent_id: agentId,
    });
  }

  trackSkillDisable(skillId: string, agentId: string) {
    this.track('skill_disable', {
      skill_id: skillId,
      agent_id: agentId,
    });
  }

  trackSkillInvoke(sessionId: string, skillId: string, agentId: string) {
    this.track(
      'skill_invoke',
      {
        skill_id: skillId,
        agent_id: agentId,
      },
      { sessionId }
    );
  }

  trackFirstSession(_userId: string, sessionId: string) {
    this.track('first_session', {}, { sessionId });
  }

  trackReturningUser(_userId: string, daysSinceLastVisit: number) {
    this.track('returning_user', {
      days_since_last_visit: daysSinceLastVisit,
    });
  }

  async flush(): Promise<void> {
    if (!this.enabled || this.queue.length === 0 || this.isFlushing) {
      return;
    }

    if (Date.now() < this.nextRetryAt) {
      return;
    }

    this.isFlushing = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.slice(0, this.maxBatchSize);
        const sent = await this.sendBatch(batch);

        if (!sent) {
          batch.forEach((_, index) => {
            if (this.queue[index]) {
              this.queue[index] = {
                ...this.queue[index],
                attempts: this.queue[index].attempts + 1,
              };
            }
          });
          this.registerFailure();
          this.persistQueue();
          return;
        }

        this.queue = this.queue.slice(batch.length);
        this.registerSuccess();
        this.persistQueue();
      }
    } finally {
      this.isFlushing = false;
    }
  }

  async forceFlush(): Promise<void> {
    await this.flush();
  }

  clearQueue(): void {
    this.queue = [];
    this.consecutiveFailures = 0;
    this.nextRetryAt = 0;
    this.persistQueue();
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  private sanitizeProperties(
    schema: Record<string, PropertySanitizer>,
    properties: Record<string, unknown>
  ): Record<string, PropertyValue> {
    const sanitizedEntries = Object.entries(schema)
      .map(([key, sanitizer]) => {
        const sanitizedValue = sanitizer(properties[key]);
        return sanitizedValue === undefined ? null : [key, sanitizedValue];
      })
      .filter((entry): entry is [string, PropertyValue] => entry !== null);

    return Object.fromEntries(sanitizedEntries);
  }

  private async sendBatch(batch: QueuedAnalyticsEvent[]): Promise<boolean> {
    if (this.transportMode !== 'legacy') {
      const collectResult = await this.sendCollectorBatch(batch);
      if (collectResult === 'success') {
        this.transportMode = 'collect';
        return true;
      }
      if (collectResult === 'fallback') {
        this.transportMode = 'legacy';
      } else {
        return false;
      }
    }

    return this.sendLegacyBatch(batch);
  }

  private async sendCollectorBatch(
    batch: QueuedAnalyticsEvent[]
  ): Promise<'success' | 'fallback' | 'failure'> {
    try {
      const response = await fetch(COLLECT_BATCH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: batch.map((item) => item.event),
        } as CollectorBatchRequest),
        keepalive: true,
      });

      if (response.ok) {
        return 'success';
      }

      if (COLLECT_FALLBACK_STATUSES.has(response.status)) {
        return 'fallback';
      }

      return 'failure';
    } catch (error) {
      console.warn('Analytics collector flush failed:', error);
      return 'failure';
    }
  }

  private async sendLegacyBatch(
    batch: QueuedAnalyticsEvent[]
  ): Promise<boolean> {
    try {
      const response = await fetch(LEGACY_BATCH_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: batch.map((item) => ({
            event_type: item.legacy_event_type,
            event_category: item.event_category,
            user_id: this.userId,
            session_id: item.event.session_id,
            properties: item.event.properties,
            platform: item.event.platform,
            app_version: item.event.app_version,
            os: this.getOS(),
            device_id: this.deviceId,
          })),
        } as LegacyTrackEventsBatchRequest),
        keepalive: true,
      });

      return response.ok;
    } catch (error) {
      console.warn('Legacy analytics flush failed:', error);
      return false;
    }
  }

  private registerSuccess() {
    this.consecutiveFailures = 0;
    this.nextRetryAt = 0;
  }

  private registerFailure() {
    this.consecutiveFailures = Math.min(this.consecutiveFailures + 1, 6);
    const delayMs =
      Math.min(1000 * 2 ** (this.consecutiveFailures - 1), 30000) +
      Math.floor(Math.random() * 250);
    this.nextRetryAt = Date.now() + delayMs;
  }

  private startFlushTimer() {
    if (typeof window === 'undefined') {
      return;
    }

    window.setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  private setupUnloadHandler() {
    if (typeof window === 'undefined') {
      return;
    }

    window.addEventListener('beforeunload', () => {
      void this.flush();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void this.flush();
      }
    });
  }

  private getOrCreateDeviceId(): string {
    if (typeof window === 'undefined') {
      return this.generateEventId();
    }

    const persistedId = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (persistedId) {
      return persistedId;
    }

    const nextId = this.generateEventId();
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, nextId);
    return nextId;
  }

  private loadQueue(): QueuedAnalyticsEvent[] {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const raw = localStorage.getItem(OUTBOX_STORAGE_KEY);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter(this.isQueuedAnalyticsEvent)
        .slice(-this.maxQueueSize);
    } catch (error) {
      console.warn('Failed to restore analytics outbox:', error);
      return [];
    }
  }

  private persistQueue() {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      if (this.queue.length === 0) {
        localStorage.removeItem(OUTBOX_STORAGE_KEY);
        return;
      }

      localStorage.setItem(OUTBOX_STORAGE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      console.warn('Failed to persist analytics outbox:', error);
    }
  }

  private isQueuedAnalyticsEvent = (
    value: unknown
  ): value is QueuedAnalyticsEvent => {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Partial<QueuedAnalyticsEvent>;
    return (
      typeof candidate.attempts === 'number' &&
      typeof candidate.legacy_event_type === 'string' &&
      typeof candidate.event_category === 'string' &&
      !!candidate.event &&
      typeof candidate.event.event_id === 'string' &&
      typeof candidate.event.event_name === 'string' &&
      typeof candidate.event.trace_id === 'string' &&
      typeof candidate.event.occurred_at === 'string' &&
      candidate.event.properties !== undefined
    );
  };

  private generateEventId(): string {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }

    return `evt-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  private getPlatform(): AnalyticsPlatform {
    if (typeof window === 'undefined') {
      return 'unknown';
    }

    const ua = navigator.userAgent;
    if (/electron/i.test(ua)) return 'desktop';
    if (/mobile/i.test(ua)) return 'mobile';
    return 'web';
  }

  private getOS(): string {
    if (typeof window === 'undefined') {
      return 'unknown';
    }

    const ua = navigator.userAgent;
    if (/windows/i.test(ua)) return 'Windows';
    if (/mac/i.test(ua)) return 'macOS';
    if (/linux/i.test(ua)) return 'Linux';
    if (/android/i.test(ua)) return 'Android';
    if (/ios|iphone|ipad/i.test(ua)) return 'iOS';
    return 'unknown';
  }
}

export const analytics = new AnalyticsService();

export { AnalyticsService };
