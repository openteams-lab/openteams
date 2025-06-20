import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText, ChevronDown, ChevronUp, RefreshCw, GitBranch } from "lucide-react";
import { makeRequest } from "@/lib/api";
import type { WorktreeDiff, DiffChunkType, DiffChunk, BranchStatus } from "shared/types";

interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  message: string | null;
}

export function TaskAttemptComparePage() {
  const { projectId, taskId, attemptId } = useParams<{
    projectId: string;
    taskId: string;
    attemptId: string;
  }>();
  const navigate = useNavigate();

  const [diff, setDiff] = useState<WorktreeDiff | null>(null);
  const [branchStatus, setBranchStatus] = useState<BranchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [branchStatusLoading, setBranchStatusLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [rebasing, setRebasing] = useState(false);
  const [mergeSuccess, setMergeSuccess] = useState(false);
  const [rebaseSuccess, setRebaseSuccess] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (projectId && taskId && attemptId) {
      fetchDiff();
      fetchBranchStatus();
    }
  }, [projectId, taskId, attemptId]);

  const fetchDiff = async () => {
    if (!projectId || !taskId || !attemptId) return;

    try {
      setLoading(true);
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${taskId}/attempts/${attemptId}/diff`
      );

      if (response.ok) {
        const result: ApiResponse<WorktreeDiff> = await response.json();
        if (result.success && result.data) {
          setDiff(result.data);
        } else {
          setError("Failed to load diff");
        }
      } else {
        setError("Failed to load diff");
      }
    } catch (err) {
      setError("Failed to load diff");
    } finally {
      setLoading(false);
    }
  };

  const fetchBranchStatus = async () => {
    if (!projectId || !taskId || !attemptId) return;

    try {
      setBranchStatusLoading(true);
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${taskId}/attempts/${attemptId}/branch-status`
      );

      if (response.ok) {
        const result: ApiResponse<BranchStatus> = await response.json();
        if (result.success && result.data) {
          setBranchStatus(result.data);
        } else {
          setError("Failed to load branch status");
        }
      } else {
        setError("Failed to load branch status");
      }
    } catch (err) {
      setError("Failed to load branch status");
    } finally {
      setBranchStatusLoading(false);
    }
  };

  const handleBackClick = () => {
    navigate(`/projects/${projectId}/tasks/${taskId}`);
  };

  const handleMergeClick = async () => {
    if (!projectId || !taskId || !attemptId) return;

    try {
      setMerging(true);
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${taskId}/attempts/${attemptId}/merge`,
        {
          method: 'POST',
        }
      );

      if (response.ok) {
        const result: ApiResponse<string> = await response.json();
        if (result.success) {
          setMergeSuccess(true);
          // Refetch both diff and branch status to show updated state
          fetchDiff();
          fetchBranchStatus();
        } else {
          setError("Failed to merge changes");
        }
      } else {
        setError("Failed to merge changes");
      }
    } catch (err) {
      setError("Failed to merge changes");
    } finally {
      setMerging(false);
    }
  };

  const handleRebaseClick = async () => {
    if (!projectId || !taskId || !attemptId) return;

    try {
      setRebasing(true);
      const response = await makeRequest(
        `/api/projects/${projectId}/tasks/${taskId}/attempts/${attemptId}/rebase`,
        {
          method: 'POST',
        }
      );

      if (response.ok) {
        const result: ApiResponse<string> = await response.json();
        if (result.success) {
          setRebaseSuccess(true);
          // Refresh both diff and branch status after rebase
          fetchDiff();
          fetchBranchStatus();
        } else {
          setError(result.message || "Failed to rebase branch");
        }
      } else {
        setError("Failed to rebase branch");
      }
    } catch (err) {
      setError("Failed to rebase branch");
    } finally {
      setRebasing(false);
    }
  };

  const getChunkClassName = (chunkType: DiffChunkType) => {
    const baseClass = "font-mono text-sm whitespace-pre px-3 py-1";
    
    switch (chunkType) {
      case 'Insert':
        return `${baseClass} bg-green-50 text-green-800 border-l-2 border-green-400`;
      case 'Delete':
        return `${baseClass} bg-red-50 text-red-800 border-l-2 border-red-400`;
      case 'Equal':
      default:
        return `${baseClass} text-gray-700`;
    }
  };

  const getChunkPrefix = (chunkType: DiffChunkType) => {
    switch (chunkType) {
      case 'Insert':
        return '+';
      case 'Delete':
        return '-';
      case 'Equal':
      default:
        return ' ';
    }
  };

  interface ProcessedLine {
    content: string;
    chunkType: DiffChunkType;
    lineNumber: number;
  }

  interface ProcessedSection {
    type: 'context' | 'change' | 'expanded';
    lines: ProcessedLine[];
    expandKey?: string;
    expandedAbove?: boolean;
    expandedBelow?: boolean;
  }

  const processFileChunks = (chunks: DiffChunk[], fileIndex: number) => {
    const CONTEXT_LINES = 3;
    const lines: ProcessedLine[] = [];
    let currentLineNumber = 1;

    // Convert chunks to lines with line numbers
    chunks.forEach(chunk => {
      const chunkLines = chunk.content.split('\n');
      chunkLines.forEach((line, index) => {
        if (index < chunkLines.length - 1 || line !== '') { // Skip empty last line from split
          lines.push({
            content: line,
            chunkType: chunk.chunk_type,
            lineNumber: currentLineNumber++
          });
        }
      });
    });

    const sections: ProcessedSection[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.chunkType === 'Equal') {
        // Look for the next change or end of file
        let nextChangeIndex = i + 1;
        while (nextChangeIndex < lines.length && lines[nextChangeIndex].chunkType === 'Equal') {
          nextChangeIndex++;
        }

        const contextLength = nextChangeIndex - i;
        const hasNextChange = nextChangeIndex < lines.length;
        const hasPrevChange = sections.length > 0 && sections[sections.length - 1].type === 'change';

        if (contextLength <= CONTEXT_LINES * 2 || (!hasPrevChange && !hasNextChange)) {
          // Show all context if it's short or if there are no changes around it
          sections.push({
            type: 'context',
            lines: lines.slice(i, nextChangeIndex)
          });
        } else {
          // Split into context sections with expandable middle
          if (hasPrevChange) {
            // Add context after previous change
            sections.push({
              type: 'context',
              lines: lines.slice(i, i + CONTEXT_LINES)
            });
            i += CONTEXT_LINES;
          }

          if (hasNextChange) {
            // Add expandable section
            const expandStart = hasPrevChange ? i : i + CONTEXT_LINES;
            const expandEnd = nextChangeIndex - CONTEXT_LINES;
            
            if (expandEnd > expandStart) {
              const expandKey = `${fileIndex}-${expandStart}-${expandEnd}`;
              const isExpanded = expandedSections.has(expandKey);
              
              if (isExpanded) {
                sections.push({
                  type: 'expanded',
                  lines: lines.slice(expandStart, expandEnd),
                  expandKey
                });
              } else {
                sections.push({
                  type: 'context',
                  lines: [],
                  expandKey
                });
              }
            }

            // Add context before next change
            sections.push({
              type: 'context',
              lines: lines.slice(nextChangeIndex - CONTEXT_LINES, nextChangeIndex)
            });
          } else if (!hasPrevChange) {
            // No changes around, just show first few lines
            sections.push({
              type: 'context',
              lines: lines.slice(i, i + CONTEXT_LINES)
            });
          }
        }

        i = nextChangeIndex;
      } else {
        // Found a change, collect all consecutive changes
        const changeStart = i;
        while (i < lines.length && lines[i].chunkType !== 'Equal') {
          i++;
        }

        sections.push({
          type: 'change',
          lines: lines.slice(changeStart, i)
        });
      }
    }

    return sections;
  };

  const toggleExpandSection = (expandKey: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(expandKey)) {
        newSet.delete(expandKey);
      } else {
        newSet.add(expandKey);
      }
      return newSet;
    });
  };

  if (loading || branchStatusLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading diff...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={handleBackClick} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Task
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Button onClick={handleBackClick} variant="outline" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Task
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Compare Changes
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {/* Branch Status */}
          {!branchStatusLoading && branchStatus && (
            <div className="flex items-center gap-2 text-sm">
              <GitBranch className="h-4 w-4" />
              {branchStatus.up_to_date ? (
                <span className="text-green-600">Up to date</span>
              ) : branchStatus.is_behind === true ? (
                <span className="text-orange-600">
                  {branchStatus.commits_behind} commit{branchStatus.commits_behind !== 1 ? 's' : ''} behind main
                </span>
              ) : (
                <span className="text-blue-600">
                  {branchStatus.commits_ahead} commit{branchStatus.commits_ahead !== 1 ? 's' : ''} ahead of main
                </span>
              )}
            </div>
          )}

          {/* Success Messages */}
          {rebaseSuccess && (
            <div className="text-green-600 text-sm">
              Branch rebased successfully!
            </div>
          )}
          {mergeSuccess && (
            <div className="text-green-600 text-sm">
              Changes merged successfully!
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {branchStatus && branchStatus.is_behind === true && (
              <Button 
                onClick={handleRebaseClick} 
                disabled={rebasing || branchStatusLoading}
                variant="outline"
                className="border-orange-300 text-orange-700 hover:bg-orange-50"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${rebasing ? 'animate-spin' : ''}`} />
                {rebasing ? "Rebasing..." : "Rebase onto Main"}
              </Button>
            )}
            <Button 
              onClick={handleMergeClick} 
              disabled={merging || !diff || diff.files.length === 0 || Boolean(branchStatus?.is_behind)}
              className="bg-green-600 hover:bg-green-700 disabled:bg-gray-400"
            >
              {merging ? "Merging..." : "Merge Changes"}
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Diff: Base Commit vs. Current Worktree
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Shows changes made in the task attempt worktree compared to the base commit
          </p>
        </CardHeader>
        <CardContent>
          {!diff || diff.files.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No changes detected</p>
              <p className="text-sm">The worktree is identical to the base commit</p>
            </div>
          ) : (
            <div className="space-y-6">
              {diff.files.map((file, fileIndex) => (
                <div key={fileIndex} className="border rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 border-b">
                    <p className="text-sm font-medium text-gray-700 font-mono">
                      {file.path}
                    </p>
                  </div>
                  <div className="max-h-[600px] overflow-y-auto">
                    {processFileChunks(file.chunks, fileIndex).map((section, sectionIndex) => {
                      if (section.type === 'context' && section.lines.length === 0 && section.expandKey) {
                        // Render expand button
                        const lineCount = parseInt(section.expandKey.split('-')[2]) - parseInt(section.expandKey.split('-')[1]);
                        return (
                          <div key={`expand-${section.expandKey}`}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleExpandSection(section.expandKey!)}
                              className="w-full h-8 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 border-t border-b border-gray-200 rounded-none"
                            >
                              <ChevronDown className="h-3 w-3 mr-1" />
                              Show {lineCount} more lines
                            </Button>
                          </div>
                        );
                      }

                      // Render lines (context, change, or expanded)
                      return (
                        <div key={`section-${sectionIndex}`}>
                          {section.type === 'expanded' && section.expandKey && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleExpandSection(section.expandKey!)}
                              className="w-full h-8 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 border-t border-b border-gray-200 rounded-none"
                            >
                              <ChevronUp className="h-3 w-3 mr-1" />
                              Hide expanded lines
                            </Button>
                          )}
                          {section.lines.map((line, lineIndex) => (
                            <div 
                              key={`${sectionIndex}-${lineIndex}`}
                              className={getChunkClassName(line.chunkType)}
                            >
                              {getChunkPrefix(line.chunkType)}{line.content}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
