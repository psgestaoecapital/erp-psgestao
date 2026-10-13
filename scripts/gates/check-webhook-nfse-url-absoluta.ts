// Gate (Rodrigo · chamado #1881, causa raiz) — o focus-nfe-webhook grava XML/PDF com URL ABSOLUTA.
// A Focus manda o caminho RELATIVO ("/arquivos/..."); se gravado cru, o fiscal-storage-worker faz
// fetch(url) e falha com "Invalid URL", queimando as 5 tentativas → nota fica "não armazenada".
// Ressalva do Eng. Chefe (07/10): sem o ambiente da nota NÃO se adivinha homologação — o webhook grava como veio e o
// worker absolutiza ao baixar, pela base do ambiente da nota lido naquele momento. Regra única em _shared/focusUrl.ts.
// Travas de código + comportamento da regra, sem rede.
import { readFileSync } from 'node:fs'
import { focusBase, focusUrlAbsoluta, ehCaminhoRelativo } from '../../supabase/functions/_shared/focusUrl'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── regra única (comportamento) ─────────────────────────────────────────────────────────────────────────────
const CAM = '/arquivos/123/NFSe-1-nfse.xml'
ok(focusBase('producao') === 'https://api.focusnfe.com.br' && focusBase('homologacao') === 'https://homologacao.focusnfe.com.br',
  'regra: base de producao e de homologacao')
ok(focusBase(null) === null && focusBase(undefined) === null && focusBase('') === null && focusBase('outro') === null,
  'regra: ambiente desconhecido não tem base (não cai em homologação)')
ok(focusUrlAbsoluta(CAM, 'producao') === `https://api.focusnfe.com.br${CAM}`, 'regra: relativa + producao → api.focusnfe')
ok(focusUrlAbsoluta(CAM, 'homologacao') === `https://homologacao.focusnfe.com.br${CAM}`, 'regra: relativa + homologacao → homologacao')
ok(focusUrlAbsoluta(CAM, null) === CAM, 'regra: relativa SEM ambiente fica como veio (nunca homologação adivinhada)')
ok(focusUrlAbsoluta('https://s3.amazonaws.com/x.pdf', null) === 'https://s3.amazonaws.com/x.pdf' &&
   focusUrlAbsoluta('https://s3.amazonaws.com/x.pdf', 'homologacao') === 'https://s3.amazonaws.com/x.pdf', 'regra: URL absoluta não muda')
ok(focusUrlAbsoluta(null, 'producao') === null && focusUrlAbsoluta('', 'producao') === null, 'regra: vazio → null')
ok(ehCaminhoRelativo(CAM) && !ehCaminhoRelativo('//cdn.x/y') && !ehCaminhoRelativo('https://a/b') && !ehCaminhoRelativo(null),
  'regra: só "/..." é caminho relativo')

// ── webhook ─────────────────────────────────────────────────────────────────────────────────────────────────
const wh = readFileSync('supabase/functions/focus-nfe-webhook/index.ts', 'utf8')
ok(/import \{ focusUrlAbsoluta \} from "\.\.\/_shared\/focusUrl\.ts"/.test(wh) && !/function focusBase\(/.test(wh) && !/function urlAbsoluta\(/.test(wh),
  'webhook: usa a regra única (_shared/focusUrl.ts), sem cópia local')
ok(!/homologacao\.focusnfe/.test(wh), 'webhook: nenhuma base de homologação "padrão" no código')
ok(/select\("company_id, ambiente"\)/.test(wh), 'webhook: lê ambiente da nota (erp_nfse/nfe_emitidas)')
const posFallback = wh.indexOf('from("companies").select("id").eq("cnpj"')
const posRelida = wh.indexOf('.from(tabelaNota).select("ambiente")')
ok(posFallback > 0 && posRelida > posFallback, 'webhook: depois do fallback por CNPJ, relê a nota para pegar o ambiente')
ok(/p_xml_url:\s*focusUrlAbsoluta\([^)]*\?\? null, notaAmbiente\)/.test(wh), 'webhook: p_xml_url pela regra, com o ambiente da nota')
ok(/p_pdf_url:\s*focusUrlAbsoluta\([^)]*url_danfse[^)]*, notaAmbiente\)/.test(wh), 'webhook: p_pdf_url pela regra e inclui payload.url_danfse')
ok(/p_danfe_url:\s*focusUrlAbsoluta\([^)]*, notaAmbiente\)/.test(wh), 'webhook: p_danfe_url (NF-e) pela regra')

// ── worker ──────────────────────────────────────────────────────────────────────────────────────────────────
const wk = readFileSync('supabase/functions/fiscal-storage-worker/index.ts', 'utf8')
ok(/from "\.\.\/_shared\/focusUrl\.ts"/.test(wk) && !/focusnfe\.com\.br/.test(wk), 'worker: usa a regra única, sem base própria')
ok(/async function ambienteDaNota\(/.test(wk) && /\.select\("ambiente"\)[\s\S]{0,40}\.eq\("id", docId\)/.test(wk),
  'worker: lê o ambiente DA NOTA na hora de baixar')
const posAbs = wk.indexOf('xml_url = focusUrlAbsoluta(xml_url, ambiente)')
const posFetch = wk.indexOf('await fetch(xml_url')
ok(posAbs > 0 && posFetch > posAbs, 'worker: absolutiza a URL relativa ANTES do fetch')
ok(/ehCaminhoRelativo\(xml_url\)\)\s*\{\s*return \{ ok: false, erro: "URL relativa da Focus e ambiente da nota desconhecido/.test(wk),
  'worker: sem ambiente, falha com motivo (não adivinha a base)')

if (falhas) { console.error(`\ncheck-webhook-nfse-url-absoluta: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-webhook-nfse-url-absoluta: ok')
