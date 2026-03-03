#!/usr/bin/env python3
"""
Full project indexer for Context Engine.
Replicates the Swift CodeChunker + EmbeddingClient pipeline in Python
to populate the codefire.db with real embeddings.

Usage:
    python3 scripts/index_project.py                    # Index project detected from CWD
    python3 scripts/index_project.py /path/to/project   # Index specific project path
"""

import json, struct, sqlite3, subprocess, os, re, hashlib, uuid, time, urllib.request, sys

# ── Config ──────────────────────────────────────────────────────────────

DB_PATH = os.path.expanduser("~/Library/Application Support/CodeFire/codefire.db")
EMBEDDING_MODEL = "openai/text-embedding-3-small"
BATCH_SIZE = 20
MAX_CONTENT_CHARS = 30000  # Truncate chunks exceeding embedding token limit

# ── API Key ─────────────────────────────────────────────────────────────

def get_api_key():
    result = subprocess.run(
        ["plutil", "-extract", "openRouterAPIKey", "raw",
         os.path.expanduser("~/Library/Preferences/com.codefire.app.plist")],
        capture_output=True, text=True
    )
    key = result.stdout.strip()
    if not key:
        print("ERROR: No OpenRouter API key found.")
        print("Set it in CodeFire > Settings > Context Engine.")
        sys.exit(1)
    return key

# ── Project Detection ───────────────────────────────────────────────────

def detect_project(conn, target_path):
    cur = conn.cursor()
    cur.execute("SELECT id, path, name FROM projects")
    projects = cur.fetchall()

    # Exact match first
    for pid, path, name in projects:
        if path == target_path:
            return pid, path, name

    # Longest prefix match
    best = None
    best_len = 0
    for pid, path, name in projects:
        if target_path.startswith(path) and len(path) > best_len:
            best = (pid, path, name)
            best_len = len(path)

    if best:
        return best

    print(f"ERROR: No project found matching path: {target_path}")
    print("Available projects:")
    for pid, path, name in projects:
        print(f"  {name}: {path}")
    sys.exit(1)

# ── Skip lists (matches Swift ContextEngine) ────────────────────────────

SKIP_DIRS = {
    '.git', '.build', 'DerivedData', 'node_modules', '.claude',
    'Pods', 'Carthage', '.swiftpm', '__pycache__', '.venv',
    'venv', 'dist', 'build', '.next', '.nuxt', 'target',
}

SKIP_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp',
    '.pdf', '.zip', '.tar', '.gz', '.dmg', '.exe',
    '.lock', '.sum', '.resolved',
    '.DS_Store', '.o', '.a', '.dylib',
}

# ── Language detection ──────────────────────────────────────────────────

LANG_MAP = {
    '.swift': 'swift',
    '.ts': 'typescript', '.tsx': 'tsx',
    '.js': 'javascript', '.jsx': 'jsx',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.dart': 'dart',
    '.java': 'java',
    '.md': 'markdown', '.markdown': 'markdown',
    '.json': None, '.yaml': None, '.yml': None,
    '.toml': None, '.txt': None, '.sh': None,
}

def detect_language(path):
    ext = os.path.splitext(path)[1].lower()
    return LANG_MAP.get(ext)

# ── Chunking (replicates Swift CodeChunker) ─────────────────────────────

MAX_CHUNK_LINES = 100
MIN_CHUNK_LINES = 5

SWIFT_PATTERNS = [
    (r'^\s*(?:public |private |internal |open |fileprivate )?(?:static |class )?(?:func |init\(|deinit\b)', 'function',
     r'(?:func\s+(\w+)|init\(|deinit)'),
    (r'^\s*(?:public |private |internal |open |fileprivate )?(?:final )?(?:class |struct |enum |protocol |extension )', 'class',
     r'(?:class|struct|enum|protocol|extension)\s+(\w+)'),
]

TS_PATTERNS = [
    (r'^\s*(?:export\s+)?(?:async\s+)?function\s+', 'function', r'function\s+(\w+)'),
    (r'^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(', 'function', r'(?:const|let|var)\s+(\w+)'),
    (r'^\s*(?:export\s+)?(?:abstract\s+)?(?:class|interface|type)\s+', 'class', r'(?:class|interface|type)\s+(\w+)'),
]

PYTHON_PATTERNS = [
    (r'^\s*(?:async\s+)?def\s+', 'function', r'def\s+(\w+)'),
    (r'^\s*class\s+', 'class', r'class\s+(\w+)'),
]

LANG_PATTERNS = {
    'swift': SWIFT_PATTERNS,
    'typescript': TS_PATTERNS,
    'tsx': TS_PATTERNS,
    'javascript': TS_PATTERNS,
    'jsx': TS_PATTERNS,
    'python': PYTHON_PATTERNS,
}

def match_boundary(line, patterns):
    for regex, btype, name_regex in patterns:
        if re.search(regex, line):
            m = re.search(name_regex, line)
            name = m.group(1) if m and m.lastindex else None
            return (btype, name)
    return None

def chunk_by_boundaries(lines, patterns):
    chunks = []
    current_lines = []
    current_type = 'block'
    current_symbol = None
    current_parent = None
    chunk_start = 1

    header_end = 0
    for i, line in enumerate(lines):
        if match_boundary(line, patterns):
            header_end = i
            break
        if i > 30:
            header_end = i
            break

    if header_end > 0:
        header = '\n'.join(lines[:header_end]).strip()
        if header:
            chunks.append({
                'chunkType': 'header', 'symbolName': None,
                'content': header, 'startLine': 1, 'endLine': header_end
            })

    for i in range(header_end, len(lines)):
        line = lines[i]
        match = match_boundary(line, patterns)

        if match:
            if current_lines:
                emit_chunk(current_lines, current_type, current_symbol, chunk_start, chunks)
            btype, name = match
            if btype == 'class':
                current_parent = name
            current_lines = [line]
            current_type = btype
            if btype == 'function' and current_parent:
                current_symbol = f"{current_parent}.{name or 'unknown'}"
            else:
                current_symbol = name
            chunk_start = i + 1
        else:
            current_lines.append(line)
            if len(current_lines) >= MAX_CHUNK_LINES and line.strip() == '':
                emit_chunk(current_lines, current_type, current_symbol, chunk_start, chunks)
                current_lines = []
                current_type = 'block'
                current_symbol = None
                chunk_start = i + 2

    if current_lines:
        emit_chunk(current_lines, current_type, current_symbol, chunk_start, chunks)

    return chunks

def chunk_by_fixed_size(lines):
    chunks = []
    window = 50
    overlap = 10
    i = 0
    while i < len(lines):
        end = min(i + window, len(lines))
        content = '\n'.join(lines[i:end]).strip()
        if content:
            chunks.append({
                'chunkType': 'block', 'symbolName': None,
                'content': content, 'startLine': i + 1, 'endLine': end
            })
        i += window - overlap
    return chunks

def chunk_markdown(lines):
    chunks = []
    current_section = []
    current_heading = None
    section_start = 1

    for i, line in enumerate(lines):
        if line.startswith('## ') or line.startswith('# '):
            if current_section:
                text = '\n'.join(current_section).strip()
                if len(text) >= 20:
                    chunks.append({
                        'chunkType': 'doc', 'symbolName': current_heading,
                        'content': text, 'startLine': section_start, 'endLine': i
                    })
            current_heading = line.lstrip('# ').strip()
            current_section = [line]
            section_start = i + 1
        else:
            current_section.append(line)

    if current_section:
        text = '\n'.join(current_section).strip()
        if len(text) >= 20:
            chunks.append({
                'chunkType': 'doc', 'symbolName': current_heading,
                'content': text, 'startLine': section_start, 'endLine': len(lines)
            })

    return chunks

def emit_chunk(lines, ctype, symbol, start_line, chunks):
    content = '\n'.join(lines).strip()
    if len(content) < 20:
        return
    if len(lines) < MIN_CHUNK_LINES and ctype == 'block':
        return
    chunks.append({
        'chunkType': ctype, 'symbolName': symbol,
        'content': content, 'startLine': start_line, 'endLine': start_line + len(lines) - 1
    })

def chunk_file(content, language):
    lines = content.split('\n')
    if not lines:
        return []
    if language == 'markdown':
        return chunk_markdown(lines)
    patterns = LANG_PATTERNS.get(language)
    if patterns:
        return chunk_by_boundaries(lines, patterns)
    return chunk_by_fixed_size(lines)

# ── File enumeration ────────────────────────────────────────────────────

def enumerate_files(root):
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fname in filenames:
            ext = os.path.splitext(fname)[1].lower()
            if ext in SKIP_EXTENSIONS:
                continue
            if ext not in LANG_MAP:
                continue
            fullpath = os.path.join(dirpath, fname)
            relpath = os.path.relpath(fullpath, root)
            files.append((fullpath, relpath))
    return files

# ── Embedding ───────────────────────────────────────────────────────────

def embed_batch(texts, api_key):
    # Truncate oversized texts
    texts = [t[:MAX_CONTENT_CHARS] for t in texts]
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/embeddings",
        data=json.dumps({"model": EMBEDDING_MODEL, "input": texts}).encode(),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-Title": "CodeFire"
        }
    )
    resp = json.loads(urllib.request.urlopen(req, timeout=60).read())
    return [item["embedding"] for item in resp["data"]]

# ── Main ────────────────────────────────────────────────────────────────

def main():
    # Determine project path
    if len(sys.argv) > 1:
        project_path = os.path.abspath(sys.argv[1])
    else:
        project_path = os.getcwd()

    api_key = get_api_key()

    print("=" * 60)
    print("CodeFire Engine — Full Project Indexer")
    print("=" * 60)

    conn = sqlite3.connect(DB_PATH)
    project_id, project_root, project_name = detect_project(conn, project_path)
    print(f"Project: {project_name}")
    print(f"Path:    {project_root}")
    print(f"ID:      {project_id}")
    print(f"DB:      {DB_PATH}")
    print()

    cur = conn.cursor()

    # 1. Enumerate files
    files = enumerate_files(project_root)
    print(f"Found {len(files)} indexable files")

    # 2. Read and chunk all files
    all_chunks = []
    for fullpath, relpath in files:
        language = detect_language(relpath)
        try:
            with open(fullpath, 'r', errors='replace') as f:
                content = f.read()
        except:
            continue
        if len(content) < 20:
            continue

        content_hash = hashlib.sha256(content.encode()).hexdigest()[:16]
        if language is None:
            language = os.path.splitext(relpath)[1].lstrip('.').lower()
            chunks = chunk_by_fixed_size(content.split('\n'))
        else:
            chunks = chunk_file(content, language)

        file_id = str(uuid.uuid4()).upper()
        for c in chunks:
            all_chunks.append((file_id, relpath, language, content_hash, c))

    print(f"Generated {len(all_chunks)} chunks from {len(files)} files")
    print()

    type_counts = {}
    for _, _, _, _, c in all_chunks:
        t = c['chunkType']
        type_counts[t] = type_counts.get(t, 0) + 1
    for t, n in sorted(type_counts.items()):
        print(f"  {t}: {n}")
    print()

    # 3. Batch embed
    texts = [c['content'] for _, _, _, _, c in all_chunks]
    print(f"Embedding {len(texts)} chunks in batches of {BATCH_SIZE}...")

    all_embeddings = []
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i:i+BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        total_batches = (len(texts) + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"  Batch {batch_num}/{total_batches} ({len(batch)} chunks)...", end=' ', flush=True)

        retries = 0
        while retries < 3:
            try:
                embeddings = embed_batch(batch, api_key)
                all_embeddings.extend(embeddings)
                print("OK")
                break
            except Exception as e:
                retries += 1
                print(f"retry {retries}: {e}")
                time.sleep(2 * retries)
        else:
            # Fall back to one-at-a-time for failed batches
            print("Falling back to individual embedding...")
            for text in batch:
                try:
                    embs = embed_batch([text], api_key)
                    all_embeddings.extend(embs)
                except:
                    all_embeddings.append(None)
                time.sleep(0.3)

        if i + BATCH_SIZE < len(texts):
            time.sleep(0.5)

    embedded_count = sum(1 for e in all_embeddings if e is not None)
    print(f"\nGot {embedded_count} embeddings")

    # 4. Clear old data for this project
    cur.execute("DELETE FROM codeChunks WHERE projectId = ?", (project_id,))
    cur.execute("DELETE FROM indexedFiles WHERE projectId = ?", (project_id,))
    cur.execute("DELETE FROM indexState WHERE projectId = ?", (project_id,))
    cur.execute("DELETE FROM codeChunksFts WHERE rowid NOT IN (SELECT rowid FROM codeChunks)")
    conn.commit()
    print("Cleared old index data")

    # 5. Insert files and chunks
    seen_files = {}
    inserted = 0
    skipped = 0

    for i, (file_id, relpath, language, content_hash, chunk) in enumerate(all_chunks):
        if relpath not in seen_files:
            seen_files[relpath] = file_id
            cur.execute("""
                INSERT OR REPLACE INTO indexedFiles (id, projectId, relativePath, contentHash, language, lastIndexedAt)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
            """, (file_id, project_id, relpath, content_hash, language))
        else:
            file_id = seen_files[relpath]

        embedding = all_embeddings[i]
        if embedding is None:
            skipped += 1
            continue

        emb_bytes = struct.pack(f'{len(embedding)}f', *embedding)
        chunk_id = str(uuid.uuid4()).upper()

        cur.execute("""
            INSERT INTO codeChunks (id, fileId, projectId, chunkType, symbolName, content, startLine, endLine, embedding)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (chunk_id, file_id, project_id, chunk['chunkType'], chunk.get('symbolName'),
              chunk['content'], chunk.get('startLine'), chunk.get('endLine'), emb_bytes))

        cur.execute("""
            INSERT INTO codeChunksFts (rowid, content, symbolName)
            VALUES ((SELECT rowid FROM codeChunks WHERE id = ?), ?, ?)
        """, (chunk_id, chunk['content'], chunk.get('symbolName') or ''))

        inserted += 1

    # 6. Index git history
    print("\nIndexing git history (last 200 commits)...")
    try:
        git_log = subprocess.run(
            ['git', 'log', '--oneline', '--stat', '-200'],
            capture_output=True, text=True, cwd=project_root
        ).stdout
        if git_log.strip():
            git_chunks = []
            current = []
            for line in git_log.split('\n'):
                if re.match(r'^[0-9a-f]{7,} ', line):
                    if current:
                        text = '\n'.join(current).strip()
                        if text:
                            git_chunks.append(text)
                    current = [line]
                else:
                    current.append(line)
            if current:
                text = '\n'.join(current).strip()
                if text:
                    git_chunks.append(text)

            print(f"  Found {len(git_chunks)} commits")

            if git_chunks:
                git_embeddings = []
                for j in range(0, len(git_chunks), BATCH_SIZE):
                    batch = git_chunks[j:j+BATCH_SIZE]
                    batch_num = j // BATCH_SIZE + 1
                    total = (len(git_chunks) + BATCH_SIZE - 1) // BATCH_SIZE
                    print(f"  Embedding git batch {batch_num}/{total}...", end=' ', flush=True)
                    try:
                        embs = embed_batch(batch, api_key)
                        git_embeddings.extend(embs)
                        print("OK")
                    except Exception as e:
                        print(f"FAILED: {e}")
                        git_embeddings.extend([None] * len(batch))
                    time.sleep(0.5)

                git_file_id = str(uuid.uuid4()).upper()
                cur.execute("""
                    INSERT OR REPLACE INTO indexedFiles (id, projectId, relativePath, contentHash, language, lastIndexedAt)
                    VALUES (?, ?, ?, ?, ?, datetime('now'))
                """, (git_file_id, project_id, "__git_history__", "gitlog", "git"))

                for j, text in enumerate(git_chunks):
                    if j < len(git_embeddings) and git_embeddings[j] is not None:
                        emb_bytes = struct.pack(f'{len(git_embeddings[j])}f', *git_embeddings[j])
                        chunk_id = str(uuid.uuid4()).upper()
                        cur.execute("""
                            INSERT INTO codeChunks (id, fileId, projectId, chunkType, symbolName, content, startLine, endLine, embedding)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (chunk_id, git_file_id, project_id, 'commit', None, text, None, None, emb_bytes))
                        cur.execute("""
                            INSERT INTO codeChunksFts (rowid, content, symbolName)
                            VALUES ((SELECT rowid FROM codeChunks WHERE id = ?), ?, ?)
                        """, (chunk_id, text, ''))
                        inserted += 1
    except Exception as e:
        print(f"  Git history indexing failed: {e}")

    # 7. Update index state
    cur.execute("""
        INSERT OR REPLACE INTO indexState (projectId, status, totalChunks, lastFullIndexAt)
        VALUES (?, 'ready', ?, datetime('now'))
    """, (project_id, inserted))

    conn.commit()
    conn.close()

    print()
    print("=" * 60)
    print(f"Indexing complete!")
    print(f"  Project: {project_name}")
    print(f"  Files:   {len(seen_files)}")
    print(f"  Chunks:  {inserted} indexed, {skipped} skipped")
    print("=" * 60)

if __name__ == '__main__':
    main()
