import { ProCard, StatisticCard } from '@ant-design/pro-components';
import { Alert, Col, Empty, Row, Space, Table, Tag, Typography } from 'antd';
import type {
  OverviewPerformance,
  PerformanceMetricSummary,
} from '@/services/outlook/overview';
import { formatDurationMs, formatNumber } from './utils';

const metricValue = (metric?: PerformanceMetricSummary) =>
  metric?.count ? formatDurationMs(metric.p95_ms || 0) : '--';

const metricDescription = (metric?: PerformanceMetricSummary) =>
  metric?.count
    ? `${formatNumber(metric.count)} 次 · 错误率 ${(metric.error_rate || 0).toFixed(1)}%`
    : '等待采集样本';

const severityColor = (severity?: string) => {
  if (severity === 'high') return 'error';
  if (severity === 'medium') return 'warning';
  return 'default';
};

export default function PerformancePane({
  data,
  loading,
}: {
  data?: OverviewPerformance;
  loading: boolean;
}) {
  const summary = data?.summary || {};
  const windowMinutes = Math.round((data?.window?.seconds || 3600) / 60);
  const endpointColumns = [
    {
      title: '接口',
      dataIndex: 'name',
      ellipsis: true,
      render: (value: string, row: { method?: string }) => (
        <Space size={6}>
          {row.method ? <Tag>{row.method}</Tag> : null}
          <Typography.Text code>{value}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '样本',
      dataIndex: 'count',
      width: 80,
      render: (value: number) => formatNumber(value || 0),
    },
    {
      title: '平均',
      dataIndex: 'avg_ms',
      width: 110,
      render: (value: number) => formatDurationMs(value || 0),
    },
    {
      title: 'P95',
      dataIndex: 'p95_ms',
      width: 110,
      render: (value: number) => formatDurationMs(value || 0),
    },
    {
      title: '错误率',
      dataIndex: 'error_rate',
      width: 90,
      render: (value: number) => `${(value || 0).toFixed(1)}%`,
    },
  ];

  return (
    <Space
      direction="vertical"
      size={16}
      style={{ width: '100%', paddingRight: 48, boxSizing: 'border-box' }}
    >
      <Alert
        type="info"
        showIcon
        message={`最近 ${windowMinutes} 分钟滚动窗口`}
        description="服务端指标来自当前应用进程；浏览器指标在登录会话中批量上报。只记录路由模板、耗时、状态码和 trace ID。"
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '后端 API P95',
              value: metricValue(summary.backend_api),
              description: metricDescription(summary.backend_api),
            }}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '页面稳定时间 P95',
              value: metricValue(summary.page),
              description: metricDescription(summary.page),
            }}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: '邮件链路 P95',
              value: metricValue(summary.mail),
              description: metricDescription(summary.mail),
            }}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatisticCard
            loading={loading}
            statistic={{
              title: 'AI 调用 P95',
              value: metricValue(summary.ai),
              description: metricDescription(summary.ai),
            }}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <ProCard title="服务端接口耗时" variant="outlined" loading={loading}>
            <Table
              size="small"
              pagination={false}
              rowKey={(row) => `${row.method || ''}-${row.name}`}
              dataSource={data?.endpoints || []}
              columns={endpointColumns}
              locale={{ emptyText: '暂无服务端请求样本' }}
              scroll={{ x: 640 }}
            />
          </ProCard>
        </Col>
        <Col xs={24} xl={12}>
          <ProCard title="浏览器端到端接口耗时" variant="outlined" loading={loading}>
            <Table
              size="small"
              pagination={false}
              rowKey="name"
              dataSource={data?.client_endpoints || []}
              columns={endpointColumns}
              locale={{ emptyText: '暂无浏览器请求样本' }}
              scroll={{ x: 640 }}
            />
          </ProCard>
        </Col>
      </Row>

      <ProCard title="页面加载与切换" variant="outlined" loading={loading}>
        <Table
          size="small"
          pagination={false}
          rowKey="name"
          dataSource={data?.pages || []}
          columns={endpointColumns.filter((column) => column.dataIndex !== 'error_rate')}
          locale={{ emptyText: '暂无页面性能样本' }}
          scroll={{ x: 540 }}
        />
      </ProCard>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <ProCard title="瓶颈判断" variant="outlined" loading={loading}>
            {data?.bottlenecks?.length ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {data.bottlenecks.map((item) => (
                  <Alert
                    key={`${item.layer}-${item.title}`}
                    type={item.severity === 'high' ? 'error' : 'warning'}
                    showIcon
                    message={
                      <Space size={8}>
                        <Tag color={severityColor(item.severity)}>{item.layer}</Tag>
                        <span>{item.title}</span>
                      </Space>
                    }
                    description={item.evidence}
                  />
                ))}
              </Space>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={loading ? '分析中…' : '当前窗口未发现明显瓶颈'}
              />
            )}
          </ProCard>
        </Col>
        <Col xs={24} xl={10}>
          <ProCard title="优化建议" variant="outlined" loading={loading}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              {(data?.recommendations || []).map((item, index) => (
                <Typography.Paragraph key={item} style={{ marginBottom: 0 }}>
                  <Typography.Text type="secondary">{index + 1}.</Typography.Text>{' '}
                  {item}
                </Typography.Paragraph>
              ))}
            </Space>
          </ProCard>
        </Col>
      </Row>
    </Space>
  );
}
