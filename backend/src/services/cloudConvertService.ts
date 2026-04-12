import fs from 'fs/promises';
import path from 'path';

interface CloudConvertTask {
  id: string;
  name?: string;
  operation: string;
  status: 'waiting' | 'processing' | 'finished' | 'error';
  message?: string | null;
  result?: {
    form?: {
      url: string;
      parameters: Record<string, string | number>;
    };
    files?: Array<{
      filename: string;
      url: string;
    }>;
  };
}

interface CloudConvertJobResponse {
  data: {
    id: string;
    status: string;
    tasks: CloudConvertTask[];
  };
}

const API_BASE_URL = process.env.CLOUDCONVERT_API_BASE_URL || 'https://api.cloudconvert.com/v2';
const SYNC_API_BASE_URL = process.env.CLOUDCONVERT_SYNC_API_BASE_URL || 'https://sync.api.cloudconvert.com/v2';
const API_KEY = process.env.CLOUDCONVERT_API_KEY;

const assertConfigured = () => {
  if (!API_KEY) {
    throw new Error('CLOUDCONVERT_API_KEY is not configured');
  }
};

const request = async <T>(url: string, init: RequestInit) => {
  assertConfigured();

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`CloudConvert request failed (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
};

const getTaskByName = (tasks: CloudConvertTask[], name: string) => {
  const task = tasks.find((item) => item.name === name);
  if (!task) throw new Error(`CloudConvert task "${name}" not found`);
  return task;
};

export class CloudConvertService {
  static isConfigured() {
    return Boolean(API_KEY);
  }

  static async convertOfficeToPdf(sourcePath: string, fileName: string) {
    const createJobPayload = {
      tasks: {
        import_file: {
          operation: 'import/upload'
        },
        convert_file: {
          operation: 'convert',
          input: 'import_file',
          output_format: 'pdf',
          filename: `${path.parse(fileName).name}.pdf`
        },
        export_file: {
          operation: 'export/url',
          input: 'convert_file',
          inline: true,
          archive_multiple_files: false
        }
      }
    };

    const job = await request<CloudConvertJobResponse>(`${API_BASE_URL}/jobs`, {
      method: 'POST',
      body: JSON.stringify(createJobPayload)
    });

    const importTask = getTaskByName(job.data.tasks, 'import_file');
    const form = importTask.result?.form;
    if (!form) {
      throw new Error('CloudConvert upload form is missing');
    }

    const uploadBody = new FormData();
    Object.entries(form.parameters).forEach(([key, value]) => {
      uploadBody.append(key, String(value));
    });
    const fileBuffer = await fs.readFile(sourcePath);
    uploadBody.append('file', new Blob([fileBuffer]), fileName);

    const uploadResponse = await fetch(form.url, {
      method: 'POST',
      body: uploadBody
    });

    if (!uploadResponse.ok) {
      throw new Error(`CloudConvert upload failed (${uploadResponse.status})`);
    }

    const exportTask = await request<{ data: CloudConvertTask }>(
      `${SYNC_API_BASE_URL}/tasks/${encodeURIComponent(getTaskByName(job.data.tasks, 'export_file').id)}`,
      {
        method: 'GET'
      }
    );

    const fileUrl = exportTask.data.result?.files?.[0]?.url;
    const pdfName = exportTask.data.result?.files?.[0]?.filename || `${path.parse(fileName).name}.pdf`;

    if (!fileUrl) {
      throw new Error('CloudConvert export URL is missing');
    }

    const pdfResponse = await fetch(fileUrl);
    if (!pdfResponse.ok) {
      throw new Error(`CloudConvert exported PDF download failed (${pdfResponse.status})`);
    }

    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
    return {
      pdfBuffer,
      pdfName
    };
  }
}
