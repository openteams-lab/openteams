type FinalReviewTranscriptLike = {
  id: string;
  execution_id?: string | null;
  entry_type: string;
  content: string;
  round_id?: string | null;
  meta_json?: string | null;
};

export type WorkflowFinalReviewActionData = {
  executionId: string;
  transcriptId: string;
  roundId?: string | null;
  message: string;
  description?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseWorkflowTranscriptMeta(
  metaJson: string | null | undefined
): Record<string, unknown> | null {
  if (!metaJson) return null;
  try {
    const parsed = JSON.parse(metaJson) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function findPendingFinalReviewTranscript<
  T extends FinalReviewTranscriptLike,
>(entries: T[], executionId?: string | null): T | null {
  return (
    entries.find((entry) => {
      if (
        entry.execution_id &&
        executionId &&
        entry.execution_id !== executionId
      ) {
        return false;
      }
      if (entry.entry_type !== 'final_review') {
        return false;
      }
      const meta = parseWorkflowTranscriptMeta(entry.meta_json);
      return meta?.resolved === false;
    }) ?? null
  );
}

export function toWorkflowFinalReviewAction<
  T extends FinalReviewTranscriptLike,
>(
  executionId: string | null | undefined,
  entries: T[]
): WorkflowFinalReviewActionData | null {
  if (!executionId) {
    return null;
  }

  const transcript = findPendingFinalReviewTranscript(entries, executionId);
  if (!transcript) {
    return null;
  }

  const meta = parseWorkflowTranscriptMeta(transcript.meta_json);
  return {
    executionId,
    transcriptId: transcript.id,
    roundId: transcript.round_id ?? null,
    message: transcript.content || 'Task completed. Accept the result?',
    description:
      typeof meta?.description === 'string' ? meta.description : undefined,
  };
}
