import { useState } from 'react';
import { ProjectList } from './project-list';
import { ProjectDetail } from './project-detail';

export function ProjectsPage() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );

  if (selectedProjectId) {
    return (
      <ProjectDetail
        projectId={selectedProjectId}
        onBack={() => setSelectedProjectId(null)}
      />
    );
  }

  return <ProjectList />;
}
