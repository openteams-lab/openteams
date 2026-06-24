import {
  WorktreeMergeConflictsView,
  type WorktreeMergeConflictsViewProps,
} from '@/components/source-control/WorktreeMergeConflictsView';

export function WorktreeMergeConflictsSection(
  props: WorktreeMergeConflictsViewProps,
) {
  return <WorktreeMergeConflictsView {...props} />;
}
