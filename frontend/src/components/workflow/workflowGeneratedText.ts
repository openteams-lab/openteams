type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const REVIEW_LOOP_MESSAGE_PATTERN = /Please review loop "([^"]+)"\./g;
const REVIEW_STEP_RESULT_MESSAGE_PATTERNS = [
  /请审核步骤「([^」]+)」的执行结果/g,
  /Please review step "([^"]+)"\./g,
];
const USER_APPROVED_STEP_RESULT = 'User approved the step result.';
const USER_APPROVED_STEP_RESULT_MESSAGES = [
  USER_APPROVED_STEP_RESULT,
  '用户已批准步骤结果。',
  '用戶已批准步驟結果。',
  'ユーザーがステップ結果を承認しました。',
  '사용자가 단계 결과를 승인했습니다.',
  "L'utilisateur a approuvé le résultat de l'étape.",
  'El usuario aprobó el resultado del paso.',
];
const USER_APPROVED_LOOP_RESULT_MESSAGES = [
  'User approved the loop result.',
  '用户已批准循环结果。',
  '用戶已批准循環結果。',
  'ユーザーがループ結果を承認しました。',
  '사용자가 루프 결과를 승인했습니다.',
  "L'utilisateur a approuvé le résultat de la boucle.",
  'El usuario aprobó el resultado del bucle.',
];
const COMPLETED_STATUS_LINE_PATTERN =
  /(^|\r?\n)(?:Status|状态)[ \t]*[:：][ \t]*(?:DONE|COMPLETED)[ \t]*(?=\r?\n|$)/gim;

function replaceExactGeneratedMessages(
  text: string,
  messages: string[],
  replacement: string
): string {
  return messages.reduce(
    (current, message) => current.replaceAll(message, replacement),
    text
  );
}

export function localizeWorkflowGeneratedText(
  text: string,
  t: TranslateFn
): string {
  let localized = text.replace(
    REVIEW_LOOP_MESSAGE_PATTERN,
    (_match, loopKey: string) =>
      t('workflow.generatedText.reviewLoop', {
        loopKey,
        defaultValue: `Please review loop "${loopKey}".`,
      })
  );

  for (const pattern of REVIEW_STEP_RESULT_MESSAGE_PATTERNS) {
    localized = localized.replace(pattern, (_match, stepTitle: string) =>
      t('workflow.generatedText.reviewStepResult', {
        stepTitle,
        defaultValue: `Please review the execution result for step "${stepTitle}".`,
      })
    );
  }

  localized = localized.replace(
    COMPLETED_STATUS_LINE_PATTERN,
    (_match, linePrefix: string) =>
      `${linePrefix}${t('workflow.generatedText.completedStatus', {
        defaultValue: 'Status: Completed',
      })}`
  );

  localized = replaceExactGeneratedMessages(
    localized,
    USER_APPROVED_STEP_RESULT_MESSAGES,
    t('workflow.generatedText.userApprovedStepResult', {
      defaultValue: USER_APPROVED_STEP_RESULT,
    })
  );

  return replaceExactGeneratedMessages(
    localized,
    USER_APPROVED_LOOP_RESULT_MESSAGES,
    t('workflow.generatedText.userApprovedLoopResult', {
      defaultValue: 'User approved the loop result.',
    })
  );
}
