import { useParams, useNavigate } from 'react-router-dom';
import { ProjectList } from '@/components/projects/project-list';
import { ProjectDetail } from '@/components/projects/project-detail';
import { useKeyboardShortcuts } from '@/lib/keyboard-shortcuts';

export function Projects() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const handleBack = () => {
    navigate('/projects');
  };

  // Setup keyboard shortcuts (only Esc for back navigation, no task creation here)
  useKeyboardShortcuts({
    navigate,
    currentPath: projectId ? `/projects/${projectId}` : '/projects',
    hasOpenDialog: false,
    closeDialog: () => {},
    openCreateTask: () => {}, // No-op for projects page
  });

  if (projectId) {
    return <ProjectDetail projectId={projectId} onBack={handleBack} />;
  }

  return <ProjectList />;
}
