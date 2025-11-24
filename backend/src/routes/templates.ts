import { Router } from 'express';
import { listResumeTemplates, type TemplateMeta } from '../services/exportResume';

export const templateRouter = Router();

templateRouter.get('/', async (_req, res) => {
  try {
    const templates: TemplateMeta[] = await listResumeTemplates();
    res.json({ templates });
  } catch (error) {
    console.error('Failed to list templates', error);
    res.status(500).json({ error: 'Failed to load templates' });
  }
});


