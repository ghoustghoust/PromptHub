import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  DesktopPromptLayoutCaptionRequest,
  DesktopPromptLayoutReverseRequest,
  DesktopPromptOrchestrationRequest,
  DesktopPromptSkillGenerationRequest,
  PromptMossCaptionRefinement,
  PromptMossLayoutReverse,
  PromptOrchestrationResult,
  PromptOrchestratorIPCReply,
  PromptSkillDraft,
  PromptVocabularyBrowseInput,
  PromptVocabularyBrowseResult,
  PromptVocabularySearchInput,
  PromptVocabularySearchItem,
  PromptVocabularyResolveInput,
} from "@prompthub/shared/types";

export const promptOrchestratorApi = {
  run: (request: DesktopPromptOrchestrationRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.PROMPT_ORCHESTRATOR_RUN, request) as Promise<
      PromptOrchestratorIPCReply<PromptOrchestrationResult>
    >,
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
};
