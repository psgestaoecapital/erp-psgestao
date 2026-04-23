// PS Gestão ERP — Registry de conectores. Importar este módulo (efeito
// colateral) garante que todos os adapters disponíveis estão registrados
// antes de qualquer chamada a getConnector().

import { register } from './base'
import { OmieConnector } from './omie'

register('omie', (ctx) => new OmieConnector(ctx))
