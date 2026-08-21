13# Knowledge Base Management Module

This module provides complete knowledge base initialization, management, and query functionality.

## 📁 Directory Structure

```
knowledge/
├─┢ __init__.py                    # Module initialization
├─┢ config.py                      # Path configuration (unified management)
├─┢ start_kb.py                    # Startup script (main entry) ?├─┢ kb.py                          # Quick startup script (recommended)
├─┢ initializer.py                # Knowledge base initializer
├─┢ add_documents.py               # Incremental document addition ?New feature
├─┢ manager.py                     # Knowledge base manager
├─┢ extract_numbered_items.py      # Numbered items extractor
├─┢ progress_tracker.py            # Progress tracking
└─┢ README.md                      # This file
```

## 🚀 Quick Start

**Recommended usage (direct execution):**

```bash
# Run from project root directory (ThinkPilot/)
python -m src.knowledge.start_kb [command]
```

**Or using module import:**

```bash
# Ensure in project root directory (ThinkPilot/)
python -m src.knowledge.start_kb [command]
```

## 📋 Commands

### 1. List All Knowledge Bases

```bash
python -m src.knowledge.start_kb list
```

### 2. View Knowledge Base Information

```bash
# View default knowledge base
python -m src.knowledge.start_kb info

# View specified knowledge base
python -m src.knowledge.start_kb info ai_textbook
```

### 3. Set Default Knowledge Base

```bash
python -m src.knowledge.start_kb set-default math2211
```

### 4. Initialize New Knowledge Base

```bash
# Create from single or multiple documents
python -m src.knowledge.start_kb init my_textbook --docs textbook.pdf notes.pdf

# Create from directory
python -m src.knowledge.start_kb init my_course --docs-dir ./course_materials/

# Skip numbered items extraction (faster)
python -m src.knowledge.start_kb init my_kb --docs doc.pdf --skip-extract

# Custom batch size (for large documents)
python -m src.knowledge.start_kb init my_kb --docs large_book.pdf --batch-size 30
```

### 5. Extract Numbered Items

```bash
# Extract all numbered items for specified knowledge base
python -m src.knowledge.start_kb extract --kb ai_textbook

# Process specific file only
python -m src.knowledge.start_kb extract --kb ai_textbook --content-file chapter1.json

# Debug mode (process first file only)
python -m src.knowledge.start_kb extract --kb ai_textbook --debug

# Custom concurrency and batch processing
python -m src.knowledge.start_kb extract --kb ai_textbook --batch-size 30 --max-concurrent 10
```

### 6. Incremental Document Addition ?New Feature

Add new documents to existing knowledge base without recreating the entire knowledge base:

```bash
# Add single document to knowledge base
python -m src.knowledge.add_documents ai_textbook --docs new_chapter.pdf

# Add multiple documents
python -m src.knowledge.add_documents math2211 --docs chapter1.pdf chapter2.pdf

# Add documents from directory
python -m src.knowledge.add_documents ai_textbook --docs-dir ./new_materials/

# Allow overwriting duplicate files
python -m src.knowledge.add_documents ai_textbook --docs document.pdf --allow-duplicates

# Add files only, skip processing (process later manually)
python -m src.knowledge.add_documents ai_textbook --docs file.pdf --skip-processing

# Skip numbered items extraction
python -m src.knowledge.add_documents ai_textbook --docs file.pdf --skip-extract
```

**Benefits of incremental addition:**
- ?Only processes new documents, saves time and cost
- ?Automatically merges with existing knowledge graph without affecting existing content
- ?Automatically skips duplicate files to avoid reprocessing
- ?Automatically updates knowledge base metadata and history

### 7. Delete Knowledge Base 🗑?
Permanently delete a knowledge base:

```bash
# Delete knowledge base (requires confirmation)
python -m src.knowledge.start_kb delete old_kb

# Force delete (skip confirmation, dangerous!)
python -m src.knowledge.start_kb delete old_kb --force
```

### 8. Clean RAG Storage 🧹

When RAG storage is corrupted (e.g., GraphML file corruption), clean and rebuild:

```bash
# Clean RAG storage for specified knowledge base (auto backup)
python -m src.knowledge.start_kb clean-rag C2-test

# Clean default knowledge base RAG storage
python -m src.knowledge.start_kb clean-rag

# Clean without backup (not recommended)
python -m src.knowledge.start_kb clean-rag C2-test --no-backup
```

**Use cases:**
- ?RAG initialization failure (e.g., GraphML parsing error)
- ?Knowledge graph data corruption
- 🔄 Need to rebuild knowledge graph

**After cleaning:**
Use `add_documents.py` to reprocess documents to rebuild RAG storage

### 9. Refresh Knowledge Base 🔄

Reprocess all documents in knowledge base:

```bash
# Refresh knowledge base (rebuild RAG only)
python -m src.knowledge.start_kb refresh ai_textbook

# Full refresh (clean all extracted content and images)
python -m src.knowledge.start_kb refresh ai_textbook --full

# Refresh without backing up RAG storage
python -m src.knowledge.start_kb refresh ai_textbook --no-backup

# Skip numbered items extraction
python -m src.knowledge.start_kb refresh ai_textbook --skip-extract
```

**Use cases:**
- 🔧 Updated parsing algorithm or model
- 🐛 Fixed previous processing errors
- 📊 Need to completely rebuild knowledge graph

**Difference:**
- `refresh`: Reprocesses all documents
- `add_documents`: Only processes newly added documents (incremental)

## 📦 Knowledge Base Structure

Initialized knowledge base directory structure:

```
knowledge_bases/
├─┢ kb_config.json              # Knowledge base configuration
└─┢ my_textbook/                # Knowledge base directory
    ├─┢ metadata.json           # Metadata (includes update history)
    ├─┢ numbered_items.json     # Numbered items (Definition, Theorem, etc.)
    ├─┢ raw/                    # Original documents
    ?  ├─┢ textbook.pdf        # Initial documents
    ?  └─┢ new_chapter.pdf     # Incrementally added documents
    ├─┢ images/                 # Extracted images
    ?  ├─┢ figure_1_1.jpg
    ?  └─┢ new_figure.jpg      # Images from new documents
    ├─┢ content_list/           # Document content list
    ?  ├─┢ textbook.json
    ?  └─┢ new_chapter.json    # Content list for new documents
    └─┢ rag_storage/            # RAG knowledge graph (incremental updates)
        ├─┢ kv_store_full_entities.json
        ├─┢ kv_store_full_relations.json
        └─┢ kv_store_text_chunks.json
```

**metadata.json structure example:**

```json
{
  "name": "my_textbook",
  "created_at": "2025-01-15 10:30:00",
  "last_updated": "2025-01-20 14:25:00",
  "description": "Knowledge base: my_textbook",
  "version": "1.0",
  "update_history": [
    {
      "timestamp": "2025-01-15 10:30:00",
      "action": "create",
      "files_added": 1
    },
    {
      "timestamp": "2025-01-20 14:25:00",
      "action": "add_documents",
      "files_added": 2
    }
  ]
}
```

## 🔧 Environment Configuration

Required in project root `.env` file:

```bash
LLM_API_KEY=your_openai_api_key
LLM_HOST=https://api.openai.com/v1
```

## 💡 Usage Tips

### 1. Incremental Document Addition ?
When knowledge base already exists and you only need to add new documents:

```bash
# Wrong approach: Recreate entire knowledge base (wastes time and API costs)
python -m src.knowledge.start_kb init ai_textbook --docs chapter10.pdf

# Correct approach: Use incremental addition
python -m src.knowledge.add_documents ai_textbook --docs chapter10.pdf
```

**Benefits:**
- Only processes new documents, saves API costs
- Preserves existing knowledge graph, new content automatically merged
- Automatically skips duplicate files to avoid reprocessing

### 2. Processing Large Documents

For large documents, recommend increasing batch size and concurrency:

```bash
python -m src.knowledge.start_kb init large_book \
  --docs book.pdf \
  --batch-size 30

python -m src.knowledge.start_kb extract \
  --kb large_book \
  --batch-size 30 \
  --max-concurrent 10
```

### 3. Debug Mode

Use debug mode for testing, only processes first file:

```bash
python -m src.knowledge.start_kb extract --kb test_kb --debug
```

## 📚 Module Description

### config.py - Path Configuration

Unified path management to avoid path conflicts:

```python
from src.knowledge.config import (
    PROJECT_ROOT,           # Project root directory
    KNOWLEDGE_BASES_DIR,    # Knowledge base directory
    setup_paths,            # Setup Python paths
    get_env_config          # Get environment variables
)
```

### manager.py - Knowledge Base Management

Manages multiple knowledge bases:

```python
from src.knowledge import KnowledgeBaseManager

manager = KnowledgeBaseManager("./knowledge_bases")
kb_list = manager.list_knowledge_bases()
manager.set_default("ai_textbook")
info = manager.get_info("ai_textbook")
```

### initializer.py - Initialization

Creates and initializes new knowledge bases:

```python
from src.knowledge import KnowledgeBaseInitializer

initializer = KnowledgeBaseInitializer(
    kb_name="my_kb",
    base_dir="./knowledge_bases",
    api_key="your_key"
)
await initializer.process_documents()
```

### add_documents.py - Incremental Document Addition ?
Adds new documents to existing knowledge base (incremental updates):

```python
from src.knowledge.add_documents import DocumentAdder

adder = DocumentAdder(
    kb_name="ai_textbook",
    base_dir="./knowledge_bases",
    api_key="your_key"
)

# Add documents
new_files = adder.add_documents(
    source_files=["new_chapter.pdf"],
    skip_duplicates=True
)

# Process new documents
processed = await adder.process_new_documents(new_files)

# Extract numbered items
adder.extract_numbered_items_for_new_docs(processed)
```

**Features:**
- Only processes newly added documents, saves time and API costs
- Automatically merges with existing knowledge graph
- Intelligently skips duplicate files
- Updates knowledge base metadata

### extract_numbered_items.py - Extract Items

Extracts Definition, Theorem, Formula, Figure, etc.:

```python
from src.knowledge.extract_numbered_items import process_content_list

process_content_list(
    content_list_file=Path("content_list/chapter1.json"),
    output_file=Path("numbered_items.json"),
    api_key="your_key",
    base_url="your_url"
)
```

## 🔍 Extracted Numbered Item Types

- **Definition** - Definitions
- **Proposition** - Propositions
- **Theorem** - Theorems
- **Lemma** - Lemmas
- **Corollary** - Corollaries
- **Example** - Examples
- **Remark** - Remarks
- **Figure** - Figures
- **Equation** - Equations (numbered)
- **Table** - Tables

## ?Common Questions

### Q: How to fix path issues?

A: Use `setup_paths()` function in `config.py` to uniformly set paths:

```python
from src.knowledge.config import setup_paths
setup_paths()
```

### Q: raganything module not found?

A: Ensure `raganything/RAG-Anything` is in project parent directory, or modify path in `config.py`.

### Q: API call failed?

A: Check `LLM_API_KEY` and `LLM_HOST` configuration in `.env` file.

### Q: RAG initialization failed, error "no element found" or GraphML parsing error?

A: This is caused by corrupted RAG storage files. Fix using:

```bash
# Clean corrupted RAG storage
python -m src.knowledge.start_kb clean-rag your_kb_name

# Then reprocess documents
python -m src.knowledge.start_kb refresh your_kb_name
```

### Q: How to completely rebuild a knowledge base?

A: Use refresh command:

```bash
# Method 1: Full refresh (preserve original documents)
python -m src.knowledge.start_kb refresh kb_name --full

# Method 2: Delete and recreate
python -m src.knowledge.start_kb delete kb_name
python -m src.knowledge.start_kb init kb_name --docs-dir ./documents/
```

## 🎯 Best Practices

1. **Use start_kb.py or kb.py** - Unified entry point, avoid directly calling submodules
2. **Configure default knowledge base** - Reduces need to specify knowledge base name each time
3. **Incremental document addition** ?- Use `add_documents.py` when adding new documents to existing knowledge base, not reinitialize
4. **Regular cleanup** 🧹 - Use `clean-rag` command when encountering RAG errors
5. **Careful deletion** 🗑?- Ensure important data is backed up before deleting knowledge base
6. **Regular backups** - `numbered_items.json` and `rag_storage/` are important
7. **Version control** - Recommend adding `knowledge_bases/` to `.gitignore`
8. **Check update history** - Use `info` command to view `update_history` in metadata
9. **Error recovery** - When RAG is corrupted, first `clean-rag`, then `refresh` or `add_documents`

## 🔗 Related Tools

- `src/tools/rag_tool.py` - RAG query tool
- `src/tools/query_item_tool.py` - Query numbered items
- `src/agents/solve/` - Problem solving system
- `src/agents/guide/` - Guided tutoring system

