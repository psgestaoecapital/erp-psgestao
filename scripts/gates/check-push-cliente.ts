// Gate (chamado #120): o cliente assina via PushManager, grava no banco, tem toggle e orientação iOS. Estático.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const lib = readFileSync('src/lib/push/cliente.ts', 'utf8')
const cmp = readFileSync('src/components/push/NotificacaoCelular.tsx', 'utf8')

ok(/pushManager\.subscribe\(/.test(lib) && /userVisibleOnly: true/.test(lib), 'assina via PushManager (userVisibleOnly)')
ok(/NEXT_PUBLIC_VAPID_PUBLIC_KEY/.test(lib) && !/VAPID_PRIVATE/.test(lib), 'só a chave pública no cliente')
ok(/erp_push_assinatura/.test(lib) && /\.delete\(\)/.test(lib), 'grava e remove a assinatura do aparelho')
ok(/ehIos\(\)/.test(lib) && /ios_instalar/.test(lib), 'iOS fora da tela de início recebe orientação')
ok(/Adicionar à Tela de Início/.test(cmp), 'passo a passo do iOS no cartão')
ok(/AjudaCampo/.test(cmp), '"?" nos controles (RD-95)')
const menu = readFileSync('supabase/migrations/20261017210030_push_celular_menu.sql', 'utf8')
ok(/module_catalog/.test(menu) && /system_screens/.test(menu) && /notificacoes-celular/.test(menu), 'tela no menu e em system_screens')
if (falhas) process.exit(1)
