import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import routes from './routes/index';
import { ensurePlanningSchema } from './config/ensurePlanningSchema';
import { ensureLearningStateSchema } from './config/ensureLearningStateSchema';
import { conversationHistoryService } from './services/conversationHistoryService';

const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';

app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '2mb' }));

const start = async () => {
  await ensurePlanningSchema();
  await ensureLearningStateSchema();
  conversationHistoryService.registerBackgroundJobs();

  app.use('/api', routes);

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

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
