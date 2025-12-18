/**
 * WHATSAPP INSTANCE API - Criar/Listar instâncias
 * 
 * POST /api/whatsapp/instance - Criar nova instância
 * GET /api/whatsapp/instance - Listar instância
 */

import { NextRequest, NextResponse } from 'next/server';
import {
    createWhatsAppInstance,
    createMainWhatsAppInstance,
    getInstanceByAgentId,
    getMainInstance,
    startQRConnection,
    configureAPIOficial,
} from '@/server/services/whatsapp-manager';

/**
 * POST - Criar ou atualizar instância WhatsApp
 * Body: { agentId?, connectionType, credentials?, isMain?, userId? }
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { agentId, connectionType, credentials, isMain, userId } = body;

        // Validações
        const connType = connectionType || 'qr_code';
        if (!['api_oficial', 'qr_code'].includes(connType)) {
            return NextResponse.json({
                error: 'connectionType deve ser "api_oficial" ou "qr_code"'
            }, { status: 400 });
        }

        let result;

        if (isMain && userId) {
            // Criar instância principal (para userId)
            result = await createMainWhatsAppInstance(userId, connType);
        } else if (agentId) {
            // Criar instância para agente específico
            result = await createWhatsAppInstance(agentId, connType);
        } else {
            return NextResponse.json({
                error: 'Forneça agentId ou (isMain=true + userId)'
            }, { status: 400 });
        }

        if (!result.success) {
            return NextResponse.json({ error: result.error }, { status: 400 });
        }

        // Se for API Oficial e tiver credenciais, configurar
        if (connType === 'api_oficial' && credentials) {
            const configResult = await configureAPIOficial(result.instanceId!, credentials);
            if (!configResult.success) {
                return NextResponse.json({ error: configResult.error }, { status: 400 });
            }
        }

        // Se for QR Code, iniciar conexão automaticamente
        if (connType === 'qr_code') {
            const qrResult = await startQRConnection(result.instanceId!);
            if (!qrResult.success) {
                return NextResponse.json({
                    error: qrResult.error,
                    instanceId: result.instanceId
                }, { status: 400 });
            }
        }

        return NextResponse.json({
            success: true,
            instanceId: result.instanceId,
        });
    } catch (error) {
        console.error('[API WhatsApp Instance] Erro:', error);
        return NextResponse.json({
            error: 'Erro interno do servidor'
        }, { status: 500 });
    }
}

/**
 * GET - Obter instância WhatsApp
 * Query: agentId ou main=true&userId=xxx
 */
export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const agentId = searchParams.get('agentId');
        const isMain = searchParams.get('main') === 'true';
        const userId = searchParams.get('userId');

        let instance = null;

        if (isMain && userId) {
            // Buscar instância principal do usuário
            instance = await getMainInstance(userId);
        } else if (agentId) {
            // Buscar instância do agente
            instance = await getInstanceByAgentId(agentId);
        } else {
            return NextResponse.json({
                error: 'Forneça agentId ou (main=true&userId=xxx)'
            }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            instance,
        });
    } catch (error) {
        console.error('[API WhatsApp Instance] Erro:', error);
        return NextResponse.json({
            error: 'Erro interno do servidor'
        }, { status: 500 });
    }
}
