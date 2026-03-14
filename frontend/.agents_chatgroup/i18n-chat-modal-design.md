# Chat主页面和Modal多语言系统设计方案

## 1. 现有i18n系统概述

### 1.1 技术栈
- **i18next**: 核心国际化库
- **react-i18next**: React绑定
- **i18next-browser-languagedetector**: 浏览器语言检测

### 1.2 支持的语言
| 语言代码 | 语言名称 |
|---------|---------|
| en | English |
| fr | Français |
| ja | 日本語 |
| es | Español |
| ko | 한국어 |
| zh-Hans | 简体中文 |
| zh-Hant | 繁體中文 |

### 1.3 现有命名空间(namespace)
- `common` - 通用翻译(按钮、状态、表单等)
- `settings` - 设置页面翻译
- `projects` - 项目相关翻译
- `tasks` - 任务相关翻译
- `organization` - 组织相关翻译

### 1.4 翻译文件结构
```
src/i18n/locales/
├── en/
│   ├── common.json
│   ├── settings.json
│   ├── projects.json
│   ├── tasks.json
│   └── organization.json
├── zh-Hans/
│   └── ... (同上)
└── ... (其他语言)
```

## 2. Chat页面多语言设计

### 2.1 需要新增的翻译命名空间
建议新增 `chat.json` 命名空间，专门用于Chat相关翻译。

### 2.2 Chat页面组件翻译键设计

#### 2.2.1 SessionListSidebar (会话列表侧边栏)
```json
{
  "chat": {
    "sidebar": {
      "title": "Chat Groups",
      "newSession": "New",
      "noActiveSessions": "No active sessions.",
      "noArchivedSessions": "No archived sessions.",
      "showArchived": "Show Archived",
      "hideArchived": "Hide Archived",
      "expandSidebar": "Expand sidebar",
      "collapseSidebar": "Collapse sidebar",
      "createNewSession": "Create new session",
      "untitledSession": "Untitled session"
    }
  }
}
```

#### 2.2.2 ChatHeader (聊天头部)
```json
{
  "chat": {
    "header": {
      "untitledSession": "Untitled session",
      "editSessionName": "Edit session name",
      "deleteSession": "Delete session",
      "sessionNamePlaceholder": "Session name",
      "created": "Created",
      "totalMessages": "Total messages",
      "aiMembers": "AI members",
      "searchMessages": "Search messages...",
      "clearSearch": "Clear search",
      "archived": "Archived",
      "archiveSession": "Archive session",
      "restoreSession": "Restore session",
      "cleanupMessages": "Cleanup messages",
      "exitCleanupMode": "Exit cleanup mode",
      "settings": "Settings"
    }
  }
}
```

#### 2.2.3 MessageInputArea (消息输入区)
```json
{
  "chat": {
    "input": {
      "mentionAgents": "Mention agents",
      "routeToAgents": "Route to agents",
      "replyingTo": "Replying to {{name}}",
      "referencedMessage": "Referenced message",
      "cancel": "Cancel",
      "clearAll": "Clear all",
      "preview": "Preview",
      "archivedPlaceholder": "This session is archived and read-only.",
      "inputPlaceholder": "Type your message and @mention agents...",
      "uploadingAttachments": "Uploading attachments...",
      "sendHint": "Press Enter to send, Shift+Enter for new line.",
      "addAttachment": "Add attachment files",
      "send": "Send"
    }
  }
}
```

#### 2.2.4 ChatMessageItem (聊天消息项)
```json
{
  "chat": {
    "message": {
      "quote": "Quote",
      "replyingTo": "Replying to {{name}}",
      "view": "View",
      "referencedMessageUnavailable": "Referenced message unavailable.",
      "attachments": "Attachments",
      "mentions": "Mentions",
      "codeChanges": "Code changes",
      "viewChanges": "View changes",
      "loadingDiff": "Loading diff...",
      "untrackedFile": "untracked file",
      "untrackedFiles": "untracked files",
      "apiError": {
        "quotaExceeded": "API quota exceeded",
        "rateLimited": "Rate limited",
        "checkQuota": "Please check your API quota or try again later"
      },
      "sendToAgent": "Send to agent",
      "open": "Open"
    }
  }
}
```

#### 2.2.5 AiMembersSidebar (AI成员侧边栏)
```json
{
  "chat": {
    "members": {
      "title": "AI Members",
      "countInSession": "{{count}} in session",
      "selectSessionToManage": "Select a session to manage AI members.",
      "noMembersYet": "No AI members yet. Add one below to enable @mentions.",
      "workspace": "Workspace",
      "edit": "Edit",
      "remove": "Remove",
      "addAiMember": "Add AI member",
      "editAiMember": "Edit AI member",
      "memberNameHint": "AI member name is the @mention handle.",
      "memberNameLabel": "AI member name",
      "memberNamePlaceholder": "e.g. coder",
      "baseCodingAgent": "Base coding agent",
      "checkingAgents": "Checking agents...",
      "noLocalAgentsDetected": "No local agents detected",
      "noInstalledAgents": "No installed code agents detected on this machine.",
      "modelVariant": "Model variant",
      "model": "Model",
      "systemPrompt": "System prompt",
      "expand": "Expand",
      "systemPromptPlaceholder": "Describe how this AI member should behave.",
      "workspacePath": "Workspace path",
      "workspacePathPlaceholder": "Absolute path on the server",
      "workspacePathCannotBeModified": "Workspace path cannot be modified",
      "add": "Add",
      "save": "Save"
    }
  }
}
```

#### 2.2.6 CleanupModeBar (清理模式栏)
```json
{
  "chat": {
    "cleanup": {
      "selected": "Selected: {{count}}",
      "selectAll": "Select All",
      "deselectAll": "Deselect All",
      "deleteSelected": "Delete Selected"
    }
  }
}
```

#### 2.2.7 StreamingRunEntry 和 RunningAgentPlaceholder
```json
{
  "chat": {
    "agent": {
      "running": "Running...",
      "processing": "Processing your request...",
      "thinking": "Thinking...",
      "idle": "Idle",
      "completed": "Completed",
      "failed": "Failed",
      "received": "Received"
    }
  }
}
```

## 3. Modal组件多语言设计

### 3.1 ConfirmModal (确认弹窗)
```json
{
  "chat": {
    "modals": {
      "confirm": {
        "cancel": "Cancel",
        "confirm": "Confirm",
        "processing": "Processing..."
      }
    }
  }
}
```

### 3.2 PromptEditorModal (系统提示编辑器)
```json
{
  "chat": {
    "modals": {
      "promptEditor": {
        "title": "System Prompt",
        "description": "Edit the AI member system prompt",
        "close": "Close prompt editor",
        "placeholder": "Describe how this AI member should behave.",
        "attachTextFile": "Attach text file",
        "loadingFile": "Loading file...",
        "done": "Done"
      }
    }
  }
}
```

### 3.3 FilePreviewModal (文件预览弹窗)
```json
{
  "chat": {
    "modals": {
      "filePreview": {
        "previewTitle": "Preview: {{filename}}",
        "previewNotAvailable": "Preview not available for this file type",
        "close": "Close"
      }
    }
  }
}
```

### 3.4 DiffViewerModal (代码变更查看器)
```json
{
  "chat": {
    "modals": {
      "diffViewer": {
        "title": "Code changes",
        "run": "Run",
        "exitFullScreen": "Exit full screen",
        "fullScreen": "Full screen",
        "closeDiffViewer": "Close diff viewer",
        "loadingDiff": "Loading diff...",
        "noTrackedDiff": "No tracked diff available.",
        "openRawDiff": "Open raw diff",
        "untrackedFiles": "Untracked files",
        "loadingFile": "Loading file...",
        "hide": "Hide",
        "view": "View"
      }
    }
  }
}
```

### 3.5 WorkspaceDrawer (工作区抽屉)
```json
{
  "chat": {
    "modals": {
      "workspaceDrawer": {
        "agentWorkspace": "Agent workspace",
        "close": "Close",
        "workspacePathCreatedOnFirstRun": "Workspace path is created on first run.",
        "runHistory": "Run history",
        "noRunsYet": "No runs yet for this agent.",
        "run": "Run",
        "viewLog": "View log",
        "selected": "Selected",
        "runLog": "Run log",
        "selectRunToViewLog": "Select a run to view its log output.",
        "refresh": "Refresh",
        "loadingLog": "Loading log...",
        "logEmpty": "Log is empty."
      }
    }
  }
}
```

## 4. 实现计划

### 4.1 Phase 1: 创建翻译文件结构 (优先级: 高)
1. 在所有语言目录下创建 `chat.json` 文件
2. 添加英文基础翻译 (en/chat.json)
3. 更新 `src/i18n/config.ts` 导入新的翻译文件

### 4.2 Phase 2: 修改Chat组件使用i18n (优先级: 高)
按以下顺序修改组件:
1. `SessionListSidebar.tsx`
2. `ChatHeader.tsx`
3. `MessageInputArea.tsx`
4. `AiMembersSidebar.tsx`
5. `ChatMessageItem.tsx`
6. `CleanupModeBar.tsx`
7. `StreamingRunEntry.tsx`
8. `RunningAgentPlaceholder.tsx`

### 4.3 Phase 3: 修改Modal组件使用i18n (优先级: 高)
1. `ConfirmModal.tsx`
2. `PromptEditorModal.tsx`
3. `FilePreviewModal.tsx`
4. `DiffViewerModal.tsx`
5. `WorkspaceDrawer.tsx`

### 4.4 Phase 4: 添加其他语言翻译 (优先级: 中)
按以下顺序添加翻译:
1. 简体中文 (zh-Hans/chat.json)
2. 繁体中文 (zh-Hant/chat.json)
3. 日语 (ja/chat.json)
4. 韩语 (ko/chat.json)
5. 法语 (fr/chat.json)
6. 西班牙语 (es/chat.json)

### 4.5 Phase 5: 测试和优化 (优先级: 中)
1. 测试所有语言切换功能
2. 检查文本溢出/布局问题
3. 优化翻译文本

## 5. 代码实现示例

### 5.1 组件使用示例
```tsx
// 在组件中使用翻译
import { useTranslation } from 'react-i18next';

export function SessionListSidebar() {
  const { t } = useTranslation('chat');

  return (
    <div>
      <span>{t('sidebar.title')}</span>
      <button>{t('sidebar.newSession')}</button>
      {sessions.length === 0 && (
        <div>{t('sidebar.noActiveSessions')}</div>
      )}
    </div>
  );
}
```

### 5.2 带参数的翻译示例
```tsx
// 带动态参数的翻译
<span>{t('header.totalMessages', { count: messageCount })}</span>

// 翻译文件中:
// "totalMessages": "Total messages: {{count}}"
```

### 5.3 config.ts 修改示例
```ts
// 在 config.ts 中添加 chat 命名空间
import enChat from './locales/en/chat.json';
import zhHansChat from './locales/zh-Hans/chat.json';
// ... 其他语言

const resources = {
  en: {
    common: enCommon,
    settings: enSettings,
    // ... 其他
    chat: enChat, // 新增
  },
  'zh-Hans': {
    common: zhHansCommon,
    settings: zhHansSettings,
    // ... 其他
    chat: zhHansChat, // 新增
  },
  // ... 其他语言
};
```

## 6. 注意事项

### 6.1 复用现有翻译
部分翻译已存在于 `common.json` 中，应复用而非重复:
- `buttons.save`, `buttons.cancel`, `buttons.send`, `buttons.delete`, `buttons.edit`, `buttons.close`
- `states.loading`
- `confirm.defaultConfirm`, `confirm.defaultCancel`

### 6.2 文本长度考虑
不同语言的文本长度差异较大，需注意:
- 德语通常比英语长30%
- 中文通常比英语短
- 确保UI布局能容纳最长文本

### 6.3 RTL支持
当前设计不考虑RTL(从右到左)语言，如阿拉伯语。如需支持，需要额外的CSS和布局调整。

## 7. 文件清单

### 7.1 需要创建的文件
- `src/i18n/locales/en/chat.json`
- `src/i18n/locales/zh-Hans/chat.json`
- `src/i18n/locales/zh-Hant/chat.json`
- `src/i18n/locales/ja/chat.json`
- `src/i18n/locales/ko/chat.json`
- `src/i18n/locales/fr/chat.json`
- `src/i18n/locales/es/chat.json`

### 7.2 需要修改的文件
- `src/i18n/config.ts` - 添加chat命名空间导入
- `src/pages/ui-new/chat/components/SessionListSidebar.tsx`
- `src/pages/ui-new/chat/components/ChatHeader.tsx`
- `src/pages/ui-new/chat/components/MessageInputArea.tsx`
- `src/pages/ui-new/chat/components/AiMembersSidebar.tsx`
- `src/pages/ui-new/chat/components/ChatMessageItem.tsx`
- `src/pages/ui-new/chat/components/CleanupModeBar.tsx`
- `src/pages/ui-new/chat/components/StreamingRunEntry.tsx`
- `src/pages/ui-new/chat/components/RunningAgentPlaceholder.tsx`
- `src/pages/ui-new/chat/components/ConfirmModal.tsx`
- `src/pages/ui-new/chat/components/PromptEditorModal.tsx`
- `src/pages/ui-new/chat/components/FilePreviewModal.tsx`
- `src/pages/ui-new/chat/components/DiffViewerModal.tsx`
- `src/pages/ui-new/chat/components/WorkspaceDrawer.tsx`

## 8. 时间估算

| 阶段 | 预计工时 |
|-----|---------|
| Phase 1: 创建翻译文件结构 | 1小时 |
| Phase 2: 修改Chat组件 | 3-4小时 |
| Phase 3: 修改Modal组件 | 2小时 |
| Phase 4: 添加其他语言翻译 | 4-6小时 |
| Phase 5: 测试和优化 | 2小时 |
| **总计** | **12-15小时** |

---

**设计者**: Designer Agent
**日期**: 2026-02-13
**版本**: 1.0
