import { useEffect, useMemo, useRef, useState } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import {
  ArrowClockwiseIcon,
  ArrowsClockwiseIcon,
  ArrowsInSimpleIcon,
  MinusIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import { LoaderCircle, SkipForward } from 'lucide-react';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { motion } from 'framer-motion';
import type { WorkflowCardData, WorkflowCardLoopData } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useShortcutScope } from '@/shortcuts/ShortcutProvider';
import {
  canSkipWorkflowStep,
  canRetryWorkflowStepReview,
  isRetryableWorkflowStepStatus,
} from './workflowControlContract';
import {
  workflowLoopStatusMeta,
  workflowStatusLabel,
} from './workflowStepPresentation';

type WorkflowGraphStep = WorkflowCardData['steps'][number];
type WorkflowGraphNode = WorkflowCardData['plan']['nodes'][number];
type WorkflowGraphAgent = NonNullable<WorkflowCardData['agents']>[number];
type WorkflowGraphEdge = WorkflowCardData['plan']['edges'][number];
type WorkflowGraphLoop = WorkflowCardLoopData;
type WorkflowGraphPlanLoop = NonNullable<
  WorkflowCardData['plan']['loops']
>[number];

const getPlanLoopKey = (loop: WorkflowGraphPlanLoop) =>
  loop.loopKey ?? loop.loop_key ?? '';

const getPlanLoopMemberStepKeys = (loop: WorkflowGraphPlanLoop) =>
  loop.memberSteps ?? loop.member_step_keys ?? [];

const getPlanLoopReviewStepKey = (loop: WorkflowGraphPlanLoop) =>
  loop.reviewStep ?? loop.review_step_key ?? null;

type WorkflowGraphBoardProps = {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  steps: WorkflowGraphStep[];
  loops?: WorkflowGraphLoop[];
  planLoops?: WorkflowGraphPlanLoop[] | null;
  agents?: WorkflowGraphAgent[];
  selectedStepId?: string | null;
  onSelectStep?: (id: string) => void;
  onRetryStep?: (stepId: string, retryTarget?: 'task' | 'review') => void;
  onSkipStep?: (stepId: string) => void;
  pendingActionId?: string | null;
  pendingActionType?: string | null;
  compact?: boolean;
  className?: string;
  isOpen?: boolean;
  historicalRound?: boolean;
};

export type WorkflowNodeRect = {
  id: string;
  centerX: number;
  centerY: number;
};

export function findNextWorkflowNodeId(
  current: WorkflowNodeRect,
  candidates: readonly WorkflowNodeRect[],
  direction: 'up' | 'down' | 'left' | 'right',
): string | null {
  return candidates
    .map((candidate) => ({
      candidate,
      dx: candidate.centerX - current.centerX,
      dy: candidate.centerY - current.centerY,
    }))
    .filter(({ dx, dy }) => {
      const horizontal = direction === 'left' || direction === 'right';
      const pointsTowardDirection =
        direction === 'left'
          ? dx < 0
          : direction === 'right'
            ? dx > 0
            : direction === 'up'
              ? dy < 0
              : dy > 0;
      const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
      const secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
      return pointsTowardDirection && secondary <= primary * 2;
    })
    .sort((left, right) => {
      const horizontal = direction === 'left' || direction === 'right';
      const leftPrimary = horizontal ? Math.abs(left.dx) : Math.abs(left.dy);
      const rightPrimary = horizontal ? Math.abs(right.dx) : Math.abs(right.dy);
      const leftSecondary = horizontal ? Math.abs(left.dy) : Math.abs(left.dx);
      const rightSecondary = horizontal ? Math.abs(right.dy) : Math.abs(right.dx);
      return leftPrimary - rightPrimary || leftSecondary - rightSecondary;
    })[0]?.candidate.id ?? null;
}

const elk = new ELK();

interface ElkLayoutNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkLayoutNode[];
  edges?: ElkLayoutEdge[];
}

interface ElkLayoutEdge {
  id: string;
  sources?: string[];
  targets?: string[];
  sections?: Array<{
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
  }>;
}

const NODE_WIDTH = 240;
const NODE_HEIGHT = 110;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const ZOOM_BUTTON_FACTOR = 1.2;

function buildElkGraph(
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
  loops: WorkflowGraphLoop[],
  planLoops: WorkflowGraphPlanLoop[],
  steps: WorkflowGraphStep[]
) {
  const stepById = new Map(steps.map((s) => [s.id, s]));

  const runtimeLoopKeys = new Set(loops.map((l) => l.loop_key));
  const allLoops = [
    ...loops.map((l) => ({
      loopKey: l.loop_key,
      memberStepKeys: l.member_step_ids
        .map((id) => stepById.get(id)?.step_key)
        .filter((k): k is string => !!k),
      reviewStepKey: l.review_step_id
        ? (stepById.get(l.review_step_id)?.step_key ?? null)
        : null,
      status: l.status,
      label: l.loop_key,
    })),
    ...planLoops
      .filter((l) => {
        const loopKey = getPlanLoopKey(l);
        return loopKey && !runtimeLoopKeys.has(loopKey);
      })
      .map((l) => ({
        loopKey: getPlanLoopKey(l),
        memberStepKeys: getPlanLoopMemberStepKeys(l),
        reviewStepKey: getPlanLoopReviewStepKey(l),
        status: null as string | null,
        label: getPlanLoopKey(l),
      })),
  ];

  const nodeToLoop = new Map<string, string>();
  for (const loop of allLoops) {
    for (const key of loop.memberStepKeys) {
      nodeToLoop.set(key, loop.loopKey);
    }
    if (loop.reviewStepKey) {
      nodeToLoop.set(loop.reviewStepKey, loop.loopKey);
    }
  }

  const getPathToRoot = (nodeId: string): string[] => {
    const loopKey = nodeToLoop.get(nodeId);
    if (loopKey) {
      return ['root', loopKey, nodeId];
    }
    return ['root', nodeId];
  };

  const getLCA = (sourceId: string, targetId: string): string => {
    const path1 = getPathToRoot(sourceId);
    const path2 = getPathToRoot(targetId);
    let lca = 'root';
    for (let i = 0; i < Math.min(path1.length, path2.length); i++) {
      if (path1[i] === path2[i]) lca = path1[i];
      else break;
    }
    return lca;
  };

  // Filter edges to only include those referencing existing nodes
  const allNodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter(
    (e) => allNodeIds.has(e.source) && allNodeIds.has(e.target)
  );

  const edgesByParent: Record<string, WorkflowGraphEdge[]> = {};
  for (const edge of validEdges) {
    const lca = getLCA(edge.source, edge.target);
    if (!edgesByParent[lca]) edgesByParent[lca] = [];
    edgesByParent[lca].push(edge);
  }

  const rootNodeIds = new Set(nodes.map((n) => n.id));
  const loopChildIds = new Set<string>();
  const loopNodes: Array<{
    loopKey: string;
    children: WorkflowGraphNode[];
    edges: WorkflowGraphEdge[];
    status: string | null;
    label: string;
  }> = [];

  for (const loop of allLoops) {
    const childNodeIds = new Set([
      ...loop.memberStepKeys,
      ...(loop.reviewStepKey ? [loop.reviewStepKey] : []),
    ]);
    const children = nodes.filter((n) => childNodeIds.has(n.id));
    children.forEach((n) => {
      loopChildIds.add(n.id);
      rootNodeIds.delete(n.id);
    });
    loopNodes.push({
      loopKey: loop.loopKey,
      children,
      edges: edgesByParent[loop.loopKey] || [],
      status: loop.status,
      label: loop.label,
    });
  }

  const rootChildren: ElkLayoutNode[] = [];

  for (const nodeId of rootNodeIds) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) continue;
    rootChildren.push({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  }

  for (const loop of loopNodes) {
    if (loop.children.length === 0) continue;
    rootChildren.push({
      id: loop.loopKey,
      layoutOptions: {
        'elk.padding': '[top=60,left=30,bottom=30,right=30]',
        'elk.direction': 'RIGHT',
        'elk.algorithm': 'layered',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
      },
      children: loop.children.map((n) => ({
        id: n.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
      edges: loop.edges
        .filter((e) => {
          const childIds = new Set(loop.children.map((n) => n.id));
          return childIds.has(e.source) && childIds.has(e.target);
        })
        .map((e) => ({
          id: e.id,
          sources: [e.source],
          targets: [e.target],
        })),
    });
  }

  return {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '80',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.edgeRouting': 'POLYLINE',
      'elk.layered.mergeEdges': 'true',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    },
    children: rootChildren,
    edges: (edgesByParent['root'] || []).map((e) => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
    })),
  };
}

function buildFallbackLayout(
  children: ElkLayoutNode[]
): ElkLayoutNode & { width: number; height: number } {
  const gap = 40;
  let x = gap;
  const y = gap;
  const laid: ElkLayoutNode[] = [];

  for (const child of children) {
    const innerChildren = child.children;
    if (innerChildren && innerChildren.length > 0) {
      // Loop container: lay out children horizontally inside
      let innerX = 30;
      const innerY = 60;
      const laidInner: ElkLayoutNode[] = [];
      for (const ic of innerChildren) {
        laidInner.push({
          id: ic.id,
          x: innerX,
          y: innerY,
          width: ic.width ?? NODE_WIDTH,
          height: ic.height ?? NODE_HEIGHT,
        });
        innerX += (ic.width ?? NODE_WIDTH) + gap;
      }
      const loopW = innerX + 30;
      const loopH = innerY + NODE_HEIGHT + 30;
      laid.push({
        id: child.id,
        x,
        y,
        width: loopW,
        height: loopH,
        children: laidInner,
      });
      x += loopW + gap;
    } else {
      laid.push({
        id: child.id,
        x,
        y,
        width: child.width ?? NODE_WIDTH,
        height: child.height ?? NODE_HEIGHT,
      });
      x += (child.width ?? NODE_WIDTH) + gap;
    }
  }

  const totalWidth = x;
  const totalHeight =
    y +
    Math.max(
      ...laid.map((c) => (c.height ?? NODE_HEIGHT) + gap),
      NODE_HEIGHT + gap
    );

  return {
    id: 'root',
    children: laid,
    width: totalWidth,
    height: totalHeight,
  };
}

function flattenEdges(
  layoutNode: ElkLayoutNode,
  edges: WorkflowGraphEdge[],
  hoveredNodeId: string | null,
  offsetX = 0,
  offsetY = 0,
  elements: React.ReactElement[] = []
) {
  if (layoutNode.edges) {
    for (const edge of layoutNode.edges) {
      const edgeData = edges.find((e) => e.id === edge.id);
      const isHovered =
        hoveredNodeId != null &&
        edgeData &&
        (edgeData.source === hoveredNodeId ||
          edgeData.target === hoveredNodeId);

      edge.sections?.forEach((section, index) => {
        let d = `M ${section.startPoint.x} ${section.startPoint.y}`;
        if (section.bendPoints) {
          for (const bp of section.bendPoints) {
            d += ` L ${bp.x} ${bp.y}`;
          }
        }
        d += ` L ${section.endPoint.x} ${section.endPoint.y}`;

        elements.push(
          <g
            transform={`translate(${offsetX}, ${offsetY})`}
            key={`${edge.id}-${index}`}
          >
            <path
              d={d}
              fill="none"
              stroke={
                isHovered
                  ? 'var(--workflow-edge-hover-color, #6366f1)'
                  : 'var(--workflow-edge-color, #cbd5e1)'
              }
              strokeWidth={isHovered ? 3 : 2}
              markerEnd={isHovered ? 'url(#arrow-hover)' : 'url(#arrow)'}
              className="transition-colors duration-300"
            />
          </g>
        );
      });
    }
  }
  if (layoutNode.children) {
    for (const child of layoutNode.children) {
      flattenEdges(
        child,
        edges,
        hoveredNodeId,
        offsetX + (child.x || 0),
        offsetY + (child.y || 0),
        elements
      );
    }
  }
  return elements;
}

export function WorkflowGraphBoard({
  nodes,
  edges,
  steps,
  loops = [],
  planLoops = [],
  agents = [],
  selectedStepId = null,
  onSelectStep,
  onRetryStep,
  onSkipStep,
  pendingActionId = null,
  pendingActionType = null,
  compact = false,
  className,
  isOpen = false,
  historicalRound = false,
}: WorkflowGraphBoardProps) {
  const { t } = useAppTranslation();
  const [layout, setLayout] = useState<ElkLayoutNode | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [retryDialogStepId, setRetryDialogStepId] = useState<string | null>(
    null
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const workflowGraphRef = containerRef;
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  const layoutInputRef = useRef({
    nodes,
    edges,
    loops,
    planLoops,
    steps,
  });

  useShortcutScope('workflow-graph', {
    active: isOpen && !historicalRound,
    rootRef: workflowGraphRef,
  });

  useEffect(() => {
    layoutInputRef.current = {
      nodes,
      edges,
      loops,
      planLoops,
      steps,
    };
  }, [nodes, edges, loops, planLoops, steps]);

  const layoutTopologyKey = useMemo(
    () =>
      JSON.stringify({
        nodes: nodes.map((node) => node.id),
        edges: edges.map((edge) => [edge.id, edge.source, edge.target]),
        loops: loops.map((loop) => [
          loop.loop_key,
          loop.member_step_ids,
          loop.review_step_id,
        ]),
        planLoops: (planLoops ?? []).map((loop) => [
          getPlanLoopKey(loop),
          getPlanLoopMemberStepKeys(loop),
          getPlanLoopReviewStepKey(loop),
        ]),
        steps: steps.map((step) => [step.id, step.step_key]),
      }),
    [edges, loops, nodes, planLoops, steps]
  );

  const stepByKey = useMemo(
    () => new Map(steps.map((s) => [s.step_key, s])),
    [steps]
  );
  const agentNameByLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    for (const agent of agents) {
      const keys = [
        agent.name,
        agent.agent_id,
        agent.session_agent_id,
        agent.workflow_agent_session_id,
      ];
      for (const key of keys) {
        const nk = key?.trim();
        if (nk && !lookup.has(nk)) lookup.set(nk, agent.name);
      }
    }
    return lookup;
  }, [agents]);

  useEffect(() => {
    const { nodes, edges, loops, planLoops, steps } = layoutInputRef.current;

    if (nodes.length === 0) {
      setLayout(null);
      setLayoutError(null);
      return;
    }

    const graph = buildElkGraph(nodes, edges, loops, planLoops ?? [], steps);

    elk
      .layout(graph as Parameters<typeof elk.layout>[0])
      .then((laidOut: unknown) => {
        const result = laidOut as unknown as ElkLayoutNode;
        setLayout(result);
        setLayoutError(null);

        if (result.width && result.height && containerRef.current) {
          const container = containerRef.current.getBoundingClientRect();
          const scale = Math.min(
            1,
            (container.width - 100) / result.width,
            (container.height - 100) / result.height
          );
          const x = (container.width - result.width * scale) / 2;
          const y = (container.height - result.height * scale) / 2;
          setTransform({ x, y, scale });
        }
      })
      .catch((err: unknown) => {
        console.error('ELK Layout error:', err);
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        setLayoutError(errorMessage);
        // Fallback: simple grid layout without ELK
        const fallbackLayout = buildFallbackLayout(graph.children ?? []);
        setLayout(fallbackLayout);
        if (containerRef.current) {
          const container = containerRef.current.getBoundingClientRect();
          const fw = fallbackLayout.width ?? 800;
          const fh = fallbackLayout.height ?? 400;
          const scale = Math.min(
            1,
            (container.width - 100) / fw,
            (container.height - 100) / fh
          );
          const x = (container.width - fw * scale) / 2;
          const y = (container.height - fh * scale) / 2;
          setTransform({ x, y, scale });
        }
      });
  }, [layoutTopologyKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const scaleFactor = event.deltaY < 0 ? 1.1 : 0.9;

      setTransform((current) => {
        const newScale = Math.min(
          Math.max(MIN_ZOOM, current.scale * scaleFactor),
          MAX_ZOOM
        );
        const scaleRatio = newScale / current.scale;
        return {
          x: mouseX - (mouseX - current.x) * scaleRatio,
          y: mouseY - (mouseY - current.y) * scaleRatio,
          scale: newScale,
        };
      });
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement | null;
    const isInteractiveTarget = target?.closest(
      '[data-workflow-node], button, a, input, textarea, select'
    );
    if (e.button === 1 || (e.button === 0 && !isInteractiveTarget)) {
      isDragging.current = true;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setTransform((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging.current) {
      isDragging.current = false;
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleFitView = () => {
    if (layout && layout.width && layout.height && containerRef.current) {
      const container = containerRef.current.getBoundingClientRect();
      const w = layout.width;
      const h = layout.height;
      const scale = Math.min(
        1,
        (container.width - 100) / w,
        (container.height - 100) / h
      );
      const x = (container.width - w * scale) / 2;
      const y = (container.height - h * scale) / 2;
      setTransform({ x, y, scale });
    }
  };

  const handleZoom = (scaleFactor: number) => {
    if (!containerRef.current) return;

    const container = containerRef.current.getBoundingClientRect();
    const centerX = container.width / 2;
    const centerY = container.height / 2;

    setTransform((current) => {
      const newScale = Math.min(
        Math.max(MIN_ZOOM, current.scale * scaleFactor),
        MAX_ZOOM
      );
      const scaleRatio = newScale / current.scale;

      return {
        x: centerX - (centerX - current.x) * scaleRatio,
        y: centerY - (centerY - current.y) * scaleRatio,
        scale: newScale,
      };
    });
  };

  const getStatusNodeStyles = (status?: string | null) => {
    switch (status) {
      case 'completed':
      case 'pre_completed':
        return 'wf-node-completed';
      case 'running':
      case 'revising':
        return 'wf-node-running';
      case 'failed':
      case 'interrupted':
        return 'wf-node-interrupted';
      case 'waiting_review':
      case 'waiting_input':
        return 'wf-node-waiting';
      case 'ready':
        return 'wf-node-ready';
      default:
        return 'wf-node-pending';
    }
  };

  const getStatusTextClassName = (status?: string | null) => {
    switch (status) {
      case 'completed':
        return 'text-[#4ADE80]';
      case 'pre_completed':
      case 'ready':
        return 'text-[#8A8F98]';
      case 'running':
      case 'revising':
        return 'text-[#5E6AD2]';
      case 'waiting_review':
        return 'text-[#8B5CF6]';
      case 'waiting_input':
        return 'text-[#8B5CF6]';
      case 'failed':
      case 'interrupted':
        return 'text-[#E5484D]';
      case 'skipped':
        return 'text-[#4F5156]';
      case 'blocked':
        return 'text-[#4F5156]';
      default:
        return 'text-[#4F5156]';
    }
  };

  const renderLayoutNodes = (
    layoutNode: ElkLayoutNode,
    mode: 'background' | 'nodes',
    offsetX = 0,
    offsetY = 0
  ): React.ReactElement[] => {
    const elements: React.ReactElement[] = [];

    (layoutNode.children || []).forEach((child) => {
      const dataNode = nodes.find((n) => n.id === child.id);
      const isLoop = !dataNode;

      const absX = offsetX + (child.x || 0);
      const absY = offsetY + (child.y || 0);

      if (isLoop) {
        if (mode === 'background') {
          const loopData = loops.find((l) => l.loop_key === child.id);
          const loopStatus = loopData?.status ?? null;
          const loopTone = workflowLoopStatusMeta(loopStatus, t);

          elements.push(
            <div key={`loop-bg-${child.id}`}>
              <div
                className="absolute border-2 border-dashed rounded-[32px] pointer-events-none transition-all duration-500"
                style={{
                  left: absX,
                  top: absY,
                  width: child.width,
                  height: child.height,
                  borderColor: loopTone.borderColor,
                  backgroundColor: 'var(--workflow-loop-bg, #FFFFFF)',
                  boxShadow:
                    'var(--workflow-loop-shadow, 0 4px 12px rgba(0,0,0,0.03), inset 0 2px 20px 0 rgba(0,0,0,0.01))',
                }}
              >
                {/* Floating Header Badge */}
                <div
                  className="absolute -top-3 left-6 flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-slate-200 shadow-sm"
                  style={{ borderColor: loopTone.borderColor }}
                >
                  <div className="flex items-center gap-1.5">
                    <ArrowsClockwiseIcon
                      className="size-3 text-slate-400"
                      weight="bold"
                    />
                    <span className="text-[10px] font-bold tracking-tight text-slate-800 uppercase">
                      {child.id}
                    </span>
                  </div>
                  <div className="w-px h-3 bg-slate-200 mx-0.5" />
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[9px] font-bold whitespace-nowrap',
                      loopTone.badgeClass
                    )}
                  >
                    {loopTone.label}
                  </span>
                  {loopStatus === 'running' && (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                    </span>
                  )}
                </div>
              </div>
              {renderLayoutNodes(child, 'background', absX, absY)}
            </div>
          );
        } else {
          elements.push(...renderLayoutNodes(child, 'nodes', absX, absY));
        }
        return;
      }

      if (mode === 'nodes') {
        const node = child;
        const step = stepByKey.get(child.id);
        const status = step?.status ?? dataNode.data.status ?? 'pending';
        const retryStepId = step?.id ?? null;
        const leadReviewRequired = step?.lead_review_required ?? true;
        const canRetryReviewStep = canRetryWorkflowStepReview(step);

        const canRetryStep =
          !!onRetryStep &&
          !!retryStepId &&
          isRetryableWorkflowStepStatus(step?.status);
        const canSkipStep =
          !!onSkipStep && !!retryStepId && canSkipWorkflowStep(step?.status);
        const isRetryPending = !!retryStepId && pendingActionId === retryStepId;
        const isSkipPending =
          !!retryStepId &&
          pendingActionId === retryStepId &&
          pendingActionType === 'skip-step';
        const stepAgentLabel = step?.agent_name?.trim();
        const agentName =
          (stepAgentLabel
            ? (agentNameByLookup.get(stepAgentLabel) ?? stepAgentLabel)
            : null) ??
          (dataNode.data.agentId
            ? (agentNameByLookup.get(dataNode.data.agentId.trim()) ?? null)
            : null) ??
          t('workflow.graph.leadFallback', { defaultValue: 'Lead' });

        elements.push(
          <div
            key={child.id}
            className={cn(
              'absolute rounded-xl p-4 flex flex-col gap-2',
              'cursor-pointer',
              'transition-all duration-200',
              getStatusNodeStyles(status),
              selectedStepId === child.id &&
                'wf-node-selected'
            )}
            style={{
              left: absX,
              top: absY,
              width: child.width,
              height: child.height,
            }}
            onClick={() => {
              const step = stepByKey.get(child.id);
              onSelectStep?.(child.id);
              void step;
            }}
            onMouseEnter={() => setHoveredNodeId(child.id)}
            onMouseLeave={() => setHoveredNodeId(null)}
            data-workflow-node="true"
            data-workflow-node-id={node.id}
            role={onSelectStep ? 'button' : undefined}
            tabIndex={onSelectStep && selectedStepId === child.id ? 0 : -1}
            onKeyDown={(e) => {
              if (onSelectStep && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                const step = stepByKey.get(child.id);
                onSelectStep(child.id);
                void step;
              }
            }}
          >
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold">
              <span className={cn(
                "flex items-center gap-1.5 truncate max-w-[140px]",
                'text-[#4F5156]'
              )}>
                {step?.step_type ?? dataNode.data.step_type ?? dataNode.data.stepType ?? 'task'}
                <span className="text-[rgba(255,255,255,0.15)]">·</span>
                {agentName}
              </span>
              <span className={getStatusTextClassName(status)}>
                {workflowStatusLabel(status, t)}
              </span>
            </div>
            <div
              className={cn(
                "mt-1 line-clamp-2 text-sm font-bold leading-tight break-words",
                status === 'running' || status === 'revising'
                  ? 'text-[#F7F8F8]'
                  : status === 'completed' || status === 'pre_completed'
                    ? 'text-[#4F5156]'
                    : 'text-[#8A8F98]'
              )}
              title={step?.title ?? dataNode.data.title ?? undefined}
            >
              {step?.title ?? dataNode.data.title}
            </div>

            {status === 'running' && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden rounded-b-lg">
                <motion.div
                  className="h-full bg-[#5E6AD2] w-1/3"
                  animate={{ x: ['-100%', '300%'] }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'linear',
                  }}
                />
              </div>
            )}

            {(canRetryStep || canSkipStep) && (
              <div className="absolute -bottom-3 right-3 z-50 flex items-center gap-1">
                {canSkipStep && retryStepId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRetryDialogStepId(null);
                      onSkipStep?.(retryStepId);
                    }}
                    disabled={isRetryPending}
                    aria-busy={isSkipPending}
                    className="inline-flex items-center gap-1 rounded-2xl bg-slate-500 px-2.5 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-slate-600 disabled:opacity-40"
                  >
                    {isSkipPending ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : (
                      <SkipForward className="size-3" />
                    )}
                    {t('workflow.controls.skipStep', {
                      defaultValue: 'Skip',
                    })}
                  </button>
                )}
                {canRetryStep && (
                  <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!retryStepId) return;
                    if (leadReviewRequired) {
                      setRetryDialogStepId(retryStepId);
                    } else {
                      onRetryStep?.(retryStepId);
                    }
                  }}
                  disabled={isRetryPending}
                  aria-busy={
                    isRetryPending && pendingActionType?.startsWith('retry-')
                  }
                  className="inline-flex items-center gap-1 rounded-2xl bg-rose-600 px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60 transition-colors"
                >
                  {isRetryPending &&
                  pendingActionType?.startsWith('retry-') ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : (
                    <ArrowClockwiseIcon className="size-3" weight="bold" />
                  )}
                  {t('workflow.graph.retry', { defaultValue: 'Retry' })}
                </button>
                {retryDialogStepId === retryStepId && (
                  <div className="absolute right-0 bottom-full mb-1.5 z-[100] flex min-w-[140px] flex-col gap-1 rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] p-1.5 shadow-lg">
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRetryDialogStepId(null);
                        onRetryStep?.(retryStepId);
                      }}
                    >
                      {t('workflow.graph.retryTask', {
                        defaultValue: 'Retry task',
                      })}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] font-medium transition-colors',
                        canRetryReviewStep
                          ? 'text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]'
                          : 'cursor-not-allowed text-[var(--ink-tertiary)]'
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!canRetryReviewStep) return;
                        setRetryDialogStepId(null);
                        onRetryStep?.(retryStepId, 'review');
                      }}
                      disabled={!canRetryReviewStep}
                    >
                      {t('workflow.graph.retryReview', {
                        defaultValue: 'Retry review',
                      })}
                    </button>
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRetryDialogStepId(null);
                      }}
                    >
                      {t('workflow.graph.retryCancel', {
                        defaultValue: 'Cancel',
                      })}
                    </button>
                  </div>
                )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      }
    });

    return elements.filter(Boolean);
  };

  if (!layout && nodes.length === 0) return null;

  return (
    <div
      className={cn(
        'workflow-graph-board relative overflow-hidden active:cursor-grabbing',
        className
      )}
      ref={containerRef}
      tabIndex={-1}
      data-workflow-graph-root="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        touchAction: 'none',
        backgroundColor: 'var(--workflow-board-bg, #F1F5F9)',
        height: compact ? 240 : '100%',
        minHeight: compact ? 240 : 0,
      }}
    >
      <div className="absolute top-4 left-4 pointer-events-none z-10 text-xs text-slate-600 font-medium flex flex-col gap-1">
        <span>
          {t('workflow.graph.tip', {
            defaultValue: '(Tip: Scroll to zoom, drag to pan)',
          })}
        </span>
        {layoutError && (
          <span className="text-amber-500 font-semibold pointer-events-auto">
            {t('workflow.graph.layoutWarning', {
              defaultValue: 'Layout warning: using fallback layout',
            })}
          </span>
        )}
      </div>

      <div className="workflow-graph-controls absolute bottom-4 right-4 z-20 flex items-center overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface-1)] shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
        <button
          type="button"
          onClick={() => handleZoom(1 / ZOOM_BUTTON_FACTOR)}
          className={cn(
            'flex items-center justify-center text-[var(--ink-subtle)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:opacity-40',
            compact ? 'size-5' : 'size-9',
          )}
          title={t('workflow.graph.zoomOut', { defaultValue: 'Zoom out' })}
          aria-label={t('workflow.graph.zoomOut', { defaultValue: 'Zoom out' })}
          disabled={transform.scale <= MIN_ZOOM}
        >
          <MinusIcon size={compact ? 10 : 14} weight="bold" />
        </button>
        <div className="h-5 w-px bg-[var(--hairline)]" />
        <button
          type="button"
          onClick={() => handleZoom(ZOOM_BUTTON_FACTOR)}
          className={cn(
            'flex items-center justify-center text-[var(--ink-subtle)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] disabled:opacity-40',
            compact ? 'size-5' : 'size-9',
          )}
          title={t('workflow.graph.zoomIn', { defaultValue: 'Zoom in' })}
          aria-label={t('workflow.graph.zoomIn', { defaultValue: 'Zoom in' })}
          disabled={transform.scale >= MAX_ZOOM}
        >
          <PlusIcon size={compact ? 10 : 14} weight="bold" />
        </button>
        <div className="h-5 w-px bg-[var(--hairline)]" />
        <button
          type="button"
          onClick={handleFitView}
          className={cn(
            'flex items-center justify-center text-[var(--ink-subtle)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]',
            compact ? 'size-5' : 'size-9',
          )}
          title={t('workflow.graph.fitView', { defaultValue: 'Fit to canvas' })}
          aria-label={t('workflow.graph.fitView', {
            defaultValue: 'Fit to canvas',
          })}
        >
          <ArrowsInSimpleIcon size={compact ? 10 : 14} weight="bold" />
        </button>
      </div>

      <div
        className="absolute transform-gpu origin-top-left"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
      >
        {layout && (
          <>
            {renderLayoutNodes(layout, 'background')}
            <svg
              className="absolute inset-0 pointer-events-none overflow-visible z-0"
              style={{
                width: layout.width,
                height: layout.height,
              }}
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    fill="var(--workflow-edge-color, #cbd5e1)"
                  />
                </marker>
                <marker
                  id="arrow-hover"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    fill="var(--workflow-edge-hover-color, var(--primary))"
                  />
                </marker>
              </defs>
              {flattenEdges(layout, edges, hoveredNodeId)}
            </svg>
            {renderLayoutNodes(layout, 'nodes')}
          </>
        )}
      </div>
    </div>
  );
}
