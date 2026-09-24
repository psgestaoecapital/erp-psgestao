// Prova do parser tipo-aware (parseTributos). Roda: npx tsx scripts/test-parse-tributos.ts
// Cobre: NF-e com vTotTrib (total + item), NF-e SEM vTotTrib, NFS-e nacional (pTotTribSN real do CEO),
// NFS-e com valores Fed/Est/Mun, e namespace com prefixo. Sem I/O — parser é puro.
import { parseTributos } from '../src/lib/fiscal/parseTributos'

let falhas = 0
function check(nome: string, cond: boolean, got?: unknown) {
  if (cond) { console.log('  ok  ·', nome) }
  else { falhas++; console.log('  XX  ·', nome, '· obtido:', JSON.stringify(got)) }
}

// 1) NF-e COM vTotTrib no ICMSTot + por item
const nfeCom = `<?xml version="1.0"?><nfeProc><NFe><infNFe>
  <det nItem="1"><prod><vProd>96.35</vProd></prod><imposto><vTotTrib>5.78</vTotTrib><ICMS/></imposto></det>
  <total><ICMSTot><vProd>96.35</vProd><vTotTrib>5.78</vTotTrib><vNF>96.35</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`
{
  const r = parseTributos(nfeCom)
  check('NF-e: tipo=nfe', r.tipo === 'nfe', r.tipo)
  check('NF-e: vTotTrib do ICMSTot = 5.78', r.vTotTrib === 5.78, r.vTotTrib)
  check('NF-e: 1 item com vTotTrib', r.itensComVTotTrib === 1, r.itensComVTotTrib)
}

// 2) NF-e SEM vTotTrib (Focus não calcula) → vTotTrib null, tipo nfe, 0 itens
const nfeSem = `<?xml version="1.0"?><nfeProc><NFe><infNFe>
  <det nItem="1"><prod><vProd>96.35</vProd></prod><imposto><ICMS><ICMSSN102/></ICMS></imposto></det>
  <total><ICMSTot><vProd>96.35</vProd><vNF>96.35</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`
{
  const r = parseTributos(nfeSem)
  check('NF-e sem vTotTrib: tipo=nfe', r.tipo === 'nfe', r.tipo)
  check('NF-e sem vTotTrib: vTotTrib=null', r.vTotTrib === null, r.vTotTrib)
  check('NF-e sem vTotTrib: 0 itens', r.itensComVTotTrib === 0, r.itensComVTotTrib)
}

// 3) NFS-e nacional — trecho REAL do CEO (só pTotTribSN, sem vTotTrib) → não perde os 6%
const nfseSN = `<?xml version="1.0"?><NFSe><infNFSe><valores><totTrib><pTotTribSN>6.00</pTotTribSN></totTrib></valores></infNFSe></NFSe>`
{
  const r = parseTributos(nfseSN)
  check('NFS-e SN: tipo=nfse', r.tipo === 'nfse', r.tipo)
  check('NFS-e SN: pTotTribSN=6', r.pTotTribSN === 6, r.pTotTribSN)
  check('NFS-e SN: vTotTrib=null (não há valor monetário)', r.vTotTrib === null, r.vTotTrib)
}

// 4) NFS-e com valores Fed/Est/Mun → soma monetária
const nfseVal = `<?xml version="1.0"?><NFSe><infNFSe><totTrib><vTotTribFed>3.00</vTotTribFed><vTotTribEst>1.50</vTotTribEst><vTotTribMun>0.50</vTotTribMun></totTrib></infNFSe></NFSe>`
{
  const r = parseTributos(nfseVal)
  check('NFS-e val: tipo=nfse', r.tipo === 'nfse', r.tipo)
  check('NFS-e val: soma=5.00', r.vTotTrib === 5.0, r.vTotTrib)
}

// 5) namespace com prefixo (ns:) na NF-e
const nfeNs = `<ns:nfeProc><ns:NFe><ns:infNFe><ns:total><ns:ICMSTot><ns:vTotTrib>12.34</ns:vTotTrib></ns:ICMSTot></ns:total></ns:infNFe></ns:NFe></ns:nfeProc>`
{
  const r = parseTributos(nfeNs)
  check('NF-e ns: vTotTrib=12.34', r.vTotTrib === 12.34, r.vTotTrib)
}

console.log(falhas === 0 ? '\n✓ parseTributos OK (todos os casos)' : `\n✗ ${falhas} caso(s) falharam`)
process.exit(falhas === 0 ? 0 : 1)
