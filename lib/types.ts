export type TaskType = 'agent' | 'human';

export type TaskStatus =
  | 'backlog'
  | 'sprint'
  | 'building_context'
  | 'executing'
  | 'blocked'
  | 'completed';

export type BlockedKind = 'dependency' | 'missing_resource' | 'human_question';

export interface BlockedInfo {
  kind: BlockedKind;
  detail: string;
  /** ids of unmet dependency tasks, or names of missing resources */
  refs: string[];
}

export type UpdateKind =
  | 'status'
  | 'context'
  | 'info'
  | 'problem'
  | 'question'
  | 'answer'
  | 'output';

export interface TaskUpdate {
  id: string;
  ts: string;
  kind: UpdateKind;
  text: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  /** resource names (MCPs / credentials) this task needs before an agent can run it */
  requirements: string[];
  /** task ids that must be completed first */
  dependencies: string[];
  /** agent must confirm with a human before completing */
  askHuman: boolean;
  blocked: BlockedInfo | null;
  pendingQuestion: string | null;
  updates: TaskUpdate[];
  output: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type ResourceKind = 'mcp' | 'credential';

export interface Resource {
  id: string;
  name: string;
  kind: ResourceKind;
  addedAt: string;
}

export interface Db {
  tasks: Task[];
  resources: Resource[];
}
