// Talks to the local Docker Engine API directly over its Unix socket, rather
// than shelling out to the `docker` CLI like docker.ts does. Two things need
// this: checking a registry for a newer image without pulling it first
// (GET /distribution/{name}/json, which reuses whatever registry credentials
// the user already has via `docker login` — no Hub/GHCR auth client needed),
// and recreating a container from its own exact previous config (there's no
// CLI equivalent of "create from this JSON blob", so hand-translating
// `docker inspect` output into `docker run` flags would be fragile).
//
// No PATH-widening here unlike docker.ts — that workaround exists only
// because execFile needs `docker` resolvable on PATH under launchd's bare
// environment. A raw socket connection never touches PATH.

import { request } from "node:http";
import { existsSync } from "node:fs";
import { getDockerContainers } from "./docker";
import type {
  ActionResult,
  DockerImageUpdateInfo,
  DockerImageUpdateStatus,
  DockerUpdateCheckResult,
  DockerUpdateResult,
} from "../../shared/types";

const SOCKET_PATH = "/var/run/docker.sock";
const API_VERSION = "/v1.41";
const NOT_RUNNING_REASON = "Docker isn't running";

interface ApiResponse {
  status: number;
  json: unknown;
}

function dockerApiRequest(
  method: string,
  path: string,
  body?: unknown,
  timeout = 10_000
): Promise<ApiResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath: SOCKET_PATH,
        path: `${API_VERSION}${path}`,
        method,
        timeout,
        headers: payload ? { "Content-Type": "application/json" } : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8").trim();
          let json: unknown = undefined;
          if (text) {
            try {
              json = JSON.parse(text);
            } catch {
              json = text;
            }
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Docker API request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// POST /images/create streams newline-delimited JSON progress objects rather
// than one document, and reports pull failures (auth, unknown tag, ...) as an
// {"error": ...} line inside a 200 OK stream — not as an HTTP error status.
function dockerApiPull(image: string): Promise<ActionResult> {
  return new Promise((resolve, reject) => {
    const [repo, tag] = splitImageRef(image);
    const path = `/images/create?fromImage=${encodeURIComponent(repo)}&tag=${encodeURIComponent(tag)}`;
    const req = request(
      { socketPath: SOCKET_PATH, path: `${API_VERSION}${path}`, method: "POST", timeout: 5 * 60_000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const lines = Buffer.concat(chunks).toString("utf8").trim().split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj && typeof obj.error === "string") {
                resolve({ ok: false, reason: obj.error });
                return;
              }
            } catch {
              // non-JSON progress line, ignore
            }
          }
          if ((res.statusCode ?? 0) >= 400) {
            resolve({ ok: false, reason: `Pull failed (HTTP ${res.statusCode})` });
            return;
          }
          resolve({ ok: true });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Docker image pull timed out")));
    req.on("error", reject);
    req.end();
  });
}

function splitImageRef(image: string): [repo: string, tag: string] {
  // Split on the last colon that comes after the last slash, so a registry
  // port (e.g. localhost:5000/app:latest) isn't mistaken for a tag separator.
  const lastSlash = image.lastIndexOf("/");
  const lastColon = image.lastIndexOf(":");
  if (lastColon > lastSlash) {
    return [image.slice(0, lastColon), image.slice(lastColon + 1)];
  }
  return [image, "latest"];
}

function digestOf(repoDigest: string): string {
  const at = repoDigest.lastIndexOf("@");
  return at === -1 ? repoDigest : repoDigest.slice(at + 1);
}

async function checkOneImage(image: string): Promise<DockerImageUpdateInfo> {
  const checkedAt = Date.now();
  const unknown = (reason: string): DockerImageUpdateInfo => ({
    image,
    status: "unknown",
    reason,
    checkedAt,
  });

  let localJson: ApiResponse;
  try {
    localJson = await dockerApiRequest("GET", `/images/${encodeURIComponent(image)}/json`);
  } catch {
    return unknown("Registry unreachable");
  }
  if (localJson.status === 404) return unknown("Image not found locally");
  const repoDigests: string[] = Array.isArray((localJson.json as any)?.RepoDigests)
    ? (localJson.json as any).RepoDigests
    : [];
  if (repoDigests.length === 0) return unknown("No local digest to compare");

  let distJson: ApiResponse;
  try {
    distJson = await dockerApiRequest("GET", `/distribution/${encodeURIComponent(image)}/json`);
  } catch {
    return unknown("Registry unreachable");
  }
  if (distJson.status === 401 || distJson.status === 403) {
    return unknown("Registry authentication required");
  }
  if (distJson.status === 404) return unknown("Image reference not found in registry");
  if (distJson.status >= 400) return unknown("Couldn't read registry manifest");

  // The response carries one Descriptor for the reference as a whole (the
  // manifest-list/index digest for a multi-arch tag, or the single manifest's
  // digest otherwise) plus a separate Platforms array with no per-platform
  // digests — confirmed against a real registry, not per API docs, since
  // this shape is easy to get wrong. Docker records exactly this digest in a
  // local image's RepoDigests after a pull, regardless of which platform was
  // actually fetched, so no platform-matching is needed here.
  const remoteDigest: string | undefined = (distJson.json as any)?.Descriptor?.digest;
  if (!remoteDigest) return unknown("Couldn't read registry manifest");

  const localDigests = new Set(repoDigests.map(digestOf));
  const status: DockerImageUpdateStatus = localDigests.has(remoteDigest)
    ? "upToDate"
    : "updateAvailable";
  return { image, status, checkedAt };
}

export async function checkForImageUpdates(): Promise<DockerUpdateCheckResult> {
  if (!existsSync(SOCKET_PATH)) {
    return { ok: false, reason: NOT_RUNNING_REASON, images: [] };
  }
  const listResult = await getDockerContainers();
  if (!listResult.ok) {
    return { ok: false, reason: listResult.reason, images: [] };
  }
  const uniqueImages = Array.from(new Set(listResult.containers.map((c) => c.image)));
  const images = await Promise.all(uniqueImages.map(checkOneImage));
  return { ok: true, images };
}

interface ContainerInspect {
  Id: string;
  Name: string;
  Config: Record<string, unknown> & { Image: string; Hostname?: string };
  HostConfig: Record<string, unknown> & { Binds?: string[]; Mounts?: unknown[] };
  NetworkSettings?: { Networks?: Record<string, Record<string, unknown>> };
  State?: { Running?: boolean };
}

function buildCreateBody(inspect: ContainerInspect, newImage: string) {
  const config: Record<string, unknown> = { ...inspect.Config, Image: newImage };
  const shortId = inspect.Id.slice(0, 12);
  if (config.Hostname === shortId) delete config.Hostname;

  const hostConfig: Record<string, unknown> = { ...inspect.HostConfig };
  if (Array.isArray(hostConfig.Mounts) && hostConfig.Mounts.length > 0) {
    delete hostConfig.Binds;
  }
  delete hostConfig.ContainerIDFile;

  const networks = inspect.NetworkSettings?.Networks ?? {};
  const endpointsConfig: Record<string, unknown> = {};
  for (const [netName, net] of Object.entries(networks)) {
    endpointsConfig[netName] = {
      Aliases: net.Aliases,
      IPAMConfig: net.IPAMConfig,
      MacAddress: net.MacAddress,
    };
  }

  return {
    ...config,
    HostConfig: hostConfig,
    NetworkingConfig: { EndpointsConfig: endpointsConfig },
  };
}

async function inspectContainer(name: string): Promise<ContainerInspect | null> {
  const res = await dockerApiRequest("GET", `/containers/${encodeURIComponent(name)}/json`);
  if (res.status === 404) return null;
  return res.json as ContainerInspect;
}

async function renameContainer(name: string, newName: string): Promise<boolean> {
  const res = await dockerApiRequest(
    "POST",
    `/containers/${encodeURIComponent(name)}/rename?name=${encodeURIComponent(newName)}`
  );
  return res.status >= 200 && res.status < 300;
}

async function startContainerById(id: string): Promise<boolean> {
  const res = await dockerApiRequest("POST", `/containers/${encodeURIComponent(id)}/start`);
  return res.status >= 200 && res.status < 300;
}

async function stopContainerById(id: string): Promise<boolean> {
  const res = await dockerApiRequest("POST", `/containers/${encodeURIComponent(id)}/stop`);
  return res.status >= 200 && res.status < 300;
}

async function removeContainerById(id: string): Promise<void> {
  await dockerApiRequest("DELETE", `/containers/${encodeURIComponent(id)}?force=true`);
}

export async function updateContainer(name: string): Promise<DockerUpdateResult> {
  if (!existsSync(SOCKET_PATH)) {
    return { ok: false, reason: NOT_RUNNING_REASON };
  }

  const inspect = await inspectContainer(name);
  if (!inspect) {
    return { ok: false, reason: "Container not found" };
  }
  const wasRunning = inspect.State?.Running === true;

  const pullResult = await dockerApiPull(inspect.Config.Image).catch(
    (err): ActionResult => ({ ok: false, reason: err instanceof Error ? err.message : String(err) })
  );
  if (!pullResult.ok) {
    return { ok: false, reason: `Couldn't pull new image: ${pullResult.reason}`, rolledBack: true };
  }

  if (wasRunning) await stopContainerById(inspect.Id);

  const tempName = `${name}-update-${Date.now()}`;
  const renamed = await renameContainer(inspect.Id, tempName);
  if (!renamed) {
    if (wasRunning) await startContainerById(inspect.Id);
    return { ok: false, reason: "Couldn't rename existing container", rolledBack: true };
  }

  async function rollback(): Promise<boolean> {
    const renamedBack = await renameContainer(inspect!.Id, name);
    if (!renamedBack) return false;
    if (wasRunning) await startContainerById(inspect!.Id);
    return true;
  }

  let createRes: ApiResponse;
  try {
    createRes = await dockerApiRequest(
      "POST",
      `/containers/create?name=${encodeURIComponent(name)}`,
      buildCreateBody(inspect, inspect.Config.Image)
    );
  } catch (err) {
    const ok = await rollback().catch(() => false);
    return {
      ok: false,
      reason: `Couldn't create new container: ${err instanceof Error ? err.message : String(err)}`,
      rolledBack: ok,
    };
  }
  const newId = (createRes.json as any)?.Id as string | undefined;
  if (createRes.status >= 400 || !newId) {
    const detail =
      typeof createRes.json === "string" ? createRes.json : (createRes.json as any)?.message;
    const ok = await rollback().catch(() => false);
    return { ok: false, reason: `Couldn't create new container: ${detail ?? createRes.status}`, rolledBack: ok };
  }

  const started = await startContainerById(newId).catch(() => false);
  if (!started) {
    await removeContainerById(newId).catch(() => {});
    const ok = await rollback().catch(() => false);
    return ok
      ? { ok: false, reason: "Couldn't start the updated container; restored the previous one.", rolledBack: true }
      : {
          ok: false,
          reason: `Update failed and the previous container could not be restored — check 'docker ps -a' for '${tempName}'.`,
          rolledBack: false,
        };
  }

  await removeContainerById(inspect.Id).catch(() => {});
  return { ok: true };
}
