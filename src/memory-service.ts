// Agent memory — thin wrapper over @wasmagent/core StructuredMemory.
// Remembers a user's preferred vendors and per-draft context across turns.

import path from 'path'

const log = console

const MEMORY_FILE = process.env.AGENT_MEMORY_FILE ||
  path.join(__dirname, '..', 'agent-memory.json')

let _memoryPromise: Promise<any> | null = null
let _memory: any = null

async function _init(): Promise<any> {
  if (_memoryPromise) return _memoryPromise
  _memoryPromise = import('@wasmagent/core').then(({ StructuredMemory, FileStructuredKv, InMemoryStructuredKv }) => {
    let backend: any
    try {
      backend = new FileStructuredKv(MEMORY_FILE)
      log.info(`[memory] StructuredMemory initialised (file backend: ${MEMORY_FILE})`)
    } catch (e: any) {
      log.warn('[memory] FileStructuredKv unavailable, falling back to in-memory:', e.message)
      backend = new InMemoryStructuredKv()
    }
    _memory = new StructuredMemory(backend)
    return _memory
  })
  return _memoryPromise
}

export async function getMemory(): Promise<any> {
  if (_memory) return _memory
  return _init()
}

export async function rememberVendor(userId: string, vendorId: string, vendorName: string): Promise<void> {
  const mem = await getMemory()
  const existing = await mem.get(`vendor_pref:${userId}`, 'semantic') || { vendors: [] }
  const vendors: any[] = existing.vendors || []
  if (!vendors.find((v: any) => v.vendorId === vendorId)) {
    vendors.push({ vendorId, vendorName, addedAt: new Date().toISOString() })
  }
  await mem.set(`vendor_pref:${userId}`, { vendors }, { namespace: 'semantic' })
}

export async function getPreferredVendors(userId: string): Promise<Array<{ vendorId: string; vendorName: string; addedAt: string }>> {
  try {
    const mem = await getMemory()
    const rec = await mem.get(`vendor_pref:${userId}`, 'semantic')
    return rec?.vendors || []
  } catch { return [] }
}

export async function rememberDraftContext(userId: string, draftId: string, context: object): Promise<void> {
  const mem = await getMemory()
  await mem.set(`draft_ctx:${userId}:${draftId}`, { draftId, ...context, savedAt: new Date().toISOString() }, { namespace: 'episodic' })
}

export async function getDraftContext(userId: string, draftId: string): Promise<object | null> {
  try {
    const mem = await getMemory()
    return await mem.get(`draft_ctx:${userId}:${draftId}`, 'episodic')
  } catch { return null }
}

export async function buildMemoryContext(userId: string): Promise<string> {
  try {
    const vendors = await getPreferredVendors(userId)
    if (vendors.length === 0) return ''
    const names = vendors.slice(0, 5).map(v => `${v.vendorName} (${v.vendorId})`).join(', ')
    return `\n## User Memory\nPreferred vendors for ${userId}: ${names}`
  } catch { return '' }
}
