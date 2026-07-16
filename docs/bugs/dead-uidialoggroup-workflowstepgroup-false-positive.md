# DEAD-1: UIDialogGroup/WorkflowStepGroup Exports — False Positive

**Date:** 2026-06-15
**Severity:** N/A (False positive from prior audit)
**Status:** Reverted — types are actively used
**Files affected:**
- `src/renderer/src/utils/message-grouping.ts`
- `src/renderer/src/components/chat/ChatView.tsx`

## Initial Assessment (from prior audit)

The prior audit classified `UIDialogGroup` and `WorkflowStepGroup` as dead code because no function in `message-grouping.ts` creates instances of them. The audit recommended removing them.

## Actual Finding

These types ARE actively used — just not by functions in `message-grouping.ts`. ChatView directly constructs objects matching these types and pushes them onto the `messageGroups` array:

```ts
// ChatView.tsx line ~186
messageGroups.push({ key: `wf-${workflowId}`, type: 'workflow-step', workflowId })

// ChatView.tsx line ~192
messageGroups.push({ key: 'ui-dialog-active', type: 'ui-dialog' })
```

The types are also used in type narrowing:
```ts
if (group.type === 'ui-dialog' && activeUIRequest) { ... }
if (group.type === 'workflow-step') { const wf = trackedWorkflows.get(group.workflowId) }
```

## Resolution

Restored `UIDialogGroup` and `WorkflowStepGroup` to the `MessageGroup` union type. The audit's methodology was flawed: it only checked for exports within the defining module, not cross-module usage of the exported types.

## Lesson

When auditing for dead code, search the entire codebase for references — not just the defining file. TypeScript union types are often consumed in other modules via type narrowing.
