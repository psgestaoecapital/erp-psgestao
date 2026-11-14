// Gate (#5661) — certificado A1 vencido é derivado da data (não depende do status do banco) e bloqueia a emissão.
import { readFileSync } from 'node:fs'
import { situacaoCertificado } from '../../src/lib/fiscal/certificadoValidade'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const hoje = new Date(2026, 9, 30, 12)
ok(situacaoCertificado('2026-10-07', hoje).estado === 'vencido', 'validade passada => vencido (Alliance)')
ok(situacaoCertificado('2026-10-07', hoje).mensagem?.includes('07/10/2026') === true, 'mensagem cita a data')
ok(situacaoCertificado('2026-11-24', hoje).estado === 'vence_em_breve', 'vence em 25 dias => aviso (Vianz)')
ok(situacaoCertificado('2026-10-30', hoje).estado === 'vence_em_breve', 'vence hoje => ainda válido, com aviso')
ok(situacaoCertificado('2027-10-30', hoje).estado === 'valido', 'longe do fim => válido')
ok(situacaoCertificado(null, hoje).estado === 'sem_data', 'sem data => sem_data')
const svc = readFileSync('src/lib/fiscal/service.ts', 'utf8')
ok(/situacaoCertificado\(/.test(svc) && /CERTIFICADO_EXPIRADO/.test(svc), 'service bloqueia emissão com certificado vencido')
const ui = readFileSync('src/app/dashboard/configuracoes/fiscal/FiscalConfigClient.tsx', 'utf8')
ok(/situacaoCertificado\(cert\.validade_fim\)\.estado !== 'vencido'/.test(ui), 'checklist fiscal fica pendente com certificado vencido')
ok(/aviso-validade-certificado/.test(ui), 'tela mostra o aviso de validade')
if (falhas) process.exit(1)
