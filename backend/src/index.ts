import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ensureAuthSecuritySchema } from './config/ensureAuthSecuritySchema';
import routes from './routes/index';
import { ensurePlanningSchema } from './config/ensurePlanningSchema';
import { ensureLearningStateSchema } from './config/ensureLearningStateSchema';
import { ensureWorkbenchTableSchema } from './config/ensureWorkbenchTableSchema';
import { ensureWorkbenchNoteRevisionSchema } from './config/ensureWorkbenchNoteRevisionSchema';
import { ensureCourseKnowledgeGraphSchema } from './config/ensureCourseKnowledgeGraphSchema';
import { ensureStudioArtifactSchema } from './config/ensureStudioArtifactSchema';
import { conversationHistoryService } from './services/conversationHistoryService';
import { videoAnalysisService } from './services/videoAnalysisService';
import { audioNoteService } from './services/audioNoteService';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { securityHeaders } from './middleware/securityHeaders';

const app = express();
const parsePort = (value: string | undefined) => {
  const port = Number(value || 3001);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${value}". PORT must be an integer between 1 and 65535.`);
  }

  return port;
};

const PORT = parsePort(process.env.PORT);
const HOST = process.env.HOST || '127.0.0.1';
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigins = allowedOrigins.length > 0 ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS;

app.use(securityHeaders);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed by CORS'));
    },
    credentials: true
  })
);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));

const start = async () => {
  await ensureAuthSecuritySchema();
  await ensurePlanningSchema();
  await ensureLearningStateSchema();
  await ensureWorkbenchTableSchema();
  await ensureWorkbenchNoteRevisionSchema();
  await ensureCourseKnowledgeGraphSchema();
  await ensureStudioArtifactSchema();
  conversationHistoryService.registerBackgroundJobs();
  videoAnalysisService.registerBackgroundJobs();
  audioNoteService.registerBackgroundJobs();

  app.use('/api', routes);

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(notFoundHandler);
  app.use(errorHandler);

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server is running at http://${HOST}:${PORT}`);
  });

  server.on('error', (error) => {
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(
        `Server failed to start: http://${HOST}:${PORT} is already in use. Stop the existing backend process or set a different PORT.`
      );
      process.exit(1);
    }

    console.error('Server failed to start:', error);
    process.exit(1);
  });
};

start().catch((error) => {
  console.error('Server failed to initialize:', error);
  process.exit(1);
});
