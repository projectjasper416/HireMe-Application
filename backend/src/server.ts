import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { authRouter } from './routes/auth';
import { resumeRouter } from './routes/resumes';
import { templateRouter } from './routes/templates';
import { jobsRouter } from './routes/jobs';


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


const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  // TDD 10.3 Integration Points: backend should expose stable base URL
  console.log(`[api] listening on http://localhost:${port}`);
});


