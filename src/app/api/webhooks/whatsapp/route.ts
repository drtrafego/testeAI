/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHATSAPP WEBHOOK - Endpoint principal para receber mensagens
 * ─────────────────────────────────────────────────────────────────────────────
 * 
 * Rota: /api/webhooks/whatsapp
 * 
 * Este webhook recebe mensagens da Meta API e processa com o agente de IA.
 * 
 * Fluxo:
 * 1. Validação do Webhook (assinatura)
 * 2. Identificação/Criação da Thread
 * 3. Acumulação de mensagens rápidas (debounce)
 * 4. RAG - Injeção de Knowledge Base
 * 5. Processamento com IA (generateText + tools)
 * 6. Persistência da resposta
 * 7. Envio para WhatsApp
 */

import { NextRequest, NextResponse } from 'next/server';
import {
    verifyWebhookSignature,
    extractMessagesFromPayload,
    sendWhatsAppMessage,
    markMessageAsRead,
    isWebhookVerification,
    handleWebhookVerification,
    type WhatsAppWebhookPayload,
} from '@/server/services/meta-whatsapp.service';
import { getOrCreateThreadAction } from '@/server/actions/thread.actions';
import { getDefaultAgent } from '@/server/queries/agent.queries';
import { StageMachine } from '@/server/engine/stage-machine';
import { FALLBACK_RESPONSE } from '@/lib/ai';

// ID do usuário padrão (em produção, seria dinâmico baseado no número de telefone)
// TODO: Implementar multi-tenancy
const DEFAULT_USER_ID = process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000000';

// Instância do StageMachine (mesma usada pelo frontend)
const stageMachine = new StageMachine();

// ═══════════════════════════════════════════════════════════════════════════
// SISTEMA DE BUFFER PARA MENSAGENS RÁPIDAS
// ═══════════════════════════════════════════════════════════════════════════

interface MessageBuffer {
    messages: string[];
    lastMessageTime: number;
    timeout: NodeJS.Timeout | null;
    isProcessing: boolean;
}

// Buffer por número de telefone (in-memory, funciona para single server)
const messageBuffers = new Map<string, MessageBuffer>();

// Tempo de espera para acumular mensagens (ms)
const MESSAGE_BUFFER_DELAY = 2250; // 2.25 segundos

/**
 * Processa mensagens acumuladas de um usuário
 */
async function processBufferedMessages(phoneNumber: string) {
    const buffer = messageBuffers.get(phoneNumber);
    if (!buffer || buffer.messages.length === 0 || buffer.isProcessing) {
        return;
    }

    buffer.isProcessing = true;

    // Juntar todas as mensagens em uma só
    const combinedMessage = buffer.messages.join(' ');
    const messages = [...buffer.messages]; // Cópia para log

    // Limpar buffer
    buffer.messages = [];
    buffer.timeout = null;

    console.log(`[Webhook] 📥 Processando ${messages.length} mensagens acumuladas de ${phoneNumber}: "${combinedMessage.substring(0, 100)}..."`);

    try {
        // 1. Buscar agente padrão
        const agent = await getDefaultAgent(DEFAULT_USER_ID);

        if (!agent) {
            console.error('[Webhook] Nenhum agente configurado');
            await sendWhatsAppMessage({
                to: phoneNumber,
                message: 'Desculpe, nosso assistente está temporariamente indisponível. Tente novamente mais tarde.',
            });
            buffer.isProcessing = false;
            return;
        }

        // 2. Criar/buscar thread
        const threadResult = await getOrCreateThreadAction(
            DEFAULT_USER_ID,
            agent.id,
            phoneNumber,
            phoneNumber // Nome será atualizado depois
        );

        if (!threadResult.success || !threadResult.thread) {
            console.error('[Webhook] Erro ao criar thread');
            buffer.isProcessing = false;
            return;
        }

        const thread = threadResult.thread;

        // 3. Processar com StageMachine (mensagem combinada)
        const responseText = await stageMachine.processMessage(
            DEFAULT_USER_ID,
            agent.id,
            thread.id,
            combinedMessage
        );

        // 4. Enviar resposta para WhatsApp
        const sendResult = await sendWhatsAppMessage({
            to: phoneNumber,
            message: responseText,
        });

        if (!sendResult.success) {
            console.error('[Webhook] Erro ao enviar resposta:', sendResult.error);
        }

    } catch (error) {
        console.error('[Webhook] Erro no processamento:', error);

        // Tentar enviar mensagem de fallback
        await sendWhatsAppMessage({
            to: phoneNumber,
            message: FALLBACK_RESPONSE,
        });
    } finally {
        buffer.isProcessing = false;
    }
}

/**
 * Adiciona mensagem ao buffer e agenda processamento
 */
function addToBuffer(phoneNumber: string, text: string, messageId: string) {
    let buffer = messageBuffers.get(phoneNumber);

    if (!buffer) {
        buffer = {
            messages: [],
            lastMessageTime: Date.now(),
            timeout: null,
            isProcessing: false
        };
        messageBuffers.set(phoneNumber, buffer);
    }

    // Adicionar mensagem ao buffer
    buffer.messages.push(text);
    buffer.lastMessageTime = Date.now();

    // Marcar como lida
    markMessageAsRead(messageId).catch(console.error);

    // Cancelar timeout anterior
    if (buffer.timeout) {
        clearTimeout(buffer.timeout);
    }

    // Agendar processamento após delay
    buffer.timeout = setTimeout(() => {
        processBufferedMessages(phoneNumber);
    }, MESSAGE_BUFFER_DELAY);

    console.log(`[Webhook] 📨 Mensagem adicionada ao buffer de ${phoneNumber} (total: ${buffer.messages.length})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET - Verificação do Webhook (Challenge)
 */
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;

    if (isWebhookVerification(searchParams)) {
        const result = handleWebhookVerification(searchParams);

        if (result.verified) {
            console.log('[Webhook] Verificação bem-sucedida');
            return new NextResponse(result.challenge, { status: 200 });
        }

        console.error('[Webhook] Verificação falhou');
        return new NextResponse('Forbidden', { status: 403 });
    }

    return new NextResponse('OK', { status: 200 });
}

/**
 * POST - Receber mensagens
 */
export async function POST(request: NextRequest) {
    const startTime = Date.now();

    try {
        // 1. Ler e validar payload
        const rawBody = await request.text();
        const signature = request.headers.get('x-hub-signature-256');

        // Validar assinatura (desabilitar em desenvolvimento se necessário)
        if (process.env.NODE_ENV === 'production' && signature) {
            if (!verifyWebhookSignature(rawBody, signature)) {
                console.error('[Webhook] Assinatura inválida');
                return new NextResponse('Unauthorized', { status: 401 });
            }
        }

        const payload: WhatsAppWebhookPayload = JSON.parse(rawBody);

        // 2. Extrair mensagens de texto
        const incomingMessages = extractMessagesFromPayload(payload);

        if (incomingMessages.length === 0) {
            // Pode ser um status update ou outro tipo de evento
            return new NextResponse('OK', { status: 200 });
        }

        // 3. Adicionar mensagens ao buffer (com debounce)
        for (const incoming of incomingMessages) {
            addToBuffer(incoming.from, incoming.text, incoming.messageId);
        }

        console.log(`[Webhook] Mensagens recebidas em ${Date.now() - startTime}ms`);
        return new NextResponse('OK', { status: 200 });

    } catch (error) {
        console.error('[Webhook] Erro:', error);
        // Retornar 200 para evitar retry infinito da Meta
        return new NextResponse('OK', { status: 200 });
    }
}
