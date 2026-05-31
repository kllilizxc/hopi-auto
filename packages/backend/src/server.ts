import express from 'express';
import cors from 'cors';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { startOrchestrator } from './index.ts';
import { readYaml } from './skills/kanban/yaml.ts';
import { watch } from 'node:fs';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;

// Start the core reconciler loop
const scheduler = startOrchestrator();

// Active SSE connections
const clients = new Set<express.Response>();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  clients.add(res);

  req.on('close', () => {
    clients.delete(res);
  });
});

// Broadcast board changes to all connected UI clients
scheduler.on('board_changed', (payload) => {
  const message = `data: ${JSON.stringify({ type: 'board_changed', ...payload })}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
});

// Get Board State
app.get('/api/goals/:goalKey/board', (req, res) => {
  const { goalKey } = req.params;
  // Note: rootDir is expected to be the workspace root, one level up from packages/backend
  const todoPath = join(process.cwd(), '..', '..', '.hopi', 'docs', 'goals', goalKey, 'todo.yml');

  if (!existsSync(todoPath)) {
    // Return skeleton if not found
    return res.json({
      goal: { goalKey, title: `Goal: ${goalKey}` },
      items: []
    });
  }

  try {
    const board = readYaml(todoPath);
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse board YAML' });
  }
});

// Stream Session Logs (JSONL Tailing)
app.get('/api/sessions/:sessionId/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { sessionId } = req.params;
  const projectHash = Buffer.from(join(process.cwd(), '..', '..')).toString('base64').substring(0, 12);
  const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
  const logPath = join(homeDir, '.hopi', 'projects', projectHash, 'sessions', `${sessionId}.jsonl`);

  let position = 0;

  const readNewData = () => {
    if (!existsSync(logPath)) return;

    const content = readFileSync(logPath, 'utf-8');
    const newContent = content.slice(position);

    if (newContent) {
      position = Buffer.byteLength(content, 'utf-8');
      const lines = newContent.split('\n').filter(Boolean);
      for (const line of lines) {
        res.write(`data: ${line}\n\n`);
      }
    }
  };

  // Initial read
  readNewData();

  // Watch for appends
  let watcher: ReturnType<typeof watch> | null = null;
  if (existsSync(logPath)) {
    watcher = watch(logPath, (eventType) => {
      if (eventType === 'change') {
        readNewData();
      }
    });
  }

  req.on('close', () => {
    if (watcher) watcher.close();
  });
});

app.listen(PORT, () => {
  console.log(`[API] Server listening on http://localhost:${PORT}`);
});
