import { Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function SharedAppLayout() {
  // Register CMD+K shortcut globally for all routes under SharedAppLayout
  return (
    <div className="flex h-screen bg-primary">
      <div className="flex flex-col flex-1 min-w-0">
        <div className={cn('flex-1 min-h-0 chat-session-route')}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
