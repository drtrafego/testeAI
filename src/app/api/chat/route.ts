import { StageMachine } from '@/server/engine/stage-machine';
import { db } from '@/lib/db';
import { agents, threads, messages } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

const stageMachine = new StageMachine();

export async function POST(req: Request) {
    try {
        const { message, agentId, threadId: initialThreadId } = await req.json();

        // 1. Validar Agente
        const agent = await db.query.agents.findFirst({
            where: eq(agents.id, agentId)
        });

        if (!agent) {
            return NextResponse.json({ error: 'Agente não encontrado' }, { status: 404 });
        }

        // 2. Garantir Thread
        let currentThreadId = initialThreadId;
        if (!currentThreadId) {
            const [newThread] = await db.insert(threads).values({
                agentId,
                userId: agent.userId,
                externalId: `web_test_${Date.now()}`, // Identificador temporário para teste web
                contactName: 'Teste Web',
                status: 'active',
            }).returning();

            if (!newThread) {
                return NextResponse.json({ error: 'Falha ao criar thread' }, { status: 500 });
            }
            currentThreadId = newThread.id;
        }

        // 3. Salvar mensagem do usuário no banco
        await db.insert(messages).values({
            threadId: currentThreadId,
            role: 'user',
            content: message,
            isFromWebhook: false,
        });

        // 4. Atualizar última interação da thread
        await db.update(threads)
            .set({
                lastInteractionAt: new Date(),
                messageCount: await getMessageCount(currentThreadId) + 1,
            })
            .where(eq(threads.id, currentThreadId));

        // 5. Processar mensagem na Stage Machine
        const responseText = await stageMachine.processMessage(
            agent.userId,
            agentId,
            currentThreadId,
            message
        );

        // 6. Salvar resposta do agente no banco
        await db.insert(messages).values({
            threadId: currentThreadId,
            role: 'assistant',
            content: responseText,
            isFromWebhook: false,
            metadata: {
                model: agent.modelConfig?.model || 'gpt-4o-mini',
            },
        });

        // 7. Atualizar contagem de mensagens novamente
        await db.update(threads)
            .set({
                messageCount: await getMessageCount(currentThreadId),
            })
            .where(eq(threads.id, currentThreadId));

        return NextResponse.json({
            response: responseText,
            threadId: currentThreadId
        });

    } catch (error) {
        console.error('Chat API Error:', error);
        return NextResponse.json(
            { error: 'Erro ao processar mensagem', details: String(error) },
            { status: 500 }
        );
    }
}

/**
 * Helper to count messages in a thread
 */
async function getMessageCount(threadId: string): Promise<number> {
    const result = await db
        .select()
        .from(messages)
        .where(eq(messages.threadId, threadId));
    return result.length;
}
