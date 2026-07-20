import type { BackendChatMessage, MemberQueueSnapshot } from '@/types';

export type FileChangeType = 'created' | 'modified' | 'deleted';

export type FileChangeEntry = {
  path: string;
  change_type: FileChangeType;
};

export type ChatStreamEvent =
  | {
      type: 'agent_run_started';
      session_id: string;
      session_agent_id: string;
      agent_id: string;
      agent_name: string;
      model: string | null;
      run_id: string;
      source_message_id: string;
      client_message_id: string | null;
      started_at: string | null;
    }
  | {
      type: 'agent_activity_updated';
      session_id: string;
      run_id: string;
      latest_sequence: number;
    }
  | {
      type: 'message_new' | 'message_updated';
      message: BackendChatMessage;
    }
  | {
      type: 'agent_state';
      session_agent_id: string;
      agent_id: string;
      state: string;
      run_id: string | null;
      started_at: string | null;
    }
  | {
      type: 'mention_error';
      session_id: string;
      message_id: string;
      client_message_id: string | null;
      agent_name: string;
      agent_id: string | null;
      reason: string;
    }
  | {
      type: 'workflow_runtime_line';
      line_id: string;
      session_id: string;
      execution_id: string;
      workflow_agent_session_id: string | null;
      step_id: string;
      step_key: string;
      agent_id: string;
      agent_name: string;
      stream_type: 'assistant' | 'thinking' | 'error';
      content: string;
      created_at: string;
    }
  | {
      type: 'workflow_execution_updated';
      session_id: string;
      execution_id: string;
    }
  | {
      type: 'file_change_refresh';
      session_id: string;
      session_agent_id: string;
      agent_id: string;
      run_id: string;
      message_id: string;
      changed_files: FileChangeEntry[];
      ts: string;
    }
  | {
      type: 'queue_updated';
      session_id: string;
      session_agent_id: string;
      queue: MemberQueueSnapshot;
    };

