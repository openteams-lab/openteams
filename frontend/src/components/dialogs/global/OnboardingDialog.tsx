import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { BaseCodingAgent, EditorType } from 'shared/types';
import type { EditorConfig, ExecutorProfileId } from 'shared/types';
import { useUserSystem } from '@/components/ConfigProvider';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal, type NoProps } from '@/lib/modals';
import { useAgentAvailability } from '@/hooks/useAgentAvailability';
import { getVariantDisplayLabel, getVariantOptions } from '@/utils/executor';

export type OnboardingResult = {
  profile: ExecutorProfileId;
  editor: EditorConfig;
};

const selectBackgroundStyle = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%238C8C8C' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'calc(100% - 14px) center',
} as const;

const OnboardingDialogImpl = NiceModal.create<NoProps>(() => {
  const modal = useModal();
  const { t } = useTranslation('common');
  const { profiles, config } = useUserSystem();

  const defaultEditor: EditorConfig = config?.editor ?? {
    editor_type: EditorType.VS_CODE,
    custom_command: null,
    remote_ssh_host: null,
    remote_ssh_user: null,
  };

  const [profile, setProfile] = useState<ExecutorProfileId>(
    config?.executor_profile || {
      executor: BaseCodingAgent.OPEN_TEAMS_CLI,
      variant: null,
    }
  );

  const agentAvailability = useAgentAvailability(profile.executor);

  const agentOptions = useMemo(() => {
    const availableAgents = profiles
      ? (Object.keys(profiles) as BaseCodingAgent[]).sort()
      : [];

    if (availableAgents.length === 0) {
      return [profile.executor];
    }

    return availableAgents;
  }, [profile.executor, profiles]);

  const selectedExecutorProfile = profiles?.[profile.executor];
  const hasExplicitDefaultVariant = Boolean(
    selectedExecutorProfile &&
      Object.prototype.hasOwnProperty.call(selectedExecutorProfile, 'DEFAULT')
  );

  const variantOptions = useMemo(() => {
    const variants = getVariantOptions(profile.executor, profiles);
    return variants.length > 0 ? variants : ['DEFAULT'];
  }, [profile.executor, profiles]);

  const variantValue =
    profile.variant && variantOptions.includes(profile.variant)
      ? profile.variant
      : (variantOptions[0] ?? 'DEFAULT');

  const resolvedProfile: ExecutorProfileId = {
    executor: profile.executor,
    variant:
      variantValue === 'DEFAULT' && !hasExplicitDefaultVariant
        ? null
        : variantValue,
  };

  const statusMeta = useMemo(() => {
    if (agentAvailability?.status === 'login_detected') {
      return {
        container:
          'border-[#B7EB8F] bg-[#F6FFED] text-[#389E0D] fill-[#52C41A]',
        icon: (
          <Check
            className="mt-[2px] h-[14px] w-[14px] shrink-0"
            strokeWidth={3}
          />
        ),
        message: t('onboardingDialog.status.loginDetected'),
      };
    }

    if (agentAvailability?.status === 'installation_found') {
      return {
        container:
          'border-[#B7EB8F] bg-[#F6FFED] text-[#389E0D] fill-[#52C41A]',
        icon: (
          <Check
            className="mt-[2px] h-[14px] w-[14px] shrink-0"
            strokeWidth={3}
          />
        ),
        message: t('onboardingDialog.status.installationFound'),
      };
    }

    if (agentAvailability?.status === 'checking') {
      return {
        container:
          'border-[#D9E6F5] bg-[#F9FBFF] text-[#4A90E2] fill-[#4A90E2]',
        icon: (
          <Loader2
            className="mt-[2px] h-[14px] w-[14px] shrink-0 animate-spin"
            strokeWidth={2.5}
          />
        ),
        message: t('onboardingDialog.status.checking'),
      };
    }

    return {
      container: 'border-[#D9E6F5] bg-[#F9FBFF] text-[#8C8C8C] fill-[#8C8C8C]',
      icon: (
        <Check
          className="mt-[2px] h-[14px] w-[14px] shrink-0 opacity-60"
          strokeWidth={3}
        />
      ),
      message: t('onboardingDialog.status.notFound'),
    };
  }, [agentAvailability, t]);

  const handleExecutorChange = (value: string) => {
    const nextExecutor = value as BaseCodingAgent;
    const nextVariants = getVariantOptions(nextExecutor, profiles);
    const nextVariant = nextVariants.includes('DEFAULT')
      ? 'DEFAULT'
      : (nextVariants[0] ?? null);

    setProfile({
      executor: nextExecutor,
      variant: nextVariant,
    });
  };

  const handleVariantChange = (value: string) => {
    setProfile((current) => ({
      ...current,
      variant: value === 'DEFAULT' && !hasExplicitDefaultVariant ? null : value,
    }));
  };

  const handleComplete = () => {
    modal.resolve({
      profile: resolvedProfile,
      editor: defaultEditor,
    } as OnboardingResult);
  };

  return (
    <>
      <style>{`
        @keyframes onboarding-welcome-slide-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      <Dialog
        open={modal.visible}
        uncloseable
        hideCloseButton
        className="!my-0 !w-auto !max-w-none !gap-0 !rounded-none !border-0 !bg-transparent !p-0 !shadow-none"
        containerClassName="items-center"
        overlayClassName="!bg-[rgba(240,244,248,0.42)] backdrop-blur-[2px]"
      >
        <DialogContent
          className="!w-[520px] !max-w-[calc(100vw-32px)] self-center !gap-0 !rounded-[20px] !border-0 !bg-white !p-12 !text-center !shadow-[0_10px_40px_rgba(0,0,0,0.05)]"
          style={{ animation: 'onboarding-welcome-slide-up 0.5s ease-out' }}
        >
          <div className="mb-12">
            <img
              src="/openteams-brand-logo.png"
              alt="OpenTeams"
              className="mx-auto mb-6 h-10 w-auto"
            />
            <h1 className="m-0 mb-3 text-2xl font-semibold text-[#333333]">
              {t('onboardingDialog.title')}
            </h1>
            <p className="m-0 text-sm leading-[1.5] text-[#8C8C8C]">
              {t('onboardingDialog.description')}
            </p>
          </div>

          <div className="mb-12 text-left">
            <div className="mb-5 flex items-center gap-2 text-[15px] font-semibold text-[#333333]">
              <span className="text-[#52C41A]">{'✓'}</span>
              <span>{t('onboardingDialog.agentSectionTitle')}</span>
            </div>

            <div className="mb-4 flex gap-3">
              <select
                value={profile.executor}
                onChange={(event) => handleExecutorChange(event.target.value)}
                className="h-11 min-w-0 flex-[2] appearance-none rounded-xl border border-[#E8EEF5] bg-[#F9FBFF] px-[14px] text-sm text-[#333333] outline-none transition-all duration-300 ease-in-out focus:border-[#4A90E2] focus:bg-white focus:shadow-[0_0_0_4px_rgba(74,144,226,0.06)]"
                style={selectBackgroundStyle}
              >
                {agentOptions.map((agent) => (
                  <option key={agent} value={agent}>
                    {agent}
                  </option>
                ))}
              </select>

              <select
                value={variantValue}
                onChange={(event) => handleVariantChange(event.target.value)}
                className="h-11 min-w-0 flex-1 appearance-none rounded-xl border border-[#E8EEF5] bg-[#F9FBFF] px-[14px] text-sm text-[#333333] outline-none transition-all duration-300 ease-in-out focus:border-[#4A90E2] focus:bg-white focus:shadow-[0_0_0_4px_rgba(74,144,226,0.06)] disabled:cursor-not-allowed disabled:opacity-80"
                style={selectBackgroundStyle}
                disabled={
                  variantOptions.length <= 1 && variantOptions[0] === 'DEFAULT'
                }
              >
                {variantOptions.map((variant) => (
                  <option key={variant} value={variant}>
                    {getVariantDisplayLabel(
                      profile.executor,
                      variant,
                      profiles
                    )}
                  </option>
                ))}
              </select>
            </div>

            <div
              className={`flex items-start gap-2 rounded-lg border px-3 py-3 ${statusMeta.container}`}
            >
              {statusMeta.icon}
              <span className="text-[13px] leading-[1.4]">
                {statusMeta.message}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleComplete}
            className="h-12 w-full rounded-[24px] border-0 bg-[#4A90E2] text-[15px] font-medium text-white shadow-[0_4px_14px_rgba(74,144,226,0.25)] transition-all duration-300 ease-in-out hover:-translate-y-px hover:bg-[#357ABD] hover:shadow-[0_6px_20px_rgba(74,144,226,0.35)] active:translate-y-0"
          >
            {t('buttons.continue')}
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
});

export const OnboardingDialog = defineModal<void, OnboardingResult>(
  OnboardingDialogImpl
);
