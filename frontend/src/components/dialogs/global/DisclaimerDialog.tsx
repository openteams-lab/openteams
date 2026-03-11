import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { defineModal, type NoProps } from '@/lib/modals';

const SAFETY_DOCS_URL =
  'https://www.agents-chatgroup.com/docs/getting-started#safety-notice';

const DisclaimerDialogImpl = NiceModal.create<NoProps>(() => {
  const modal = useModal();
  const { t } = useTranslation('common');

  const handleAccept = () => {
    modal.resolve('accepted');
  };

  return (
    <>
      <style>{`
        @keyframes disclaimer-modal-pop {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
      <Dialog
        open={modal.visible}
        uncloseable
        hideCloseButton
        className="!my-0 !w-auto !max-w-none !gap-0 !rounded-none !border-0 !bg-transparent !p-0 !shadow-none"
        containerClassName="items-center"
        overlayClassName="!bg-[rgba(0,0,0,0.05)]"
      >
        <DialogContent
          className="!w-[560px] !max-w-[calc(100vw-32px)] self-center !gap-0 !rounded-[20px] !border !border-[#E8EEF5] !bg-white !p-10 !shadow-[0_20px_50px_rgba(0,0,0,0.1)]"
          style={{
            animation:
              'disclaimer-modal-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.1)',
          }}
        >
          <div className="mb-6 flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-[#E6A23C]" />
            <h2 className="m-0 text-[20px] font-semibold text-[#333333]">
              {t('disclaimerDialog.title')}
            </h2>
          </div>

          <div className="text-sm leading-[1.7] text-[#8C8C8C]">
            <p className="m-0">{t('disclaimerDialog.intro')}</p>

            <div className="my-5 rounded-[8px] border-l-4 border-[#E6A23C] bg-[#FCF6ED] px-4 py-4 font-mono text-[13px] text-[#8A6D3B]">
              --dangerously-skip-permissions / --yolo
            </div>

            <p className="m-0">{t('disclaimerDialog.body')}</p>

            <span className="mt-6 block font-semibold text-[#333333]">
              {t('disclaimerDialog.importantTitle')}
            </span>
            <p className="m-0 mt-2">{t('disclaimerDialog.importantBody')}</p>

            <p className="m-0 mt-4">
              {t('disclaimerDialog.docsPrefix')}{' '}
              <a
                href={SAFETY_DOCS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#4A90E2] no-underline transition-all hover:underline"
              >
                {t('disclaimerDialog.docsLinkText')}
              </a>
            </p>
          </div>

          <div className="mt-10 flex justify-end">
            <button
              type="button"
              onClick={handleAccept}
              className="rounded-[24px] border-[1.5px] border-[#333333] bg-white px-8 py-3 text-sm font-semibold text-[#333333] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] hover:-translate-y-px hover:bg-[#333333] hover:text-white hover:shadow-[0_4px_12px_rgba(0,0,0,0.15)] active:translate-y-0"
            >
              {t('disclaimerDialog.action')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});

export const DisclaimerDialog = defineModal<void, 'accepted' | void>(
  DisclaimerDialogImpl
);
