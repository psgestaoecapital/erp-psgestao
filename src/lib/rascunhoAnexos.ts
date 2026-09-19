// #61 (Jordana) · rascunho de ANEXOS pendentes do chamado. localStorage não guarda File; o IndexedDB
// guarda Blob/File por structured clone. Guardamos por chave (usuário+empresa) os anexos ainda não
// enviados, para sobreviverem ao reload que o service worker dispara ao voltar pra aba (PwaBootstrap).
// Tudo best-effort: em aba privada / storage bloqueado, as funções não lançam (o texto já tem o seu
// próprio rascunho em localStorage; anexo é um extra).

const DB_NAME = 'ps-rascunhos'
const STORE = 'anexos'

function abrir(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return }
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => { try { req.result.createObjectStore(STORE) } catch { /* já existe */ } }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

// Guarda o valor (qualquer coisa clonável — inclui File[]) sob a chave. Silencioso em falha.
export async function salvarRascunhoAnexos<T>(chave: string, valor: T): Promise<void> {
  const db = await abrir(); if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(valor as unknown as never, chave)
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve()
    } catch { resolve() }
  })
  db.close()
}

export async function lerRascunhoAnexos<T>(chave: string): Promise<T | null> {
  const db = await abrir(); if (!db) return null
  const val = await new Promise<T | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(chave)
      req.onsuccess = () => resolve((req.result as T) ?? null)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
  db.close()
  return val
}

export async function limparRascunhoAnexos(chave: string): Promise<void> {
  const db = await abrir(); if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(chave)
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve()
    } catch { resolve() }
  })
  db.close()
}
