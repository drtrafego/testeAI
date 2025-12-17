'use server';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AGENT ACTIONS - Server Actions para CRUD de agentes
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { db } from '@/lib/db';
import { agents } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

// Schema de validação para criação de agente
const createAgentSchema = z.object({
    userId: z.string().uuid(),
    name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(255),
    description: z.string().optional(),
    systemPrompt: z.string().min(10, 'System Prompt deve ter pelo menos 10 caracteres'),
    modelConfig: z.object({
        model: z.enum([
            'gpt-4o',
            'gpt-4o-mini',
            'gpt-4-turbo',
            'claude-3-5-sonnet-20241022',
            'claude-3-haiku-20240307',
            'gemini-2.0-flash',
            'gemini-2.0-pro',
            'gemini-3-0-pro',
        ]),
        provider: z.enum(['openai', 'anthropic', 'google']).optional(),
        temperature: z.number().min(0).max(1),
        maxTokens: z.number().min(100).max(8192),
    }).optional(),
    enabledTools: z.array(z.string()).optional(),
});

// Schema de validação para atualização
const updateAgentSchema = createAgentSchema.partial().extend({
    id: z.string().uuid(),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

/**
 * Cria um novo agente
 */
export async function createAgentAction(input: CreateAgentInput) {
    try {
        // Validação
        const validated = createAgentSchema.parse(input);

        // Inserção
        const [newAgent] = await db
            .insert(agents)
            .values({
                userId: validated.userId,
                name: validated.name,
                description: validated.description || null,
                systemPrompt: validated.systemPrompt,
                modelConfig: validated.modelConfig || {
                    model: 'gpt-4o-mini',
                    temperature: 0.7,
                    maxTokens: 1024,
                },
                enabledTools: validated.enabledTools || [],
                isActive: false,
                isDefault: false,
            })
            .returning();

        // Revalidar cache
        revalidatePath('/dashboard/agents');

        return { success: true, agent: newAgent };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: 'Dados inválidos',
                details: error.errors,
            };
        }
        console.error('[createAgentAction]', error);
        return { success: false, error: 'Erro ao criar agente' };
    }
}

/**
 * Atualiza um agente existente
 */
export async function updateAgentAction(input: UpdateAgentInput) {
    try {
        // Validação
        const validated = updateAgentSchema.parse(input);
        const { id, ...updateData } = validated;

        // Atualização
        const [updatedAgent] = await db
            .update(agents)
            .set({
                ...updateData,
                updatedAt: new Date(),
            })
            .where(eq(agents.id, id))
            .returning();

        if (!updatedAgent) {
            return { success: false, error: 'Agente não encontrado' };
        }

        // Revalidar cache
        revalidatePath('/dashboard/agents');
        revalidatePath(`/dashboard/agents/${id}`);

        return { success: true, agent: updatedAgent };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: 'Dados inválidos',
                details: error.errors,
            };
        }
        console.error('[updateAgentAction]', error);
        return { success: false, error: 'Erro ao atualizar agente' };
    }
}

/**
 * Deleta um agente
 */
export async function deleteAgentAction(agentId: string) {
    try {
        const [deleted] = await db
            .delete(agents)
            .where(eq(agents.id, agentId))
            .returning();

        if (!deleted) {
            return { success: false, error: 'Agente não encontrado' };
        }

        // Revalidar cache
        revalidatePath('/dashboard/agents');

        return { success: true };
    } catch (error) {
        console.error('[deleteAgentAction]', error);
        return { success: false, error: 'Erro ao deletar agente' };
    }
}

/**
 * Alterna o status ativo/inativo de um agente
 */
export async function toggleAgentStatusAction(agentId: string) {
    try {
        // Buscar status atual
        const [currentAgent] = await db
            .select({ isActive: agents.isActive })
            .from(agents)
            .where(eq(agents.id, agentId));

        if (!currentAgent) {
            return { success: false, error: 'Agente não encontrado' };
        }

        // Inverter status
        const [updated] = await db
            .update(agents)
            .set({
                isActive: !currentAgent.isActive,
                updatedAt: new Date(),
            })
            .where(eq(agents.id, agentId))
            .returning();

        if (!updated) {
            return { success: false, error: 'Erro ao alterar status' };
        }

        // Revalidar cache
        revalidatePath('/dashboard/agents');

        return { success: true, isActive: updated.isActive };
    } catch (error) {
        console.error('[toggleAgentStatusAction]', error);
        return { success: false, error: 'Erro ao alterar status' };
    }
}

/**
 * Define um agente como padrão
 */
export async function setDefaultAgentAction(userId: string, agentId: string) {
    try {
        // Remover flag de padrão de todos os agentes do usuário
        await db
            .update(agents)
            .set({ isDefault: false })
            .where(eq(agents.userId, userId));

        // Definir o novo agente como padrão
        const [updated] = await db
            .update(agents)
            .set({
                isDefault: true,
                isActive: true, // Também ativa o agente
                updatedAt: new Date(),
            })
            .where(
                and(
                    eq(agents.id, agentId),
                    eq(agents.userId, userId)
                )
            )
            .returning();

        if (!updated) {
            return { success: false, error: 'Agente não encontrado' };
        }

        // Revalidar cache
        revalidatePath('/dashboard/agents');

        return { success: true, agent: updated };
    } catch (error) {
        console.error('[setDefaultAgentAction]', error);
        return { success: false, error: 'Erro ao definir agente padrão' };
    }
}

/**
 * Atualiza apenas o System Prompt
 */
export async function updateSystemPromptAction(agentId: string, systemPrompt: string) {
    try {
        if (systemPrompt.length < 10) {
            return { success: false, error: 'System Prompt deve ter pelo menos 10 caracteres' };
        }

        const [updated] = await db
            .update(agents)
            .set({
                systemPrompt,
                updatedAt: new Date(),
            })
            .where(eq(agents.id, agentId))
            .returning();

        if (!updated) {
            return { success: false, error: 'Agente não encontrado' };
        }

        // Revalidar cache
        revalidatePath(`/dashboard/agents/${agentId}`);

        return { success: true, agent: updated };
    } catch (error) {
        console.error('[updateSystemPromptAction]', error);
        return { success: false, error: 'Erro ao atualizar System Prompt' };
    }
}
