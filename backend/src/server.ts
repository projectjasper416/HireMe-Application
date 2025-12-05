import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { authRouter } from './routes/auth';
import { resumeRouter } from './routes/resumes';
import { templateRouter } from './routes/templates';
import { jobsRouter } from './routes/jobs';
import { Logger } from './utils/Logger';


const app = express();

const bodyLimit = process.env.BODY_LIMIT || '10mb';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],  // 👈 required for Supabase JWT
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], // optional but good practice
  })
);

app.use(express.json({ limit: bodyLimit }));
app.use(express.urlencoded({ limit: bodyLimit, extended: true }));

app.get('/health', (_req, res) => {
  // PRD 4 Target Audience: basic reliability signals for client monitoring
  res.json({ ok: true });
});

app.use('/auth', authRouter);
app.use('/resumes', resumeRouter);
app.use('/templates', templateRouter);
app.use('/jobs', jobsRouter);

// Global error handler middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  Logger.logBackendError('Server', err, {
    Endpoint: req.path || 'Unknown',
    Status: 'UNHANDLED_ERROR',
    RequestPayload: { method: req.method, path: req.path }
  }).catch(() => {
    console.error('Failed to log error:', err);
  });

  res.status(500).json({ error: 'Internal server error' });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  Logger.logBackendError('Server', reason || new Error('Unhandled promise rejection'), {
    Endpoint: 'Process',
    Status: 'UNHANDLED_REJECTION'
  }).catch(() => {
    console.error('Unhandled rejection:', reason);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error: Error) => {
  Logger.logBackendError('Server', error, {
    Endpoint: 'Process',
    Status: 'UNCAUGHT_EXCEPTION'
  }).catch(() => {
    console.error('Uncaught exception:', error);
  });
  process.exit(1);
});

const port = Number(process.env.PORT || 4000);
app.listen(port, async () => {
  // TDD 10.3 Integration Points: backend should expose stable base URL
  console.log(`[api] listening on http://localhost:${port}`);
  await Logger.logInfo('Server', 'Server started', {
    Endpoint: 'Server',
    Status: 'STARTED',
    ResponsePayload: { port }
  });
});


