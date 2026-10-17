// Gate (Eng. Chefe 17/10) — a #2796 trocou a assinatura de fn_os_criar (DROP+CREATE do mesmo nome) e o restaurar da vaga
// saía com exit 2 "recriar". Agora FUNÇÃO sumida é recriada do DDL da foto (como a função modificada); view/tabela/tipo
// sumidos continuam exigindo recriar. Infra de teste apenas (sem produção).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const sh = readFileSync('scripts/banco-testes/vaga-snapshot.sh', 'utf8')

// caso 1: função sumida NÃO cai em recriar — é separada e recriada da foto
ok(/grep '\^func ' "\$dir\/sumiu\.keys"/.test(sh) && /sumiu\.func/.test(sh), 'sumiu.keys separa as chaves "func " das demais')
ok(/2b\) FUN[ÇC][ÕO]ES que a PR dropou/.test(sh) && /from _vaga_snapshot\.fndef where sig = /.test(sh), 'função sumida é recriada a partir do DDL da foto (fndef)')
ok(/revoke all on function/.test(sh) && /_vaga_snapshot\.fndef/.test(sh) && /grants/.test(sh), 'os grants da função sumida voltam como na foto')
ok(/sem definição da foto p\/ função sumida/.test(sh), 'função sumida sem DDL na foto ainda exige recriar')

// caso 2: tabela/view/tipo sumidos continuam exigindo recriar
const trecho = sh.slice(sh.indexOf('sumiu.outros"'), sh.indexOf('if grep -qvE'))
ok(/-s "\$dir\/sumiu\.outros"/.test(trecho) && /recriar "a PR fez DROP\/rename de objeto aprovado/.test(trecho), 'objeto não-função sumido (tabela/view/tipo) ainda exige recriar')
ok(!/-s "\$dir\/sumiu\.keys"/.test(sh), 'não há mais recriar incondicional para qualquer chave sumida')

// a verificação (assinatura + ledger == foto) continua obrigatória
ok(/raise exception 'vaga-snapshot: vaga nao voltou a foto/.test(sh), 'verify-before-commit mantido')
ok(!/PROD_DATABASE_URL/.test(sh), 'Pilar 2 intacto: sem segredo de produção')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-vaga-snapshot-funcao-sumida: OK')
