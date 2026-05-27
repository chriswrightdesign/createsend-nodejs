import type {
  CreateSendOptions,
  ErrorResponse,
  CreateSendErrorName,
  Response,
} from './interfaces.js';
import type {
  GetOptions,
  PostOptions,
  PutOptions,
  DeleteOptions,
} from './common/interfaces/index.js';

// Generated resource imports — DO NOT EDIT between the markers below.
// GENERATED:IMPORTS:START
import { Accounts } from './accounts/accounts.js';
import { Admins } from './admins/admins.js';
import { Anonymous } from './anonymous/anonymous.js';
import { BasicEmail } from './basic-email/basic-email.js';
import { Campaigns } from './campaigns/campaigns.js';
import { Clients } from './clients/clients.js';
import { Getfeedback } from './getfeedback/getfeedback.js';
import { Lists } from './lists/lists.js';
import { Message } from './message/message.js';
import { People } from './people/people.js';
import { Query } from './query/query.js';
import { Segments } from './segments/segments.js';
import { Send } from './send/send.js';
import { SmartEmail } from './smart-email/smart-email.js';
import { Statistics } from './statistics/statistics.js';
import { Subscribers } from './subscribers/subscribers.js';
import { SubscribersConsentToTrack } from './subscribers-consent-to-track/subscribers-consent-to-track.js';
import { Templates } from './templates/templates.js';
import { Util } from './util/util.js';
import { Workflowemails } from './workflowemails/workflowemails.js';
import { Workflows } from './workflows/workflows.js';
// GENERATED:IMPORTS:END

const DEFAULT_BASE_URL = 'https://api.createsend.com/api/v3.3';
const DEFAULT_USER_AGENT = 'createsend-node';

const STATUS_TO_ERROR_NAME: Record<number, CreateSendErrorName> = {
  400: 'validation_error',
  401: 'invalid_api_key',
  403: 'invalid_api_key',
  404: 'not_found',
  405: 'method_not_allowed',
  429: 'rate_limit_exceeded',
  500: 'internal_server_error',
  502: 'application_error',
  503: 'application_error',
};

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) params.append(k, String(item));
    } else {
      params.append(k, String(v));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export class Createsend {
  readonly key: string;
  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly authHeader: string;

  // Generated resource accessors — DO NOT EDIT between the markers below.
  // GENERATED:ACCESSORS:START
  readonly accounts!: Accounts;
  readonly admins!: Admins;
  readonly anonymous!: Anonymous;
  readonly basicEmail!: BasicEmail;
  readonly campaigns!: Campaigns;
  readonly clients!: Clients;
  readonly getfeedback!: Getfeedback;
  readonly lists!: Lists;
  readonly message!: Message;
  readonly people!: People;
  readonly query!: Query;
  readonly segments!: Segments;
  readonly send!: Send;
  readonly smartEmail!: SmartEmail;
  readonly statistics!: Statistics;
  readonly subscribers!: Subscribers;
  readonly subscribersConsentToTrack!: SubscribersConsentToTrack;
  readonly templates!: Templates;
  readonly util!: Util;
  readonly workflowemails!: Workflowemails;
  readonly workflows!: Workflows;
  // GENERATED:ACCESSORS:END

  constructor(key?: string, options: CreateSendOptions = {}) {
    const apiKey = key ?? process.env.CREATESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Missing API key. Pass it to the Createsend constructor or set CREATESEND_API_KEY.',
      );
    }
    this.key = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error(
        'No fetch implementation found. Use Node 18+ or pass options.fetch.',
      );
    }
    // HTTP Basic auth: API key as username, any non-empty password.
    const credentials = Buffer.from(`${this.key}:x`).toString('base64');
    this.authHeader = `Basic ${credentials}`;

    // GENERATED:CONSTRUCT:START
    this.accounts = new Accounts(this);
    this.admins = new Admins(this);
    this.anonymous = new Anonymous(this);
    this.basicEmail = new BasicEmail(this);
    this.campaigns = new Campaigns(this);
    this.clients = new Clients(this);
    this.getfeedback = new Getfeedback(this);
    this.lists = new Lists(this);
    this.message = new Message(this);
    this.people = new People(this);
    this.query = new Query(this);
    this.segments = new Segments(this);
    this.send = new Send(this);
    this.smartEmail = new SmartEmail(this);
    this.statistics = new Statistics(this);
    this.subscribers = new Subscribers(this);
    this.subscribersConsentToTrack = new SubscribersConsentToTrack(this);
    this.templates = new Templates(this);
    this.util = new Util(this);
    this.workflowemails = new Workflowemails(this);
    this.workflows = new Workflows(this);
    // GENERATED:CONSTRUCT:END
  }

  private headers(extra?: HeadersInit): Headers {
    const h = new Headers(extra);
    h.set('Authorization', this.authHeader);
    h.set('User-Agent', this.userAgent);
    h.set('Accept', 'application/json');
    if (!h.has('Content-Type')) h.set('Content-Type', 'application/json');
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { query?: Record<string, unknown>; headers?: HeadersInit },
  ): Promise<Response<T>> {
    const url = `${this.baseUrl}${path}${buildQuery(options?.query)}`;
    const headers = this.headers(options?.headers);

    let res: globalThis.Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      const error: ErrorResponse = {
        message: err instanceof Error ? err.message : String(err),
        statusCode: null,
        name: 'application_error',
      };
      return { data: null, error, headers: null };
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      responseHeaders[k] = v;
    });

    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const name = STATUS_TO_ERROR_NAME[res.status] ?? 'unknown_error';
      const body = parsed as { Message?: string; Code?: number } | string | undefined;
      const message =
        typeof body === 'object' && body && 'Message' in body && body.Message
          ? body.Message
          : typeof body === 'string' && body
            ? body
            : res.statusText || 'Request failed';
      const error: ErrorResponse = {
        message,
        statusCode: res.status,
        name,
        code: typeof body === 'object' && body && 'Code' in body ? body.Code : undefined,
      };
      return { data: null, error, headers: responseHeaders };
    }

    return { data: parsed as T, error: null, headers: responseHeaders };
  }

  get<T>(path: string, options?: GetOptions): Promise<Response<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  post<T>(path: string, body?: unknown, options?: PostOptions): Promise<Response<T>> {
    return this.request<T>('POST', path, body, options);
  }

  put<T>(path: string, body?: unknown, options?: PutOptions): Promise<Response<T>> {
    return this.request<T>('PUT', path, body, options);
  }

  delete<T>(path: string, options?: DeleteOptions): Promise<Response<T>> {
    return this.request<T>('DELETE', path, undefined, options);
  }
}
