import { ipcRenderer } from "electron";
import { IPC_CHANNELS } from "@prompthub/shared/constants/ipc-channels";
import type {
  DesktopPromptOrchestrationRequest,
  DesktopPromptSkillGenerationRequest,
  PromptOrchestrationResult,
  PromptOrchestratorIPCReply,
  PromptSkillDraft,
  PromptVocabularySearchInput,
  PromptVocabularySearchItem,
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
};
