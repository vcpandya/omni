---
name: pageindex
description: "Hierarchical document retrieval via PageIndex: tree-structured indexing with LLM-based reasoning retrieval. Use when: (1) finding specific sections in large documents (PDFs, markdown), (2) navigating document structure without reading entire files, (3) answering questions about document content using structured tree search. NOT for: code intelligence (use GitNexus), simple file reads (use read tool), or entity-level memory (use Graph Memory)."
metadata:
  {
    "openclaw":
      {
        "emoji": "📑",
        "homepage": "https://github.com/EthanAnro/pageindex",
        "primaryEnv": "PAGEINDEX_AVAILABLE",
        "requires": { "bins": ["pageindex"] },
        "install":
          [
            {
              "id": "pip",
              "kind": "python",
              "package": "pageindex",
              "bins": ["pageindex"],
              "label": "Install PageIndex (pip)",
            },
          ],
      },
  }
---

# PageIndex Hierarchical Document Retrieval

Use PageIndex to build hierarchical tree indexes of documents and perform LLM-based reasoning retrieval to find relevant sections without reading entire files.

## When to Use

**USE this skill when:**

- Need to find specific sections in large PDFs or markdown documents
- Answering questions about document structure ("what topics does this cover?")
- Navigating complex documents with nested sections/chapters
- Performing targeted retrieval across multiple indexed documents
- Complementing Graph Memory: PageIndex works at document-structure level, Graph Memory at entity level

**DON'T use this skill when:**

- Analyzing code structure (use GitNexus `code_intel` tool)
- Simple file reads where you know the exact location (use `read` tool)
- Entity-level knowledge queries (use Graph Memory)
- Web searches (use `web_search` tool)

## Setup

```bash
# Install PageIndex
pip install pageindex

# Verify installation
pageindex --version

# Or use via Python module
python -m pageindex --version
```

## Workflow: Document Indexing & Retrieval

**Step 1: Index a document** — generates a hierarchical tree of sections:

```bash
pageindex index --input document.pdf --output document.tree.json
```

**Step 2: Query the index** — reasoning-based retrieval finds relevant sections:

```bash
pageindex retrieve --index document.tree.json --query "What are the security requirements?"
```

**Step 3: View tree structure** — inspect the hierarchy:

```bash
pageindex tree --index document.tree.json
```

## Available Actions (via Omni bridge)

| Action | Description |
|--------|-------------|
| `status` | Check if PageIndex is installed and list indexed documents |
| `index` | Generate hierarchical tree index for a document (PDF/markdown) |
| `retrieve` | Reasoning-based retrieval: query the tree to find relevant sections |
| `tree` | View the generated hierarchical tree structure |
| `list_indexes` | List all indexed documents in the workspace |

## Key Patterns

### Before Asking About a Document
Always check if the document is already indexed with `status` or `list_indexes`. If not, run `index` first.

### Complementary with Graph Memory
- **PageIndex** finds relevant *sections* within documents (structural navigation)
- **Graph Memory** finds relevant *entities* across conversations (knowledge graph)
- Use both together: PageIndex to locate the right document section, then Graph Memory to connect entities mentioned there

### Multi-Document Retrieval
Index multiple documents, then query across all indexes to find the most relevant sections regardless of source document.

## Notes

- PageIndex tree files are stored alongside documents as `.tree.json` files
- Re-index after document content changes
- Supports: PDF, Markdown, plain text, HTML
- Reasoning retrieval uses LLM to navigate the tree, not just keyword matching
- Works offline after indexing — retrieval is local
