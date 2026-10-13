// Mantem /public/pdf.worker.min.mjs em sync com a versao de pdfjs-dist
// instalada — evita "mismatch version" no client. Roda no postinstall.
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs')
const dst = resolve(__dirname, '../public/pdf.worker.min.mjs')

try {
  await mkdir(dirname(dst), { recursive: true })
  await copyFile(src, dst)
  // eslint-disable-next-line no-console
  console.log(`[pdfjs] worker copiado: ${src} -> ${dst}`)
} catch (e) {
  // Nao falha o install se o pacote ainda nao estiver presente (npm install em ordens estranhas).
  // eslint-disable-next-line no-console
  console.warn('[pdfjs] copy-worker pulado:', e?.message ?? e)
}
