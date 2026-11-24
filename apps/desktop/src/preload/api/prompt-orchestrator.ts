import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  DesktopPromptFeedbackRequest,
  DesktopPromptLayoutCaptionRequest,
  DesktopPromptLayoutReverseRequest,
  DesktopPromptOrchestrationRequest,
  DesktopPromptSkillGenerationRequest,
  DesktopPromptWritingBudgetRequest,
  PromptMossCaptionRefinement,
  PromptMossLayoutReverse,
  PromptOrchestrationResult,
  PromptOrchestratorIPCReply,
  PromptOrchestratorStreamEnvelope,
  PromptOrchestratorStreamEvent,
  PromptOrchestratorWorkspaceState,
  PromptResultFeedbackRecord,
  PromptSkillDraft,
  PromptVocabularyBrowseInput,
  PromptVocabularyBrowseResult,
  PromptVocabularySearchInput,
  PromptVocabularySearchItem,
  PromptVocabularyResolveInput,
  PromptWritingLayerBudgetPreview,
} from "@prompthub/shared/types";

function createRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `orchestrator-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const promptOrchestratorApi = {
  run: async (
    request: DesktopPromptOrchestrationRequest,
    handlers?: { onEvent?: (event: PromptOrchestratorStreamEvent) => void },
  ) => {
    const runId = request.runId?.trim() || createRunId();
    const listener = (_event: Electron.IpcRendererEvent, payload: PromptOrchestratorStreamEnvelope) => {
      if (payload?.runId === runId) handlers?.onEvent?.(payload.event);
    };
    ipcRenderer.on(IPC_CHANNELS.PROMPT_ORCHESTRATOR_STREAM_EVENT, listener);
    try {
      return (await ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ORCHESTRATOR_RUN, {
        ...request,
        runId,
      })) as PromptOrchestratorIPCReply<PromptOrchestrationResult>;
    } finally {
      ipcRenderer.removeListener(IPC_CHANNELS.PROMPT_ORCHESTRATOR_STREAM_EVENT, listener);
    }
  },
  generateSkill: (request: DesktopPromptSkillGenerationRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.PROMPT_ORCHESTRATOR_GENERATE_SKILL,
      request,
    ) as Promise<PromptOrchestratorIPCReply<PromptSkillDraft>>,
  listSeries: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ORCHESTRATOR_SERIES) as Promise<
      PromptOrchestratorIPCReply<string[]>
    >,
  searchTerms: (input: PromptVocabularySearchInput) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.PROMPT_ORCHESTRATOR_VOCABULARY_SEARCH,
      input,
    ) as Promise<PromptOrchestratorIPCReply<PromptVocabularySearchItem[]>>,
  browseTerms: (input: PromptVocabularyBrowseInput) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.PROMPT_ORCHESTRATOR_VOCABULARY_BROWSE,
      input,
    ) as Promise<PromptOrchestratorIPCReply<PromptVocabularyBrowseResult>>,
  resolveTerms: (input: PromptVocabularyResolveInput) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.PROMPT_ORCHESTRATOR_VOCABULARY_RESOLVE,
      input,
    ) as Promise<PromptOrchestratorIPCReply<PromptVocabularySearchItem[]>>,
  refineLayoutCaptions: (request: DesktopPromptLayoutCaptionRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.PROMPT_ORCHESTRATOR_LAYOUT_CAPTIONS,
      request,
    ) as Promise<PromptOrchestratorIPCReply<PromptMossCaptionRefinement>>,
  reverseLayout: (request: DesktopPromptLayoutReverseRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.PROMPT_ORCHESTRATOR_LAYOUT_REVERSE,
      request,
    ) as Promise<PromptOrchestratorIPCReply<PromptMossLayoutReverse>>,
  submitFeedback: (request: DesktopPromptFeedbackRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.PROMPT_ORCHESTRATOR_FEEDBACK,
      request,
    ) as Promise<PromptOrchestratorIPCReply<PromptResultFeedbackRecord>>,
  getWorkspaceState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ORCHESTRATOR_STATE_GET) as Promise<
      PromptOrchestratorIPCReply<PromptOrchestratorWorkspaceState | null>
    >,
  saveWorkspaceState: (state: PromptOrchestratorWorkspaceState) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.PROMPT_ORCHESTRATOR_STATE_SAVE,
      state,
    ) as Promise<PromptOrchestratorIPCReply<PromptOrchestratorWorkspaceState>>,
  getLayerBudget: (request: DesktopPromptWritingBudgetRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.PROMPT_ORCHESTRATOR_LAYER_BUDGET,
      request,
    ) as Promise<PromptOrchestratorIPCReply<PromptWritingLayerBudgetPreview>>,
};
