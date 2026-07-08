// Talks to the local Docker daemon via the `docker` CLI. We ask for JSON-lines
// output so we don't have to parse a table. If Docker isn't running (or isn't
// installed), we surface that as a friendly state rather than crashing.

const { exec } = require("child_process");

function getDockerContainers() {
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
          .filter(Boolean);

        resolve({ ok: true, containers });
      }
    );
  });
}

module.exports = { getDockerContainers };
