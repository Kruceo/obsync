const PREFIX = '[obsidian-sync]';

export function log(...args: unknown[]): void {
  console.log(PREFIX, new Date().toISOString(), ...args);
}

export function warn(...args: unknown[]): void {
  console.warn(PREFIX, new Date().toISOString(), ...args);
}

export function error(...args: unknown[]): void {
  console.error(PREFIX, new Date().toISOString(), ...args);
}
