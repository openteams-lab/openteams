type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const REVIEW_LOOP_MESSAGE_PATTERN = /Please review loop "([^"]+)"\./g;
const USER_APPROVED_STEP_RESULT = 'User approved the step result.';

export function localizeWorkflowGeneratedText(
  text: string,
  t: TranslateFn
): string {
  return text
    .replace(REVIEW_LOOP_MESSAGE_PATTERN, (_match, loopKey: string) =>
      t('workflow.generatedText.reviewLoop', {
        loopKey,
        defaultValue: `Please review loop "${loopKey}".`,
      })
    )
    .replace(
      USER_APPROVED_STEP_RESULT,
      t('workflow.generatedText.userApprovedStepResult', {
        defaultValue: USER_APPROVED_STEP_RESULT,
      })
    );
}
