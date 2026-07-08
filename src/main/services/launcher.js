// Launches an external terminal at a given directory and runs a command
// (e.g. `claude`). Terminal-launching is inherently OS-specific, so we branch
// on platform. macOS targets Warp; adjust to your terminal of choice
// (Terminal.app, iTerm, etc.) if you don't use Warp.

const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Warp has no AppleScript "do script" support. Instead it watches
// ~/.warp/tab_configs/*.toml and can open one by name via its URI scheme, so
// we write a config pointing at the target directory/command and open that.
// https://docs.warp.dev/terminal/windows/tab-configs
function openInWarp(dir, command) {
  return new Promise((resolve) => {
    const configDir = path.join(os.homedir(), ".warp", "tab_configs");
    const configName = "command-center-launch";
    const toml = `name = "Command Center Launch"

[[panes]]
id = "main"
type = "terminal"
directory = "${dir}"
commands = ["${command}"]
`;

    try {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, `${configName}.toml`), toml);
    } catch (err) {
      resolve({ ok: false, reason: err.message });
      return;
    }

    exec(`open "warp://tab_config/${configName}"`, (err) => {
      if (err) resolve({ ok: false, reason: err.message });
      else resolve({ ok: true });
    });
  });
}

function openInTerminal(dir, command) {
  return new Promise((resolve) => {
    if (process.platform === "darwin") {
      openInWarp(dir, command).then(resolve);
      return;
    }

    let cmd;
    if (process.platform === "win32") {
      cmd = `start cmd /k "cd /d ${dir} && ${command}"`;
    } else {
      // Linux — assumes gnome-terminal; swap for your terminal if needed.
      cmd = `gnome-terminal --working-directory="${dir}" -- bash -c "${command}; exec bash"`;
    }

    exec(cmd, (err) => {
      if (err) resolve({ ok: false, reason: err.message });
      else resolve({ ok: true });
    });
  });
}

module.exports = { openInTerminal };
