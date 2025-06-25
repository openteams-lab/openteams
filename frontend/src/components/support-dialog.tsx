import { useState, ReactNode } from 'react';
import { HelpCircle, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SupportDialogProps {
  children: ReactNode;
}

export function SupportDialog({ children }: SupportDialogProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleEmailClick = () => {
    window.location.href = 'mailto:louis@bloop.ai';
  };

  return (
    <>
      <div onClick={() => setIsOpen(true)}>{children}</div>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              Support
            </DialogTitle>
            <DialogDescription>
              Have questions or need help? I'm here to assist you!
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Email me at{' '}
              <strong className="text-foreground">louis@bloop.ai</strong> with
              any questions and I'll respond ASAP.
            </p>
            <Button onClick={handleEmailClick} className="w-full">
              <Mail className="mr-2 h-4 w-4" />
              Send Email
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
