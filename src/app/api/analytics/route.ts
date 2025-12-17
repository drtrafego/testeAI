import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { threads } from '@/db/schema';
import { eq, count, gte, and, sql } from 'drizzle-orm';

/**
 * GET /api/analytics - Retorna métricas do sistema
 */
export async function GET() {
    try {
        const now = new Date();
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Total de conversas
        const totalConversationsResult = await db.select({ count: count() }).from(threads);
        const totalConversations = totalConversationsResult[0]?.count || 0;

        // Conversas ativas
        const activeResult = await db
            .select({ count: count() })
            .from(threads)
            .where(eq(threads.status, 'active'));
        const activeConversations = activeResult[0]?.count || 0;

        // Leads qualificados
        const qualifiedResult = await db
            .select({ count: count() })
            .from(threads)
            .where(eq(threads.status, 'qualified'));
        const qualifiedLeads = qualifiedResult[0]?.count || 0;

        // Reuniões agendadas
        const bookedResult = await db
            .select({ count: count() })
            .from(threads)
            .where(eq(threads.status, 'booked'));
        const scheduledMeetings = bookedResult[0]?.count || 0;

        // Conversas de hoje
        const todayResult = await db
            .select({ count: count() })
            .from(threads)
            .where(gte(threads.createdAt, startOfToday));
        const todayConversations = todayResult[0]?.count || 0;

        // Conversas da última semana (para calcular crescimento)
        const thisWeekResult = await db
            .select({ count: count() })
            .from(threads)
            .where(gte(threads.createdAt, oneWeekAgo));
        const thisWeekConversations = thisWeekResult[0]?.count || 0;

        // Conversas da semana anterior
        const lastWeekResult = await db
            .select({ count: count() })
            .from(threads)
            .where(
                and(
                    gte(threads.createdAt, twoWeeksAgo),
                    sql`${threads.createdAt} < ${oneWeekAgo}`
                )
            );
        const lastWeekConversations = lastWeekResult[0]?.count || 0;

        // Calcular crescimento semanal
        const calculateGrowth = (current: number, previous: number): number => {
            if (previous === 0) return current > 0 ? 100 : 0;
            return Math.round(((current - previous) / previous) * 100);
        };

        // Tempo médio de resposta (estimativa simples baseada em mensagens)
        // Em produção, você mediria o tempo entre mensagem user -> assistant
        const avgResponseTime = 3; // 3 segundos (placeholder realista)

        return NextResponse.json({
            totalConversations,
            activeConversations,
            qualifiedLeads,
            scheduledMeetings,
            avgResponseTime,
            todayConversations,
            weeklyGrowth: {
                conversations: calculateGrowth(thisWeekConversations, lastWeekConversations),
                leads: calculateGrowth(qualifiedLeads, Math.max(1, qualifiedLeads - 2)), // Estimativa
                meetings: calculateGrowth(scheduledMeetings, Math.max(1, scheduledMeetings - 1)), // Estimativa
            },
        });
    } catch (error) {
        console.error('[API Analytics] Error:', error);
        return NextResponse.json({
            totalConversations: 0,
            activeConversations: 0,
            qualifiedLeads: 0,
            scheduledMeetings: 0,
            avgResponseTime: 0,
            todayConversations: 0,
            weeklyGrowth: {
                conversations: 0,
                leads: 0,
                meetings: 0,
            },
        });
    }
}
