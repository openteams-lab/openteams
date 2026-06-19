import { ApiError, handleApiResponse } from './apiCore';

let failures = 0;

const check = (label: string, condition: boolean, detail?: unknown) => {
  if (!condition) {
    failures += 1;
    console.error(`FAIL ${label}`, detail ?? '');
  } else {
    console.log(`ok ${label}`);
  }
};

const errorData = {
  code: 'github_rate_limited',
  message: 'rate limited',
  retry_after: '2026-06-05T12:00:00Z',
};

try {
  await handleApiResponse(
    new Response(
      JSON.stringify({
        success: false,
        data: null,
        message: 'GitHub limited requests',
        error_data: errorData,
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    ),
  );
  check('non-2xx structured error throws', false);
} catch (error) {
  check('non-2xx throws ApiError', error instanceof ApiError, error);
  check(
    'non-2xx preserves ApiResponse.error_data',
    error instanceof ApiError &&
      (error.errorData as typeof errorData | undefined)?.code ===
        'github_rate_limited',
    error,
  );
}

if (failures > 0) process.exit(1);
