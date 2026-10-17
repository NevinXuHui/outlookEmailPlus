import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();

app.use(express.json());
app.get('/api/auth/current-user', (_request, response) => {
  response.json({
    success: true,
    data: { name: '性能验收', userid: 'visual-smoke', access: 'admin' },
  });
});
app.get('/api/csrf-token', (_request, response) => {
  response.json({ csrf_disabled: true, csrf_token: null });
});
app.post('/api/performance/client', (_request, response) => {
  response.status(202).json({ success: true, accepted: 1 });
});
app.get('/api/overview/performance', (_request, response) => {
  response.json({
    window: { seconds: 3600, storage: 'process_memory' },
    summary: {
      backend_api: { count: 284, error_rate: 1.4, p95_ms: 680 },
      frontend_api: { count: 231, error_rate: 0.9, p95_ms: 920 },
      page: { count: 46, error_rate: 0, p95_ms: 1480 },
      mail: { count: 93, error_rate: 2.2, p95_ms: 2570 },
      ai: { count: 18, error_rate: 11.1, p95_ms: 6410 },
    },
    endpoints: [
      { name: '/api/emails', method: 'GET', count: 93, avg_ms: 1180, p95_ms: 2410, error_rate: 2.2 },
      { name: '/api/overview/summary', method: 'GET', count: 51, avg_ms: 190, p95_ms: 340, error_rate: 0 },
      { name: '/api/accounts', method: 'GET', count: 37, avg_ms: 240, p95_ms: 410, error_rate: 0 },
    ],
    client_endpoints: [
      { name: '/api/emails', count: 81, avg_ms: 1470, p95_ms: 2820, error_rate: 1.2 },
      { name: '/api/accounts', count: 34, avg_ms: 390, p95_ms: 620, error_rate: 0 },
    ],
    pages: [
      { name: '/mailbox', count: 22, avg_ms: 1020, p95_ms: 1820 },
      { name: '/overview', count: 16, avg_ms: 690, p95_ms: 970 },
      { name: '/accounts', count: 8, avg_ms: 740, p95_ms: 1090 },
    ],
    bottlenecks: [
      {
        layer: 'AI/外部服务',
        severity: 'high',
        title: 'AI 调用延迟偏高',
        evidence: 'AI 调用 P95 为 6410 ms',
        recommendation: '检查上游模型可用性，并保留规则提取快速路径。',
      },
      {
        layer: '邮件链路',
        severity: 'medium',
        title: '邮件获取链路偏慢',
        evidence: '邮件相关请求 P95 为 2570 ms',
        recommendation: '结合 trace ID 区分 Graph、IMAP 回退和渲染耗时。',
      },
    ],
    recommendations: [
      '检查上游模型可用性，并保留规则提取快速路径。',
      '结合 trace ID 区分 Graph、IMAP 回退和渲染耗时。',
    ],
  });
});

app.use(express.static(path.join(root, 'dist')));
app.use((_request, response) => {
  response.sendFile(path.join(root, 'dist', 'index.html'));
});

app.listen(4173, '127.0.0.1', () => {
  console.log('Performance preview server listening on http://127.0.0.1:4173');
});
