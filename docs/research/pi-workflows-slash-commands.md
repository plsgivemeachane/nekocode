# Pi SDK: Workflows and Slash Commands

## Overview

This document describes how to use the Pi SDK for workflows and slash commands within NekoCode. Pi provides three main mechanisms for extending agent capabilities:

1. **Slash Commands** (`/command`) - Keyboard-interrupt style extensions
2. **Prompt Templates** (`/template`) - Text expansion snippets  
3. **Skills** (`/skill:name`) - Self-contained capability packages

---

## Slash Commands

Slash commands are registered via `pi.registerCommand()` in extensions. They provide quick actions accessible via `/` prefix.

### Registration

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI) {
  pi.registerCommand("hello", {
    description: "Greet someone",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello ${args || "world"}!`, "info");
    },
  });
}
```

### With Argument Completion

```typescript
pi.registerCommand("deploy", {
  description: "Deploy to an environment",
  getArgumentCompletions: (prefix: string) => {
    const envs = ["dev", "staging", "prod"];
    return envs
      .filter(e => e.startsWith(prefix))
      .map(e => ({ value: e, label: e }));
  },
  handler: async (args, ctx) => {
    ctx.ui.notify(`Deploying to: ${args}`, "info");
  },
});
```

### Available Commands API

```typescript
const commands = pi.getCommands();
// Returns: { name, description, source, sourceInfo }[]

// Filter by source
const extensionCommands = commands.filter(c => c.source === "extension");
const promptCommands = commands.filter(c => c.source === "prompt");
const skillCommands = commands.filter(c => c.source === "skill");
```

### Command Sources

| Source | Description | Location |
|--------|-------------|----------|
| `extension` | Registered via `pi.registerCommand()` | Extensions |
| `prompt` | Loaded from `.md` files in prompts directories | Prompt templates |
| `skill` | Loaded from `SKILL.md` directories | Skills |

---

## Prompt Templates

Prompt templates are Markdown files that expand when invoked. They act as reusable prompt snippets.

### File Locations

- Global: `~/.pi/agent/prompts/*.md`
- Project: `.pi/prompts/*.md`
- Packages: `prompts/` directories or `pi.prompts` in `package.json`
- Settings: `"prompts"` array in settings.json

### Format

```markdown
---
description: Review staged git changes
argument-hint: "<branch-name>"
---
Review the staged changes (`git diff --cached`). Focus on:
- Bugs and logic errors
- Security issues  
- Error handling gaps
```

### Usage

Type `/name` to invoke (filename without `.md`):

```
/review                    # Expands review.md
/component Button          # Expands with $1 = "Button"
/fix "typo in header"      # Multiple arguments
```

### Arguments

Templates support positional arguments:

```markdown
---
description: Create a component
---
Create a React component named $1 with features: $@
```

| Variable | Meaning |
|----------|---------|
| `$1`, `$2`, ... | Positional arguments |
| `$@` or `$ARGUMENTS` | All arguments joined |
| `${@:N}` | Arguments from N position |
| `${@:N:L}` | L arguments starting at N |

### Programmatic Registration (SDK)

```typescript
import type { PromptTemplate } from "@mariozechner/pi-coding-agent";

const customTemplate: PromptTemplate = {
  name: "deploy",
  description: "Deploy the application",
  filePath: "/virtual/prompts/deploy.md",
  sourceInfo: createSyntheticSourceInfo("/virtual/prompts/deploy.md", { source: "sdk" }),
  content: `# Deploy Instructions\n\n1. Build: npm run build\n2. Test: npm test\n3. Deploy: npm run deploy`,
};

const loader = new DefaultResourceLoader({
  cwd: process.cwd(),
  promptsOverride: (current) => ({
    prompts: [...current.prompts, customTemplate],
    diagnostics: current.diagnostics,
  }),
});
```

---

## Skills

Skills are self-contained capability packages for specialized workflows. They follow the Agent Skills standard.

### File Locations

- Global: `~/.pi/agent/skills/`, `~/.agents/skills/`
- Project: `.pi/skills/`, `.agents/skills/`
- Packages: `skills/` directories or `pi.skills` in `package.json`
- Settings: `"skills"` array in settings.json

### Structure

```
my-skill/
├── SKILL.md              # Required: frontmatter + instructions
├── scripts/              # Helper scripts
│   └── process.sh
└── references/           # Detailed docs
```

### SKILL.md Format

```markdown
---
name: my-skill
description: What this skill does and when to use it.
---

# My Skill

## Setup
```bash
npm install
```

## Usage
```bash
./scripts/process.sh <input>
```
```

### Invocation

Skills register as `/skill:name` commands:

```bash
/skill:brave-search              # Load and execute
/skill:pdf-tools extract         # With arguments
```

Arguments become: `User: <args>` appended to skill content.

---

## Workflows in NekoCode Context

### Current NekoCode Architecture

NekoCode uses the Pi SDK for AI session management. Key integration points:

1. **Session Management** (`src/main/session-manager.ts`)
   - Creates `AgentSession` via `createAgentSession()`
   - Uses `PiSessionManager` wrapper

2. **Extension Loading** (`src/main/extension-loader.ts`)
   - Loads Pi extensions via `createSdkSession()`
   - Creates `DefaultResourceLoader` for discovery

3. **IPC Bridge** (`src/main/ipc-handlers.ts`)
   - Bridges renderer commands to main process

### Implementing Slash Commands in NekoCode

NekoCode can expose slash commands through extensions. The flow:

```
User types /command in chat input
    ↓
IPC sends to main process
    ↓  
SessionManager processes extension command
    ↓
Extension handler executes (pi.registerCommand callback)
    ↓
Results streamed back to renderer
```

### Example: Workflow Extension for NekoCode

```typescript
// extensions/workflow.ts
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export default function workflowExtension(pi: ExtensionAPI) {
  // Register a new workflow command
  pi.registerCommand("start-workflow", {
    description: "Begin a structured development workflow",
    handler: async (args, ctx) => {
      const workflowType = args || "default";
      
      // Create session with workflow context
      ctx.ui.notify(`Starting ${workflowType} workflow...`, "info");
      
      // Send initial prompt
      await ctx.sendUserMessage([
        `Begin ${workflowType} workflow:`,
        `1. Understand requirements`,
        `2. Create plan`,
        `3. Implement`,
        `4. Verify`
      ].join("\n"));
    },
  });

  // Register workflow step command
  pi.registerCommand("workflow-step", {
    description: "Execute a workflow step",
    handler: async (args, ctx) => {
      const step = parseInt(args) || 1;
      const steps = [
        "requirements",
        "design", 
        "implementation",
        "testing",
        "documentation"
      ];
      
      if (step > 0 && step <= steps.length) {
        ctx.ui.setStatus("workflow", `Step ${step}: ${steps[step-1]}`);
        await ctx.sendUserPrompt(`Execute workflow step ${step}: ${steps[step-1]}`);
      }
    },
  });
}
```

---

## RPC Mode for External Integration

Pi supports JSON-RPC mode for external applications:

```bash
pi --mode rpc --no-session
```

### Key Commands

| Command | Purpose |
|---------|---------|
| `prompt` | Send user message |
| `get_commands` | List available commands |
| `get_state` | Get session state |
| `get_messages` | Get conversation history |
| `set_model` | Switch model |

### Example Request

```json
{"type": "get_commands"}
```

### Example Response

```json
{
  "type": "response",
  "command": "get_commands",
  "success": true,
  "data": {
    "commands": [
      {"name": "plan", "description": "Toggle plan mode", "source": "extension"},
      {"name": "fix-tests", "description": "Fix failing tests", "source": "prompt"}
    ]
  }
}
```

---

## NekoCode Integration Points

### 1. Chat Input Handling

`src/renderer/src/components/chat/ChatInput.tsx` handles `/` prefix detection and command invocation.

### 2. Extension System

`src/main/extension-loader.ts` already integrates Pi's extension system:

```typescript
export async function createSdkSession(
  sessionManager: SdkSessionManager,
  cwd: string,
  mode: 'create' | 'create-noext' | 'reconnect' | 'reconnect-noext',
) {
  const resourceLoader = createResourceLoader(cwd, { noExtensions: mode.endsWith('noext') });
  await resourceLoader.reload();
  // ...
}
```

### 3. Commands Available in NekoCode

Based on existing extensions, NekoCode provides:

- `/plan` - Toggle plan mode (from plan-mode extension)
- `/todos` - Show todo list
- `/reload-runtime` - Reload extensions
- Built-in: `/model`, `/settings`, `/tree`, `/compact`

---

## Creating New Slash Commands

### Step 1: Create Extension File

```typescript
// .pi/extensions/my-command.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function(pi: ExtensionAPI) {
  pi.registerCommand("my-command", {
    description: "Description of what it does",
    handler: async (args, ctx) => {
      // Your logic here
      ctx.ui.notify(`Command executed with: ${args}`, "success");
    },
  });
}
```

### Step 2: Register with NekoCode

The extension auto-discovers from `.pi/extensions/`. Restart NekoCode or use `/reload-runtime`.

### Step 3: Use in Chat

Type `/my-command <args>` in the chat input.

---

## Best Practices

1. **Use meaningful names**: Commands should be action-oriented (`deploy`, `test`, `review`)

2. **Provide descriptions**: Always include `description` for autocomplete help

3. **Handle errors gracefully**: Use try/catch and `ctx.ui.notify(..., "error")`

4. **Use argument completion**: Implement `getArgumentCompletions` for better UX

5. **Check streaming state**: Commands can run during streaming - use `ctx.waitForIdle()` if needed

6. **Follow naming conventions**: 
   - Commands: `verb-noun` (e.g., `run-tests`, `create-branch`)
   - Templates: `noun-action` (e.g., `review-changes`, `fix-bug`)
   - Skills: `capability-area` (e.g., `web-search`, `pdf-processing`)

---

## References

- [Pi Extensions Documentation](https://github.com/mariozechner/pi-coding-agent/docs/extensions.md)
- [Pi Prompt Templates Documentation](https://github.com/mariozechner/pi-coding-agent/docs/prompt-templates.md)
- [Pi Skills Documentation](https://github.com/mariozechner/pi-coding-agent/docs/skills.md)
- [Pi SDK Examples](E:/project/node/nekocode/workers/pi-package/examples/sdk/)
- [Extension Examples](E:/project/node/nekocode/workers/pi-package/examples/extensions/)