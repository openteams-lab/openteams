/**
 * Analytics Service for tracking user events
 * Provides batch event sending and offline queue support
 */

// Event types supported by the analytics system
export type EventCategory = 'user_action' | 'system' | 'conversion';

export interface TrackEventRequest {
  event_type: string;
  event_category: EventCategory;
  user_id?: string;
  session_id?: string;
  properties: Record<string, unknown>;
  platform?: string;
  app_version?: string;
  os?: string;
  device_id?: string;
}

export interface TrackEventsBatchRequest {
  events: TrackEventRequest[];
}

// Event type to category mapping
const EVENT_CATEGORIES: Record<string, EventCategory> = {
  // User actions
  session_create: 'user_action',
  session_archive: 'user_action',
  session_restore: 'user_action',
  session_delete: 'user_action',
  message_send: 'user_action',
  agent_add: 'user_action',
  agent_remove: 'user_action',
  skill_install: 'user_action',
  skill_assign: 'user_action',
  skill_enable: 'user_action',
  skill_disable: 'user_action',

  // System events
  agent_run_start: 'system',
  agent_run_complete: 'system',
  agent_run_error: 'system',
  agent_stop: 'system',
  context_compression: 'system',
  token_usage: 'system',
  skill_invoke: 'system',

  // Conversion events
  first_session: 'conversion',
  returning_user: 'conversion',
  first_agent_added: 'conversion',
  first_message_sent: 'conversion',
  first_skill_used: 'conversion',
};

class AnalyticsService {
  private deviceId: string;
  private userId?: string;
  private queue: TrackEventRequest[] = [];
  private flushInterval = 5000; // 5 seconds
  private maxQueueSize = 50;
  private isFlushing = false;
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.deviceId = this.getOrCreateDeviceId();
    this.startFlushTimer();
    this.setupUnloadHandler();
  }

  // Get or create a persistent device ID
  private getOrCreateDeviceId(): string {
    const STORAGE_KEY = 'analytics_device_id';
    let deviceId = localStorage.getItem(STORAGE_KEY);

    if (!deviceId) {
      deviceId = this.generateUUID();
      localStorage.setItem(STORAGE_KEY, deviceId);
    }

    return deviceId;
  }

  // Generate a UUID
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Infer event category from event type
  private inferCategory(eventType: string): EventCategory {
    return EVENT_CATEGORIES[eventType] || 'user_action';
  }

  // Get platform information
  private getPlatform(): string {
    if (typeof window !== 'undefined') {
      const ua = navigator.userAgent;
      if (/electron/i.test(ua)) return 'desktop';
      if (/mobile/i.test(ua)) return 'mobile';
      return 'web';
    }
    return 'unknown';
  }

  // Get OS information
  private getOS(): string {
    if (typeof window !== 'undefined') {
      const ua = navigator.userAgent;
      if (/windows/i.test(ua)) return 'Windows';
      if (/mac/i.test(ua)) return 'macOS';
      if (/linux/i.test(ua)) return 'Linux';
      if (/android/i.test(ua)) return 'Android';
      if (/ios|iphone|ipad/i.test(ua)) return 'iOS';
    }
    return 'unknown';
  }

  // Set user ID
  setUserId(userId: string | undefined) {
    this.userId = userId;
  }

  // Track a single event
  track(
    eventType: string,
    properties: Record<string, unknown> = {},
    sessionId?: string
  ) {
    const event: TrackEventRequest = {
      event_type: eventType,
      event_category: this.inferCategory(eventType),
      user_id: this.userId,
      session_id: sessionId,
      properties,
      platform: this.getPlatform(),
      app_version: __APP_VERSION__,
      os: this.getOS(),
      device_id: this.deviceId,
    };

    this.queue.push(event);

    // Flush if queue is full
    if (this.queue.length >= this.maxQueueSize) {
      this.flush();
    }
  }

  // Session events
  trackSessionCreate(sessionId: string, titleLength: number) {
    this.track(
      'session_create',
      { title_length: titleLength },
      sessionId
    );
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
      sessionId
    );
  }

  trackSessionRestore(sessionId: string) {
    this.track('session_restore', {}, sessionId);
  }

  trackSessionDelete(sessionId: string, hadMessages: boolean) {
    this.track('session_delete', { had_messages: hadMessages }, sessionId);
  }

  // Message events
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
        mentions,
        has_attachment: hasAttachment,
        attachment_count: attachmentCount,
      },
      sessionId
    );
  }

  // Agent events
  trackAgentAdd(
    sessionId: string,
    agentId: string,
    agentName: string,
    runnerType: string,
    hasWorkspace: boolean
  ) {
    this.track(
      'agent_add',
      {
        agent_id: agentId,
        agent_name: agentName,
        runner_type: runnerType,
        has_workspace: hasWorkspace,
      },
      sessionId
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
      sessionId
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
      sessionId
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
      sessionId
    );
  }

  trackAgentRunError(
    sessionId: string,
    agentId: string,
    runId: string,
    errorType: string,
    errorMessage: string
  ) {
    this.track(
      'agent_run_error',
      {
        agent_id: agentId,
        run_id: runId,
        error_type: errorType,
        error_message: errorMessage,
      },
      sessionId
    );
  }

  // Skill events
  trackSkillInstall(
    skillId: string,
    skillName: string,
    source: 'builtin' | 'registry'
  ) {
    this.track('skill_install', {
      skill_id: skillId,
      skill_name: skillName,
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
      sessionId
    );
  }

  // Conversion events
  trackFirstSession(userId: string, sessionId: string) {
    this.track('first_session', { user_id: userId }, sessionId);
  }

  trackReturningUser(userId: string, daysSinceLastVisit: number) {
    this.track('returning_user', {
      user_id: userId,
      days_since_last_visit: daysSinceLastVisit,
    });
  }

  // Start the flush timer
  private startFlushTimer() {
    if (typeof window !== 'undefined') {
      this.flushTimer = setInterval(() => {
        this.flush();
      }, this.flushInterval);
    }
  }

  // Setup unload handler to flush remaining events
  private setupUnloadHandler() {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.flush();
      });

      // Also flush on visibility change (mobile)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flush();
        }
      });
    }
  }

  // Flush events to server
  async flush(): Promise<void> {
    if (this.queue.length === 0 || this.isFlushing) {
      return;
    }

    this.isFlushing = true;
    const events = [...this.queue];
    this.queue = [];

    try {
      const response = await fetch('/api/analytics/events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events } as TrackEventsBatchRequest),
      });

      if (!response.ok) {
        // Re-queue events on failure (up to max queue size)
        const remainingSpace = this.maxQueueSize - this.queue.length;
        this.queue = [...events.slice(-remainingSpace), ...this.queue];
      }
    } catch (error) {
      // Re-queue events on network error
      const remainingSpace = this.maxQueueSize - this.queue.length;
      this.queue = [...events.slice(-remainingSpace), ...this.queue];
      console.warn('Analytics flush failed:', error);
    } finally {
      this.isFlushing = false;
    }
  }

  // Manually flush (useful for testing or critical events)
  async forceFlush(): Promise<void> {
    await this.flush();
  }

  // Clear the queue
  clearQueue(): void {
    this.queue = [];
  }

  // Get current queue size (for debugging)
  getQueueSize(): number {
    return this.queue.length;
  }
}

// Create singleton instance
export const analytics = new AnalyticsService();

// Export class for testing
export { AnalyticsService };