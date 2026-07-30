// Module-level singleton — CopilotChat registers its insertAtCursor fn here.
// CopyToChat calls insertToChatAtCursor() without needing React context.

let _insertFn: ((text: string) => void) | null = null

export function registerChatInsert(fn: (text: string) => void): void {
  _insertFn = fn
}

export function deregisterChatInsert(fn: (text: string) => void): void {
  if (_insertFn === fn) _insertFn = null
}

export function insertToChatAtCursor(text: string): void {
  _insertFn?.(text)
}
