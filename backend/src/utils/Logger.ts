import { supabaseAdmin } from '../config/supabase';

export interface LogEntry {
    UserID?: string;
    SessionID?: string;
    TransactionID?: string;
    ParentTransactionID?: string;
    Category?: string;
    Endpoint?: string;
    RequestPayload?: any;
    ResponsePayload?: any;
    Exception?: string;
    ExceptionStackTrace?: string;
    RelatedTo?: string;
    Status?: string;
}

export class Logger {
    static async log(entry: LogEntry) {
        try {
            const { error } = await supabaseAdmin
                .from('Application_Log')
                .insert([
                    {
                        UserID: entry.UserID,
                        SessionID: entry.SessionID,
                        TransactionID: entry.TransactionID,
                        ParentTransactionID: entry.ParentTransactionID,
                        Category: entry.Category,
                        Endpoint: entry.Endpoint,
                        RequestPayload: entry.RequestPayload ? JSON.stringify(entry.RequestPayload) : null,
                        ResponsePayload: entry.ResponsePayload ? JSON.stringify(entry.ResponsePayload) : null,
                        Exception: entry.Exception,
                        ExceptionStackTrace: entry.ExceptionStackTrace,
                        RelatedTo: entry.RelatedTo,
                        Status: entry.Status,
                    },
                ]);

            if (error) {
                console.error('Failed to write to Application_Log:', error);
            }
        } catch (err) {
            console.error('Unexpected error writing to Application_Log:', err);
        }
    }

    static async logInfo(
        category: string,
        message: string,
        metadata?: Partial<LogEntry>
    ) {
        await this.log({
            Category: category,
            Status: 'INFO',
            ResponsePayload: message, // Storing message in ResponsePayload for generic info
            ...metadata,
        });
    }

    static async logError(
        category: string,
        error: any,
        metadata?: Partial<LogEntry>
    ) {
        await this.log({
            Category: category,
            Status: 'ERROR',
            Exception: error instanceof Error ? error.message : String(error),
            ExceptionStackTrace: error instanceof Error ? error.stack : undefined,
            ...metadata,
        });
    }
}
