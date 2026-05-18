# AI Studio 2.0 Backend Kernel

This module is the phase-1/phase-2 backend foundation for the redesigned AI Studio.

The product surface may expose many learning resources, but the backend should stay compact:

- Goal categories: Understand, Map, Practice, Review, Lab, Visualize, Plan.
- Resource templates: configuration records that describe a concrete resource.
- Generator kinds: eight reusable generation families.
- Workflow trace: lightweight agent steps inspired by graph-based orchestration.
- Unified artifact publishing: all generated resources go through the same file/resource path.

## Core Abstractions

`types.ts`

- `StudioGoalCategory`: the user-facing learning intent layer.
- `StudioResourceTemplate`: a template config for one resource shape.
- `StudioGeneratorKind`: one of the eight backend generator families.
- `StudioWorkflowTraceItem`: trace data for showing multi-agent collaboration.

`templateRegistry.ts`

- Registers goals and templates.
- Adding a resource should usually mean adding a template, not a new API.
- Templates map to generator/renderer pairs such as `assessment + quiz` or `structure + mermaid`.

`generators.ts`

- Implements the current generator registry.
- Uses DeepSeek when configured.
- Falls back to deterministic source-grounded content when the model is unavailable.
- Includes a Review generator pass for quality warnings and score.

`workflow.ts`

- A lightweight graph-like runner.
- Each step is persisted into `LearningRunStep`.
- Current steps:
  - ContextAgent
  - LearnerStateAgent
  - ResourcePlanningAgent
  - GeneratorAgent
  - ReviewAgent
  - PublisherAgent

`recommendationService.ts`

- Builds recommendation signals from context, learner evidence, events, and runs.
- Starts with explainable rules, leaving room for a model-based recommender later.

`studioV2Service.ts`

- Unified V2 service for templates, recommendations, and template-driven generation.
- Keeps the old AI Studio service intact for compatibility.

## API Shape

- `GET /studio/templates?goal=practice`
- `POST /studio/recommend`
- `POST /studio/generate` with `templateId` for V2
- `POST /studio/generate` with legacy `resourceType` still uses the old implementation

## Architecture Notes

This intentionally borrows the design language of graph-based agent systems:

- state is represented by `StudioGenerationContext`
- nodes are workflow steps
- outputs are persisted as run steps
- the frontend can render the trace directly

The implementation is local and dependency-light for now. If the project later adopts LangGraph JS,
the boundary is clear: `StudioWorkflowRunner` can become the adapter layer.

## Teaching Visualization IR

AI Studio visualization resources use a four-layer pipeline:

1. Teaching understanding: `teaching_understanding.v1`
2. Process trace: `process_trace.v1`
3. Visual mapping: `visual_mapping.v1`
4. Delivery: markdown, HTML, PPTX, Manim source, Remotion source

The middle two layers are intentionally product contracts, not prompt prose.

`visualizationIr.ts`

- Defines the IR contract for `sequence`, `graph`, `table`, `state_machine`, `formula`, and `hybrid` domains.
- Provides `normalizeTeachingVisualizationIR` to recover model output into a valid product shape.
- Provides `validateTeachingVisualizationIR` for runtime contract checks.
- Provides `executeProcessTrace` to derive replay frames from `initialState + statePatch`.

`reviewAgent.ts`

- Runs IR contract checks for interactive, animation, and UI-video artifacts.
- Treats missing or invalid IR as an error for visualization resources.

`contractFixtures.ts`

- Includes an evaluation corpus for sorting, NFA-to-DFA, table joins, graph traversal, and formula derivation.
- `backend/src/scripts/checkStudioContracts.ts` runs artifact normalization, rendering, review, IR validation, and trace runtime checks.
