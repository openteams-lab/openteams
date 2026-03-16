/**
 * Format a date string as "Jan 5, 10:30 AM".
 */
export function formatDateShortWithTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a date string as a short date without time (e.g., "Jan 5").
 */
export function formatDateShort(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a date string as a relative time (e.g., "just now", "5m ago", "2h ago", "3d ago").
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Format a date string as a relative time with i18n support.
 * Returns relative time (e.g., "1小时", "1天", "7天") if within 15 days,
 * otherwise returns full date format (e.g., "1月15日").
 */
export function formatRelativeDateWithI18n(
  dateString: string,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  // More than 15 days - show full date
  if (diffDays > 15) {
    return date.toLocaleDateString(undefined, {
      month: 'numeric',
      day: 'numeric',
    });
  }

  // Within 1 minute
  if (diffSecs < 60) {
    return t('relativeTime.justNow', { defaultValue: '刚刚' });
  }

  // Within 1 hour
  if (diffMins < 60) {
    return t('relativeTime.minutesAgo', {
      count: diffMins,
      defaultValue: `${diffMins}分钟`,
    });
  }

  // Within 24 hours
  if (diffHours < 24) {
    return t('relativeTime.hoursAgo', {
      count: diffHours,
      defaultValue: `${diffHours}小时`,
    });
  }

  // Within 15 days
  return t('relativeTime.daysAgo', {
    count: diffDays,
    defaultValue: `${diffDays}天`,
  });
}
