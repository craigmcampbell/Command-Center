import { ipcMain, type IpcMainInvokeEvent } from "electron";

// Only reads belong here. Mutations must always execute, even with equal arguments.
export function readHandler(channel: string, handler: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
  const pending = new Map<string, Promise<unknown>>();
  ipcMain.handle(channel, (event, ...args) => {
    const key = JSON.stringify(args);
    let request = pending.get(key);
    if (!request) {
      request = Promise.resolve().then(() => handler(event, ...args)).finally(() => pending.delete(key));
      pending.set(key, request);
    }
    return request;
  });
}
