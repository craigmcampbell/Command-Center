import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

interface Slot {
  size: number;
  mtime: number;
  inode: number;
  offset: number;
  head: string;
  tail: string;
  payload: string;
}
let database: Database.Database | undefined;
const fallback = new Map<string, Slot>();
let fallbackBytes = 0;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;

export function initTranscriptIndex(db: Database.Database): void {
  database = db;
  db.exec(`CREATE TABLE IF NOT EXISTS transcript_index_v1 (
    file TEXT PRIMARY KEY, size INTEGER, mtime REAL, inode INTEGER,
    offset INTEGER, head TEXT, tail TEXT, payload TEXT NOT NULL
  )`);
}

function get(file: string): Slot | undefined {
  return database
    ? database.prepare("SELECT * FROM transcript_index_v1 WHERE file = ?").get(file) as Slot | undefined
    : fallback.get(file);
}
function put(file: string, slot: Slot): void {
  if (database) {
    database.prepare(`INSERT OR REPLACE INTO transcript_index_v1
      (file,size,mtime,inode,offset,head,tail,payload) VALUES (?,?,?,?,?,?,?,?)`)
      .run(file, slot.size, slot.mtime, slot.inode, slot.offset, slot.head, slot.tail, slot.payload);
  } else {
    fallbackBytes -= fallback.get(file)?.payload.length ?? 0;
    fallback.delete(file);
    fallback.set(file, slot);
    fallbackBytes += slot.payload.length;
    while (fallbackBytes > MAX_CACHE_BYTES && fallback.size) {
      const key = fallback.keys().next().value!;
      fallbackBytes -= fallback.get(key)!.payload.length;
      fallback.delete(key);
    }
  }
}

// Read only complete records up to a fixed snapshot. An unfinished final line
// stays on disk and is retried next time; offsets are bytes, not JS characters.
export async function* completeLines(file: string, start: number, end: number, progress: { offset: number }): AsyncGenerator<string> {
  if (start >= end) return;
  const stream = fs.createReadStream(file, { start, end: end - 1 });
  let pieces: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      let from = 0;
      for (let at = buffer.indexOf(10); at !== -1; at = buffer.indexOf(10, from)) {
        const piece = buffer.subarray(from, at);
        pieces.push(piece);
        length += piece.length;
        const line = Buffer.concat(pieces, length).toString("utf8");
        progress.offset += length + 1;
        pieces = [];
        length = 0;
        from = at + 1;
        yield line;
      }
      if (from < buffer.length) {
        const rest = buffer.subarray(from);
        pieces.push(rest);
        length += rest.length;
      }
    }
  } finally { stream.destroy(); }
}

async function fingerprint(file: string, offset: number): Promise<{ head: string; tail: string }> {
  const handle = await fs.promises.open(file, "r");
  try {
    const head = Buffer.alloc(Math.min(offset, 256));
    const tail = Buffer.alloc(Math.min(offset, 256));
    await handle.read(head, 0, head.length, 0);
    await handle.read(tail, 0, tail.length, Math.max(0, offset - tail.length));
    return { head: head.toString("base64"), tail: tail.toString("base64") };
  } finally { await handle.close(); }
}

export async function indexedFile<T>(file: string, parse: (lines: AsyncIterable<string>, previous?: T) => Promise<T>): Promise<T> {
  const stat = await fs.promises.stat(file);
  const cached = get(file);
  if (cached && cached.size === stat.size && cached.mtime === stat.mtimeMs && cached.inode === stat.ino) {
    return JSON.parse(cached.payload) as T;
  }
  let previous: T | undefined;
  let start = 0;
  // Same-sized rewrites, truncation, and replacement force a complete parse.
  // Verify the prefix and append boundary before trusting a growing file.
  if (cached && stat.size > cached.size && cached.inode === stat.ino) {
    const mark = await fingerprint(file, cached.offset);
    if (mark.head === cached.head && mark.tail === cached.tail) {
      previous = JSON.parse(cached.payload) as T;
      start = cached.offset;
    }
  }
  const progress = { offset: start };
  const result = await parse(completeLines(file, start, stat.size, progress), previous);
  const after = await fs.promises.stat(file);
  // A concurrent rewrite invalidates the snapshot. Appends are picked up on
  // the next scan; never publish a cache assembled across a replacement.
  if (after.ino !== stat.ino || after.size < stat.size || (after.size === stat.size && after.mtimeMs !== stat.mtimeMs)) {
    throw new Error("Transcript changed while indexing; retry refresh");
  }
  const mark = await fingerprint(file, progress.offset);
  put(file, { size: stat.size, mtime: stat.mtimeMs, inode: stat.ino, offset: progress.offset, ...mark, payload: JSON.stringify(result) });
  return result;
}

export async function findTranscripts(dir: string, out: string[] = []): Promise<string[]> {
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await findTranscripts(full, out);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

export function pruneIndex(roots: string[], files: string[]): void {
  const present = new Set(files);
  const rows = database
    ? database.prepare("SELECT file FROM transcript_index_v1").all() as { file: string }[]
    : [...fallback.keys()].map((file) => ({ file }));
  for (const { file } of rows) {
    if (!roots.some((root) => file.startsWith(root + path.sep)) || present.has(file)) continue;
    if (database) database.prepare("DELETE FROM transcript_index_v1 WHERE file = ?").run(file);
    else { fallbackBytes -= fallback.get(file)!.payload.length; fallback.delete(file); }
  }
}
