// Gate #88 (FC, CEO 29/09): (1) o teste de conexão que falha mostra o que fazer (catálogo), não o erro cru;
// (2) "Sincronizar extrato" só aparece para banco com conector de extrato por API (hoje só Sicoob).
// Roda no build (package.json). Sem rede, sem banco.
import { readFileSync } from 'node:fs'
import { acharErroCatalogo, textoErroCatalogo, type ErroCatalogo } from '../../src/lib/banco/erroCatalogo'
import { temConectorExtrato, EXTRATO_COM_CONECTOR } from '../../src/lib/banco/extratoConector'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const CAT: ErroCatalogo[] = [
  { provider: 'sicredi', codigo: '401_x_api_key', titulo: 'Access Token ausente ou inválido', o_que_e: '', o_que_fazer: 'Confirme o token de PRODUÇÃO.', quem_contatar: null },
  { provider: 'sicredi', codigo: '401_invalid_user_credentials', titulo: 'Usuário ou Código de Acesso inválidos', o_que_e: '',
    o_que_fazer: 'Se persistir, gere novo Código de Acesso.', quem_contatar: 'Usuário Master', pedir_ao_banco: 'Regerar Código de Acesso em Cobrança >> Código de Acesso >> Gerar' },
]

// o erro REAL gravado para a FC em erp_banco_teste_conexao (24–25/09)
const erroFC = 'Sicredi auth falhou: 401 {"error":"invalid_grant","error_description":"Invalid user credentials"}'
const achado = acharErroCatalogo(erroFC, CAT, 'sicredi')
ok(achado?.codigo === '401_invalid_user_credentials', 'erro 401 invalid_grant da FC → "Usuário ou Código de Acesso inválidos"')
const texto = achado ? textoErroCatalogo(achado) : ''
ok(/Código de Acesso inválidos/.test(texto) && /Cobrança >> Código de Acesso >> Gerar/.test(texto), 'a frase diz o que fazer e onde gerar o código')
ok(acharErroCatalogo('ECONNRESET socket hang up', CAT, 'sicredi') === null, 'erro não reconhecido ⇒ null (a tela mostra o erro cru, nunca uma linha errada)')
ok(acharErroCatalogo({ erro: 'invalid_grant' }, CAT, 'sicredi')?.codigo === '401_invalid_user_credentials', 'aceita detalhe em objeto (Assistente)')

// extrato: só com conector de verdade
ok(temConectorExtrato('sicoob'), 'Sicoob tem conector de extrato')
ok(!temConectorExtrato('sicredi') && !temConectorExtrato('bradesco') && !temConectorExtrato(null), 'Sicredi, Bradesco e vazio não têm')
for (const prov of ['sicredi', 'bradesco']) {
  const src = readFileSync(`src/lib/banco/extrato/${prov}.ts`, 'utf8')
  ok(!(src.includes('extrato_nao_habilitado') && EXTRATO_COM_CONECTOR.includes(prov)), `${prov}: adapter ainda é fase 2 ⇒ fora da lista`)
}

// as telas usam o módulo (não voltam a oferecer o botão sem conector)
const conexoes = readFileSync('src/app/dashboard/financeiro/conexoes-bancarias/page.tsx', 'utf8')
ok(/temConectorExtrato\(cfg\.provider\) && \(\s*<button/.test(conexoes), 'Conexões: botão "Sincronizar extrato" só com conector')
ok(conexoes.includes('acharErroCatalogo(j.erro, catalogoErros, cfg.provider)'), 'Conexões: resultado do teste passa pelo catálogo')
const inbox = readFileSync('src/app/dashboard/financeiro/conciliacao/inbox/page.tsx', 'utf8')
ok(/\{temExtratoApi && \(\s*<button\s+onClick=\{sincronizarExtratoAgora\}/.test(inbox), 'Inbox: "Sincronizar extrato agora" só com conector')

if (falhas) { console.error(`\ncheck-sicredi-erro-claro: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-sicredi-erro-claro: ok')
