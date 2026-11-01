/**
 * Gate (#2936 etapa 4): conferência pública de contrato assinado (/verificar/contrato).
 * Travas que não podem regredir sem ninguém ver:
 *  - só código (12 hex) ou hash SHA-256 (64 hex) chegam ao banco; o resto é recusado sem consulta;
 *  - o arquivo conferido não sobe: a página calcula o hash no navegador e manda só o hash;
 *  - rota pública com limite por IP, chamando a função só pelo service_role;
 *  - a função continua só service_role, aceita o hash do PDF ASSINADO e devolve só o mínimo (LGPD);
 *  - a página de evidências do PDF traz o link da conferência.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { normalizarConsulta, linkVerificacao, veredito } from '../../src/lib/contratos/verificacao'
import { blocosEvidencias, type Evidencias } from '../../src/lib/contratos/pdfAssinado'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }
const ler = (p: string) => readFileSync(p, 'utf8')
const semComentario = (s: string) => s.replace(/^\s*(\/\/|--).*$/gm, '')

// regras puras
const H = 'b'.repeat(64)
ok(normalizarConsulta(' AB12 CD34-EF56 ')?.valor === 'ab12cd34ef56' && normalizarConsulta('AB12CD34EF56')?.tipo === 'codigo', 'código normalizado (espaço/hífen/maiúscula)')
ok(normalizarConsulta(H.toUpperCase())?.tipo === 'hash', 'hash de 64 hex aceito')
ok([null, '', 'ab12', 'ab12cd34ef5', 'zz12cd34ef56', "' OR 1=1 --", '%', 'b'.repeat(63), 'b'.repeat(65)].every((x) => normalizarConsulta(x) === null),
  'formato fora de código/hash recusado sem consulta')
ok(linkVerificacao('https://x.com/', 'ab12cd34ef56') === 'https://x.com/verificar/contrato?c=AB12CD34EF56', 'link da conferência')
ok(veredito({ ok: true, encontrado: false }).tom === 'erro', 'não encontrado = erro')
ok(veredito({ ok: true, encontrado: true, status: 'assinado', arquivo: 'assinado' }).tom === 'ok', 'assinado = ok')
ok(veredito({ ok: true, encontrado: true, status: 'aguardando' }).tom === 'aviso', 'aguardando = aviso')
ok(['cancelado', 'expirado'].every((s) => veredito({ ok: true, encontrado: true, status: s }).tom === 'erro'), 'cancelado/expirado = erro')

// PDF: linha do link só quando o servidor informa a URL
const ev = {
  envio_id: 'e', company_id: 'c', contrato_id: 'k', status: 'assinado', versao: 1, documento_hash: H, documento_path: null,
  documento_assinado_path: null, codigo_verificacao: 'AB12CD34EF56', criado_em: '2026-10-17T12:00:00Z', concluido_em: null,
  contrato_numero: null, contrato_nome: null, empresa: null, empresa_cnpj: null, signatarios: [],
} as Evidencias
const linhas = (e: Evidencias) => blocosEvidencias(e)[0].linhas.join('\n')
ok(!linhas(ev).includes('Confira a autenticidade'), 'sem URL, sem linha de conferência (PDFs antigos iguais)')
ok(linhas({ ...ev, url_verificacao: 'https://x.com/verificar/contrato?c=AB12CD34EF56' }).includes('Confira a autenticidade em: https://x.com/verificar/contrato?c=AB12CD34EF56'), 'PDF traz o link da conferência')
const serv = semComentario(ler('src/lib/contratos/pdfAssinadoServidor.ts'))
ok(/url_verificacao:\s*origem\s*\?\s*linkVerificacao\(/.test(serv), 'servidor monta o link a partir da origem')
for (const r of ['src/app/api/contratos/assinatura/publico/route.ts', 'src/app/api/contratos/assinatura/pdf/route.ts']) {
  ok(/gerarEArquivarPdfAssinado\([^)]*new URL\(req\.url\)\.origin\)/.test(semComentario(ler(r))), `${r} passa a origem para o PDF`)
}

// rota pública
const rota = semComentario(ler('src/app/api/contratos/assinatura/verificar/route.ts'))
ok(/rateLimit\(`verificar-contrato:\$\{ip\}`/.test(rota), 'rota com limite por IP')
ok(/normalizarConsulta\(body\.consulta\)/.test(rota) && /if \(!q\) return erro/.test(rota), 'rota recusa formato inválido antes do banco')
ok(/rpc\('fn_contrato_assinatura_verificar', \{ p_codigo_ou_hash: q\.valor \}\)/.test(rota), 'rota só manda o valor normalizado')
ok(!/exigirLogin/.test(rota), 'rota é pública (sem login)')

// página pública
const pag = semComentario(ler('src/app/verificar/contrato/page.tsx'))
ok(/crypto\.subtle\.digest\('SHA-256'/.test(pag), 'página calcula o hash no navegador')
ok(!/FormData|multipart|storage\.from/.test(pag), 'arquivo não sobe para o servidor')
ok(/\/api\/contratos\/assinatura\/verificar/.test(pag) && !/supabase/i.test(pag), 'página só fala com a rota do servidor')
ok(/<Suspense/.test(pag), 'useSearchParams dentro de Suspense')

// migration
const mig = readdirSync('supabase/migrations').find((f) => f.endsWith('_contrato_assinatura_verificar_publico.sql'))
ok(!!mig, 'migration da etapa 4 existe')
if (mig) {
  const sql = semComentario(ler(`supabase/migrations/${mig}`))
  ok(/documento_assinado_hash = v_q/.test(sql), 'aceita o hash do PDF assinado')
  ok(/REVOKE EXECUTE ON FUNCTION public\.fn_contrato_assinatura_verificar\(text\) FROM anon, public, authenticated/.test(sql)
    && /GRANT EXECUTE ON FUNCTION public\.fn_contrato_assinatura_verificar\(text\) TO service_role;/.test(sql)
    && !/TO (anon|authenticated|public)/i.test(sql.replace(/FROM anon, public, authenticated/g, '')), 'função só service_role')
  ok(!/'(documento|email|telefone|ip|assinatura_ip|user_agent|geolocalizacao|empresa|contrato_nome)',/.test(sql), 'resposta sem CPF/e-mail/IP/aparelho/localização (LGPD)')
  ok(!/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i.test(sql), 'migration sem DROP/DELETE/UPDATE')
  ok(/ci-sem-guarda: fn_contrato_assinatura_verificar/.test(ler(`supabase/migrations/${mig}`)), 'marcada ci-sem-guarda')
}

if (falhas) { console.error(`\n[check-contrato-assinatura-verificar] ${falhas} falha(s).`); process.exit(1) }
console.log('\n[check-contrato-assinatura-verificar] conferência pública conferida.')
