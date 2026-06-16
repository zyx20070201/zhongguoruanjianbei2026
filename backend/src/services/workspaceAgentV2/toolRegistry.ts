import type {
  WorkspaceAgentRuntimeContextControl,
  WorkspaceAgentObservation,
  WorkspaceAgentRisk,
  WorkspaceAgentToolManifest,
  WorkspaceAgentHistoryMessage,
  WorkspaceAgentV2Context
} from './types';

export interface WorkspaceAgentToolContext extends WorkspaceAgentV2Context {
  userInput: string;
  runId?: string;
  contextControl?: WorkspaceAgentRuntimeContextControl;
  evidence?: any[];
  agentMessages?: WorkspaceAgentHistoryMessage[];
}

export interface WorkspaceAgentToolResult {
  observation: WorkspaceAgentObservation;
  evidence?: any[];
  raw?: unknown;
}

export interface WorkspaceAgentToolDefinition<I extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  title: string;
  description: string;
  category?: string;
  inputSchema: Record<string, unknown>;
  risk: WorkspaceAgentRisk;
  sideEffect: boolean;
  requiresApproval: boolean;
  approvalReason?: string;
  examples?: Array<Record<string, unknown>>;
  enabled?: (context: WorkspaceAgentToolContext) => boolean | Promise<boolean>;
  execute: (input: I, context: WorkspaceAgentToolContext) => Promise<WorkspaceAgentToolResult>;
}

export class WorkspaceAgentToolRegistry {
  private readonly tools = new Map<string, WorkspaceAgentToolDefinition>();

  register(tool: WorkspaceAgentToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  get(name: string) {
    return this.tools.get(name);
  }

  async available(context: WorkspaceAgentToolContext): Promise<WorkspaceAgentToolDefinition[]> {
    const result: WorkspaceAgentToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      if (context.contextControl && !context.contextControl.toolAvailability.enabledTools.includes(tool.name)) {
        continue;
      }
      if (!tool.enabled || await tool.enabled(context)) result.push(tool);
    }
    return result;
  }

  async manifest(context: WorkspaceAgentToolContext): Promise<WorkspaceAgentToolManifest[]> {
    return (await this.available(context)).map((tool) => {
      const policy = context.contextControl?.toolPolicy?.[tool.name];
      const requiresApproval = policy ? policy.requiresApproval && !policy.autoApprove : tool.requiresApproval;
      return {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        category: tool.category || 'general',
        inputSchema: tool.inputSchema,
        risk: policy?.risk || tool.risk,
        sideEffect: tool.sideEffect,
        requiresApproval,
        approvalReason: requiresApproval ? tool.approvalReason || 'ToolPolicy requires approval for this tool.' : undefined,
        examples: tool.examples
      };
    });
  }
}

export const workspaceAgentV2ToolRegistry = new WorkspaceAgentToolRegistry();
