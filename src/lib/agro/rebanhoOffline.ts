// Snapshot offline do rebanho em IndexedDB (PWA Fase A · consulta sem internet).
// Isolado por company_id (P2/LGPD) · limparTudo() chamado no logout (SIGNED_OUT).
// Zero-dep: IndexedDB cru (evita adicionar lib e mexer no build do Next 16/Turbopack).

const DB_NAME = 'ps_offline'
const STORE = 'rebanho'
const VERSION = 1

export type RebanhoSnapshot = {
  companyId: string
  ts: number            // Date.now() do momento da captura
  propriedade: { id: string; nome: string } | null
  animais: unknown[]
  lotes: unknown[]
  piquetes: unknown[]
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB indisponível')); return }
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'companyId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function salvarSnapshot(s: RebanhoSnapshot): Promise<void> {
  const db = await abrir()
  try {
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(s)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } finally { db.close() }
}

export async function lerSnapshot(companyId: string): Promise<RebanhoSnapshot | null> {
  const db = await abrir()
  try {
    return await new Promise<RebanhoSnapshot | null>((res, rej) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(companyId)
      req.onsuccess = () => res((req.result as RebanhoSnapshot) ?? null)
      req.onerror = () => rej(req.error)
    })
  } finally { db.close() }
}

// Logout: apaga TODO o cache offline (nenhum dado de fazenda fica no aparelho).
export async function limparTudo(): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(DB_NAME)
      r.onsuccess = () => resolve()
      r.onerror = () => resolve()
      r.onblocked = () => resolve()
    })
  } catch { /* noop — best effort */ }
}
