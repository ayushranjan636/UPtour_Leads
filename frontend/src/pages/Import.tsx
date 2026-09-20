import { useState } from 'react';
import {
  Card,
  Steps,
  Upload,
  Button,
  Select,
  Typography,
  Flex,
  Alert,
  Result,
  Spin,
  message,
} from 'antd';
import {
  InboxOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { importsAPI } from '../services/endpoints';
import { color, font, radius, space } from '../theme/tokens';
import type { UploadFile } from 'antd';

const { Text } = Typography;
const { Dragger } = Upload;

const crmFields = [
  { label: 'Name', value: 'name' },
  { label: 'Email', value: 'email' },
  { label: 'WhatsApp', value: 'whatsapp_number' },
  // Must be `company_name` — the import worker looks for exactly this key
  // when deciding whether to create/link a company.
  { label: 'Company', value: 'company_name' },
  { label: 'Country', value: 'country' },
  { label: 'City', value: 'city' },
  { label: 'Agency Type', value: 'agency_type' },
  { label: 'Phone', value: 'phone' },
  { label: 'Designation', value: 'designation' },
  { label: '— Skip —', value: '_skip' },
];

interface PreviewData {
  columns: string[];
  rows: Record<string, string>[];
  total: number;
}

interface ImportRecord {
  id: string;
  original_filename?: string;
  status?: string;
  total_rows?: number;
  valid_rows?: number;
  duplicate_rows?: number;
  error_rows?: number;
  created_at?: string;
}

export default function Import() {
  const [currentStep, setCurrentStep] = useState(0);
  const [importId, setImportId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importResult, setImportResult] = useState<ImportRecord | null>(null);
  const [uploading, setUploading] = useState(false);

  const steps = [
    { title: 'Upload', description: 'Select file' },
    { title: 'Map', description: 'Match columns' },
    { title: 'Import', description: 'Process records' },
  ];

  const handleUpload = async (file: UploadFile) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file as unknown as Blob);
      const { data } = await importsAPI.upload(formData);
      const id = data.id;
      setImportId(id);

      // Backend returns { headers, rows, totalRows }.
      const { data: prev } = await importsAPI.preview(id);
      const columns: string[] = prev.headers ?? [];
      setPreview({
        columns,
        rows: prev.rows ?? [],
        total: prev.totalRows ?? 0,
      });

      const autoMap: Record<string, string> = {};
      columns.forEach((col) => {
        const lc = col.toLowerCase();
        if (lc.includes('company') || lc.includes('business'))
          autoMap[col] = 'company_name';
        else if (lc.includes('name')) autoMap[col] = 'name';
        else if (lc.includes('email')) autoMap[col] = 'email';
        else if (lc.includes('whatsapp') || lc.includes('wa'))
          autoMap[col] = 'whatsapp_number';
        else if (lc.includes('country')) autoMap[col] = 'country';
        else if (lc.includes('city')) autoMap[col] = 'city';
        else if (lc.includes('phone') || lc.includes('tel'))
          autoMap[col] = 'phone';
        else if (lc.includes('designation') || lc.includes('title'))
          autoMap[col] = 'designation';
        else if (lc.includes('type')) autoMap[col] = 'agency_type';
      });
      setMapping(autoMap);
      setCurrentStep(1);
    } catch {
      message.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleMap = async () => {
    if (!importId) return;
    try {
      const cleanMapping = Object.fromEntries(
        Object.entries(mapping).filter(([, v]) => v && v !== '_skip'),
      );

      if (!Object.values(cleanMapping).includes('whatsapp_number')) {
        message.error('You must map a column to the WhatsApp field.');
        return;
      }
      if (!Object.values(cleanMapping).includes('name')) {
        message.error('You must map a column to the Name field.');
        return;
      }

      await importsAPI.map(importId, cleanMapping);
      setCurrentStep(2);
      executeImport(importId);
    } catch {
      message.error('Failed to map columns');
    }
  };

  /**
   * Import runs as a background BullMQ job, so /execute only returns "queued".
   * Poll the record until it reaches a terminal status instead of reading it
   * immediately (which would always show 0 rows imported).
   */
  const executeImport = async (id: string) => {
    setImporting(true);
    try {
      await importsAPI.execute(id);

      const deadline = Date.now() + 120_000;
      let last: ImportRecord | null = null;

      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const { data } = await importsAPI.get(id);
        last = data;
        if (data.status === 'completed' || data.status === 'failed') break;
      }

      setImportResult(last);
      setImportDone(true);

      if (last?.status === 'failed') {
        message.error('Import failed. Check the report below.');
      } else if (last?.status !== 'completed') {
        message.warning('Import is still running in the background.');
      }
    } catch {
      message.error('Import failed');
      setImportDone(true);
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setCurrentStep(0);
    setImportId(null);
    setPreview(null);
    setMapping({});
    setImporting(false);
    setImportDone(false);
    setImportResult(null);
  };

  return (
    <div>
      <PageHeader
        title="Import"
        subtitle="Import contacts from CSV or Excel files"
      />

      <Card style={{ borderRadius: radius.xl, border: `1px solid ${color.separator}` }}>
        <Steps
          current={currentStep}
          items={steps}
          style={{ marginBottom: 40 }}
        />

        {/* Step 1 — Upload */}
        {currentStep === 0 && (
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            <Spin spinning={uploading}>
              <Dragger
                accept=".csv,.xlsx,.xls"
                showUploadList={false}
                beforeUpload={(file) => {
                  handleUpload(file as unknown as UploadFile);
                  return false;
                }}
                style={{
                  padding: '40px 20px',
                  borderRadius: radius.xl,
                  border: `2px dashed ${color.textTertiary}`,
                  background: color.fill,
                }}
              >
                <p style={{ marginBottom: space.lg }}>
                  <InboxOutlined style={{ fontSize: 48, color: color.accent }} />
                </p>
                <Text
                  strong
                  style={{
                    fontSize: font.size.headline,
                    display: 'block',
                    marginBottom: space.sm,
                    color: color.text,
                  }}
                >
                  Drop your file here, or click to browse
                </Text>
                <Text style={{ color: color.textSecondary }}>
                  Supports CSV and Excel files (.csv, .xlsx, .xls)
                </Text>
              </Dragger>
            </Spin>
          </div>
        )}

        {/* Step 2 — Map columns */}
        {currentStep === 1 && preview && (
          <div>
            <Text style={{ color: color.textSecondary, display: 'block', marginBottom: space.sm }}>
              {preview.total} rows found. Map your columns to CRM fields.
            </Text>
            {preview.rows.length > 0 && (
              <Alert
                message={`Preview: First ${Math.min(preview.rows.length, 3)} rows shown below the mapping`}
                type="info"
                showIcon
                style={{ marginBottom: space.xl, borderRadius: radius.lg }}
              />
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                gap: '12px 20px',
                alignItems: 'center',
                maxWidth: 700,
              }}
            >
              <Text
                strong
                style={{
                  fontSize: font.size.caption,
                  color: color.textSecondary,
                  textTransform: 'uppercase',
                }}
              >
                File Column
              </Text>
              <div />
              <Text
                strong
                style={{
                  fontSize: font.size.caption,
                  color: color.textSecondary,
                  textTransform: 'uppercase',
                }}
              >
                CRM Field
              </Text>

              {preview.columns.map((col) => (
                <Flex key={col} align="center" gap={20} style={{ display: 'contents' }}>
                  <div
                    style={{
                      padding: '8px 14px',
                      background: color.fill,
                      borderRadius: radius.md,
                      fontWeight: font.weight.medium,
                      fontSize: font.size.footnote,
                    }}
                  >
                    {col}
                  </div>
                  <Text style={{ color: color.textTertiary, fontSize: 18 }}>→</Text>
                  <Select
                    value={mapping[col]}
                    onChange={(val) => setMapping({ ...mapping, [col]: val })}
                    options={crmFields}
                    style={{ width: '100%' }}
                    placeholder="Select field..."
                    allowClear
                  />
                </Flex>
              ))}
            </div>

            <Flex justify="flex-end" gap={space.md} style={{ marginTop: space.xxl }}>
              <Button onClick={() => { setCurrentStep(0); setPreview(null); }}>Back</Button>
              <Button type="primary" onClick={handleMap}>
                Import Data
              </Button>
            </Flex>
          </div>
        )}

        {/* Step 3 — Import */}
        {currentStep === 2 && (
          <div style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
            {!importDone ? (
              <Flex vertical align="center" gap={space.xl}>
                <Text strong style={{ fontSize: font.size.headline, color: color.text }}>
                  Importing contacts...
                </Text>
                <Spin size="large" spinning={importing} />
                <Text style={{ color: color.textSecondary }}>This may take a moment</Text>
              </Flex>
            ) : (
              <Result
                status={importResult?.status === 'failed' ? 'error' : 'success'}
                icon={
                  importResult?.status === 'failed' ? undefined : (
                    <CheckCircleOutlined style={{ color: color.success }} />
                  )
                }
                title={
                  importResult?.status === 'failed'
                    ? 'Import Failed'
                    : 'Import Complete!'
                }
                subTitle={
                  importResult
                    ? `Imported ${importResult.valid_rows ?? 0} of ${importResult.total_rows ?? 0} rows. ` +
                      `${importResult.duplicate_rows ?? 0} duplicates, ${importResult.error_rows ?? 0} errors.`
                    : 'Import completed successfully.'
                }
                extra={[
                  <Button type="primary" key="another" onClick={reset}>
                    Import Another File
                  </Button>,
                ]}
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
