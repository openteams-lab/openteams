import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { SharedAppLayout } from '@/components/ui-new/containers/SharedAppLayout';
import { usePreviousPath } from '@/hooks/usePreviousPath';

import { UserSystemProvider, useUserSystem } from '@/components/ConfigProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { SearchProvider } from '@/contexts/SearchContext';

import { HotkeysProvider } from 'react-hotkeys-hook';

import { ThemeMode } from 'shared/types';
import * as Sentry from '@sentry/react';

import { DisclaimerDialog } from '@/components/dialogs/global/DisclaimerDialog';
import { OnboardingDialog } from '@/components/dialogs/global/OnboardingDialog';
import { ClickedElementsProvider } from './contexts/ClickedElementsProvider';

// Design scope components
import { NewDesignScope } from '@/components/ui-new/scope/NewDesignScope';

import { ChatSessions } from '@/pages/ui-new/ChatSessions';
import { analytics } from '@/lib/analytics';

const SentryRoutes = Sentry.withSentryReactRouterV6Routing(Routes);

function AppContent() {
  const { config, analyticsUserId, updateAndSaveConfig, loading } =
    useUserSystem();
  const [disclaimerAcceptedInSession, setDisclaimerAcceptedInSession] =
    useState<boolean>(() => {
      if (typeof window === 'undefined') return false;
      return sessionStorage.getItem('vk_disclaimer_ack') === 'true';
    });
  const [onboardingAcceptedInSession, setOnboardingAcceptedInSession] =
    useState<boolean>(() => {
      if (typeof window === 'undefined') return false;
      return sessionStorage.getItem('vk_onboarding_ack') === 'true';
    });
  const disclaimerInFlightRef = useRef(false);

  // Track previous path for back navigation
  usePreviousPath();

  useEffect(() => {
    if (loading) {
      return;
    }

    analytics.configure({
      enabled: Boolean(config?.analytics_enabled),
      userId: analyticsUserId ?? undefined,
    });
  }, [config?.analytics_enabled, analyticsUserId, loading]);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;

    const showNextStep = async () => {
      // 1) Disclaimer - first step
      if (
        !config.disclaimer_acknowledged &&
        !disclaimerAcceptedInSession &&
        !disclaimerInFlightRef.current
      ) {
        disclaimerInFlightRef.current = true;
        await DisclaimerDialog.show();
        setDisclaimerAcceptedInSession(true);
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('vk_disclaimer_ack', 'true');
        }
        if (!cancelled) {
          await updateAndSaveConfig({ disclaimer_acknowledged: true });
        }
        DisclaimerDialog.hide();
        disclaimerInFlightRef.current = false;
        return;
      }

      // 2) Onboarding - configure executor and editor
      if (!config.onboarding_acknowledged && !onboardingAcceptedInSession) {
        const result = await OnboardingDialog.show();
        setOnboardingAcceptedInSession(true);
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('vk_onboarding_ack', 'true');
        }
        if (!cancelled) {
          await updateAndSaveConfig({
            onboarding_acknowledged: true,
            executor_profile: result.profile,
            editor: result.editor,
          });
        }
        OnboardingDialog.hide();
        return;
      }
    };

    showNextStep();

    return () => {
      cancelled = true;
    };
  }, [
    config,
    disclaimerAcceptedInSession,
    onboardingAcceptedInSession,
    updateAndSaveConfig,
  ]);

  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider initialTheme={config?.theme || ThemeMode.LIGHT}>
        <SearchProvider>
          <SentryRoutes>
            {/* Shared shell for the remaining chat routes */}
            <Route
              element={
                <NewDesignScope>
                  <SharedAppLayout />
                </NewDesignScope>
              }
            >
              {/* Chat routes */}
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="/chat" element={<ChatSessions />} />
              <Route path="/chat/:sessionId" element={<ChatSessions />} />
            </Route>
          </SentryRoutes>
        </SearchProvider>
      </ThemeProvider>
    </I18nextProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <UserSystemProvider>
        <ClickedElementsProvider>
          <HotkeysProvider initiallyActiveScopes={['global', 'projects']}>
            <AppContent />
          </HotkeysProvider>
        </ClickedElementsProvider>
      </UserSystemProvider>
    </BrowserRouter>
  );
}

export default App;
