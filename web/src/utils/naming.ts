const CLI_SAFE_NAME = /^[a-zA-Z0-9_]+$/

export function isCliSafeName(name: string): boolean {
  return CLI_SAFE_NAME.test(name)
}

export function toCliSafeName(name: string): string {
  return name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '_')
}
