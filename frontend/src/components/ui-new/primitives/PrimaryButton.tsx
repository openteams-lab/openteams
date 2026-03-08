import { cn } from '@/lib/utils';
import { SpinnerIcon, type Icon } from '@phosphor-icons/react';

interface PrimaryButtonProps {
  variant?: 'default' | 'secondary' | 'tertiary';
  actionIcon?: Icon | 'spinner';
  value?: string;
  onClick?: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function PrimaryButton({
  variant = 'default',
  actionIcon: ActionIcon,
  value,
  onClick,
  disabled,
  children,
  className,
}: PrimaryButtonProps) {
  const variantStyles = disabled
    ? 'cursor-not-allowed bg-panel'
    : variant === 'default'
      ? 'bg-[#5094FB] hover:bg-[#4084EB] text-on-brand'
      : variant === 'secondary'
        ? 'bg-[#4A69CC] hover:bg-[#5094FB] text-on-brand'
        : 'bg-[#F0F3F9] hover:bg-[#e1e6f2] text-normal';

  return (
    <button
      className={cn(
        'primary-button',
        variant === 'default' && 'primary-button-default',
        variant === 'secondary' && 'primary-button-secondary',
        variant === 'tertiary' && 'primary-button-tertiary',
        'rounded-sm px-base py-half text-cta h-cta flex gap-half items-center',
        variantStyles,
        className
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {value}
      {children}
      {ActionIcon ? (
        ActionIcon === 'spinner' ? (
          <SpinnerIcon className={'size-icon-sm animate-spin'} weight="bold" />
        ) : (
          <ActionIcon className={'size-icon-xs'} weight="bold" />
        )
      ) : null}
    </button>
  );
}
