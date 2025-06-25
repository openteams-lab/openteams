import { cn } from '@/lib/utils';

export interface ChipProps {
  children: React.ReactNode;
  dotColor?: string;
  className?: string;
}

export function Chip({
  children,
  dotColor = 'bg-gray-400',
  className,
}: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground',
        className
      )}
    >
      <span className={cn('w-2 h-2 rounded-full', dotColor)} />
      {children}
    </span>
  );
}
