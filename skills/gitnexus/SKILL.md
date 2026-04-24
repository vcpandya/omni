---
name: gitnexus
description: "Code intelligence via GitNexus: impact analysis, symbol context, call graphs, and architectural exploration. Use when: (1) analyzing blast radius before multi-file edits, (2) understanding all callers/callees of a function, (3) tracing execution flows, (4) performing safe coordinated renames. NOT for: simple one-file edits (just edit directly), reading file contents (use read tool), or tasks unrelated to code structure."
metadata:
  {
    "openclaw":
      {
        "emoji": "🔬",
        "homepage": "https://github.com/abhigyanpatwari/GitNexus",
        "primaryEnv": "GITNEXUS_AVAILABLE",
        "requires": { "bins": ["gitnexus"] },
        "install":
          [
            {
              "id": "npm",
              "kind": "node",
              "package": "gitnexus",
              "bins": ["gitnexus"],
              "label": "Install GitNexus (npm)",
            },
          ],
      },
  }
---

# GitNexus Code Intelligence

Use GitNexus to understand code structure, analyze impact before changes, and navigate the codebase as a knowledge graph.

## When to Use

**USE this skill when:**

- About to make multi-file edits (run `impact` first to understand blast radius)
- Need to understand all callers/callees of a function before modifying it
- Performing coordinated renames across a codebase
- Exploring architecture: "what calls what?", "how does this flow work?"
- Verifying staged changes won't break unexpected downstream code

**DON'T use this skill when:**

- Simple single-file edits where the scope is obvious
- Reading file contents (use `read` tool)
- Tasks unrelated to code structure analysis

## Setup

```bash
# Install GitNexus
npm install -g gitnexus

# Index the current workspace (run once, re-run after major changes)
gitnexus analyze

# Verify index
gitnexus mcp  # starts the MCP server (used internally by Omni)
```

## Workflow: Impact-Aware Editing

**Before making changes** to a function or class:

1. **Query context** to understand the symbol:
   ```
   gitnexus context --symbol "functionName" --repo .
   ```
   Returns: definition, callers, callees, imports, community cluster.

2. **Run impact analysis** to see blast radius:
   ```
   gitnexus impact --symbol "functionName" --repo .
   ```
   Returns: all files/symbols affected if this symbol changes.

3. **Make your edits** with full knowledge of downstream effects.

4. **Detect changes** after staging to verify:
   ```
   gitnexus detect_changes --repo .
   ```
   Compares current state to indexed graph, shows what shifted.

## Available Tools (via MCP)

| Tool | Purpose |
|------|---------|
| `query` | Search the knowledge graph by symbol name, type, or pattern |
| `context` | Get full context for a symbol: definition, callers, callees, community |
| `impact` | Analyze blast radius: what breaks if this symbol changes? |
| `detect_changes` | Compare current code state against indexed graph |
| `rename` | Coordinated rename across all references |
| `cypher` | Raw Cypher query against the KuzuDB graph |
| `list_repos` | List all indexed repositories |

## Key Patterns

### Before Multi-File Edits
Always run `impact` on the primary symbol being changed. If the blast radius includes files you didn't plan to touch, review those files before proceeding.

### After Staging Changes
Run `detect_changes` to verify the actual impact matches your expectations. This is especially important for refactors.

### Architectural Exploration
Use `query` with broad patterns to understand module boundaries:
```
gitnexus query --pattern "auth*" --type function --repo .
```

### Coordinated Renames
Use `rename` instead of manual find-replace. It understands imports, re-exports, and type references:
```
gitnexus rename --old "oldName" --new "newName" --repo .
```

## Notes

- GitNexus indexes are stored in `~/.gitnexus/` and tracked via `~/.gitnexus/registry.json`
- Re-index after major structural changes (new modules, large refactors)
- Supports: TypeScript, JavaScript, Python, Java, C/C++, C#, Go, Rust
- Impact analysis is most valuable for shared/library code with many consumers
