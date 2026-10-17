/**
 * Gate (#2936 etapa 3): PDF assinado com página de evidências, arquivado no contrato.
 * Prova de verdade com o pdf-lib: um PDF de 2 páginas vira um PDF de 2 + evidências, com o código no assunto.
 * Travas que não podem regredir sem ninguém ver:
 *  - página de evidências com o hash do original, o código de verificação, IP/aparelho/data de cada signatário;
 *  - LGPD: CPF e e-mail mascarados; localização só com consentimento;
 *  - rota logada confere o envio pela RLS do usuário antes de usar o service_role; rota pública só gera depois do último;
 *  - o servidor só gera se o arquivo guardado ainda tem o hash assinado;
 *  - funções novas só service_role (marcadas ci-sem-guarda), registro idempotente, só envio assinado, só pasta da empresa.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { blocosEvidencias, documentoMascarado, emailMascarado, textoSeguro, dataHoraBR, gerarPdfAssinado, type Evidencias } from '../../src/lib/contratos/pdfAssinado'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const ler = (p: string) => readFileSync(p, 'utf8')
const semComentario = (s: string) => s.replace(/^\s*\/\/.*$/gm, '')

const HASH = 'a'.repeat(64)
const ev: Evidencias = {
  envio_id: 'e1', company_id: 'c1', contrato_id: 'k1', status: 'assinado', versao: 2, documento_hash: HASH,
  documento_path: 'c1/x.pdf', documento_assinado_path: null, codigo_verificacao: 'AB12CD34EF56',
  criado_em: '2026-10-17T12:00:00Z', concluido_em: '2026-10-17T13:30:00Z',
  contrato_numero: 'CT-0007', contrato_nome: 'Prestação de serviços — “Pdois”', empresa: 'Proplay Produtora Ltda', empresa_cnpj: '12345678000199',
  signatarios: [
    { nome: 'Maria Aparecida Souza', papel: 'cliente', documento: '12345678909', email: 'maria.souza@exemplo.com', status: 'assinado',
      visualizado_em: '2026-10-17T13:00:00Z', assinado_em: '2026-10-17T13:05:00Z', metodo: 'aceite', ip: '177.10.20.30',
      user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' + 'X'.repeat(300), geo_consentido: false,
      geolocalizacao: { latitude: -27.1, longitude: -52.6 }, documento_hash_assinado: HASH },
    { nome: 'João Empresa', papel: 'empresa', documento: '12345678000199', email: 'joao@proplay.com.br', status: 'assinado',
      visualizado_em: null, assinado_em: '2026-10-17T13:30:00Z', metodo: 'aceite', ip: '2804:14c::1', user_agent: null,
      geo_consentido: true, geolocalizacao: { latitude: -27.123456, longitude: -52.654321, precisao: 18.4 }, documento_hash_assinado: HASH },
  ],
}

// regras puras
ok(documentoMascarado('12345678909') === '***.456.789-**', 'CPF mascarado')
ok(documentoMascarado('12345678000199') === '12.345.678/0001-99', 'CNPJ inteiro e formatado')
ok(emailMascarado('maria.souza@exemplo.com') === 'ma***@exemplo.com' && emailMascarado(null) === '-', 'e-mail mascarado')
ok(/17\/10\/2026.*10:05:00.*Brasília/.test(dataHoraBR('2026-10-17T13:05:00Z')), `data no horário de Brasília (${dataHoraBR('2026-10-17T13:05:00Z')})`)
ok(textoSeguro('“a” — b • c ✓') === '"a" - b - c ?', 'texto sem caractere que a fonte do PDF não desenha')
const texto = blocosEvidencias(ev).map((b) => [b.titulo, ...b.linhas].join('\n')).join('\n')
ok(texto.includes(HASH) && texto.includes('AB12CD34EF56'), 'evidências: hash do original e código de verificação')
ok(texto.includes('177.10.20.30') && texto.includes('2804:14c::1') && texto.includes('iPhone'), 'evidências: IP e aparelho de cada signatário')
ok(!texto.includes('12345678909') && !texto.includes('123.456.789-09') && texto.includes('***.456.789-**'), 'evidências: CPF nunca inteiro')
ok(!texto.includes('maria.souza@') && texto.includes('ma***@exemplo.com'), 'evidências: e-mail mascarado')
ok(!texto.includes('-27.10000') && texto.includes('não autorizada') && texto.includes('-27.12346, -52.65432 (precisão ~18 m)'), 'evidências: localização só com consentimento')
ok(/Lei 14\.063\/2020/.test(texto) && /código de uso único/.test(texto), 'evidências: base legal e método de identificação')
ok(!texto.includes('DIFERENTE'), 'evidências: hash assinado igual ao original não acusa diferença')
const outro = blocosEvidencias({ ...ev, signatarios: [{ ...ev.signatarios[0], documento_hash_assinado: 'b'.repeat(64) }] }).flatMap((b) => b.linhas).join('\n')
ok(outro.includes('DIFERENTE do original'), 'evidências: acusa hash assinado diferente do original')

// estático: rotas, servidor e migration
const servidor = semComentario(ler('src/lib/contratos/pdfAssinadoServidor.ts'))
const rotaPdf = semComentario(ler('src/app/api/contratos/assinatura/pdf/route.ts'))
const publico = semComentario(ler('src/app/api/contratos/assinatura/publico/route.ts'))
const tela = ler('src/components/ge/ContratoAssinatura.tsx')
const migArq = readdirSync('supabase/migrations').find((f) => f.endsWith('_contrato_assinatura_pdf_evidencias.sql'))
const mig = migArq ? ler(`supabase/migrations/${migArq}`) : ''
ok(!!migArq, 'migration do PDF assinado existe')

ok(/export const POST = exigirLogin\(/.test(rotaPdf), 'rota do PDF: exige login')
ok(rotaPdf.indexOf("doUsuario.from('erp_contrato_assinatura_envio')") > -1
  && rotaPdf.indexOf("doUsuario.from('erp_contrato_assinatura_envio')") < rotaPdf.indexOf('gerarEArquivarPdfAssinado(envioId'),
  'rota do PDF: confere o envio pela RLS do usuário antes do service_role')
ok(/createSignedUrl\(g\.path, 120/.test(rotaPdf), 'rota do PDF: download por link de 2 min')
ok(/r\.todos_assinaram && /.test(publico) && /gerarEArquivarPdfAssinado\(/.test(publico) && /catch/.test(publico.slice(publico.indexOf('gerarEArquivarPdfAssinado('))),
  'rota pública: gera só depois do último signatário, sem derrubar a assinatura se falhar')
ok(/sha256Hex\(original\.buffer/.test(servidor) && /!== ev\.documento_hash/.test(servidor), 'servidor: só gera se o arquivo guardado tem o hash assinado')
ok(/if \(ev\.documento_assinado_path\) return/.test(servidor), 'servidor: idempotente (não gera duas vezes)')
ok(/\$\{e\.company_id\}\/assinados\//.test(servidor), 'servidor: PDF na pasta da empresa')
ok(/fn_contrato_assin__registrar_pdf/.test(servidor) && /fn_contrato_assin__evidencias/.test(servidor), 'servidor: usa as funções do banco')

const sql = mig.replace(/--[^\n]*/g, '')
for (const fn of ['fn_contrato_assin__evidencias', 'fn_contrato_assin__registrar_pdf']) {
  ok(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM anon, public, authenticated`).test(sql), `${fn}: fechada para anon/authenticated`)
  ok(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role`).test(sql), `${fn}: só service_role`)
  ok(new RegExp(`ci-sem-guarda: ${fn} — `).test(mig), `${fn}: marcada ci-sem-guarda com motivo`)
}
ok(/v_e\.status <> 'assinado'/.test(sql) && /documento_assinado_path IS NOT NULL/.test(sql), 'registro: só envio assinado e uma vez só')
ok(/NOT LIKE v_e\.company_id::text \|\| '\/%'/.test(sql) && /LIKE '%\.\.%'/.test(sql), 'registro: só na pasta da empresa do envio')
ok(/CASE WHEN s\.geo_consentido THEN s\.geolocalizacao END/.test(sql), 'evidências: localização só com consentimento também no banco')
ok(!/DROP |DELETE |TRUNCATE /i.test(sql) && !/CREATE OR REPLACE FUNCTION public\.fn_contrato_assinatura_/.test(sql), 'migration aditiva: não mexe nas funções da etapa 1')
const chaves = [...tela.matchAll(/<AjudaCampo chave="(ge\.contrato\.assinatura\.(?:pdf_assinado|gerar_pdf))"/g)].map((m) => m[1])
ok(chaves.length === 2, `tela: "?" nos dois botões do PDF (${chaves.length})`)
for (const c of chaves) ok(mig.includes(`'${c}'`), `"?" ${c} cadastrado na migration`)

// prova real: PDF de 2 páginas → original + evidências, abre de novo, assunto com o código
async function provaPdf() {
  const base = await PDFDocument.create()
  const f = await base.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 2; i++) base.addPage([595.28, 841.89]).drawText(`Contrato pagina ${i + 1}`, { x: 50, y: 700, size: 12, font: f })
  const original = await base.save()
  const saida = await gerarPdfAssinado(original, ev)
  const lido = await PDFDocument.load(saida)
  ok(lido.getPageCount() >= 3, `PDF assinado: ${lido.getPageCount()} páginas (2 do original + evidências)`)
  ok((lido.getSubject() ?? '').includes('AB12CD34EF56') && (lido.getSubject() ?? '').includes(HASH), 'PDF assinado: código e hash no assunto do arquivo')
  const muitos = await gerarPdfAssinado(original, { ...ev, signatarios: Array.from({ length: 10 }, () => ev.signatarios[0]) })
  ok((await PDFDocument.load(muitos)).getPageCount() >= 4, '10 signatários: evidências continuam em nova página')
}

provaPdf().catch((e) => { falhas++; console.error('✘ geração do PDF falhou:', e) }).finally(() => {
  if (falhas) { console.error(`\n[check-contrato-assinatura-pdf] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
  console.log('\n[check-contrato-assinatura-pdf] PDF assinado com evidências conferido.')
})
