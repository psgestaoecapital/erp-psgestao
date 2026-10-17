/**
 * Gate (#2936 etapa 2): botão "Enviar para assinatura" + página pública + rotas do servidor.
 * Travas que não podem regredir sem ninguém ver:
 *  - o código de confirmação (2º fator) nunca volta na resposta da rota pública (só vai por e-mail);
 *  - o hash assinado é recalculado no servidor a partir do arquivo guardado (nunca o valor vindo do navegador);
 *  - a página pública não fala direto com o banco (sem cliente supabase no navegador);
 *  - o envio roda com o JWT do próprio usuário (guarda de empresa na função) e exige login;
 *  - geolocalização só com consentimento; toda chave de "?" da tela existe na migration.
 * Mais a prova dos utilitários (IP, e-mail mascarado, WhatsApp, hash).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { ipDaRequisicao, mascararEmail, telefoneWhatsApp, sha256Hex, linkAssinatura, escaparHtml } from '../../src/lib/contratos/assinatura'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const ler = (p: string) => readFileSync(p, 'utf8')
const semComentario = (s: string) => s.replace(/^\s*\/\/.*$/gm, '')

const publico = semComentario(ler('src/app/api/contratos/assinatura/publico/route.ts'))
const enviar = semComentario(ler('src/app/api/contratos/assinatura/enviar/route.ts'))
const pagina = semComentario(ler('src/app/sign/contrato/[token]/page.tsx'))
const tela = ler('src/components/ge/ContratoAssinatura.tsx')
const form = ler('src/components/ge/ContratoForm.tsx')
const mig = ler('supabase/migrations/20261017080020_contrato_assinatura_tela_ajuda.sql')
// etapa 3 (#2936): os "?" dos botões do PDF assinado vêm na migration dela (achada pelo nome: a fila pode renumerar)
const migPdf = readdirSync('supabase/migrations').filter((f) => f.endsWith('_contrato_assinatura_pdf_evidencias.sql'))
  .map((f) => ler(`supabase/migrations/${f}`)).join('\n')

// rota pública
const blocoCodigo = publico.slice(publico.indexOf("body.acao === 'codigo'"), publico.indexOf("body.acao === 'assinar'"))
const respostas = [...blocoCodigo.matchAll(/NextResponse\.json\(([^)]*)\)/g)].map((m) => m[1])
ok(respostas.length > 0 && respostas.every((r) => !/codigo/.test(r)), 'rota pública: o código de confirmação não volta na resposta')
ok(/p_template: 'contrato_evento'/.test(blocoCodigo) && /\$\{r\.codigo\}/.test(blocoCodigo), 'rota pública: o código vai por e-mail ao signatário')
const blocoAssinar = publico.slice(publico.indexOf("body.acao === 'assinar'"))
ok(/storage\.from\(BUCKET_CONTRATOS\)\.download/.test(blocoAssinar) && /p_documento_hash: hash/.test(blocoAssinar) && !/body\.documento_hash/.test(publico),
  'rota pública: hash recalculado do arquivo guardado, nunca o do navegador')
ok(/p_geo_consentido: !!geoOk/.test(blocoAssinar) && /geoOk \? body\.geo : null/.test(blocoAssinar), 'rota pública: geolocalização só com consentimento')
ok(/TOKEN_RE\.test\(token\)/.test(publico), 'rota pública: token validado antes de ir ao banco')
ok(/createSignedUrl\(r\.documento_path, 300\)/.test(publico) && /documento_path: _p/.test(publico), 'rota pública: documento por link assinado de 5 min, sem expor o caminho')

// rota do envio
ok(/export const POST = exigirLogin\(/.test(enviar), 'envio: exige login')
ok(/doUsuario\.rpc\('fn_contrato_assinatura_enviar'/.test(enviar) && /Authorization: `Bearer \$\{u\.token\}`/.test(enviar), 'envio: cria o envio com o JWT do usuário (guarda de empresa)')
ok(/doUsuario\.from\('erp_contratos_arquivos'\)/.test(enviar), 'envio: arquivo lido pela RLS do usuário antes de baixar com service_role')
ok(/p_documento_hash: hash/.test(enviar) && /sha256Hex\(await blob\.arrayBuffer\(\)\)/.test(enviar), 'envio: hash calculado no servidor')
ok(/application\/pdf/.test(enviar), 'envio: só PDF vai para assinatura')

// página pública e tela
ok(!/@\/lib\/supabase/.test(pagina) && !/\.rpc\(/.test(pagina), 'página pública: sem acesso direto ao banco')
ok(/\/api\/contratos\/assinatura\/publico/.test(pagina), 'página pública: usa a rota do servidor')
ok(/<ContratoAssinatura contratoId=\{contrato\.id\}/.test(form), 'contrato: componente de assinatura na ficha')
const chaves = [...tela.matchAll(/<AjudaCampo chave="([^"]+)"/g)].map((m) => m[1])
ok(chaves.length >= 10, `tela: ${chaves.length} "?" na tela`)
for (const c of new Set(chaves)) ok((mig + migPdf).includes(`'${c}'`), `"?" ${c} cadastrado na migration`)
ok(!/CREATE OR REPLACE|DROP |UPDATE |DELETE |GRANT |REVOKE /i.test(mig.replace(/--.*$/gm, '')), 'migration: só textos do "?" (aditiva)')

// utilitários
const req = (h: Record<string, string>) => new Request('https://x.test/', { headers: h })
ok(ipDaRequisicao(req({ 'x-forwarded-for': '177.10.20.30, 10.0.0.1' })) === '177.10.20.30', 'IP: primeiro do x-forwarded-for')
ok(ipDaRequisicao(req({ 'x-forwarded-for': '999.1.1.1' })) === null && ipDaRequisicao(req({ 'x-forwarded-for': "1.1.1.1'; drop" })) === null, 'IP: inválido vira nulo')
ok(ipDaRequisicao(req({ 'x-forwarded-for': '2804:14c::1' })) === '2804:14c::1', 'IP: IPv6')
ok(mascararEmail('maria.souza@exemplo.com') === 'ma***@exemplo.com', 'e-mail mascarado')
ok(telefoneWhatsApp('(54) 99999-0000') === '5554999990000' && telefoneWhatsApp('5554999990000') === '5554999990000' && telefoneWhatsApp('123') === null, 'WhatsApp: DDI 55')
ok(linkAssinatura('https://app.test/', 'a'.repeat(48)) === `https://app.test/sign/contrato/${'a'.repeat(48)}`, 'link de assinatura')
ok(escaparHtml('<b>"A&B"</b>') === '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;', 'nome escapado no e-mail')
const bytes = new TextEncoder().encode('contrato v1')
sha256Hex(bytes.buffer as ArrayBuffer).then((h) => {
  ok(h === createHash('sha256').update('contrato v1').digest('hex'), 'hash SHA-256 igual ao do Node')
  if (falhas) { console.error(`\n[check-contrato-assinatura-tela] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
  console.log('\n[check-contrato-assinatura-tela] envio e assinatura pelo celular conferidos.')
})
