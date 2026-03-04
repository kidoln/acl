import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AclApiClient } from './acl-api-client';
import { renderConsolePage } from './html';
import type { ConsoleQuery, GateProfile, PublishWorkflowStatus } from './types';

const VALID_STATUSES = new Set<PublishWorkflowStatus>([
  'blocked',
  'review_required',
  'approved',
  'rejected',
  'published',
]);

const VALID_PROFILES = new Set<GateProfile>(['baseline', 'strict_compliance']);

const MAX_FORM_BODY_BYTES = 64 * 1024;

function parseInteger(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function parseQuery(inputUrl: URL): ConsoleQuery {
  const statusRaw = inputUrl.searchParams.get('status');
  const profileRaw = inputUrl.searchParams.get('profile');
  const flashTypeRaw = inputUrl.searchParams.get('flash_type');
  const flashMessage = inputUrl.searchParams.get('flash_message')?.trim();

  const status =
    statusRaw && VALID_STATUSES.has(statusRaw as PublishWorkflowStatus)
      ? (statusRaw as PublishWorkflowStatus)
      : undefined;
  const profile =
    profileRaw && VALID_PROFILES.has(profileRaw as GateProfile)
      ? (profileRaw as GateProfile)
      : undefined;

  const publishId = inputUrl.searchParams.get('publish_id')?.trim();
  const decisionId = inputUrl.searchParams.get('decision_id')?.trim();
  const simulationId = inputUrl.searchParams.get('simulation_id')?.trim();
  const namespace = inputUrl.searchParams.get('namespace')?.trim();
  const cellKey = inputUrl.searchParams.get('cell_key')?.trim();

  return {
    status,
    profile,
    limit: parseInteger(inputUrl.searchParams.get('limit'), 20, 1, 100),
    offset: parseInteger(inputUrl.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
    publish_id: publishId && publishId.length > 0 ? publishId : undefined,
    decision_id: decisionId && decisionId.length > 0 ? decisionId : undefined,
    simulation_id: simulationId && simulationId.length > 0 ? simulationId : undefined,
    namespace: namespace && namespace.length > 0 ? namespace : 'tenant_a.crm',
    cell_key: cellKey && cellKey.length > 0 ? cellKey : undefined,
    flash_type:
      flashTypeRaw === 'success' || flashTypeRaw === 'error'
        ? flashTypeRaw
        : undefined,
    flash_message: flashMessage && flashMessage.length > 0 ? flashMessage : undefined,
  };
}

function sendJson(res: ServerResponse, statusCode: number, data: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(html);
}

function sendCss(res: ServerResponse, css: string): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/css; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(css);
}

function redirectTo(res: ServerResponse, location: string): void {
  res.statusCode = 303;
  res.setHeader('location', location);
  res.end();
}

function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, {
    code: 'METHOD_NOT_ALLOWED',
    message: 'only GET/POST is supported',
  });
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, {
    code: 'NOT_FOUND',
    message: 'route not found',
  });
}

function buildRedirectUrl(input: {
  query?: Partial<ConsoleQuery>;
  flashType?: 'success' | 'error';
  flashMessage?: string;
}): string {
  const params = new URLSearchParams();
  const query = input.query;

  if (query?.status) {
    params.set('status', query.status);
  }
  if (query?.profile) {
    params.set('profile', query.profile);
  }
  if (query?.limit && Number.isInteger(query.limit)) {
    params.set('limit', String(query.limit));
  }
  if (query?.offset !== undefined && Number.isInteger(query.offset)) {
    params.set('offset', String(query.offset));
  }
  if (query?.publish_id) {
    params.set('publish_id', query.publish_id);
  }
  if (query?.decision_id) {
    params.set('decision_id', query.decision_id);
  }
  if (query?.simulation_id) {
    params.set('simulation_id', query.simulation_id);
  }
  if (query?.namespace) {
    params.set('namespace', query.namespace);
  }
  if (query?.cell_key) {
    params.set('cell_key', query.cell_key);
  }

  if (input.flashType && input.flashMessage) {
    params.set('flash_type', input.flashType);
    params.set('flash_message', input.flashMessage);
  }

  const queryString = params.toString();
  return queryString.length > 0 ? `/?${queryString}` : '/';
}

async function loadGlobalCss(): Promise<string> {
  const fileCandidates = [
    resolve(__dirname, 'styles/global.css'),
    resolve(__dirname, '../src/styles/global.css'),
  ];

  for (const filePath of fileCandidates) {
    try {
      return await readFile(filePath, 'utf-8');
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(`global css not found, checked: ${fileCandidates.join(', ')}`);
}

async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of req) {
    const chunkBuffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    receivedBytes += chunkBuffer.byteLength;

    if (receivedBytes > MAX_FORM_BODY_BYTES) {
      throw new Error('form body too large');
    }

    chunks.push(chunkBuffer);
  }

  const raw = Buffer.concat(chunks).toString('utf-8');
  return new URLSearchParams(raw);
}

function parseContextFromForm(form: URLSearchParams): Partial<ConsoleQuery> {
  const statusRaw = form.get('status');
  const profileRaw = form.get('profile');

  const status =
    statusRaw && VALID_STATUSES.has(statusRaw as PublishWorkflowStatus)
      ? (statusRaw as PublishWorkflowStatus)
      : undefined;
  const profile =
    profileRaw && VALID_PROFILES.has(profileRaw as GateProfile)
      ? (profileRaw as GateProfile)
      : undefined;

  const publishId = form.get('publish_id')?.trim();
  const decisionId = form.get('decision_id')?.trim();
  const simulationId = form.get('simulation_id')?.trim();
  const namespace = form.get('namespace')?.trim();
  const cellKey = form.get('cell_key')?.trim();

  return {
    status,
    profile,
    limit: parseInteger(form.get('limit'), 20, 1, 100),
    offset: parseInteger(form.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
    publish_id: publishId && publishId.length > 0 ? publishId : undefined,
    decision_id: decisionId && decisionId.length > 0 ? decisionId : undefined,
    simulation_id: simulationId && simulationId.length > 0 ? simulationId : undefined,
    namespace: namespace && namespace.length > 0 ? namespace : 'tenant_a.crm',
    cell_key: cellKey && cellKey.length > 0 ? cellKey : undefined,
  };
}

async function handleIndex(req: IncomingMessage, res: ServerResponse, client: AclApiClient): Promise<void> {
  const inputUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
  const query = parseQuery(inputUrl);
  const namespace = query.namespace ?? 'tenant_a.crm';

  const publishListPromise = client.listPublishRequests(query);
  const publishDetailPromise = query.publish_id ? client.getPublishRequest(query.publish_id) : undefined;
  const decisionDetailPromise = query.decision_id ? client.getDecision(query.decision_id) : undefined;
  const simulationListPromise = client.listSimulationReports({
    publish_id: query.publish_id,
    profile: query.profile,
    limit: 20,
    offset: 0,
  });
  const controlCatalogsPromise = client.listControlCatalogs({
    namespace,
    limit: 20,
    offset: 0,
  });
  const controlObjectsPromise = client.listControlObjects({
    namespace,
    limit: 20,
    offset: 0,
  });
  const controlRelationsPromise = client.listControlRelations({
    namespace,
    limit: 20,
    offset: 0,
  });
  const controlAuditsPromise = client.listControlAudits({
    namespace,
    limit: 20,
    offset: 0,
  });

  const [
    publishList,
    publishDetail,
    decisionDetail,
    simulationList,
    controlCatalogs,
    controlObjects,
    controlRelations,
    controlAudits,
  ] = await Promise.all([
    publishListPromise,
    publishDetailPromise,
    decisionDetailPromise,
    simulationListPromise,
    controlCatalogsPromise,
    controlObjectsPromise,
    controlRelationsPromise,
    controlAuditsPromise,
  ]);

  const pickedSimulationId =
    query.simulation_id
    ?? (simulationList.ok && simulationList.data.items[0] ? simulationList.data.items[0].report_id : undefined);
  const simulationDetail = pickedSimulationId
    ? await client.getSimulationReport(pickedSimulationId)
    : undefined;

  const html = renderConsolePage({
    query,
    publish_list: publishList,
    publish_detail: publishDetail,
    decision_detail: decisionDetail,
    simulation_list: simulationList,
    simulation_detail: simulationDetail,
    control_catalogs: controlCatalogs,
    control_objects: controlObjects,
    control_relations: controlRelations,
    control_audits: controlAudits,
    action_flash:
      query.flash_type && query.flash_message
        ? {
            type: query.flash_type,
            message: query.flash_message,
          }
        : undefined,
    api_base_url: client.getBaseUrl(),
    generated_at: new Date().toISOString(),
  });

  sendHtml(res, html);
}

async function handleReviewAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const publishId = form.get('publish_id')?.trim();
  const decision = form.get('decision')?.trim();
  const reviewer = form.get('reviewer')?.trim();
  const reason = form.get('reason')?.trim();
  const expiresAt = form.get('expires_at')?.trim();

  if (!publishId || (decision !== 'approve' && decision !== 'reject') || !reviewer || !reason) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: 'error',
        flashMessage: 'review 参数缺失：publish_id/decision/reviewer/reason 必填',
      }),
    );
    return;
  }

  const result = await client.reviewPublishRequest({
    publish_id: publishId,
    decision,
    reviewer,
    reason,
    expires_at: expiresAt && expiresAt.length > 0 ? expiresAt : undefined,
  });

  context.publish_id = publishId;

  if (!result.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: 'error',
        flashMessage: `review 失败: ${result.error}`,
      }),
    );
    return;
  }

  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: 'success',
      flashMessage: `review 成功，状态: ${result.data.status}`,
    }),
  );
}

async function handleActivateAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const publishId = form.get('publish_id')?.trim();
  const operator = form.get('operator')?.trim() || 'release_bot';

  if (!publishId) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: 'error',
        flashMessage: 'activate 参数缺失：publish_id 必填',
      }),
    );
    return;
  }

  const result = await client.activatePublishRequest({
    publish_id: publishId,
    operator,
  });

  context.publish_id = publishId;

  if (!result.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: 'error',
        flashMessage: `activate 失败: ${result.error}`,
      }),
    );
    return;
  }

  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: 'success',
      flashMessage: `activate 成功，状态: ${result.data.status}`,
    }),
  );
}

export interface StartConsoleServerOptions {
  port?: number;
  apiBaseUrl?: string;
}

export async function startConsoleServer(options: StartConsoleServerOptions = {}): Promise<void> {
  const port = options.port ?? 3020;
  const apiBaseUrl = options.apiBaseUrl ?? process.env.ACL_API_BASE_URL ?? 'http://127.0.0.1:3010';
  const client = new AclApiClient(apiBaseUrl);

  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const inputUrl = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (method === 'GET') {
      if (inputUrl.pathname === '/assets/global.css') {
        try {
          const css = await loadGlobalCss();
          sendCss(res, css);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'load css failed';
          sendJson(res, 500, {
            code: 'INTERNAL_ERROR',
            message,
          });
        }
        return;
      }

      if (inputUrl.pathname === '/healthz') {
        sendJson(res, 200, {
          service: 'acl-console',
          status: 'ok',
          api_base_url: client.getBaseUrl(),
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (inputUrl.pathname === '/') {
        try {
          await handleIndex(req, res, client);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'render failed';
          sendJson(res, 500, {
            code: 'INTERNAL_ERROR',
            message,
          });
        }
        return;
      }

      notFound(res);
      return;
    }

    if (method === 'POST') {
      try {
        if (inputUrl.pathname === '/actions/review') {
          await handleReviewAction(req, res, client);
          return;
        }

        if (inputUrl.pathname === '/actions/activate') {
          await handleActivateAction(req, res, client);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'action failed';
        sendJson(res, 500, {
          code: 'INTERNAL_ERROR',
          message,
        });
        return;
      }

      notFound(res);
      return;
    }

    methodNotAllowed(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  });
}
