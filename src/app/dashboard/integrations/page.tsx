'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Header, PageWrapper, PageSection } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, Button, Badge } from '@/components/ui';
import {
    Chrome,
    MessageCircle,
    Check,
    X,
    ExternalLink,
    RefreshCw,
    AlertCircle,
    CheckCircle,
    QrCode,
    Wifi,
    WifiOff,
    Loader2,
    Trash2,
} from 'lucide-react';
import { WhatsAppQRCode } from '@/components/integrations/WhatsAppQRCode';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGRATIONS PAGE - Conectar Google Calendar + WhatsApp Principal
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface WhatsAppInstanceInfo {
    id: string;
    agentId: string;
    connectionType: 'api_oficial' | 'qr_code';
    status: 'disconnected' | 'connecting' | 'connected' | 'error';
    phoneNumber?: string;
    profileName?: string;
    errorMessage?: string;
}

function IntegrationsContent() {
    const searchParams = useSearchParams();
    const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; email?: string } | null>(null);
    const [loading, setLoading] = useState(true);

    // WhatsApp Main Integration
    const [whatsappInstance, setWhatsappInstance] = useState<WhatsAppInstanceInfo | null>(null);
    const [whatsappLoading, setWhatsappLoading] = useState(true);
    const [showQRCode, setShowQRCode] = useState(false);

    // Buscar status real das integrações
    useEffect(() => {
        async function fetchStatus() {
            try {
                const res = await fetch('/api/integrations/status');
                if (res.ok) {
                    const data = await res.json();
                    setGoogleStatus(data.google);
                    // WhatsApp main instance seria data.whatsapp
                    if (data.whatsapp) {
                        setWhatsappInstance(data.whatsapp);
                    }
                } else {
                    setGoogleStatus({ connected: false });
                }
            } catch (error) {
                console.error('Erro ao buscar status:', error);
                setGoogleStatus({ connected: false });
            } finally {
                setLoading(false);
                setWhatsappLoading(false);
            }
        }
        fetchStatus();
    }, []);

    // Buscar instância WhatsApp principal (sem agentId = principal)
    const fetchMainWhatsAppInstance = useCallback(async () => {
        setWhatsappLoading(true);
        try {
            const res = await fetch('/api/whatsapp/instance?main=true');
            if (res.ok) {
                const data = await res.json();
                setWhatsappInstance(data.instance);
            }
        } catch (error) {
            console.error('Erro ao buscar instância WhatsApp:', error);
        } finally {
            setWhatsappLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchMainWhatsAppInstance();
    }, [fetchMainWhatsAppInstance]);

    // Verificar parâmetros de retorno do OAuth
    useEffect(() => {
        const success = searchParams.get('success');
        const error = searchParams.get('error');

        if (success === 'google_connected') {
            setNotification({ type: 'success', message: 'Google Calendar conectado com sucesso!' });
            setLoading(true);
            fetch('/api/integrations/status')
                .then(res => res.json())
                .then(data => {
                    setGoogleStatus(data.google);
                    setLoading(false);
                })
                .catch(() => setLoading(false));
        } else if (error === 'access_denied') {
            setNotification({ type: 'error', message: 'Acesso negado. Tente novamente.' });
        } else if (error) {
            setNotification({ type: 'error', message: 'Erro ao conectar. Tente novamente.' });
        }

        if (success || error) {
            const timer = setTimeout(() => setNotification(null), 5000);
            return () => clearTimeout(timer);
        }

        return undefined;
    }, [searchParams]);

    const handleConnectGoogle = async () => {
        try {
            const response = await fetch('/api/auth/google');
            const data = await response.json();

            if (data.authUrl) {
                window.location.href = data.authUrl;
            } else if (data.error) {
                setNotification({ type: 'error', message: data.error });
            }
        } catch (error) {
            setNotification({ type: 'error', message: 'Erro ao conectar integração' });
        }
    };

    const handleDisconnectGoogle = async () => {
        try {
            const res = await fetch('/api/integrations/google/disconnect', { method: 'POST' });
            if (res.ok) {
                setNotification({ type: 'success', message: 'Google desconectado.' });
                setGoogleStatus({ connected: false });
            } else {
                setNotification({ type: 'error', message: 'Erro ao desconectar.' });
            }
        } catch (error) {
            setNotification({ type: 'error', message: 'Erro ao desconectar integração.' });
        }
    };

    // Handler para criar instância WhatsApp principal
    async function handleCreateWhatsAppInstance() {
        try {
            setWhatsappLoading(true);

            const res = await fetch('/api/whatsapp/instance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    connectionType: 'qr_code',
                    isMain: true, // Indica que é a instância principal
                }),
            });

            const data = await res.json();

            if (data.success) {
                setShowQRCode(true);
                await fetchMainWhatsAppInstance();
            } else {
                setNotification({ type: 'error', message: data.error || 'Erro ao criar instância' });
            }
        } catch (error) {
            console.error('Erro ao criar instância WhatsApp:', error);
            setNotification({ type: 'error', message: 'Erro ao criar instância WhatsApp' });
        } finally {
            setWhatsappLoading(false);
        }
    }

    // Handler para desconectar WhatsApp
    async function handleDisconnectWhatsApp() {
        if (!whatsappInstance?.id) return;

        if (!confirm('Deseja realmente desconectar o WhatsApp?')) return;

        try {
            const res = await fetch(`/api/whatsapp/instance/${whatsappInstance.id}/status`, {
                method: 'POST',
            });

            if (res.ok) {
                setShowQRCode(false);
                setNotification({ type: 'success', message: 'WhatsApp desconectado.' });
                await fetchMainWhatsAppInstance();
            } else {
                setNotification({ type: 'error', message: 'Erro ao desconectar' });
            }
        } catch (error) {
            console.error('Erro ao desconectar:', error);
        }
    }

    // Callback quando WhatsApp conecta
    function handleWhatsAppConnected(info: { phoneNumber: string; profileName: string }) {
        setShowQRCode(false);
        setNotification({ type: 'success', message: `WhatsApp conectado: ${info.profileName}` });
        fetchMainWhatsAppInstance();
    }

    return (
        <PageWrapper>
            {/* Notification */}
            {notification && (
                <div
                    className={`mb-6 flex items-center gap-3 rounded-xl p-4 ${notification.type === 'success'
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-red-50 text-red-800'
                        }`}
                >
                    {notification.type === 'success' ? (
                        <CheckCircle className="h-5 w-5" />
                    ) : (
                        <AlertCircle className="h-5 w-5" />
                    )}
                    <p className="text-sm font-medium">{notification.message}</p>
                </div>
            )}

            <div className="grid gap-6 lg:grid-cols-2">
                {/* Google Integration */}
                <Card>
                    <CardHeader>
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-4">
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500 to-yellow-500">
                                    <Chrome className="h-7 w-7 text-white" />
                                </div>
                                <div>
                                    <CardTitle>Google</CardTitle>
                                    <p className="text-sm text-slate-500">Calendar e Sheets</p>
                                </div>
                            </div>
                            <Badge variant={googleStatus?.connected ? 'success' : 'secondary'}>
                                {googleStatus?.connected ? 'Conectado' : 'Desconectado'}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {googleStatus?.connected && (
                            <div className="mb-4 rounded-xl bg-slate-50 p-4">
                                <p className="text-sm text-slate-600">
                                    <span className="font-medium">Conta:</span> {googleStatus.email}
                                </p>
                            </div>
                        )}

                        <div className="mb-4 space-y-2">
                            <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                                <span className="text-sm text-slate-700">Google Calendar</span>
                                <Check className="h-4 w-4 text-emerald-500" />
                            </div>
                            <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                                <span className="text-sm text-slate-700">Google Sheets</span>
                                <Check className="h-4 w-4 text-emerald-500" />
                            </div>
                        </div>

                        <div className="flex gap-2">
                            {googleStatus?.connected ? (
                                <>
                                    <Button variant="outline" size="sm" className="flex-1" onClick={handleConnectGoogle}>
                                        <RefreshCw className="h-4 w-4" />
                                        Reconectar
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-red-600 hover:bg-red-50 hover:border-red-200"
                                        onClick={handleDisconnectGoogle}
                                    >
                                        <X className="h-4 w-4" />
                                        Desconectar
                                    </Button>
                                </>
                            ) : (
                                <Button variant="primary" size="sm" className="w-full" onClick={handleConnectGoogle} disabled={loading}>
                                    <ExternalLink className="h-4 w-4" />
                                    {loading ? 'Carregando...' : 'Conectar Google'}
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* WhatsApp Integration */}
                <Card>
                    <CardHeader>
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-4">
                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500">
                                    <MessageCircle className="h-7 w-7 text-white" />
                                </div>
                                <div>
                                    <CardTitle>WhatsApp Business</CardTitle>
                                    <p className="text-sm text-slate-500">Conexão Principal</p>
                                </div>
                            </div>
                            {whatsappLoading ? (
                                <Badge variant="secondary">
                                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                    Carregando
                                </Badge>
                            ) : whatsappInstance?.status === 'connected' ? (
                                <Badge variant="success">
                                    <Wifi className="h-3 w-3 mr-1" />
                                    Conectado
                                </Badge>
                            ) : whatsappInstance?.status === 'connecting' ? (
                                <Badge variant="secondary">
                                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                    Conectando
                                </Badge>
                            ) : (
                                <Badge variant="secondary">
                                    <WifiOff className="h-3 w-3 mr-1" />
                                    Desconectado
                                </Badge>
                            )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        {/* Se já está conectado */}
                        {whatsappInstance?.status === 'connected' && (
                            <div className="mb-4 rounded-xl bg-green-50 p-4">
                                <p className="text-sm text-green-800">
                                    <span className="font-medium">Número:</span> +{whatsappInstance.phoneNumber}
                                </p>
                                <p className="text-sm text-green-700">
                                    <span className="font-medium">Perfil:</span> {whatsappInstance.profileName}
                                </p>
                            </div>
                        )}

                        {/* Se está mostrando QR Code */}
                        {showQRCode && whatsappInstance && (
                            <div className="mb-4">
                                <WhatsAppQRCode
                                    instanceId={whatsappInstance.id}
                                    onConnected={handleWhatsAppConnected}
                                    onDisconnected={() => fetchMainWhatsAppInstance()}
                                />
                            </div>
                        )}

                        {/* Features */}
                        {!showQRCode && (
                            <div className="mb-4 space-y-2">
                                <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                                    <span className="text-sm text-slate-700">Enviar Mensagens</span>
                                    <Check className="h-4 w-4 text-emerald-500" />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                                    <span className="text-sm text-slate-700">Receber Mensagens</span>
                                    <Check className="h-4 w-4 text-emerald-500" />
                                </div>
                                <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                                    <span className="text-sm text-slate-700">Conexão via QR Code</span>
                                    <Check className="h-4 w-4 text-emerald-500" />
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2">
                            {whatsappInstance?.status === 'connected' ? (
                                <>
                                    <Button variant="outline" size="sm" className="flex-1" onClick={handleCreateWhatsAppInstance}>
                                        <RefreshCw className="h-4 w-4" />
                                        Reconectar
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="text-red-600 hover:bg-red-50 hover:border-red-200"
                                        onClick={handleDisconnectWhatsApp}
                                    >
                                        <X className="h-4 w-4" />
                                        Desconectar
                                    </Button>
                                </>
                            ) : showQRCode ? (
                                <Button variant="outline" size="sm" className="w-full" onClick={() => setShowQRCode(false)}>
                                    Cancelar
                                </Button>
                            ) : (
                                <Button
                                    variant="primary"
                                    size="sm"
                                    className="w-full"
                                    onClick={handleCreateWhatsAppInstance}
                                    disabled={whatsappLoading}
                                >
                                    <QrCode className="h-4 w-4" />
                                    {whatsappLoading ? 'Carregando...' : 'Conectar via QR Code'}
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Help Section */}
            <PageSection className="mt-8">
                <Card className="bg-slate-50 border-slate-200">
                    <CardContent className="p-6">
                        <h3 className="font-semibold text-slate-900 mb-2">
                            Como funcionam as integrações principais?
                        </h3>
                        <div className="text-sm text-slate-600 space-y-2 mb-4">
                            <p><strong>Google:</strong> Clique em "Conectar" e autorize o acesso. Todos os agentes podem usar esta conta.</p>
                            <p><strong>WhatsApp:</strong> Escaneie o QR Code com seu WhatsApp. Esta será a conexão padrão para seus agentes.</p>
                            <p className="text-amber-600">💡 <strong>Dica:</strong> Você pode conectar contas específicas em cada agente, se preferir.</p>
                        </div>
                    </CardContent>
                </Card>
            </PageSection>
        </PageWrapper>
    );
}

export default function IntegrationsPage() {
    return (
        <>
            <Header
                title="Integrações"
                description="Conecte seus serviços externos"
            />
            <Suspense fallback={<div className="p-6">Carregando integrações...</div>}>
                <IntegrationsContent />
            </Suspense>
        </>
    );
}
