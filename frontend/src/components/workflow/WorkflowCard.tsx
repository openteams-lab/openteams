import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { useQuery } from '@/lib/queryCompat';
import { chatMessagesApi, workflowApi } from '@/lib/api';
import { notifySourceControlRefreshRequested } from '@/lib/sourceControlEvents';
import {
  shouldPollWorkflowProjection,
  WORKFLOW_CARD_REFETCH_INTERVAL_MS,
} from '@/lib/workflowRequestPolicy';
import type {
  UserIterationFeedbackRequest,
  WorkflowCardMessageType,
  WorkflowCardProjection,
  WorkflowPlanGenerationMeta,
  WorkflowTranscriptEntry,
} from '@/types';
import { useWorkspace } from '@/context/WorkspaceContext';
import { ChatWorkflowCard } from './ChatWorkflowCard';
import {
  WorkflowReviewSettingsDialog,
  type WorkflowReviewSettingOverride,
} from './WorkflowReviewSettingsDialog';
import { toWorkflowFinalReviewAction } from './WorkflowFinalReviewCard';
import { WorkflowWindow } from './WorkflowWindow';

interface WorkflowCardProps {
  sessionId: string;
  messageId: string;
  cardType: WorkflowCardMessageType;
  planGenerationMeta?: WorkflowPlanGenerationMeta;
}

type OldTranscriptEntry = WorkflowTranscriptEntry & {
  message_type: 'system' | 'agent' | 'user' | 'control';
};

const senderToMessageType = (
  senderType: string,
): 'system' | 'agent' | 'user' | 'control' => {
  if (senderType === 'agent' || senderType === 'user' || senderType === 'system') {
    return senderType;
  }
  return 'control';
};

const toOldTranscriptEntry = (
  entry: WorkflowTranscriptEntry,
): OldTranscriptEntry => ({
  ...entry,
  message_type: senderToMessageType(entry.sender_type),
});

export function WorkflowCard({
  sessionId,
  messageId,
  cardType,
  planGenerationMeta,
}: WorkflowCardProps) {
  const { t } = useAppTranslation();
  const {
    sessionsAsync,
    workflowRuntimeLinesByExecution,
    refreshSessionWorkflowStatus,
  } = useWorkspace();
  const sessionTitle = useMemo(() => {
    const session = sessionsAsync.data.find((s) => s.id === sessionId);
    return session?.title ?? null;
  }, [sessionsAsync.data, sessionId]);

  const [projection, setProjection] = useState<WorkflowCardProjection | null>(
    null,
  );
  const [windowOpen, setWindowOpen] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [retryPlanGenerationError, setRetryPlanGenerationError] = useState<
    string | null
  >(null);
  const [executeReviewProjection, setExecuteReviewProjection] =
    useState<WorkflowCardProjection | null>(null);
  const [executeReviewError, setExecuteReviewError] = useState<string | null>(
    null,
  );

  const message = useMemo(
    () =>
      ({
        id: messageId,
        meta: {
          card_type: cardType,
          workflow_plan_generation: planGenerationMeta ?? null,
        },
      }),
    [cardType, messageId, planGenerationMeta],
  );

  const loadProjection = useCallback(async () => {
    try {
      const data = await chatMessagesApi.getWorkflowCard(messageId, 'full');
      setProjection(data);
      void refreshSessionWorkflowStatus(sessionId);
    } catch {
      if (cardType === 'workflow_plan_generation') {
        setProjection(null);
      }
    }
  }, [
    cardType,
    messageId,
    refreshSessionWorkflowStatus,
    sessionId,
  ]);

  useEffect(() => {
    void loadProjection();
  }, [loadProjection]);

  useEffect(() => {
    if (!shouldPollWorkflowProjection(projection)) return undefined;
    const intervalId = window.setInterval(() => {
      void loadProjection();
    }, WORKFLOW_CARD_REFETCH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadProjection, projection]);

  const refreshAll = async () => {
    await loadProjection();
  };

  const withPending = async (id: string, action: () => Promise<unknown>) => {
    setPendingActionId(id);
    try {
      await action();
      await refreshAll();
    } finally {
      setPendingActionId(null);
    }
  };

  const shouldLoadFinalReviewAction =
    !!sessionId &&
    !!projection?.execution_id &&
    !(
      projection.state === 'preview_ready' ||
      projection.state === 'preview_invalid'
    ) &&
    (projection.state === 'waiting' ||
      projection.execution_status === 'waiting');
  const { data: finalReviewTranscripts = [] } = useQuery({
    queryKey: [
      'workflowFinalReviewAction',
      sessionId,
      projection?.execution_id,
    ],
    queryFn: () => {
      if (!sessionId || !projection?.execution_id) return [];
      return workflowApi
        .getExecutionTranscripts(sessionId, projection.execution_id, {
          entryType: 'final_review',
          unresolved: true,
          limit: 1,
        })
        .then((entries) => entries.map(toOldTranscriptEntry));
    },
    enabled: shouldLoadFinalReviewAction,
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000,
    refetchInterval: shouldPollWorkflowProjection(projection)
      ? WORKFLOW_CARD_REFETCH_INTERVAL_MS
      : false,
  });
  const finalReviewAction =
    shouldLoadFinalReviewAction && projection?.execution_id
      ? toWorkflowFinalReviewAction(
          projection.execution_id,
          finalReviewTranscripts,
        )
      : null;
  const workflowRuntimeMessages = useMemo(() => {
    if (!projection?.execution_id) return [];
    return workflowRuntimeLinesByExecution[projection.execution_id] ?? [];
  }, [projection?.execution_id, workflowRuntimeLinesByExecution]);

  const handleExecute = (nextProjection: WorkflowCardProjection) => {
    setExecuteReviewError(null);
    setExecuteReviewProjection(nextProjection);
  };

  const handleCloseExecuteReviewSettings = () => {
    if (pendingActionId === 'execute-plan') return;
    setExecuteReviewProjection(null);
    setExecuteReviewError(null);
  };

  const handleConfirmExecute = async (
    overrides: WorkflowReviewSettingOverride[],
  ) => {
    if (!executeReviewProjection) return;
    setExecuteReviewError(null);
    try {
      await withPending('execute-plan', () =>
        workflowApi.executePlan(sessionId, executeReviewProjection.plan_id, {
          plan: null,
          stepReviewOverrides: overrides,
        }),
      );
      setExecuteReviewProjection(null);
    } catch (error) {
      setExecuteReviewError(
        error instanceof Error
          ? error.message
          : t('workflow.reviewSettings.executeError', {
              defaultValue: 'Unable to start workflow execution.',
            }),
      );
    }
  };

  const handlePauseAll = (executionId: string) =>
    void withPending(executionId, () => workflowApi.pauseAll(sessionId, executionId));

  const handleResume = (executionId: string) =>
    void withPending(executionId, () =>
      workflowApi.resumeExecution(sessionId, executionId),
    );

  const handleRetryStep = (stepId: string, retryTarget?: 'task' | 'review') =>
    void withPending(stepId, () =>
      workflowApi.retryStep(sessionId, stepId, retryTarget),
    );

  const handleInterruptStep = (stepId: string) =>
    void withPending(stepId, () => workflowApi.interruptStepById(sessionId, stepId));

  const handleStopStep = (stepId: string) =>
    void withPending(stepId, () => workflowApi.stopStep(sessionId, stepId));

  const handleApproval = (
    stepId: string,
    action: string,
    transcriptId: string,
    inputText?: string,
  ) =>
    void withPending(transcriptId, () =>
      workflowApi.approveStep(sessionId, stepId, {
        transcriptId,
        action,
        inputText,
      }),
    );

  const handlePendingReview = (
    reviewId: string,
    action: 'approve' | 'reject',
    feedback?: string,
    expectedStepId?: string,
  ) =>
    void withPending(reviewId, () =>
      workflowApi.respondToReview({
        review_id: reviewId,
        action,
        feedback: feedback ?? null,
        expected_step_id: expectedStepId ?? null,
      }),
    );

  const handleStepInput = (stepId: string, inputText: string) =>
    void withPending(stepId, () =>
      workflowApi.submitStepInput(sessionId, stepId, inputText),
    );

  const handleIterationFeedback = (payload: {
    executionId: string;
    action: 'accept' | 'reject';
    feedback?: {
      what_wrong: string;
      expected: string;
      priority: 'low' | 'medium' | 'high';
      additional_notes?: string | null;
    };
  }) =>
    void withPending(payload.executionId, async () => {
      await workflowApi.submitIterationFeedback({
        execution_id: payload.executionId,
        action: payload.action,
        feedback: payload.feedback
          ? {
              ...payload.feedback,
              additional_notes: payload.feedback.additional_notes ?? null,
            }
          : null,
      });
      if (payload.action === 'accept') {
        notifySourceControlRefreshRequested({ sessionId });
      }
    });

  const handleUpdateReviewSettings = (
    executionId: string,
    overrides: Array<{
      stepId: string;
      leadReview: boolean | null;
      userReview: boolean | null;
    }>,
  ) =>
    withPending('review-settings', () =>
      workflowApi.updateReviewSettings(sessionId, executionId, {
        stepReviewOverrides: overrides,
      }),
    );

  const handleRetryPlanGeneration = (retryMessageId: string) => {
    setRetryPlanGenerationError(null);
    void withPending(retryMessageId, () =>
      workflowApi.retryPlanGeneration(sessionId, retryMessageId).catch((error) => {
        setRetryPlanGenerationError(
          error instanceof Error ? error.message : 'Retry request failed',
        );
        throw error;
      }),
    );
  };

  return (
    <>
      <ChatWorkflowCard
        message={message}
        projection={projection}
        onExecute={handleExecute}
        onPauseAll={handlePauseAll}
        onResume={handleResume}
        onRetryStep={handleRetryStep}
        onOpenWindow={() => setWindowOpen(true)}
        onRetryPlanGeneration={handleRetryPlanGeneration}
        retryPlanGenerationPending={pendingActionId === messageId}
        retryPlanGenerationError={retryPlanGenerationError}
        finalReviewAction={finalReviewAction}
        onRespondPendingReview={handlePendingReview}
        onSubmitStepInput={handleStepInput}
        onSubmitIterationFeedback={handleIterationFeedback}
        pendingActionId={pendingActionId}
      />

      {projection && (
        <WorkflowWindow
          sessionId={sessionId}
          sessionTitle={sessionTitle}
          projection={projection}
          finalReviewAction={finalReviewAction}
          runtimeMessages={workflowRuntimeMessages}
          isOpen={windowOpen}
          onClose={() => setWindowOpen(false)}
          onExecute={handleExecute}
          onPauseAll={handlePauseAll}
          onResume={handleResume}
          onInterruptStep={handleInterruptStep}
          onStopStep={handleStopStep}
          onRetryStep={handleRetryStep}
          onUpdateReviewSettings={handleUpdateReviewSettings}
          onSubmitStepInput={handleStepInput}
          onApproval={handleApproval}
          onRespondPendingReview={handlePendingReview}
          onSubmitIterationFeedback={handleIterationFeedback}
          pendingActionId={pendingActionId}
        />
      )}

      {executeReviewProjection && (
        <WorkflowReviewSettingsDialog
          projection={executeReviewProjection}
          isOpen
          onClose={handleCloseExecuteReviewSettings}
          onSubmit={handleConfirmExecute}
          submitLabel={t('workflow.reviewSettings.startExecution', {
            defaultValue: 'Start Execution',
          })}
          submittingLabel={t('workflow.reviewSettings.startingExecution', {
            defaultValue: 'Starting...',
          })}
          isSubmitting={pendingActionId === 'execute-plan'}
          disabled={pendingActionId === 'execute-plan'}
          error={executeReviewError}
          variant="modal"
        />
      )}
    </>
  );
}
