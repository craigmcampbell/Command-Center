// Talks to the local Docker daemon via the `docker` CLI. We ask for JSON-lines
// output so we don't have to parse a table. If Docker isn't running (or isn't
// installed), we surface that as a friendly state rather than crashing.

import { exec, execFile } from "node:child_process";
import type { ActionResult, DockerResult } from "../../shared/types";

export function getDockerContainers(): Promise<DockerResult> {
  return new Promise((resolve) => {
    // --format '{{json .}}' prints one JSON object per line, per container.
    exec(
      "docker ps -a --format '{{json .}}'",
      { timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve({
            ok: false,
            reason: /not.*running|cannot connect/i.test(err.message)
              ? "Docker isn't running"
              : "Docker CLI not found",
            containers: [],
          });
          return;
        }

        const containers = stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            try {
              const c = JSON.parse(line);
              return {
                name: c.Names,
                image: c.Image,
                state: c.State, // running | exited | created | paused
                status: c.Status, // human string, e.g. "Up 2 hours"
                ports: c.Ports || "",
              };
            } catch {
              return null;
            }
          })
          .filter((c): c is NonNullable<typeof c> => c !== null)
          .sort((a, b) => a.name.localeCompare(b.name));

        resolve({ ok: true, containers });
      }
    );
  });
}

// execFile (not exec) so the container name is passed as a real argv entry,
// never interpolated into a shell string.
export function startContainer(name: string): Promise<ActionResult> {
  return new Promise((resolve) => {
    execFile("docker", ["start", name], { timeout: 15000 }, (err, _stdout, stderr) => {
      if (err) {
        resolve({ ok: false, reason: stderr.trim() || "Couldn't start container" });
        return;
      }
      resolve({ ok: true });
    });
  });
}

export function stopContainer(name: string): Promise<ActionResult> {
  return new Promise((resolve) => {
    execFile("docker", ["stop", name], { timeout: 15000 }, (err, _stdout, stderr) => {
      if (err) {
        resolve({ ok: false, reason: stderr.trim() || "Couldn't stop container" });
        return;
      }
      resolve({ ok: true });
    });
  });
}
