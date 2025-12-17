'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ANALYTICS PAGE - Métricas e insights do sistema
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect } from 'react';
import { Header, PageWrapper, PageSection } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    MessageSquare,
    Users,
    Calendar,
    Clock,
    TrendingUp,
    TrendingDown,
    BarChart3,
} from 'lucide-react';

interface AnalyticsData {
    totalConversations: number;
    activeConversations: number;
    qualifiedLeads: number;
    scheduledMeetings: number;
    avgResponseTime: number; // em segundos
    todayConversations: number;
    weeklyGrowth: {
        conversations: number;
        leads: number;
        meetings: number;
    };
}

export default function AnalyticsPage() {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadAnalytics() {
            try {
                const res = await fetch('/api/analytics');
                if (res.ok) {
                    const analytics = await res.json();
                    setData(analytics);
                }
            } catch (error) {
                console.error('Erro ao carregar analytics:', error);
            } finally {
                setLoading(false);
            }
        }

        loadAnalytics();
    }, []);

    const formatTime = (seconds: number) => {
        if (seconds < 60) return `${seconds}s`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
    };

    const formatGrowth = (value: number) => {
        const isPositive = value >= 0;
        return {
            text: `${isPositive ? '+' : ''}${value}%`,
            color: isPositive ? 'text-emerald-600' : 'text-red-600',
            icon: isPositive ? TrendingUp : TrendingDown,
        };
    };

    return (
        <PageWrapper>
            <Header
                title="Analytics"
                description="Métricas e insights do seu atendimento"
            />

            <PageSection>
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        {[...Array(4)].map((_, i) => (
                            <Card key={i} className="animate-pulse">
                                <CardHeader className="pb-2">
                                    <div className="h-4 bg-slate-200 rounded w-24" />
                                </CardHeader>
                                <CardContent>
                                    <div className="h-8 bg-slate-200 rounded w-16" />
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                ) : data ? (
                    <div className="space-y-6">
                        {/* Métricas Principais */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {/* Total Conversas */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <CardTitle className="text-sm font-medium text-slate-600">
                                        Total de Conversas
                                    </CardTitle>
                                    <MessageSquare className="h-4 w-4 text-blue-500" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-slate-900">
                                        {data.totalConversations}
                                    </div>
                                    <div className="flex items-center gap-1 mt-1">
                                        {(() => {
                                            const growth = formatGrowth(data.weeklyGrowth.conversations);
                                            const Icon = growth.icon;
                                            return (
                                                <>
                                                    <Icon className={`h-3 w-3 ${growth.color}`} />
                                                    <span className={`text-xs ${growth.color}`}>
                                                        {growth.text} esta semana
                                                    </span>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Leads Qualificados */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <CardTitle className="text-sm font-medium text-slate-600">
                                        Leads Qualificados
                                    </CardTitle>
                                    <Users className="h-4 w-4 text-violet-500" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-slate-900">
                                        {data.qualifiedLeads}
                                    </div>
                                    <div className="flex items-center gap-1 mt-1">
                                        {(() => {
                                            const growth = formatGrowth(data.weeklyGrowth.leads);
                                            const Icon = growth.icon;
                                            return (
                                                <>
                                                    <Icon className={`h-3 w-3 ${growth.color}`} />
                                                    <span className={`text-xs ${growth.color}`}>
                                                        {growth.text} esta semana
                                                    </span>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Reuniões Agendadas */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <CardTitle className="text-sm font-medium text-slate-600">
                                        Reuniões Agendadas
                                    </CardTitle>
                                    <Calendar className="h-4 w-4 text-emerald-500" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-slate-900">
                                        {data.scheduledMeetings}
                                    </div>
                                    <div className="flex items-center gap-1 mt-1">
                                        {(() => {
                                            const growth = formatGrowth(data.weeklyGrowth.meetings);
                                            const Icon = growth.icon;
                                            return (
                                                <>
                                                    <Icon className={`h-3 w-3 ${growth.color}`} />
                                                    <span className={`text-xs ${growth.color}`}>
                                                        {growth.text} esta semana
                                                    </span>
                                                </>
                                            );
                                        })()}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Tempo Médio de Resposta */}
                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between pb-2">
                                    <CardTitle className="text-sm font-medium text-slate-600">
                                        Tempo Médio Resposta
                                    </CardTitle>
                                    <Clock className="h-4 w-4 text-amber-500" />
                                </CardHeader>
                                <CardContent>
                                    <div className="text-2xl font-bold text-slate-900">
                                        {formatTime(data.avgResponseTime)}
                                    </div>
                                    <div className="text-xs text-slate-500 mt-1">
                                        {data.activeConversations} conversas ativas
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* Gráfico Placeholder */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <BarChart3 className="h-5 w-5 text-blue-500" />
                                    Tendência Semanal
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="h-64 flex items-center justify-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-200">
                                    <div className="text-center text-slate-500">
                                        <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                        <p className="text-sm">Gráfico de tendência</p>
                                        <p className="text-xs">Em desenvolvimento</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Conversas de Hoje */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Resumo de Hoje</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                                        <div className="text-2xl font-bold text-blue-600">
                                            {data.todayConversations}
                                        </div>
                                        <div className="text-xs text-blue-600">
                                            Novas conversas
                                        </div>
                                    </div>
                                    <div className="text-center p-4 bg-violet-50 rounded-lg">
                                        <div className="text-2xl font-bold text-violet-600">
                                            {data.activeConversations}
                                        </div>
                                        <div className="text-xs text-violet-600">
                                            Conversas ativas
                                        </div>
                                    </div>
                                    <div className="text-center p-4 bg-emerald-50 rounded-lg">
                                        <div className="text-2xl font-bold text-emerald-600">
                                            {data.qualifiedLeads}
                                        </div>
                                        <div className="text-xs text-emerald-600">
                                            Leads qualificados
                                        </div>
                                    </div>
                                    <div className="text-center p-4 bg-amber-50 rounded-lg">
                                        <div className="text-2xl font-bold text-amber-600">
                                            {data.scheduledMeetings}
                                        </div>
                                        <div className="text-xs text-amber-600">
                                            Agendamentos
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                ) : (
                    <div className="text-center py-12">
                        <BarChart3 className="h-12 w-12 mx-auto mb-4 text-slate-300" />
                        <p className="text-slate-500">Não foi possível carregar os analytics</p>
                    </div>
                )}
            </PageSection>
        </PageWrapper>
    );
}
