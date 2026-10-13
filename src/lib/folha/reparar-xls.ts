// Reparo do .xls do Domínio Sistemas (BIFF/OLE malformado).
//
// Causa-raiz (provada no byte pelo CEO 14/07): a Domínio grava o registro
// BOUNDSHEET (0x0085) com o campo lbPlyPos apontando pro ENDEREÇO ERRADO da
// worksheet. XLSX.read confia no ponteiro, pula pro offset errado, não acha o
// BOF da planilha e devolve a sheet VAZIA — SEM lançar exceção (por isso "abriu"
// mas veio zerado). O LibreOffice lê porque IGNORA o ponteiro e procura a sheet.
// O Excel conserta o ponteiro ao salvar (por isso um arquivo reaberto no Excel
// funciona) — mas o export CRU da Domínio sempre vem quebrado.
//
// Este reparo (JS puro, roda no Vercel, sem LibreOffice): abre o CFB, pega o
// stream 'Workbook', caminha os records BIFF [id:2][len:2][payload], acha a
// posição REAL da worksheet (BOF 0x0809 com dt=0x0010) e reescreve o lbPlyPos
// do 1º BOUNDSHEET. Devolve o stream corrigido pra um novo XLSX.read.
import * as XLSX from 'xlsx'

const BOF = 0x0809          // Begin Of File (substream)
const BOUNDSHEET = 0x0085   // aba: contém lbPlyPos (ponteiro pro BOF da worksheet)
const DT_WORKSHEET = 0x0010 // substream type = worksheet

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CFB: any = (XLSX as any).CFB

export function repararWorkbookDominio(buf: Uint8Array): Uint8Array | null {
  if (!CFB) return null
  let cfb: unknown
  try { cfb = CFB.read(buf, { type: 'array' }) } catch { return null }
  const entry = CFB.find(cfb, 'Workbook') || CFB.find(cfb, 'Book')
  const content: Uint8Array | undefined = entry?.content
  if (!content || content.length < 8) return null

  const s = Buffer.from(content)
  let o = 0
  let posLbPlyPos = -1   // offset (no stream) do campo lbPlyPos do 1º BOUNDSHEET
  let realBOF = -1       // offset (no stream) do BOF real da worksheet

  while (o + 4 <= s.length) {
    const id = s.readUInt16LE(o)
    const len = s.readUInt16LE(o + 2)
    if (id === BOUNDSHEET && posLbPlyPos < 0) {
      posLbPlyPos = o + 4                       // lbPlyPos = primeiros 4 bytes do payload
    } else if (id === BOF && len >= 4 && realBOF < 0) {
      // BOF payload: [vers:2][dt:2] → dt em o+4+2
      if (s.readUInt16LE(o + 6) === DT_WORKSHEET) realBOF = o
    }
    o += 4 + len
    if (posLbPlyPos >= 0 && realBOF >= 0) break
  }

  if (posLbPlyPos < 0 || realBOF < 0) return null
  if (s.readUInt32LE(posLbPlyPos) === realBOF) return null   // ponteiro já correto — nada a reparar

  s.writeUInt32LE(realBOF, posLbPlyPos)                       // 🔧 conserta o ponteiro
  return new Uint8Array(s.buffer, s.byteOffset, s.byteLength)
}
