import { google } from 'googleapis';
import { db } from '@/lib/db';
import { integrations } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { decryptCredential } from '@/lib/security';

/**
 * Formata data para timezone São Paulo (sem converter para UTC)
 * Formato: YYYY-MM-DDTHH:mm:ss
 */
function formatToSaoPaulo(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export class GoogleCalendarService {
    private oauth2Client;

    constructor() {
        this.oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            `${process.env.NEXTAUTH_URL}/api/integrations/google/callback`
        );
    }

    /**
     * Autentica o cliente com as credenciais do usuário
     */
    private async authenticate(userId: string) {
        const integration = await db.query.integrations.findFirst({
            where: and(
                eq(integrations.userId, userId),
                eq(integrations.provider, 'google')
            ),
        });

        if (!integration) {
            throw new Error('Google Integration not found for user');
        }

        // Tentar parsear credenciais (podem ser encrypted ou plain JSON)
        let credentials;
        try {
            // Primeiro tenta como JSON puro (formato atual)
            credentials = JSON.parse(integration.credentials);
        } catch {
            // Se falhar, tenta decriptar (formato futuro seguro)
            try {
                credentials = JSON.parse(decryptCredential(integration.credentials));
            } catch (decryptError) {
                console.error('[GoogleCalendar] Erro ao decriptar credenciais:', decryptError);
                throw new Error('Falha ao processar credenciais do Google');
            }
        }

        this.oauth2Client.setCredentials({
            access_token: credentials.accessToken,
            refresh_token: credentials.refreshToken,
            expiry_date: credentials.expiryDate,
        });

        return this.oauth2Client;
    }

    /**
     * Lista horários disponíveis (Freebusy)
     */
    async listAvailableSlots(userId: string, config: {
        timeMin: Date;
        timeMax: Date;
        durationMinutes: number;
        workHoursStart?: number; // 9 = 09:00
        workHoursEnd?: number;   // 18 = 18:00
    }) {
        const auth = await this.authenticate(userId);
        const calendar = google.calendar({ version: 'v3', auth });

        // 1. Buscar FreeBusy
        const response = await calendar.freebusy.query({
            requestBody: {
                timeMin: config.timeMin.toISOString(),
                timeMax: config.timeMax.toISOString(),
                items: [{ id: 'primary' }],
            },
        });

        const busySlots = response.data.calendars?.['primary']?.busy || [];

        return {
            busy: busySlots,
            config
        };
    }

    /**
     * Cria um evento no calendário
     * IMPORTANTE: Usa timezone América/São_Paulo explicitamente
     */
    async createEvent(userId: string, eventData: {
        summary: string;
        description?: string;
        start: Date;
        end: Date;
        attendeeEmail?: string;
    }) {
        const auth = await this.authenticate(userId);
        const calendar = google.calendar({ version: 'v3', auth });

        // CORREÇÃO: Formatar data SEM converter para UTC
        // Isso garante que 14:00 em SP = 14:00 no evento (não 14:00 UTC = 11:00 SP)
        const event = {
            summary: eventData.summary,
            description: eventData.description,
            start: {
                dateTime: formatToSaoPaulo(eventData.start),
                timeZone: 'America/Sao_Paulo',
            },
            end: {
                dateTime: formatToSaoPaulo(eventData.end),
                timeZone: 'America/Sao_Paulo',
            },
            attendees: eventData.attendeeEmail ? [{ email: eventData.attendeeEmail }] : [],
            // Opções para Google Meet (opcional)
            conferenceData: {
                createRequest: {
                    requestId: `meet-${Date.now()}`,
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                }
            }
        };

        console.log('[GoogleCalendar] 📅 Criando evento:', {
            summary: event.summary,
            start: event.start.dateTime,
            end: event.end.dateTime,
            timezone: event.start.timeZone,
            attendee: eventData.attendeeEmail
        });

        const response = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: event,
            conferenceDataVersion: 1, // Necessário para criar Google Meet
        });

        console.log('[GoogleCalendar] ✅ Evento criado:', response.data.id);

        return {
            id: response.data.id,
            link: response.data.htmlLink,
            meetLink: response.data.conferenceData?.entryPoints?.[0]?.uri,
        };
    }

    /**
     * Busca detalhes de um evento
     */
    async getEvent(userId: string, eventId: string) {
        const auth = await this.authenticate(userId);
        const calendar = google.calendar({ version: 'v3', auth });

        const response = await calendar.events.get({
            calendarId: 'primary',
            eventId: eventId,
        });

        return response.data;
    }

    /**
     * Atualiza um evento existente
     */
    async updateEvent(userId: string, eventId: string, eventData: {
        summary?: string;
        description?: string;
        start?: Date;
        end?: Date;
        attendeeEmail?: string;
    }) {
        const auth = await this.authenticate(userId);
        const calendar = google.calendar({ version: 'v3', auth });

        // Montar apenas os campos que foram passados
        const updatePayload: Record<string, unknown> = {};

        if (eventData.summary) updatePayload.summary = eventData.summary;
        if (eventData.description) updatePayload.description = eventData.description;
        if (eventData.start) {
            updatePayload.start = {
                dateTime: formatToSaoPaulo(eventData.start),
                timeZone: 'America/Sao_Paulo',
            };
        }
        if (eventData.end) {
            updatePayload.end = {
                dateTime: formatToSaoPaulo(eventData.end),
                timeZone: 'America/Sao_Paulo',
            };
        }
        if (eventData.attendeeEmail) {
            updatePayload.attendees = [{ email: eventData.attendeeEmail }];
        }

        console.log('[GoogleCalendar] ✏️ Atualizando evento:', eventId, updatePayload);

        const response = await calendar.events.patch({
            calendarId: 'primary',
            eventId: eventId,
            requestBody: updatePayload,
        });

        console.log('[GoogleCalendar] ✅ Evento atualizado:', response.data.id);

        return {
            id: response.data.id,
            link: response.data.htmlLink,
        };
    }

    /**
     * Deleta um evento
     */
    async deleteEvent(userId: string, eventId: string) {
        const auth = await this.authenticate(userId);
        const calendar = google.calendar({ version: 'v3', auth });

        console.log('[GoogleCalendar] 🗑️ Deletando evento:', eventId);

        await calendar.events.delete({
            calendarId: 'primary',
            eventId: eventId,
        });

        console.log('[GoogleCalendar] ✅ Evento deletado:', eventId);

        return { success: true };
    }
}
