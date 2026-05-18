import { learningRunService } from '../learningRunService';
import {
  StudioGenerationContext,
  StudioGeneratorResult,
  StudioResourceTemplate,
  StudioWorkflowTraceItem
} from './types';
import { studioGeneratorRegistry } from './generators';

const now = () => new Date().toISOString();

export class StudioWorkflowRunner {
  async step<T>(
    context: StudioGenerationContext,
    agent: string,
    title: string,
    input: Record<string, unknown>,
    action: () => Promise<T>,
    summarize: (output: T) => string,
    details?: (output: T) => Record<string, unknown>
  ): Promise<T> {
    const startedAt = Date.now();
    const startedIso = now();
    const runStep = await learningRunService.startStep(context.runId, agent, input);
    try {
      const output = await action();
      await learningRunService.completeStep(runStep.id, {
        summary: summarize(output),
        ...(details ? details(output) : {})
      });
      context.trace.push({
        id: runStep.id,
        agent,
        title,
        status: 'completed',
        summary: summarize(output),
        details: details ? details(output) : undefined,
        startedAt: startedIso,
        completedAt: now(),
        durationMs: Date.now() - startedAt
      });
      return output;
    } catch (error) {
      await learningRunService.failStep(runStep.id, error);
      context.trace.push({
        id: runStep.id,
        agent,
        title,
        status: 'failed',
        summary: error instanceof Error ? error.message : String(error),
        startedAt: startedIso,
        completedAt: now(),
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  }

  async generate(context: StudioGenerationContext): Promise<{
    generated: StudioGeneratorResult;
    review: Awaited<ReturnType<typeof studioGeneratorRegistry.review>>;
  }> {
    const generated = await this.step(
      context,
      'GeneratorAgent',
      `${context.template.generator} generator`,
      {
        templateId: context.template.id,
        generator: context.template.generator,
        renderer: context.template.renderer
      },
      () => studioGeneratorRegistry.generate(context),
      (output) => `Generated ${output.content.length} characters via ${output.source}.`,
      (output) => ({
        source: output.source,
        warningCount: output.warnings?.length || 0,
        metadata: output.metadata || {}
      })
    );

    const review = await this.step(
      context,
      'ReviewAgent',
      'quality review',
      {
        templateId: context.template.id,
        generator: context.template.generator,
        contentLength: generated.content.length
      },
      () => studioGeneratorRegistry.review(context, generated),
      (output) => output.summary,
      (output) => ({
        score: output.score,
        passed: output.passed,
        warnings: output.warnings
      })
    );

    return { generated, review };
  }
}

export const studioWorkflowRunner = new StudioWorkflowRunner();

export const templateSummary = (template: StudioResourceTemplate) => ({
  id: template.id,
  goal: template.goal,
  title: template.title,
  generator: template.generator,
  renderer: template.renderer
});
