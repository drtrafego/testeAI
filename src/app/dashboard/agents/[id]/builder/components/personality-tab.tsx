'use client';

import { useBuilderStore } from '@/stores/builder-store';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { updateAgentAction } from '@/server/actions/agents';
import { useState } from 'react';
import { Loader2, Save, CheckCircle2 } from 'lucide-react';

export function PersonalityTab() {
    const { agent, updateAgent } = useBuilderStore();
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    if (!agent) return null;

    async function handleSave() {
        setIsSaving(true);
        setSaveSuccess(false);
        const result = await updateAgentAction(agent!.id, {
            name: agent!.name,
            description: agent!.description,
            systemPrompt: agent!.systemPrompt,
            tone: agent!.tone,
            personality: agent!.personality,
            companyProfile: agent!.companyProfile,
            displayName: agent!.displayName,
            useEmojis: agent!.useEmojis,
            language: agent!.language,
            modelConfig: agent!.modelConfig,
            isActive: agent!.isActive
        });
        setIsSaving(false);
        if (result.success) {
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        }
    }

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            {/* Success Banner */}
            {saveSuccess && (
                <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5" />
                    <span>Alterações salvas com sucesso!</span>
                </div>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Identidade do Agente</CardTitle>
                    <CardDescription>Defina como seu agente se apresenta para os usuários.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Nome Interno</Label>
                            <Input
                                value={agent.name}
                                onChange={(e) => updateAgent({ name: e.target.value })}
                                placeholder="Nome para identificação interna"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Nome de Exibição (Chat)</Label>
                            <Input
                                value={agent.displayName || ''}
                                onChange={(e) => updateAgent({ displayName: e.target.value })}
                                placeholder="Como o agente se apresenta no chat"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Tipo de Atendimento</Label>
                        <Select
                            value={agent.personality || 'atendimento'}
                            onValueChange={(v) => updateAgent({ personality: v })}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Escolha o foco do agente" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="atendimento">🎧 Atendimento ao Cliente</SelectItem>
                                <SelectItem value="vendas">💼 Vendas e Prospecção</SelectItem>
                                <SelectItem value="suporte">🛠️ Suporte Técnico</SelectItem>
                                <SelectItem value="agendamento">📅 Agendamento</SelectItem>
                                <SelectItem value="informativo">📚 Informativo (FAQ)</SelectItem>
                                <SelectItem value="custom">⚙️ Personalizado</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Tom de Voz</Label>
                            <Select
                                value={agent.tone || 'friendly'}
                                onValueChange={(v) => updateAgent({ tone: v })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="friendly">Amigável 😊</SelectItem>
                                    <SelectItem value="professional">Profissional 👔</SelectItem>
                                    <SelectItem value="enthusiastic">Entusiasta 🤩</SelectItem>
                                    <SelectItem value="serious">Sério 😐</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Idioma</Label>
                            <Select
                                value={agent.language || 'pt-BR'}
                                onValueChange={(v) => updateAgent({ language: v })}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="pt-BR">🇧🇷 Português (Brasil)</SelectItem>
                                    <SelectItem value="en-US">🇺🇸 English (US)</SelectItem>
                                    <SelectItem value="es-ES">🇪🇸 Español</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex items-center justify-between border p-4 rounded-lg">
                        <div className="space-y-0.5">
                            <Label>Usar Emojis</Label>
                            <p className="text-sm text-muted-foreground">Permite o uso de emojis nas respostas.</p>
                        </div>
                        <Switch
                            checked={agent.useEmojis ?? true}
                            onCheckedChange={(c) => updateAgent({ useEmojis: c })}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Descrição Interna</Label>
                        <Textarea
                            value={agent.description || ''}
                            onChange={(e) => updateAgent({ description: e.target.value })}
                            placeholder="Para que serve este agente? (não aparece no chat)"
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Contexto da Empresa</CardTitle>
                    <CardDescription>Informações sobre sua empresa que o agente utilizará.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>Perfil da Empresa</Label>
                        <Textarea
                            className="min-h-[120px]"
                            value={agent.companyProfile || ''}
                            onChange={(e) => updateAgent({ companyProfile: e.target.value })}
                            placeholder="Descreva sua empresa, produtos/serviços, diferenciais, etc. Essas informações serão usadas pelo agente para contextualizar as respostas."
                        />
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Comportamento (Prompt)</CardTitle>
                    <CardDescription>Instruções globais que o agente deve seguir sempre.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>System Prompt Global</Label>
                        <Textarea
                            className="min-h-[200px] font-mono text-sm"
                            value={agent.systemPrompt}
                            onChange={(e) => updateAgent({ systemPrompt: e.target.value })}
                        />
                        <p className="text-xs text-muted-foreground">
                            Este prompt será combinado com as instruções específicas de cada estágio.
                        </p>
                    </div>

                    <div className="flex items-center justify-between border p-4 rounded-lg bg-slate-50 dark:bg-slate-900">
                        <div className="space-y-0.5">
                            <Label>Agente Ativo</Label>
                            <p className="text-sm text-muted-foreground">Desative para impedir novas interações.</p>
                        </div>
                        <Switch
                            checked={agent.isActive}
                            onCheckedChange={(c) => updateAgent({ isActive: c })}
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={isSaving} size="lg">
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Salvar Alterações
                </Button>
            </div>
        </div>
    );
}
