import { Router } from 'express';
import { listResumeTemplates, type TemplateMeta } from '../services/exportResume';
import { Logger } from '../utils/Logger';
import { v4 as uuid } from 'uuid';

export const templateRouter = Router();

templateRouter.get('/', async (_req, res) => {
  const transactionId = `list-templates-${uuid()}`;
  try {

    const templates: TemplateMeta[] = await listResumeTemplates();
    res.json({ templates });
  } catch (error) {
    await Logger.logBackendError('Templates', error, {
      TransactionID: transactionId,
      Endpoint: 'GET /templates',
      Status: 'INTERNAL_ERROR'
    });
    res.status(500).json({ error: 'Failed to load templates' });
  }
});


