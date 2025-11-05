# Embeddings FAQ - How Automatic Embedding Generation Works

## ❓ "How do users generate embeddings?"

**Answer**: **Embeddings are generated AUTOMATICALLY during indexing!**

When you run:
```
User: "Index my conversation history"
Claude uses: index_conversations tool
```

The system automatically:
1. ✅ Parses conversations
2. ✅ Extracts decisions, mistakes, requirements
3. ✅ **Generates embeddings for semantic search** ← AUTOMATIC!
4. ✅ Stores everything in database

---

## 🤔 "What's the Ollama model used for?"

**Answer**: **Ollama (mxbai-embed-large) generates the embeddings for semantic search!**

### Embedding Flow:

```
User message → index_conversations
              ↓
         Parse conversations
              ↓
         Extract text content
              ↓
     🎯 Generate embeddings ← Ollama/Transformers/OpenAI
              ↓
         Store in vec tables
              ↓
     Enable semantic search ✅
```

---

## 🚀 Automatic Provider Selection

The system automatically chooses the best available provider:

### 1. **Try Ollama First** (Default)
```
Check: Is Ollama running at http://localhost:11434?
Check: Is mxbai-embed-large model available?
If YES → Use Ollama (fast, high-quality, local)
```

### 2. **Fallback to Transformers.js** (Fully Offline)
```
If Ollama unavailable → Use @xenova/transformers
Model: Xenova/all-MiniLM-L6-v2 (384 dimensions)
No internet required!
```

### 3. **Fallback to OpenAI** (If configured)
```
If OPENAI_API_KEY set → Use OpenAI embeddings
Model: text-embedding-3-small (1536 dimensions)
Highest quality, requires API key
```

### 4. **Final Fallback: Full-Text Search**
```
If all embedding providers fail → Use SQLite FTS
Still works! Just no semantic search
Can upgrade later by re-indexing
```

---

## ✅ Embedding Status in Responses

**NEW in v0.2.0**: The `index_conversations` tool now reports embedding status!

### Success Response:
```json
{
  "success": true,
  "embeddings_generated": true,
  "message": "Indexed 3421 messages\n✅ Semantic search enabled (embeddings generated)"
}
```

### Failure Response (with fallback):
```json
{
  "success": true,
  "embeddings_generated": false,
  "embedding_error": "Ollama not running, Transformers.js not installed",
  "message": "Indexed 3421 messages\n⚠️ Semantic search unavailable: ...\n   Falling back to full-text search"
}
```

---

## 🔧 Common Scenarios

### Scenario 1: Fresh Install (No Setup)

```bash
# User installs MCP
npx claude-conversation-memory-mcp

# User indexes conversations
User: "Index my conversations"

# What happens:
✅ Indexing succeeds
✅ Transformers.js downloads model automatically (~100MB)
✅ Embeddings generated (384 dimensions)
✅ Semantic search works!
```

**No configuration needed!** Works out of the box.

---

### Scenario 2: Ollama User (Best Experience)

```bash
# User has Ollama installed
ollama pull mxbai-embed-large

# User indexes conversations
User: "Index my conversations"

# What happens:
✅ Detects Ollama running
✅ Uses mxbai-embed-large (1024 dimensions)
✅ Fast, high-quality embeddings
✅ Semantic search works great!
```

---

### Scenario 3: OpenAI User (Premium Quality)

```bash
# User sets API key
export OPENAI_API_KEY=sk-...

# User indexes conversations
User: "Index my conversations"

# What happens:
✅ Detects OpenAI API key
✅ Uses text-embedding-3-small (1536 dimensions)
✅ Highest quality embeddings
✅ Costs ~$0.02 per 1M tokens
```

---

### Scenario 4: Offline / No Embeddings

```bash
# No Ollama, no internet, Transformers.js fails

# User indexes conversations
User: "Index my conversations"

# What happens:
✅ Indexing still succeeds!
⚠️ No embeddings generated
⚠️ Message: "Semantic search unavailable, falling back to FTS"
✅ Full-text search still works
✅ Can re-index later to add embeddings
```

---

## 🎯 How Semantic Search Works

### With Embeddings:
```
User: "What did we discuss about authentication?"
      ↓
Convert query to embedding (vector)
      ↓
Find similar embeddings (cosine similarity)
      ↓
Return relevant conversations ✅
```

### Without Embeddings (FTS Fallback):
```
User: "What did we discuss about authentication?"
      ↓
Search for keyword "authentication"
      ↓
Return exact matches only
      ↓
Still works! Just less smart
```

---

## 📊 Embedding Statistics

After indexing, check what was generated:

```sql
-- How many embeddings were created?
SELECT COUNT(*) FROM message_embeddings;

-- What dimensions are they?
SELECT
  CASE
    WHEN LENGTH(embedding) / 4 = 384 THEN 'Transformers.js'
    WHEN LENGTH(embedding) / 4 = 768 THEN 'nomic-embed-text'
    WHEN LENGTH(embedding) / 4 = 1024 THEN 'mxbai-embed-large'
    WHEN LENGTH(embedding) / 4 = 1536 THEN 'OpenAI small'
    WHEN LENGTH(embedding) / 4 = 3072 THEN 'OpenAI large'
  END as provider,
  COUNT(*) as count
FROM message_embeddings;
```

---

## 🔄 Re-Indexing to Change Providers

Want to upgrade from Transformers.js to Ollama?

```bash
# 1. Install Ollama and pull model
ollama pull mxbai-embed-large

# 2. Re-index (automatically uses new provider)
User: "Re-index my conversations"

# Old embeddings (384d) replaced with new (1024d)
# Semantic search now uses better model!
```

---

## 💡 Key Takeaways

✅ **Embeddings are automatic** - No manual step required
✅ **Provider auto-detection** - Uses best available option
✅ **Graceful fallback** - Still works without embeddings
✅ **Transparent status** - Tool reports what happened
✅ **Upgrade anytime** - Just re-index with better provider

---

## 🐛 Troubleshooting

### "Semantic search returns empty results"

**Check embedding status:**
```
User: "Re-index conversations"
Look for: "✅ Semantic search enabled" or "⚠️ unavailable"
```

**If unavailable:**
1. Install Ollama: `brew install ollama`
2. Pull model: `ollama pull mxbai-embed-large`
3. Re-index: User asks Claude to index again

### "Embeddings taking too long"

**Solution**: Embeddings are generated in batches of 32
- Transformers.js: ~2-3 messages/sec
- Ollama: ~10-15 messages/sec
- OpenAI: ~100-500 messages/sec (batch API)

For 3000 messages:
- Transformers.js: ~15 minutes
- Ollama: ~3-5 minutes
- OpenAI: ~30 seconds

### "Database is empty after indexing"

**This was a bug in v0.1.0!**
- Fixed in v0.2.0
- MCP server was silently failing to generate embeddings
- Now reports status clearly

---

**Last Updated**: 2025-11-05
**Version**: 0.2.0
