// Gate (Rodrigo · chamado #1881, causa raiz) — o focus-nfe-webhook grava XML/PDF com URL ABSOLUTA.
// A Focus manda o caminho RELATIVO ("/arquivos/..."); se gravado cru, o fiscal-storage-worker faz
// fetch(url) e falha com "Invalid URL", queimando as 5 tentativas → nota fica "não armazenada".
// Travas de código, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const wh = readFileSync('supabase/functions/focus-nfe-webhook/index.ts', 'utf8')

// Base por ambiente (igual ao gov-nfse-consultar)
ok(/function focusBase\(/.test(wh), 'webhook: tem helper focusBase(ambiente)')
ok(wh.includes('https://api.focusnfe.com.br') && wh.includes('https://homologacao.focusnfe.com.br'),
  'webhook: base producao/homologacao')
// Helper que absolutiza caminho relativo ("/..." → base + "/...")
ok(/function urlAbsoluta\(/.test(wh) && /startsWith\("\/"\)/.test(wh),
  'webhook: urlAbsoluta transforma caminho relativo em URL completa')
// Lê o ambiente da nota (NFS-e e NF-e) para escolher a base
ok(/select\("company_id, ambiente"\)/.test(wh), 'webhook: lê ambiente da nota (erp_nfse/nfe_emitidas)')
ok(/const focusUrlBase = focusBase\(notaAmbiente\)/.test(wh), 'webhook: base derivada do ambiente da nota')
// NFS-e: xml e pdf passam por urlAbsoluta, e o PDF inclui url_danfse (DANFSE no S3 público)
ok(/p_xml_url:\s*urlAbsoluta\(/.test(wh), 'webhook: p_xml_url absolutizado')
ok(/p_pdf_url:\s*urlAbsoluta\([\s\S]*?url_danfse[\s\S]*?focusUrlBase\)/.test(wh),
  'webhook: p_pdf_url absolutizado e inclui payload.url_danfse')
// NF-e: danfe também absolutizado
ok(/p_danfe_url:\s*urlAbsoluta\(/.test(wh), 'webhook: p_danfe_url (NF-e) absolutizado')

if (falhas) { console.error(`\ncheck-webhook-nfse-url-absoluta: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-webhook-nfse-url-absoluta: ok')
