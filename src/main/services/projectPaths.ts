import path from "node:path";
import os from "node:os";
export function matchesProjectFolder(cwd: string, folder?: string): boolean {
  if (!folder) return true;
  if (!cwd) return false;
  const normalize = (value: string) => path.resolve(value.replace(/^~(?=\/|$)/, os.homedir()));
  const relative = path.relative(normalize(folder), normalize(cwd));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
