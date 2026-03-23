export type AgentStatus = 'idle' | 'active' | 'waiting' | 'permission';

export interface AgentState {
  id: number;
  projectDir: string;
  projectName: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>;
  activeSubagentToolNames: Map<string, Map<string, string>>;
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  status: AgentStatus;
  currentActivity: string;
  paletteIndex: number;
  lastActivity: number;
}
