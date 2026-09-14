import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import { initTranscriptIndex } from "./services/transcriptIndex";
import { getClaudeUsage, listClaudeSessions } from "./services/claudeUsage";
import { getCodexUsage, listCodexSessions } from "./services/codexUsage";

const database = new Database(workerData.indexPath);
database.pragma("journal_mode = WAL");
initTranscriptIndex(database);
const methods = { getClaudeUsage, listClaudeSessions, getCodexUsage, listCodexSessions };
// Serialize indexing so requests cannot race the same file's append offset.
let queue = Promise.resolve();
parentPort!.on("message", ({ id, method, args }: { id: number; method: keyof typeof methods; args: any[] }) => {
  queue = queue.then(async () => {
    try {
      const value = await (methods[method] as (...args: any[]) => Promise<unknown>)(...args);
      parentPort!.postMessage({ id, value });
    } catch (error) {
      parentPort!.postMessage({ id, error: error instanceof Error ? error.message : "Unable to index transcripts" });
    }
  });
});
