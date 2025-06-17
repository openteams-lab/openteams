import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText } from "lucide-react";
import { makeAuthenticatedRequest } from "@/lib/auth";
import type { WorktreeDiff, DiffChunkType } from "shared/types";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeSuccess, setMergeSuccess] = useState(false);

  useEffect(() => {
    if (projectId && taskId && attemptId) {
      fetchDiff();
    }
  }, [projectId, taskId, attemptId]);

  const fetchDiff = async () => {
    if (!projectId || !taskId || !attemptId) return;

    try {
      setLoading(true);
      const response = await makeAuthenticatedRequest(
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

  const handleBackClick = () => {
    navigate(`/projects/${projectId}/tasks/${taskId}`);
  };

  const handleMergeClick = async () => {
    if (!projectId || !taskId || !attemptId) return;

    try {
      setMerging(true);
      const response = await makeAuthenticatedRequest(
        `/api/projects/${projectId}/tasks/${taskId}/attempts/${attemptId}/merge`,
        {
          method: 'POST',
        }
      );

      if (response.ok) {
        const result: ApiResponse<string> = await response.json();
        if (result.success) {
          setMergeSuccess(true);
          // Optionally refetch the diff to show updated state
          fetchDiff();
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

  if (loading) {
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
        <div className="flex items-center gap-2">
          {mergeSuccess && (
            <div className="text-green-600 text-sm">
              Changes merged successfully!
            </div>
          )}
          <Button 
            onClick={handleMergeClick} 
            disabled={merging || !diff || diff.files.length === 0}
            className="bg-green-600 hover:bg-green-700"
          >
            {merging ? "Merging..." : "Merge Changes"}
          </Button>
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
                    {file.chunks.map((chunk, chunkIndex) => 
                      chunk.content.split('\n').map((line, lineIndex) => (
                        <div 
                          key={`${chunkIndex}-${lineIndex}`}
                          className={getChunkClassName(chunk.chunk_type)}
                        >
                          {getChunkPrefix(chunk.chunk_type)}{line}
                        </div>
                      ))
                    )}
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
