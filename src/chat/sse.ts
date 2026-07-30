import type { Response } from 'express'

export function sseWrite(res: Response, data: object): void {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
    if (typeof (res as any).flush === 'function') (res as any).flush()
  } catch { /* client disconnected */ }
}
